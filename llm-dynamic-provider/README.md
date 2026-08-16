# dsh-llm-dynamic-provider

中文 | [English](README.en.md)

[LLM 能力](../../../packages/llm/llm/README.md)的运行时模型发现，形态对齐 OMP 的可发现 provider。它为 **API 中转站/聚合网关**而生：这类网关把多家 provider 的几十个模型收拢在一个 OpenAI 兼容端点后面。手工声明这样的路由意味着把每个模型条目逐一写进配置，网关一更新阵容就得重来——动态路由只需声明端点一次，目录即跟随网关：模型上架、下架、容量变更，下次启动自动跟进，无需手工重新采纳。

为本插件声明的路由会在**每次启动时重新探测其端点，并直接注册进内存 LLM 注册表**——发现的目录绝不写 `settings.yaml`，也不碰任何其他插件的配置。

路由声明在本插件自有的 `llm-dynamic-provider` settings 命名空间里：cordis.yml 条目 config 的 `routes` 是组合基底，配置界面（兄弟设置面板，或直接手改 `settings.yaml` 里的该命名空间）可以实时增、删、改路由——热编辑无需重启即重新探测。

本插件托管**自己的** `PiAiAdapter`（该类是已发布入口导出），通过 pi-ai 公开的按协议工厂服务四种线路协议——`openai-completions`、`openai-responses`、`anthropic-messages`、`google-generative-ai`——因此流式、重试、空闲看门狗、图像处理都是 pi-ai 自己的实现，而非重写。

## 一次重探测注册什么

对每条已声明的路由，探测端点后按固定优先级从三个来源组装出 resolved pi-ai profile:

| 字段 | 来源 |
|---|---|
| `id` | 端点的列表（唯一必需的事实） |
| `contextWindow` / `maxTokens` | 端点披露则用之，否则按精确 id 查内置 pi-ai 目录，否则用路由的 `defaultContextWindow` / `defaultMaxTokens` |
| `name` | 按精确 id 查内置目录，否则用 id 本身 |
| `reasoning` / 思考档位 | 内置目录的 `thinkingLevelMap` 经 `getSupportedThinkingLevels` 翻译——仅对目录记录为可推理的 id |

端点上报的值永远优先；绝不在 id 模式上做任何推断。目录里已知的 id 到达时即可供选择器使用（显示名、容量、思考档位）；端点和目录都无法描述的 id 只保留路由默认值所提供的部分。

## 生命周期语义

- **目录内存态，每次启动重建。** 注册走 `ctx.llm.registerAdapter`，探测一答路由即出现在选择器里，插件卸载即消失。settings 文档承载的只是路由声明；发现的模型列表只活在注册表里。
- **失败或空探测不产生路由。** 不可达、未认证、或返回空列表的端点记入 `failed`，直接不注册——绝不会产生选择器无法服务的零模型路由。开启 `cache` 时，已发现的目录在端点宕机期间继续让路由可用。
- **可选缓存。** `cache: true` 时发现的目录持久化到 `$DSH_HOME/llm-dynamic-provider-cache.json`。冷启动先从缓存注册，待端点应答后由实时探测原子地刷新注册（`replace`)——即 OMP 的 model-cache 姿态。默认关闭：每次启动同步探测。
- **四种协议。** 路由的 `api` 同时决定发现方言与流式实现：两个 OpenAI 协议用 OpenAI 兼容列表，`anthropic-messages` 用 Anthropic 的 `?limit=1000` 列表，`google-generative-ai` 用 Google 的列表。

## 配置

路由声明住在 `llm-dynamic-provider` settings 命名空间，其组合基底是 cordis.yml 条目 config（命名空间持久化的是路由*声明*；发现的目录是运行时状态，绝不持久化）:

```yaml
- id: llm-dynamic-provider
  name: 'dsh-llm-dynamic-provider'
  config:
    routes:
      upstream:
        baseURL: https://gateway.internal/v1
        api: openai-completions      # openai-responses | anthropic-messages | google-generative-ai
        apiKeyEnv: UPSTREAM_API_KEY  # 经凭证缝解析，回落到环境变量
        displayName: Upstream
        defaultContextWindow: 262144 # 未披露模型的兜底
        defaultMaxTokens: 32768
      local-gemini:
        baseURL: http://127.0.0.1:8000
        api: google-generative-ai
    cache: true                      # 把目录持久化到 $DSH_HOME
    timeoutMs: 10000                 # 单请求探测上限
    maxResponseBytes: 4194304        # 超过即拒绝
    enrichment: true                 # 内置目录补全未披露字段
```

