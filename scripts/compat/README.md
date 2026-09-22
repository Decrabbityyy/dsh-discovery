# scripts/compat

这组脚本比较两侧的 harness 依赖：仓库编译时钉在 `devDependencies` 里的 `@deepseek-ai/dsh-*`，与运行时宿主实际注入的那一份。两侧分叉时问题通常要到插件加载才暴露，所以这里在启动前把差异、以及需要改动的文件位置列出来。

## 运行

```sh
pnpm run check                    # 全部六项：依赖版本 → pi-ai 对齐 → 运行时导出 → 类型 → 宿主声明 → 清单
pnpm run check -- --host <dir>    # 指定宿主树（默认自动查找 PATH 上的 dsh 与 DSH_HOME 下的 profile）
pnpm run check -- --only deps,types
pnpm run check -- --no-tests      # 只扫 src（影响 surface / host-types；types 始终检查 src + tests）
pnpm run check -- --verbose       # 打印每个 peer 的「编译期 / 宿主」版本表
pnpm run check -- --require-host  # 找不到宿主树时直接失败

pnpm run check:deps               # 等价于 --only deps
pnpm run check:pi-ai              # 等价于 --only pi-ai
pnpm run check:host               # 等价于 --only surface,host-types
pnpm run check:types              # 等价于 --only types
pnpm run check:manifest           # 等价于 --only manifest
```

退出码：`0` 通过（允许有 warning）；`1` 有 FAIL；`2` 参数错误，或给了 `--require-host` 但没找到宿主树。

## 检查项

| id | 标题 | 需要宿主 | 检查内容 |
|---|---|---|---|
| `deps` | dependency versions | 否 | peer 范围是否接受宿主版本（含 npm 的预发布规则）；同一依赖在各包是否钉了同一范围；peer 是否在 `devDependencies` 里有对应副本 |
| `pi-ai` | pi-ai alignment | 否 | `@earendil-works/pi-ai` 的声明是否与所钉 `dsh-llm-pi-ai` 自己依赖的范围一致 |
| `surface` | harness surface | 是 | 插件 import 的 specifier 是否在宿主的 exports 映射里可解析；具名导出是否存在于宿主的运行时模块（不只看 `.d.ts`）；同名包在多个宿主根上是否为兼容版本 |
| `types` | workspace types (src + tests) | 否 | `tsc -b` 只覆盖 `src`，tsdown 不做类型检查；这一项用 `noEmit` 把 `src` 与 `tests` 一起检查 |
| `host-types` | plugin sources vs host declarations | 是 | 按宿主 exports 把每个 harness specifier 映射到宿主的 `.d.ts`，重新类型检查插件源码与测试，报告精确到 `file:line` |
| `manifest` | dsh manifest contract | 否 | `dsh.bundle.patch` 指向的文件是否存在且在 `files` 里；`dsh.client` 声明是否合法；`exports` 的产物是否被 `files` 覆盖 |

`surface` 与 `host-types` 需要宿主树，找不到时自报 `skip`，其余四项照常运行；CI 上没有 harness 安装，就是这个形态。

## 宿主树解析

按优先级查找，同一个包由先出现的根提供：

1. `--host <dir>`（可重复）——目录本身或它的 `node_modules`，只要含 `@deepseek-ai` 即可；npm 安装的 CLI 把依赖闭包嵌在 `dsh` 包内部，所以还会认领 `<host>/@deepseek-ai/dsh/node_modules`；
2. PATH 上的 `dsh` 启动器（`dsh.cmd` / `dsh.exe` / `dsh.ps1` / `dsh`），自该目录向上最多 6 层查找 `node_modules/@deepseek-ai/dsh`；
3. `$DSH_HOME/profiles/*/node_modules`——Web 端插件依赖的几个 client 包只在这里。

找不到时输出 `host (not found — pass --host <dir> or set DSH_HOME)`。要针对即将升级到的那版宿主预检，把它的依赖闭包装到任意目录再 `--host` 指过去即可；本仓库开发时用的是 `.compat/hosts/rc1`。

多个根会按顺序回退：某个包只在旧 profile 里存在时，指向新宿主的那次检查也会通过。传了 `--host` 时其余根仍参与回退，判断某个包在宿主上是否存在要看 `surface` 的 note 行。

## pi-ai 的版本来源

