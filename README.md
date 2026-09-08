# DeepSeek Harness 模型发现插件

这组插件帮助你从 Ollama、LM Studio、llama.cpp、LiteLLM、OpenAI 兼容网关、Anthropic 和 Google Gemini 端点发现模型并加入 DeepSeek Harness。

## 选择插件

| 插件 | 用途 | 适合场景 |
|---|---|---|
| [`dsh-llm-discovery`](./llm-discovery/README.md) | 在 Web 设置页里探测端点，并按需采纳单个模型 | 先查看模型，再选择性添加 Provider |
| [`dsh-client-ui-settings-discovery`](./ui-settings-discovery/README.md) | 提供「模型发现」设置页面 | 使用 Web profile 配置模型 |
| [`dsh-llm-dynamic-provider`](./llm-dynamic-provider/README.md) | 启动时自动探测并注册整个模型目录 | 模型经常变化的中转站、聚合网关或本地服务 |

`llm-endpoint-base` 是这些插件共用的内部包。它是私有包，随上面三个插件一起发布，不需要单独安装。

常用组合：

- **在页面中探测并手动采纳模型：** 安装 `dsh-llm-discovery` 和 `dsh-client-ui-settings-discovery`。
- **让一个端点的模型目录自动保持更新：** 只安装 `dsh-llm-dynamic-provider`。
- **在页面中管理动态路由：** 安装 `dsh-llm-dynamic-provider` 和 `dsh-client-ui-settings-discovery`，不需要 `dsh-llm-discovery`。
- **同时使用页面探测和动态路由管理：** 安装三个插件。

## 安装

要求：已经安装 `dsh`，并已创建目标 profile。设置页面仅适用于 Web profile。

按需要从 npmjs 安装插件：

```sh
dsh plugin --profile web add dsh-llm-discovery
dsh plugin --profile web add dsh-client-ui-settings-discovery
dsh plugin --profile web add dsh-llm-dynamic-provider
```

只安装你需要的组合。`dsh plugin` 会把 npm 包加入目标 profile，并在该包声明了 `dsh.bundle` 时自动把它加进 profile 的 bundle 层列表；这三个插件都声明了。

确认插件已经进入配置：

```sh
dsh --profile web --dump-config
```

## 快速开始

### 在页面中发现模型

1. 安装 `dsh-llm-discovery` 和 `dsh-client-ui-settings-discovery`。
2. 启动 Web profile。
3. 打开「设置」→「模型发现」。
4. 选择 Ollama、LM Studio 或 llama.cpp 预设，或者填写自定义端点。
5. 选择协议并填写 API 密钥；本地无认证端点可以留空。
6. 点击「探测」，确认返回的模型名称、上下文窗口和最大输出。
7. 选择模型并点击「采纳为 Provider」。
8. 到「模型」设置页检查并使用新 Provider。

详见 [`dsh-client-ui-settings-discovery`](./ui-settings-discovery/README.md)。

### 自动管理一个端点的全部模型

安装 `dsh-llm-dynamic-provider`，然后在 `$DSH_HOME/settings.yaml` 的 `llm-dynamic-provider.routes` 下声明路由。插件在每次启动时都会重新探测这些路由，你在 `settings.yaml` 中改动路由后也会重新探测，不需要重启。探测成功后，该路由会出现在模型选择器中。

配置字段、凭证和缓存说明见 [`dsh-llm-dynamic-provider`](./llm-dynamic-provider/README.md)。

## 支持的端点

| 类型 | 推荐协议 | baseURL 示例 |
|---|---|---|
| Ollama | `openai-completions` | `http://127.0.0.1:11434/v1` |
| LM Studio | `openai-completions` | `http://127.0.0.1:1234/v1` |
| llama.cpp | `openai-completions` | `http://127.0.0.1:8080` |
| OpenAI 兼容网关 / LiteLLM | `openai-completions` 或 `openai-responses` | 供应方提供的 `/v1` 地址 |
| Anthropic | `anthropic-messages` | 供应方提供的 Anthropic API 地址 |
| Google Gemini | `google-generative-ai` | `https://generativelanguage.googleapis.com/v1beta` |

`baseURL` 指的是端点接受请求的 API 根地址，插件会在它后面自动补 `/models` 等路径。所以照抄上表的写法即可，其中 Ollama 必须带上 `/v1`。

## 开发：更新依赖后先跑兼容性检查

Harness 在运行时注入**它自己安装的那份** `@deepseek-ai/dsh-*`，而本仓库编译时用的是各包 `devDependencies` 里钉住的副本。两者一旦出现版本分叉（例如仓库钉的是 0.1.2-alpha.4，而宿主上的 `dsh` 已经是 0.1.5-rc.1），问题只会在插件加载时才暴露。`pnpm run check` 把这类问题提前到启动之前：

