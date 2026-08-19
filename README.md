# DeepSeek Harness 模型发现插件

这组插件帮助你从 Ollama、LM Studio、llama.cpp、LiteLLM、OpenAI 兼容网关、Anthropic 和 Google Gemini 端点发现模型，并把模型加入 DeepSeek Harness。

## 选择插件

| 插件 | 用途 | 适合场景 |
|---|---|---|
| [`dsh-llm-discovery`](./llm-discovery/README.md) | 在 Web 设置页临时探测端点 | 先查看模型，再选择性添加 Provider |
| [`dsh-client-ui-settings-discovery`](./ui-settings-discovery/README.md) | 提供「模型发现」设置页面 | 使用 Web profile 配置模型 |
| [`dsh-llm-dynamic-provider`](./llm-dynamic-provider/README.md) | 启动时自动探测并注册整个模型目录 | 模型经常变化的中转站、聚合网关或本地服务 |

`llm-endpoint-base` 是上述插件共用的内部包，不需要单独安装。

常用组合：

- **在页面中探测并手动采纳模型：**安装 `dsh-llm-discovery` 和 `dsh-client-ui-settings-discovery`。
- **让一个端点的模型目录自动保持更新：**安装 `dsh-llm-dynamic-provider`。
- **同时使用页面探测和动态路由管理：**安装三个插件。

## 安装

要求：已经安装 `dsh`，并已创建目标 profile。设置页面只能用于 Web profile。

如果你拿到的是本仓库源码，先生成安装包：

```sh
pnpm -C third-plugin/llm-dynamic-provider pack
pnpm -C third-plugin/llm-discovery pack
pnpm -C third-plugin/ui-settings-discovery pack
```

按需要安装插件：

```sh
dsh plugin --profile web add ./third-plugin/llm-discovery/dsh-llm-discovery-0.1.0.tgz
dsh plugin --profile web add ./third-plugin/ui-settings-discovery/dsh-client-ui-settings-discovery-0.1.0.tgz
dsh plugin --profile web add ./third-plugin/llm-dynamic-provider/dsh-llm-dynamic-provider-0.1.0.tgz
```

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
6. 点击「探测」，确认返回的模型与容量信息。
7. 选择模型并点击「采纳为 Provider」。
8. 到「模型」设置页检查并使用新 Provider。

详见 [`dsh-client-ui-settings-discovery`](./ui-settings-discovery/README.md)。

### 自动管理一个端点的全部模型

安装 `dsh-llm-dynamic-provider`，然后在 profile 的 `cordis.patch.yml` 中声明路由。插件会在启动时探测端点；探测成功后，该路由会出现在模型选择器中。

配置字段、凭证和缓存说明见 [`dsh-llm-dynamic-provider`](./llm-dynamic-provider/README.md)。

## 支持的端点

| 类型 | 推荐协议 | baseURL 示例 |
|---|---|---|
| Ollama | `openai-completions` | `http://127.0.0.1:11434/v1` |
| LM Studio | `openai-completions` | `http://127.0.0.1:1234/v1` |
| llama.cpp | `openai-completions` | `http://127.0.0.1:8080` |
| OpenAI 兼容网关 / LiteLLM | `openai-completions` 或 `openai-responses` | 供应方给出的 `/v1` 地址 |
| Anthropic | `anthropic-messages` | 供应方给出的 Anthropic API 地址 |
| Google Gemini | `google-generative-ai` | `https://generativelanguage.googleapis.com/v1beta` |

## 常见问题

- **401/403：**检查 API 密钥，以及协议是否与端点匹配。
- **探测为空：**确认端点提供模型列表接口，并且当前凭证有读取权限。
- **Ollama 能探测但无法对话：**Provider 的 baseURL 必须包含 `/v1`。
- **Gemini 探测失败：**使用包含 `/v1beta` 的原生 Gemini baseURL，不要填写 OpenAI 兼容地址。
- **新 Provider 没有出现在选择器中：**先查看启动日志中的探测错误，再确认插件已出现在 `--dump-config` 输出中。
