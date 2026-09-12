# dsh-client-ui-settings-discovery

`dsh-client-ui-settings-discovery` 在 DeepSeek Harness Web 设置中增加「模型发现」页面。页面包含两个相互独立的区域，按已启用且成功加载的宿主插件显示：

- 安装 [`dsh-llm-discovery`](../llm-discovery/README.md) 后，显示端点探测和 Provider 采纳区域。
- 安装 [`dsh-llm-dynamic-provider`](../llm-dynamic-provider/README.md) 后，显示动态路由管理区域。

Web UI 本身不强制依赖其中任何一个；只需安装你要使用的功能。若两者都未安装，页面没有可操作区域。

页面通过 Host 的 `pluginInventory/list` 快照判断可选宿主插件是否处于 active 状态，再显示对应区域。这只是插件状态读取，不是模型端点探测；用户不需要配置或访问任何特殊地址，只需在实际探测时填写真实的 `baseURL`。

标准 Web profile 需要提供 Host 的 `plugin-inventory`，并使用能够挂载 `remote.llm`、`remote.settings`、`remote.credentials` 与 `remote.pluginInventory` 的匹配版本 `api-remotes`；不要混用不同发布系列的 Host 与 Client 包。如果清单 Remote 不可用，页面会安全地隐藏这些可选区域；这表示运行时状态未知，不等同于宿主插件一定未安装。

## 安装

先从 npmjs 安装 UI：

```sh
dsh plugin --profile web add dsh-client-ui-settings-discovery
```

需要端点探测和 Provider 采纳时，安装：

```sh
dsh plugin --profile web add dsh-llm-discovery
```

需要动态路由管理时，安装：

```sh
dsh plugin --profile web add dsh-llm-dynamic-provider
```

两个功能都需要时，同时安装两个宿主插件。最后确认配置：

```sh
dsh --profile web --dump-config
```

启动 Web profile 后，打开「设置」→「模型发现」。

## 探测并采纳模型

1. 选择一个预设：Ollama、LM Studio 或 llama.cpp。其他服务选择「自定义端点」。
2. 检查 `baseURL`：
   - Ollama：`http://127.0.0.1:11434/v1`
   - LM Studio：`http://127.0.0.1:1234/v1`
   - llama.cpp：`http://127.0.0.1:8080`
   - Gemini：`https://generativelanguage.googleapis.com/v1beta`
3. 选择协议：
   - OpenAI Chat Completions：`openai-completions`
   - OpenAI Responses：`openai-responses`
   - Anthropic Messages：`anthropic-messages`
   - Google Gemini：`google-generative-ai`
4. 输入 API 密钥；本地无认证端点可以留空。
5. 点击「探测」。
6. 检查返回的模型，取消不想添加的条目。
7. 填写路由 ID。只能使用小写字母、数字和连字符。
8. 可选填写显示名称和思考档位。
9. 点击「采纳为 Provider」。
10. 到「模型」设置页查看并使用新 Provider。

如果填写了 API 密钥，页面会把它保存到凭证存储，并让 Provider 引用该凭证；密钥不会写进普通 settings 配置。

## 字段说明

| 字段 | 说明 |
|---|---|
| 端点地址 | 模型 API 的 baseURL，不是控制台或文档页面地址 |
| 协议 | 端点实际接受的请求格式；选错会导致探测或对话失败 |
| API 密钥 | 探测和后续模型请求使用的凭证 |
| 路由 ID | Provider 的唯一标识，例如 `local-ollama` 或 `company-gateway` |
| 显示名称 | 模型设置和选择器中显示的名称 |
| 思考档位 | 为手工路由声明可用的 reasoning effort；不确定时保持未选择 |

如果路由 ID 已存在，页面会拒绝覆盖。请到「模型」设置页编辑已有 Provider。

## 管理动态路由

安装 `dsh-llm-dynamic-provider` 后，页面会显示「动态路由」区域。

1. 点击新增路由。
2. 填写路由 ID、端点、协议和可选显示名称。
3. 端点需要认证时输入 API 密钥。
4. 保存后等待探测完成。
5. 探测成功后，该路由的整个模型目录会出现在模型选择器中。

删除动态路由会移除该路由注册的模型，但不会删除凭证存储中已经保存的密钥。

编辑已有动态路由时，如果它使用凭证，请重新输入 API 密钥；当前版本不会在编辑表单中回显旧密钥。

## 常见问题

### 页面没有显示探测表单

确认 `dsh-llm-discovery` 已启用且成功加载，并检查 Web profile 的插件清单（「设置」→「插件」）中是否存在 active 条目。`dsh --profile web --dump-config` 只能确认配置层有该插件，不能证明它已成功启动。若 Host 的 `pluginInventory/list` 不可用，页面也会按安全策略隐藏区域；这不等同于插件未安装。只有 UI 插件时无法探测。

### 点击探测后显示认证错误

检查 API 密钥、协议和 baseURL 是否属于同一个服务。Anthropic 与 Gemini 不能使用 OpenAI 协议地址进行原生探测。

### 探测成功，但模型对话失败

检查采纳后的 Provider 配置。Ollama 地址必须包含 `/v1`；协议必须与服务实际支持的生成接口一致。照抄预设或上游文档给出的 API 根地址最稳妥。

### 思考档位或模态信息为空

端点可能没有返回这些信息。安装 `dsh-llm-dynamic-provider` 后，页面可以读取更多内置目录元数据；未知模型仍可能没有这些字段。

### 其他页面刚修改的配置没有立即出现

重新打开「模型发现」页面，或者重新执行一次探测。当前页面不接收其他设置页面的实时更新。

## 已知限制

- 页面创建 Provider 后，只能到「模型」设置页继续编辑。
- 协议列表是固定的四种协议。
- 路由 ID 以数字开头时不能保存 API 密钥：派生出的 `<ROUTE>_API_KEY` 不是合法的环境变量名（凭证引用必须是 POSIX 风格的名字），页面会拒绝保存并给出原因。不带密钥的路由不受影响，也可以改用字母开头的路由 ID（例如 `ai-302`）。
- 连续快速保存动态路由可能触发重叠探测；一次保存后请等待结果再继续修改。
- 宿主插件状态来自一次性的插件清单快照；启用、停用或热替换插件后，请重新打开页面以刷新可见区域。

## Model Experience

本插件只提供浏览器配置界面，不向模型请求添加内容。

#### KV Cache 影响

无。插件不组装或发送模型请求。
