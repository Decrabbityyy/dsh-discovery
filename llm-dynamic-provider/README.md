# dsh-llm-dynamic-provider

`dsh-llm-dynamic-provider` 在 DeepSeek Harness 启动时探测你声明的模型端点，并把端点当前提供的模型注册成可用 Provider。它适合模型列表经常变化的 API 中转站、聚合网关和本地推理服务。

发现的模型目录不会写入 `settings.yaml`。你只需要保存端点和协议；每次启动时插件会重新读取模型列表。

本插件依赖 `dsh-llm-discovery`：它提供 models.dev 目录服务。没装它时本插件的宿主行不会激活（模型选择器里也就没有动态路由）。

## 安装

`dsh-llm-discovery` 是本插件的前置依赖，先装它，再装本插件：

```sh
dsh plugin --profile <name> add dsh-llm-discovery
dsh plugin --profile <name> add dsh-llm-dynamic-provider
dsh --profile <name> --dump-config
```

`--dump-config` 中应同时出现 `llm-discovery` 和 `llm-dynamic-provider`。

## 配置一个动态路由

在 `$DSH_HOME/settings.yaml` 中写入本插件的用户设置。未设置 `DSH_HOME` 时，默认文件是 `~/.dsh/settings.yaml`：

```yaml
llm-dynamic-provider:
  routes:
    upstream:
      baseURL: https://gateway.example.com/v1
      api: openai-completions
      apiKeyEnv: UPSTREAM_API_KEY
      displayName: 公司网关
      defaultContextWindow: 262144
      defaultMaxTokens: 32768
```

把凭证写入 DSH 使用的 `.env` 或启动环境，不要把真实密钥写入 `settings.yaml`：

```text
UPSTREAM_API_KEY=你的密钥
```

保存 `settings.yaml` 后插件会自动重新探测，不需要重启。探测成功后，路由名 `upstream` 会出现在模型选择器中，端点返回的模型都可以直接使用。

## 路由字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `baseURL` | 是 | 模型服务地址；路径必须与所选协议匹配 |
| `api` | 是 | `openai-completions`、`openai-responses`、`anthropic-messages` 或 `google-generative-ai` |
| `apiKeyEnv` | 否 | 凭证引用或环境变量名；本地无认证端点可以省略 |
| `displayName` | 否 | 在模型选择器中显示的 Provider 名称 |
| `defaultContextWindow` | 否 | 端点没有返回上下文窗口时使用的值 |
| `defaultMaxTokens` | 否 | 端点没有返回最大输出时使用的值 |

路由 ID（示例中的 `upstream`）只能使用小写字母、数字和连字符。环境变量名不能以数字开头，所以以数字开头的路由 ID 无法声明 `apiKeyEnv`；这类路由只能指向无认证端点。

## 插件配置

这些是部署级选项，不属于用户 `settings.yaml`。需要修改时，在 profile 的 `cordis.patch.yml` 中配置插件行：

```yaml
- id: llm-dynamic-provider
  config:
    timeoutMs: 10000
    maxResponseBytes: 4194304
    enrichment: true
```

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `routes` | `{}` | 路由声明的底稿层；`settings.yaml` 里的同名路由覆盖它 |
| `timeoutMs` | `10000` | 每次探测请求的超时时间，单位毫秒 |
| `maxResponseBytes` | `4194304` | 模型列表响应的最大字节数 |
| `enrichment` | `true` | 用内置模型目录补全端点未提供的名称和容量 |

`config.routes` 适合随 profile 分发一组默认端点；用户在 `settings.yaml` 里改动或新增的路由写在同一份命名空间的用户层上。

修改 profile patch 后需要重启。安装了 `dsh-client-ui-settings-discovery` 时，也可以在「模型发现」页面的「动态路由」区域新增、编辑和删除路由；页面写入的也是同一份用户 settings。

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

- 每次启动都会重新探测所有路由：端点不可达、认证失败或返回空列表的路由这一轮不注册，端点恢复后随下一次探测（改设置或手动刷新）注册。
- 已经探测成功过的路由，某一轮探测失败时继续沿用上一次的模型清单；只有从未成功过的路由才完全不出现。
- `settings.yaml` 中的路由发生变化时会自动重新探测，不需要重启。
- 探测成功后，端点返回的模型会出现在模型选择器中。
- 端点返回的容量优先；缺失字段可由路由默认值补全。
- 缺失的名称与容量由 `dsh-llm-discovery` 提供的 models.dev 目录补齐，缓存与刷新由该插件负责。

## 手动刷新

不用重启也可以重新读一遍目录并重新探测：安装 `dsh-client-ui-settings-discovery` 后，打开「设置」→「插件」→「模型目录」。页面显示声明路由数、models.dev 目录的条数、刷新时间与来源，按钮「刷新目录与路由」会重新读取目录、重新探测所有声明路由，并把结果逐条列出来（每条路由的模型数，或它的失败原因）。

插件自己的 HTTP 端点：`GET`/`POST /llm-dynamic-provider/probe` 读状态或触发一次全量刷新，`GET`/`POST /llm-dynamic-provider/routes` 读路由列表、按 `set` / `unset` 写入路由。两者只在挂了 Web 服务器时注册，随插件卸载撤销。

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
- 用页面编辑已有路由时只写回路由 ID、协议、端点地址、显示名称与密钥；`defaultContextWindow` 与 `defaultMaxTokens` 需要在 `settings.yaml` 里维护。
- 连续快速编辑同一路由可能产生重叠探测；一次保存后请等待探测完成再继续修改。
- 使用 Web 动态路由管理时，只应把 DSH Web 服务暴露给可信用户和可信网络。

## Model Experience

插件只改变可选的 Provider 和模型，不向模型请求添加 prompt、消息或工具定义。

#### KV Cache 影响

无。插件不修改模型请求前缀。
