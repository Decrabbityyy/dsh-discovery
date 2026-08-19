# dsh-llm-discovery

[English](README.md) | 中文

面向 [LLM 能力缝](../llm/README.md) 的引擎探测式端点模型发现。插件在 `ctx.llm.registerModelDiscovery` 上注册 `llm-discovery` 发现 offer，任何配置界面都可以通过现有的 `llm.discoverModels` RPC 以 `settingsNs: 'llm-discovery'` 探测一个尚在编辑的端点——不改动任何 adapter、网关或其他插件。发现词汇（请求草稿、候选模型形状）归能力缝所有；本包拥有引擎梯子与 enrichment 步骤。

## 梯子

一次探测按序走过引擎梯级，第一个认出端点的引擎获胜：

| 梯级 | 端点 | 读取的容量 |
|---|---|---|
| `ollama` | `GET /api/tags`，然后逐模型 `POST /api/show` | `model_info` 的 `*.context_length`；缺失时报 `ollamaDefaultContextWindow` |
| `litellm` | 按序 `GET /model_group/info`、`/v2/model/info`、`/model/info`、`/v1/model/info` | `max_input_tokens`/`context_window` 与 `max_output_tokens`/`max_tokens`，含条目内嵌的 `model_info` |
| `openai-models` | `GET {baseURL}/models` | `context_window`/`context_length`/vLLM 的 `max_model_len`，以及 `max_output_tokens`/`max_tokens` |

当草稿指定 `api: 'anthropic-messages'` 时，通用梯级切换为 Anthropic 方言：其 [Models API](https://platform.claude.com/docs/en/api/models/list) 是同样的 `data` 数组列举，但用 `x-api-key` 加必需的 `anthropic-version` 头认证（Bearer 是给 OAuth token 的），上下文窗口读 `max_input_tokens`，并以 `?limit=1000` 探测（文档页上限；不跟随 `has_more` 游标）。

当草稿指定 `api: 'google-generative-ai'` 时，同一梯级改用 Google 原生 [Models API](https://ai.google.dev/api/models)：`GET {baseURL}/models?pageSize=1000`、`x-goog-api-key` 认证，以及 `models` 数组。它保留支持 `generateContent` 的条目，优先用 `baseModelId` 作为请求 ID，并读取 `displayName`、`inputTokenLimit` 与 `outputTokenLimit`。传入的 `baseURL` 必须包含 API 版本路径，例如 `https://generativelanguage.googleapis.com/v1beta`。

特定梯级在前，因为 Ollama 主机也能回答 OpenAI 兼容列举但没有容量，而 LiteLLM 代理的 `/models` 是裸列表、其管理端点才有富元数据。梯级遇到 404、连接失败、无法解析或缺少预期负载形状的回答就跳到下一级；401/403 会被记为最值得报告的失败，在所有梯级都无果时抛出。调用方取消立即以 `ABORTED` 停止梯子。Ollama 梯级在拼接原生路径前会剥掉 base 末尾的 `/v1`，因此预设的 OpenAI 兼容 base URL 仍能到达 `/api/tags`。

## Enrichment

`enrichment` 开启时，端点未披露的字段会按精确模型 id 从 pi-ai 内置模型目录补齐：代理列举出没有容量的 `claude-haiku-4-5` 仍会得到完整描述的候选。端点上报的值永远优先；目录不认识的 id 保持诚实的未披露——[`LlmDiscoveredModel`](../llm/README.md) 契约正是为此把除 `id` 外的字段都设为可选。任何情况下都不按 id 模式推断。

## 草稿契约

请求即能力缝的 `LlmModelDiscoveryRequest`：`baseURL` 必填（本 namespace 不拥有路由也没有自己的目录，没有可短路的知识）；`apiKey` 提供时先经共享的 `normalizeApiKey` 校验再进入任何请求头，且从不落盘；`signal` 取消会被立即响应。返回值是配置界面可供采纳的候选元数据——这里不写任何 settings 或 credentials。

## 配置

```yaml
- id: llm-discovery
  name: 'dsh-llm-discovery'
  config:
    timeoutMs: 10000                  # per-request probe ceiling
    maxResponseBytes: 4194304         # replies past this are refused, not truncated
    enrichment: true                  # bundled-catalog fill of undisclosed fields
    ollamaDefaultContextWindow: 128000
    engines: { ollama: true, litellm: true, openaiModels: true }
```

所有字段可选，默认值如所示。本包是一个 [bundle](../../../../docs/user/develop/basic/publish.zh.md)：自带的 `cordis.patch.yml` 在 profile 安装它时插入 `llm-discovery` 行。

## 安装

本包是一个 [bundle](../../../../docs/user/develop/basic/publish.zh.md)：自带的 `cordis.patch.yml` 在 profile 安装它时插入 `llm-discovery` 行。

用**已安装的** `dsh` CLI 时，装打包好的 tarball——`dsh plugin add ./路径` 的 link 安装会让 Node 从 checkout 的真实位置向上解析插件的 harness 导入，而那条父级链上没有 `@deepseek-ai/*` 包：

```sh
pnpm -C third-plugin/llm-discovery pack
dsh plugin --profile <name> add ./third-plugin/llm-discovery/dsh-llm-discovery-0.1.0.tgz
dsh --profile <name> --dump-config   # 验证该层出现
```

用**源码检出**（`pnpm dsh …`）时，直接按路径安装即可——tsx 启动器会经仓库的 tsconfig paths 解析 harness 导入，适合开发迭代：

```sh
pnpm dsh plugin --profile <name> add ./third-plugin/llm-discovery
```

所有 harness 导入（`@deepseek-ai/*` 与 pi-ai 目录库）都是 peer 依赖，运行时从安装环境的依赖闭包解析，安装阶段不发生任何 npm 下载。用户针对 `llm-discovery` 行的 patch 会整体替换其 `config` 值而不是深合并。

## 模型体验

无，因为发现候选是提供给人类用户的配置期事实，从不进入 prompt、消息、schema 或工具结果。

#### KV Cache 影响

无；插件从不参与模型请求，因此不可能触及请求前缀。

## 已知限制与暂缓工作

- **无法报告逐模型的 wire 协议**——`LlmDiscoveredModel` 没有 `api` 字段，因此双 wire 代理的逐模型 `supported_endpoint_types`（OMP 的 `proxy` 发现类型）无法表达；采纳后的 profile 保留草稿的单一 `api`。
- **Ollama 引擎默认值优先于 enrichment**——`/api/show` 未披露上下文长度时，配置的 `ollamaDefaultContextWindow` 先填充该字段，目录步骤不再覆盖；本地 Ollama 变体是常见情形，且本来就不是目录里的模型。
- **不持久化答案来自哪个引擎**——每次探测都重新检测；保存后的路由 profile 不携带发现字段，因为那个 schema 属于 adapter 包。
- **超过 1000 个模型的 Anthropic 与 Google 列举会被截断**——各协议都请求文档规定的单页上限，但不跟随后续游标；真实部署不会接近这个量级。
- **不支持 `deepseek-official` 的发现**——该 adapter 在 `llm-deepseek` 目录条目下从自己配置的 catalog 回答；本 namespace 只探测端点。
