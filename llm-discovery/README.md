# dsh-llm-discovery

`dsh-llm-discovery` 为 DeepSeek Harness 提供端点模型探测。它通常与 [`dsh-client-ui-settings-discovery`](../ui-settings-discovery/README.md) 一起安装，让你在 Web 设置页输入一个端点、查看模型列表，再选择需要的模型创建 Provider。

探测只读取端点信息。输入的 API 密钥不会由本插件保存，探测结果也不会自动写入设置。

## 安装

如果你拿到的是本仓库源码，先打包：

```sh
pnpm -C third-plugin/llm-discovery pack
pnpm -C third-plugin/ui-settings-discovery pack
```

安装探测插件和设置页面：

```sh
dsh plugin --profile web add ./third-plugin/llm-discovery/dsh-llm-discovery-0.1.0.tgz
dsh plugin --profile web add ./third-plugin/ui-settings-discovery/dsh-client-ui-settings-discovery-0.1.0.tgz
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
| `enrichment` | `true` | 用内置目录补全端点未披露的信息 |
| `ollamaDefaultContextWindow` | `128000` | Ollama 未返回上下文长度时使用的值 |
| `engines.ollama` | `true` | 是否探测 Ollama 原生接口 |
| `engines.litellm` | `true` | 是否探测 LiteLLM 管理接口 |
| `engines.openaiModels` | `true` | 是否探测 OpenAI、Anthropic 和 Gemini 模型列表 |

profile patch 会整体替换该插件的 `config`，因此需要保留你仍想使用的字段。

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

Provider 的 baseURL 必须包含 `/v1`。推荐直接使用页面预设。

## 已知限制

- Anthropic 和 Gemini 每次最多读取 1000 个模型，不继续读取后续分页。
- 同一端点上的模型必须共用你在页面中选择的协议。
- 本插件不探测 `deepseek-official`；该 Provider 使用 Harness 自带配置。

## Model Experience

探测结果只显示给配置用户，不会进入模型的 prompt、消息、schema 或工具结果。

#### KV Cache 影响

无。插件不参与模型请求。
