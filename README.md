# DeepSeek Harness 模型发现插件

这组插件帮助你从 Ollama、LM Studio、llama.cpp、LiteLLM、OpenAI 兼容网关、Anthropic 和 Google Gemini 端点发现模型并加入 DeepSeek Harness。

## 选择插件

| 插件 | 用途 | 适合场景 |
|---|---|---|
| [`dsh-llm-discovery`](./llm-discovery/README.md) | 在 Web 设置页里探测端点，并按需采纳单个模型 | 先查看模型，再选择性添加 Provider |
| [`dsh-client-ui-settings-discovery`](./ui-settings-discovery/README.md) | 提供「模型发现」设置页面，以及模型页提供方卡片点开「编辑」后的「模型与选项」弹窗 | 使用 Web profile 配置模型 |
| [`dsh-llm-dynamic-provider`](./llm-dynamic-provider/README.md) | 启动时自动探测并注册整个模型目录 | 模型经常变化的中转站、聚合网关或本地服务 |

`dsh-llm-discovery` 同时是这三个插件共用的工具包：探测引擎、models.dev 目录服务与共享词表都在它里面，另外两个插件依赖它。

常用组合（`dsh-llm-discovery` 提供目录服务，另外两个都依赖它，所以任何组合都要先装它）：

- **在页面中探测并手动采纳模型：** `dsh-llm-discovery` + `dsh-client-ui-settings-discovery`。
- **让一个端点的模型目录自动保持更新：** `dsh-llm-discovery` + `dsh-llm-dynamic-provider`。
- **在页面中管理动态路由：** 上面两个再加 `dsh-client-ui-settings-discovery`。
- **三样都要：** 三个都装。

## 安装

要求：已经安装 `dsh`，并已创建目标 profile。设置页面仅适用于 Web profile。

按需要从 npmjs 安装插件；`dsh-llm-discovery` 是另外两个的依赖，先装它：

```sh
dsh plugin --profile web add dsh-llm-discovery
dsh plugin --profile web add dsh-client-ui-settings-discovery
dsh plugin --profile web add dsh-llm-dynamic-provider
```

`dsh plugin` 会把 npm 包加入目标 profile，并在该包声明了 `dsh.bundle` 时自动把它加进 profile 的 bundle 层列表；这三个插件都声明了。它只对账 profile 的直接依赖，所以装另外两个插件时不会连带把 `dsh-llm-discovery` 加进 bundle 层，需要单独装一次。

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
7. 目录没认出来的行（例如 `deepseek-v4-flash-max` 这种变体 id）点它「名称」旁的「匹配目录」，指定它对应 models.dev 的哪一条；选定后名称、容量、模态与思考档位都按该条目补全，采纳时一并写入。
8. 选择模型并点击「采纳为 Provider」。表格里的「模态」列来自 models.dev，采纳时会把每个模型接受图片输入的声明（`input`）写进该模型条目，视觉模型之后才能接收图片或使用 `read_image`。
9. 到「模型」设置页检查并使用新 Provider。

详见 [`dsh-client-ui-settings-discovery`](./ui-settings-discovery/README.md)。

### 自动管理一个端点的全部模型

安装 `dsh-llm-dynamic-provider`，然后在 `$DSH_HOME/settings.yaml` 的 `llm-dynamic-provider.routes` 下声明路由。插件在每次启动时都会重新探测这些路由，你在 `settings.yaml` 中改动路由后也会重新探测，不需要重启。探测成功后，该路由会出现在模型选择器中。

配置字段与凭证说明见 [`dsh-llm-dynamic-provider`](./llm-dynamic-provider/README.md)。

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

## 开发

包内结构与扩展点见 [`llm-discovery/DEVELOPMENT.md`](./llm-discovery/DEVELOPMENT.md)；依赖升级后的兼容性检查（`pnpm run check`）、pi-ai 对齐与发布流程见 [`scripts/compat/README.md`](./scripts/compat/README.md)。

## 常见问题

- **401/403：**检查 API 密钥，以及协议是否与端点匹配。
- **探测为空：**确认端点提供模型列表接口，并且当前凭证有读取权限。
- **Ollama 能探测但无法对话：**Provider 的 baseURL 必须包含 `/v1`。
- **Gemini 探测失败：**使用包含 `/v1beta` 的原生 Gemini baseURL，不要使用 OpenAI 兼容地址。
- **新 Provider 没有出现在选择器中：**先查看启动日志中的探测错误，再确认插件是否已出现在 `--dump-config` 输出中。