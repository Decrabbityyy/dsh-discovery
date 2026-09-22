# dsh-llm-discovery

`dsh-llm-discovery` 为 DeepSeek Harness 提供端点模型探测。它通常与 [`dsh-client-ui-settings-discovery`](../ui-settings-discovery/README.md) 一起安装，让你在 Web 设置页输入一个端点、查看模型列表，再选择需要的模型创建 Provider。

探测只读取端点信息：本插件不保存 API 密钥，也不会自动把探测结果写进设置。在设置页采纳 Provider 时，密钥由页面存入凭证存储。

## 目录服务

本插件持有 models.dev 目录：挂载时读取，缓存在 `$DSH_HOME/storages/llm_models_dev_catalog.json`，之后增量刷新，并以 `modelsDevCatalog` 服务提供给组合里的其他插件。`dsh-llm-dynamic-provider` 与设置页面读的就是这一份。已有本地缓存时启动不等待联网；首次启动需要联网取第一份目录。

默认只在挂载时刷一次，之后可以在「模型目录」页手动刷；给 `catalogRefreshIntervalMinutes` 一个非零分钟数（例如 `1440` 表示一天），它就会按该间隔自动刷新。

`enrichment: false` 只影响本插件自己的探测回复：目录服务照常提供，但不联网刷新、只用本地已有的目录，也不补全自己的回复。

## 安装

从 npmjs 安装探测插件和设置页面：

```sh
dsh plugin --profile web add dsh-llm-discovery
dsh plugin --profile web add dsh-client-ui-settings-discovery
dsh --profile web --dump-config
```

输出中应同时出现 `llm-discovery` 和 `ui-settings-discovery`。

## 使用

1. 启动 Web profile。
2. 打开「设置」→「模型发现」。
3. 选择预设，或者填写自定义 `baseURL`。
4. 选择端点协议。
5. 如果端点需要认证，输入 API 密钥。
6. 点击「探测」。
7. 检查模型名称、上下文窗口和最大输出。
8. 选择要使用的模型并点击「采纳为 Provider」。

采纳完成后，到「模型」设置页查看和编辑新 Provider。

## 支持的端点

| 端点类型 | 协议 | 地址要求 |
|---|---|---|
| Ollama | `openai-completions` | 使用 `http://127.0.0.1:11434/v1`；探测会自动读取 Ollama 原生模型信息 |
| LM Studio | `openai-completions` | 通常为 `http://127.0.0.1:1234/v1` |
| llama.cpp | `openai-completions` | 通常为 `http://127.0.0.1:8080` |
| LiteLLM / OpenAI 兼容网关 | `openai-completions` 或 `openai-responses` | 使用供应方提供的模型 API baseURL |
| Anthropic | `anthropic-messages` | 使用 Anthropic API baseURL，并提供 API 密钥 |
| Google Gemini | `google-generative-ai` | baseURL 必须包含版本路径，例如 `https://generativelanguage.googleapis.com/v1beta` |

端点没有提供模型名称或容量时，插件默认会尝试用内置模型目录补全；无法确认的字段会在页面中显示为空。

## 可选配置

默认配置适合大多数用户。需要调整超时、响应大小或关闭某类探测时，在 profile 的 `cordis.patch.yml` 中配置：

```yaml
- id: llm-discovery
  config:
    timeoutMs: 10000
    maxResponseBytes: 4194304
    enrichment: true
    catalogRefreshIntervalMinutes: 0
    ollamaDefaultContextWindow: 128000
    engines:
      ollama: true
      litellm: true
      openaiModels: true
```

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `timeoutMs` | `10000` | 单次 HTTP 请求超时，单位毫秒 |
| `maxResponseBytes` | `4194304` | 模型列表响应上限；超过后探测失败 |
| `enrichment` | `true` | 用目录补全端点未披露的信息；`false` 时不联网刷新，只用本地已有的目录 |
| `catalogRefreshIntervalMinutes` | `0` | 目录自动刷新间隔，单位分钟；`0` 表示只在挂载时刷一次 |
| `ollamaDefaultContextWindow` | `128000` | Ollama 未返回上下文长度时使用的值 |
| `engines.ollama` | `true` | 是否探测 Ollama 原生接口 |
| `engines.litellm` | `true` | 是否探测 LiteLLM 管理接口 |
| `engines.openaiModels` | `true` | 是否探测 OpenAI、Anthropic 和 Gemini 模型列表 |

profile patch 会整体替换该插件的 `config`，因此需要保留你仍想使用的字段。

`catalogRefreshIntervalMinutes` 也可以在「设置」→「插件」→「模型目录」页里改：那里写的是用户层，保存后立即重排刷新定时器，不用重启；清掉用户层就回到这里配置的值。

## 常见问题

### 页面中没有「模型发现」

确认安装了 `dsh-client-ui-settings-discovery`，并使用 Web profile。再用 `dsh --profile web --dump-config` 检查两个插件是否都已加载。

### 401 或 403

API 密钥无效或没有列出模型的权限。确认密钥和协议对应同一个端点。

### 返回“没有模型列表”

该地址可能不是模型 API baseURL，或者服务没有实现模型列表接口。检查供应方文档；必要时在「模型」设置页手工添加模型。

### Gemini 探测失败

选择 `google-generative-ai`，并使用包含 `/v1beta` 的原生 Gemini baseURL。OpenAI 兼容地址应改选 OpenAI 协议。

### Ollama 能探测但采纳后无法对话

Provider 的 baseURL 必须包含 `/v1`。推荐直接使用页面预设，或照抄上面「支持的端点」表中的地址。

## 已知限制

- Anthropic 和 Gemini 每次最多读取 1000 个模型，不继续读取后续分页。
- 同一端点上的模型必须共用你在页面中选择的协议。
- 本插件不探测 `deepseek-official`；该 Provider 使用 Harness 自带配置。

## Model Experience

探测结果只显示给配置用户，不会进入模型的 prompt、消息、schema 或工具结果。

#### KV Cache 影响

无。插件不参与模型请求。
