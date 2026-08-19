# dsh-llm-dynamic-provider

`dsh-llm-dynamic-provider` 在 DeepSeek Harness 启动时探测你声明的模型端点，并把端点当前提供的模型注册成可用 Provider。它适合模型列表经常变化的 API 中转站、聚合网关和本地推理服务。

发现的模型目录不会写入 `settings.yaml`。你只需要保存端点和协议；每次启动时插件会重新读取模型列表。

## 安装

如果你拿到的是本仓库源码，先打包：

```sh
pnpm -C third-plugin/llm-dynamic-provider pack
```

安装到目标 profile：

```sh
dsh plugin --profile <name> add ./third-plugin/llm-dynamic-provider/dsh-llm-dynamic-provider-0.1.0.tgz
dsh --profile <name> --dump-config
```

`--dump-config` 中应出现 `llm-dynamic-provider`。

## 配置一个动态路由

在目标 profile 的 `cordis.patch.yml` 中配置已安装的插件行：

```yaml
- id: llm-dynamic-provider
  config:
    routes:
      upstream:
        baseURL: https://gateway.example.com/v1
        api: openai-completions
        apiKeyEnv: UPSTREAM_API_KEY
        displayName: 公司网关
        defaultContextWindow: 262144
        defaultMaxTokens: 32768
    cache: true
    timeoutMs: 10000
    maxResponseBytes: 4194304
    enrichment: true
```

把凭证写入 DSH 使用的 `.env` 或启动环境，不要把真实密钥提交到配置文件：

```text
UPSTREAM_API_KEY=你的密钥
```

重启 profile。探测成功后，路由名 `upstream` 会出现在模型选择器中，端点返回的模型都可以直接使用。

## 路由字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `baseURL` | 是 | 模型服务地址；路径必须与所选协议匹配 |
| `api` | 是 | `openai-completions`、`openai-responses`、`anthropic-messages` 或 `google-generative-ai` |
| `apiKeyEnv` | 否 | 凭证引用或环境变量名；本地无认证端点可以省略 |
| `displayName` | 否 | 在模型选择器中显示的 Provider 名称 |
| `defaultContextWindow` | 否 | 端点没有返回上下文窗口时使用的值 |
| `defaultMaxTokens` | 否 | 端点没有返回最大输出时使用的值 |

路由 ID（示例中的 `upstream`）只能使用小写字母、数字和连字符。

## 插件配置

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `cache` | `false` | 保存上一次成功发现的目录；端点暂时不可用时仍可启动旧目录 |
| `timeoutMs` | `10000` | 每次探测请求的超时时间，单位毫秒 |
| `maxResponseBytes` | `4194304` | 模型列表响应的最大字节数 |
| `enrichment` | `true` | 用内置模型目录补全端点未提供的名称和容量 |

修改 profile patch 后需要重启。安装了 `dsh-client-ui-settings-discovery` 时，也可以在「模型发现」页面的「动态路由」区域新增、编辑和删除路由。

## 协议和地址

| 服务 | `api` | `baseURL` 示例 |
|---|---|---|
| Ollama | `openai-completions` | `http://127.0.0.1:11434/v1` |
| LM Studio | `openai-completions` | `http://127.0.0.1:1234/v1` |
| llama.cpp | `openai-completions` | `http://127.0.0.1:8080` |
| OpenAI 兼容网关 / LiteLLM | `openai-completions` 或 `openai-responses` | 供应方提供的 `/v1` 地址 |
| Anthropic | `anthropic-messages` | 供应方提供的 Anthropic API 地址 |
| Google Gemini | `google-generative-ai` | `https://generativelanguage.googleapis.com/v1beta` |

## 启动和失败行为

- 每次启动都会重新探测所有路由。
- 探测成功后，端点返回的模型会出现在模型选择器中。
- 未启用缓存时，不可达、认证失败或返回空列表的路由不会注册。
- 启用缓存后，启动时先使用上一次成功目录，再尝试刷新。
- 端点返回的容量优先；缺失字段可由内置目录或路由默认值补全。

## 常见问题

### 路由没有出现在模型选择器中

检查启动日志。常见原因是端点不可达、API 密钥错误、协议选错或模型列表为空。

### 401 或 403

确认 `apiKeyEnv` 与 `.env` 中的名称一致，并确认密钥有读取模型列表和调用模型的权限。

### 本地服务不需要密钥

省略 `apiKeyEnv`。Ollama、LM Studio 和 llama.cpp 通常可以无认证使用。Anthropic、Gemini 和大多数公网网关需要密钥。

### 模型容量不准确

端点没有返回容量时，插件会使用内置目录或你设置的默认值。可以通过 `defaultContextWindow` 和 `defaultMaxTokens` 明确指定兜底值。

## 已知限制

- Anthropic 和 Gemini 每次最多读取 1000 个模型，不继续读取后续分页。
- 连续快速编辑同一路由可能产生重叠探测；一次保存后请等待探测完成再继续修改。
- 使用 Web 动态路由管理时，只应把 DSH Web 服务暴露给可信用户和可信网络。

## Model Experience

插件只改变可选的 Provider 和模型，不向模型请求添加 prompt、消息或工具定义。

#### KV Cache 影响

无。插件不修改模型请求前缀。