```sh
pnpm run check                    # 全量：依赖版本 → pi-ai 对齐 → 运行时导出 → 类型 → 宿主声明 → 清单
pnpm run check -- --host <dir>    # 指定宿主树（默认自动找 PATH 上的 dsh 和 DSH_HOME 下的 profile）
pnpm run check -- --only deps,types
pnpm run check -- --no-tests      # 只扫 src（只影响 surface / host-types；types 那道始终查 src+tests）
pnpm run check -- --verbose       # 打印每个 peer 的「编译期 / 宿主」版本表
pnpm run check -- --require-host  # 找不到宿主树就直接失败（CI 想强制校验宿主时用）
pnpm run sync:pi-ai               # 把 @earendil-works/pi-ai 对齐到 dsh-llm-pi-ai 依赖的那个范围
pnpm run sync:pi-ai -- --check    # 只报告偏离，不写回（CI 用）

pnpm run check:deps               # 等价于 --only deps
pnpm run check:pi-ai              # 等价于 --only pi-ai
pnpm run check:host               # 等价于 --only surface,host-types
pnpm run check:types              # 等价于 --only types
pnpm run check:manifest           # 等价于 --only manifest
```

`@earendil-works/pi-ai` 的版本不由本仓库决定：宿主把 `ResolvedPiAiProviderProfile` 连同它那份 `Provider` 类型一起交给我们，编译期若对着另一份编译就会撞类型。所以唯一的权威是所钉的 `@deepseek-ai/dsh-llm-pi-ai` 自己声明的 pi-ai 范围，`sync:pi-ai` 负责照抄，`pi-ai` 这道门负责在它偏离时报错。

退出码 0 表示：编译期与宿主两份声明都能通过、peer 范围接受宿主版本、所有 harness 说明符在宿主上可解析、清单声明合法；退出码 1 表示有检查失败；退出码 2 表示参数错误，或给了 `--require-host` 却没找到宿主树。

六道检查各自拦下的问题：

| 检查 | 拦下的问题 |
|---|---|
| `deps` | peer 范围不再接受宿主的版本；同一依赖在各包里钉了不同版本；peer 没有在 `devDependencies` 里钉住 |
| `pi-ai` | `@earendil-works/pi-ai` 的版本偏离了 `@deepseek-ai/dsh-llm-pi-ai` 自己依赖的那条线——两份 pi-ai 会让 `Provider` 类型互不相认，表现为组装 profile 时的 TS2430/TS2352 |
| `surface` | 插件 import 的子路径/包在宿主上不存在；某个具名导出在宿主的运行时模块里消失了；同一个包在多个宿主根里出现不兼容版本 |
| `types` | `tsc -b` 只检查 src，tsdown 不做类型检查——这道检查把 `src` + `tests` 一起检查（noEmit），依赖升级打挂测试代码时不必等到跑 vitest |
| `host-types` | **核心**：用宿主的 `.d.ts`（而不是仓库里的副本）重新类型检查插件源码，报错精确到 file:line |
| `manifest` | `dsh.bundle.patch` 指向的文件缺失或不在 `files` 里；`dsh.client` 声明不合法（宿主会在启动时抛错）；`exports` 的产物没被 `files` 覆盖 |

门禁自身的实现细节、六道检查的取舍、宿主树查找规则与新增检查的写法见 [`scripts/compat/README.md`](./scripts/compat/README.md)。CI（`.github/workflows/publish.yml`）在测试与发布前跑这道门；本地在 `pnpm install` 之后或改完依赖后先跑一次，再启动 harness。

失败时会直接指到要改的位置，例如：

```text
FAIL  llm-dynamic-provider: host injects @deepseek-ai/dsh-llm@0.1.5-rc.2 which is outside peer range ^0.1.2-alpha.4
      (0.1.5-rc.2 is a prerelease and "^0.1.2-alpha.4" has no prerelease comparator for 0.1.5)
FAIL  llm-dynamic-provider/src/provider.ts:138:10  TS2352  Conversion of type ... to type 'ResolvedPiAiProviderProfile' may be a mistake
```

## 常见问题

- **401/403：**检查 API 密钥，以及协议是否与端点匹配。
- **探测为空：**确认端点提供模型列表接口，并且当前凭证有读取权限。
- **Ollama 能探测但无法对话：**Provider 的 baseURL 必须包含 `/v1`。
- **Gemini 探测失败：**使用包含 `/v1beta` 的原生 Gemini baseURL，不要使用 OpenAI 兼容地址。
- **新 Provider 没有出现在选择器中：**先查看启动日志中的探测错误，再确认插件是否已出现在 `--dump-config` 输出中。
