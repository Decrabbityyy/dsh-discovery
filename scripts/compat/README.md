# 兼容性门禁（scripts/compat）

启动 harness **之前**回答一个问题：这次依赖变动之后，哪些插件源码文件必须改？

Harness 在运行时注入**它自己安装的那份** `@deepseek-ai/dsh-*`，而本仓库编译时用的是各包
`devDependencies` 里钉住的副本。两者一旦分叉，问题只会在插件加载时才暴露——这道门把它提前到启动之前。

三道真实拦下来的问题：

| 场景 | 症状 | 拦截点 |
|---|---|---|
| peer 范围 `^0.1.2-alpha.4` 遇上宿主 `0.1.5-rc.2` | npm 的预发布规则要求 range 里有同一个 `x.y.z` 元组的预发布比较符，于是宿主版本「明明更大」却不满足 | [`deps`](checks/deps.mjs) |
| 仓库钉 `@earendil-works/pi-ai` 0.84.4、宿主那份是 0.85.1 | 两份 pi-ai 让 `Provider` 类型互不相认，组装 profile 时报 TS2430/TS2352 | [`pi-ai`](checks/pi-ai.mjs) |
| `@deepseek-ai/dsh-client-runtime` 在 0.1.5 被删除 | 客户端半边 import 的包在宿主上根本不存在，只有加载时才会报错 | [`surface`](checks/surface.mjs) / [`host-types`](checks/host-types.mjs) |

## 快速开始

```sh
pnpm run check                    # 全量：依赖版本 → pi-ai 对齐 → 运行时导出 → 类型 → 宿主声明 → 清单
pnpm run check -- --host <dir>    # 指定宿主树（默认自动找 PATH 上的 dsh 和 DSH_HOME 下的 profile）
pnpm run check -- --only deps,types
pnpm run check -- --no-tests      # 只扫 src（只影响 surface / host-types；types 那道始终查 src+tests）
pnpm run check -- --verbose       # 打印每个 peer 的「编译期 / 宿主」版本表
pnpm run check -- --require-host  # 找不到宿主树就直接失败（CI 想强制校验宿主时用）

pnpm run check:deps               # 等价于 --only deps
pnpm run check:pi-ai              # 等价于 --only pi-ai
pnpm run check:host               # 等价于 --only surface,host-types
pnpm run check:types              # 等价于 --only types
pnpm run check:manifest           # 等价于 --only manifest
```

**退出码**：`0` 通过（可能带 warning）；`1` 有 FAIL；`2` 参数错误，或给了 `--require-host` 却没找到宿主树。

## 六道检查

| id | 标题 | 需要宿主 | 拦下的问题 |
|---|---|---|---|
| `deps` | dependency versions | 否 | peer 范围不再接受宿主的版本；同一依赖在各包里钉了不同范围；peer 没有在 `devDependencies` 里钉住 |
| `pi-ai` | pi-ai alignment | 否 | `@earendil-works/pi-ai` 偏离了所钉 `dsh-llm-pi-ai` 自己依赖的那条线 |
| `surface` | harness surface | 是 | 插件 import 的子路径/包在宿主的 exports 映射里不存在；某个具名导出在宿主的**运行时**模块里消失了（不只是 `.d.ts`）；同名包在多个宿主根上出现不兼容版本 |
| `types` | workspace types (src + tests) | 否 | `tsc -b` 只查 src，tsdown 不做类型检查——这道用 `noEmit` 把 `src` + `tests` 一起查 |
| `host-types` | plugin sources vs host declarations | 是 | **核心**：把每个 harness 说明符按宿主自己的 exports 映射到宿主的 `.d.ts`，重新类型检查插件源码，报错精确到 `file:line` |
| `manifest` | dsh manifest contract | 否 | `dsh.bundle.patch` 指向的文件缺失或不在 `files` 里；`dsh.client` 声明不合法（宿主会在启动时抛错）；`exports` 的产物没被 `files` 覆盖 |

`surface` 与 `host-types` 标了「需要宿主」：没找到宿主树时它们会自报 `skip`，其余四道照跑。CI 里没有
harness 安装时就是这种形态。

## 宿主树是怎么找的

按优先级（同名的包**先出现的根获胜**）：

1. `--host <dir>`（可重复）——目录本身或它的 `node_modules`，只要含 `@deepseek-ai` 即可；npm 安装的 CLI 会把整个依赖闭包嵌在 `dsh` 包内部，所以还会额外认领 `<host>/@deepseek-ai/dsh/node_modules`；
2. PATH 上的 `dsh` 启动器（`dsh.cmd` / `dsh.exe` / `dsh.ps1` / `dsh`），自该目录向上最多 6 层找 `node_modules/@deepseek-ai/dsh`；
3. `$DSH_HOME/profiles/*/node_modules`——Web 端插件需要的那几个 client 包只在这里。