`@earendil-works/pi-ai` 由宿主决定：宿主把 `ResolvedPiAiProviderProfile` 连同它那份 `Provider` 类型一起交回来，编译期用另一份就会撞类型。权威是所钉 `@deepseek-ai/dsh-llm-pi-ai` 自己声明的 pi-ai 范围。

```sh
pnpm run sync:pi-ai               # 把权威范围写到每个 peer/dev 声明
pnpm run sync:pi-ai -- --check    # 只报告偏离，不写回（CI 用，有偏离则退出 1）
```

`pi-ai` 这一项按同一条规则判定：任何一处声明偏离权威就 FAIL，并在输出里给出上面的命令。宿主那份 `dsh-llm-pi-ai` 若属于另一条发布线（例如机器上是 0.1.2-alpha.5、钉 `^0.84.2`），只报 warn——仓库同时支持多条宿主线，而一个包只能对着一个 pi-ai 编译；最终判定兼容性的是 `host-types`，它拿宿主的 `.d.ts` 重新编译插件源码。

## 生成物

都在 git 忽略的 `.compat/` 下：

- `.compat/host-types/tsconfig.json`——`host-types` 每次生成的映射工程，出问题时可以直接打开查看映射结果；
- `.compat/last-command.log`——最近一次 `tsc` 的完整输出。编译器输出写文件而不是管道：部分沙箱下管道 stdio 不可用，写文件可以避免把「编译器没跑起来」当成「编译通过」。

## 新增检查

`checks/` 下每个模块导出同一份契约，然后在 `check.mjs` 的 `CHECKS` 数组里注册，数组顺序即执行顺序：

```js
export const id = 'my-check'
export const title = 'what it proves'
export const needsHost = false          // true：没找到宿主树时自报 skip

export function run(context) {
  // context = { packages, hostRoots, hostByName, options, rootManifest }
  const lines = []
  const issues = []
  return {
    id,
    title,
    status: issues.some((i) => i.level === 'fail') ? 'fail' : (issues.length > 0 ? 'warn' : 'ok'),
    summary: '一行结论',
    lines: [...lines, ...issues.map((i) => (i.level === 'fail' ? 'FAIL  ' : 'warn  ') + i.text)],
  }
}
```

`run()` 抛出异常时其余检查照常运行，这一项记为 `check crashed` 并按 FAIL 处理。只返回 warn 不会让退出码变成非零。

## lib.mjs 导出

刻意零依赖：仓库里没有 semver 与 YAML 解析器，而这些检查要在 lockfile 刚被重写之后就能跑。

| 类别 | 导出 |
|---|---|
| 路径与读写 | `WORKSPACE_ROOT`、`REPORT_DIR`、`readJson`、`rel`、`workspacePackages` |
| 源码扫描 | `scanImports`（import / export-from / 动态 import / require / declare module）、`isBare`、`packageNameOf` |
| 宿主解析 | `discoverHostRoots`、`hostPackages`、`hostPackage`、`hostEntry`、`providesTypes`、`installedPackage` |
| semver | `parseVersion`、`compareVersions`、`satisfies`（含 npm 的预发布规则） |
| 编译器 | `tscBin`、`spawnCapture`、`runTsc` |
| 清单 | `matchesFilesPattern` |

## CI

[`.github/workflows/publish.yml`](../../.github/workflows/publish.yml) 在测试与发布之前运行 `pnpm run check`。runner 上没有 harness 安装，因此 `surface` / `host-types` 自报 skip，`deps` / `pi-ai` / `types` / `manifest` 照常运行。

## 输出说明

- `host (not found — pass --host <dir> or set DSH_HOME)`：没找到宿主树；用 `--host` 指定，或加 `--require-host` 要求必须存在。
- `compiled (nothing installed — run pnpm install)`：依赖还没装，版本对照表为空。
- `pass with N warning(s)`：警告不影响退出码，每条都对应一个具体风险（peer 未被任何宿主根提供、宿主与仓库跨了不同发布线等）。
- `RESULT: N check(s) failed`：这些项需要先修掉再启动 harness。
- 在受限沙箱里运行 `pnpm install` / `build` / `test` 可能失败或长时间无进展（要落盘大量小文件并以管道方式 spawn 子进程）；检查本身只以文件方式 spawn `tsc`，在 workspace-write 下即可运行。