路由字段除 `baseURL`、`api` 外均可选，探测旋钮亦然。插件与 LLM、settings 能力并列组合（`inject: ['llm', 'settings']`)；凭证能力可选——命名了 `apiKeyEnv` 时优先经它解析，未挂载则回落到进程环境。不命名 `apiKeyEnv` 的路由以**无认证**方式探测与流式请求：在 `openai-completions` 协议上请求不携带任何凭证，这正是免费额度与本地引擎端点所期望的（错误的 bearer 会被直接拒绝）。

## 安装

本包是一个 [bundle](../../../docs/user/develop/basic/publish.md)：其自带的 `cordis.patch.yml` 在 profile 安装它时插入 `llm-dynamic-provider` 行。发现引擎已内联（`tsdown` `alwaysBundle`)，因此 tarball 除 profile 已携带的 harness peer(`@deepseek-ai/*`、`@earendil-works/pi-ai`）外自洽。

使用**已安装**的 `dsh` CLI，安装打包好的 tarball:

```sh
pnpm -C third-plugin/llm-dynamic-provider pack
dsh plugin --profile <name> add ./third-plugin/llm-dynamic-provider/dsh-llm-dynamic-provider-0.1.0.tgz
dsh --profile <name> --dump-config   # 确认该层出现
```

在**源码检出**里（`pnpm dsh …`)，直接按路径添加即可，因为 tsx 启动器会经仓库的 tsconfig paths 解析 harness 导入：

```sh
pnpm dsh plugin --profile <name> add ./third-plugin/llm-dynamic-provider
```

## 包间依赖与分工

本仓四个包构成一套发现体系，依赖方向单向：

```
dsh-llm-endpoint-base（纯库，不单独安装，内联进各 tarball）
  ├── dsh-llm-dynamic-provider   本包：自治运行时托管
  ├── dsh-llm-discovery          只读探测 offer
  └── dsh-client-ui-settings-discovery  设置面板
        ├── 发现区块 → llm-discovery 的探测 RPC
        └── 动态路由区块 → 本包的 /llm-dynamic-provider/routes 端点
```

- **`dsh-llm-endpoint-base`**（内部库，不单独安装）：引擎阶梯（Ollama / LiteLLM / OpenAI 兼容）、有界探测 HTTP、models.dev 目录解析与持久化、共享词汇（协议、命名空间、路由 id 规则）。它**内联**进本包的 tarball（`tsdown` `alwaysBundle`)，所以安装本包不需要单独装它；`llm-discovery` 与设置面板同理。
- **`dsh-llm-discovery`**：只读探测器，由配置界面按需驱动（其结果是供用户*采纳*进 settings 路由的提案），与本包共用 endpoint-base 的引擎与补全；差别只在答案落在哪里——一个是用户拥有的持久化 pi-ai 路由，一个是本插件拥有的内存注册。
- **`dsh-client-ui-settings-discovery`**：那个配置界面。它的动态路由区块通过本包暴露的 HTTP 端点（`/llm-dynamic-provider/routes`，绕过 settings 代理的暴露门）实时增删改本插件的命名空间；发现区块则走 `llm-discovery` 的探测 RPC。面板对本包是**可选的**：没有它，cordis.yml 里的声明照常工作。

本包是自治的运行时互补面：路由一次性声明即纳入托管，之后每次启动都让它的目录在注册表里保持最新，无需确认步骤；持久化的只有声明，发现的目录绝不落盘。

对 harness 的依赖（`@deepseek-ai/*`、`@earendil-works/pi-ai`）全部是 peer dependency，运行时从安装的依赖闭包解析：`llm` 与 `settings` 能力**必需**（`inject` 声明）；`credentials`、`storageDomain`、`webServer` 均**可选**——无 credentials 时回落进程环境，无 storageDomain 时 models.dev 目录只存内存，无 webServer 时跳过 HTTP 端点（面板随之不可用）。