找不到宿主时输出 `host (not found — pass --host <dir> or set DSH_HOME)`。想按「即将升级到的那版宿主」预检，
把它的依赖闭包装到任意目录再 `--host` 指过去即可（本仓库开发时用的是 `.compat/hosts/rc1`）。

注意多根回退会**掩盖**问题：某个包只在旧 profile 里存在时，指向新宿主的那次检查也会通过。给
`--host` 时其余根仍参与回退，判断「宿主到底有没有这个包」要看 `surface` 的 note 行。

## pi-ai 的版本从哪来

`@earendil-works/pi-ai` 不由本仓库决定：宿主把 `ResolvedPiAiProviderProfile` 连同它那份 `Provider`
类型一起交回来，编译期用另一份就会撞类型。唯一的权威是所钉 `@deepseek-ai/dsh-llm-pi-ai` 自己声明的
pi-ai 范围：

```sh
pnpm run sync:pi-ai               # 照抄权威范围到每个 peer/dev 声明
pnpm run sync:pi-ai -- --check    # 只报告偏离，不写回（CI 用，有偏离则退出 1）
```

`pi-ai` 这道门强制执行同一条规则：任何一处声明偏离权威就 FAIL，并直接把上面这条命令念给你。
宿主那份 `dsh-llm-pi-ai` 若在另一条线（例如机器上还是 0.1.2-alpha.5，钉 `^0.84.2`），只报 **warn**——
仓库同时支持多条宿主线，而一个包只能对着一个 pi-ai 编译；真正判定兼容的是 `host-types`（拿宿主
`.d.ts` 重编插件源码）。

## 生成物

都在 git 忽略的 `.compat/` 下：

- `.compat/host-types/tsconfig.json`——`host-types` 每次生成的映射工程，出问题时可以直接打开看映射结果；
- `.compat/last-command.log`——最近一次 `tsc` 的完整输出。编译器输出走**文件**而不是管道：部分沙箱下管道
  stdio 不可用，而这道门绝不能把「编译器没跑起来」误判成「编译通过」。

## 新增一道检查

`checks/` 下每个模块导出同一个契约，然后在 `check.mjs` 的 `CHECKS` 数组里注册（数组顺序即执行顺序）：

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

`run()` 抛出异常时门禁不会中断，只会把这道检查记成 `check crashed` 并按 FAIL 处理。只返回 `warn` 不会让退出码变成非零。

## lib.mjs 工具箱

刻意**零依赖**：仓库既没有 semver 也没有 YAML 解析器，而这道门必须在 lockfile 刚被重写之后就能跑。

| 类别 | 导出 |
|---|---|
| 路径与读写 | `WORKSPACE_ROOT`、`REPORT_DIR`、`readJson`、`rel`、`workspacePackages` |
| 源码扫描 | `scanImports`（import / export-from / 动态 import / require / declare module）、`isBare`、`packageNameOf` |
| 宿主解析 | `discoverHostRoots`、`hostPackages`、`hostPackage`、`hostEntry`、`providesTypes`、`installedPackage` |
| semver | `parseVersion`、`compareVersions`、`satisfies`（含 npm 的预发布规则） |
| 编译器 | `tscBin`、`spawnCapture`、`runTsc` |
| 清单 | `matchesFilesPattern` |

## CI

[`.github/workflows/publish.yml`](../../.github/workflows/publish.yml) 在测试与发布之前跑 `pnpm run check`；
runner 上没有 harness 安装，因此 `surface` / `host-types` 自报 skip，`deps` / `pi-ai` / `types` /
`manifest` 照常把关。

## 排错

- **`host (not found)`**：传 `--host <dir>`，或设 `DSH_HOME`；要强制要求宿主树存在就加 `--require-host`。
- **`pass with N warning(s)`**：警告不会挡住发布，但每条都说明了具体风险（peer 未被任何宿主根提供、
  宿主与仓库跨了不同的频道等），值得逐条读过再决定。
- **在受限沙箱里跑 `pnpm install` / `build` / `test`**：这些命令要落盘大量小文件、并以管道方式 spawn
  子进程，可能直接失败或长时间无进展；门禁本身只以文件方式 spawn `tsc`，在 workspace-write 下即可运行。
- **改了依赖却没重装**：`compiled` 那一行会显示 `(nothing installed — run pnpm install)`。
