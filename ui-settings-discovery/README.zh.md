# dsh-client-ui-settings-discovery

[English](README.md) | 中文

模型发现设置插件。它注册一个设置分节「模型发现」，完整流程是：选择一个本地引擎预设或输入自定义端点，通过宿主的 `llm.discoverModels` offer 探测该端点，查看返回的模型元数据，再把选中的模型采纳为一个新的 pi-ai 提供方配置。宿主侧——注册了 `llm-discovery` 命名空间、负责引擎类型自动检测（Ollama 原生接口、LiteLLM 管理接口、带 vLLM 容量的通用 OpenAI 列表）的插件——是另一个独立插件；本页面只消费它的公开 RPC，从不挂载它。该分节依赖这个 offer：当命名空间没有注册任何 discovery 时，探测会以业务错误回答，页面原样展示该消息。

## 安装

两半都是 bundle——每个包自带的 `cordis.patch.yml` 在 profile 安装它时插入自己的行。用已安装的 `dsh` CLI 时先打包：`dsh plugin add` 本地目录是 link 安装，而宿主包的 harness 导入会从 checkout 的真实路径向上解析，那条链上没有 `@deepseek-ai/*` 包。源码启动（`pnpm dsh`）下按路径直接安装即可，开发迭代优先用它。

```sh
pnpm -C third-plugin/llm-discovery pack && pnpm -C third-plugin/ui-settings-discovery pack
dsh plugin --profile web add ./third-plugin/llm-discovery/dsh-llm-discovery-0.1.0.tgz
dsh plugin --profile web add ./third-plugin/ui-settings-discovery/dsh-client-ui-settings-discovery-0.1.0.tgz
dsh --profile web --dump-config   # 验证两个层都出现
```

没有安装期构建脚本（prepack 在打包时构建），因此不需要任何 `allowBuilds` 条目。用户可在 profile 自己的 `cordis.patch.yml` 里覆盖宿主插件配置——针对 `llm-discovery` 行的 patch 会整体替换其 `config` 值。

**预设卡片**为常见本地引擎预填探测表单——Ollama（`http://127.0.0.1:11434`）、LM Studio（`http://127.0.0.1:1234/v1`）、llama.cpp（`http://127.0.0.1:8080`）——以及用于其他一切端点的「自定义端点」卡片。仅预填：每个字段都保持可编辑，采纳流程的路由 ID 也只在用户尚未手动修改前跟随所选卡片。页面提示：本地引擎通常无需密钥。

**探测**针对表单**当前显示**的内容调用 `llm.discoverModels({ settingsNs: 'llm-discovery', baseURL, api, apiKey? })`，包括已键入但尚未存储的密钥。回复以表格呈现发现的模型——ID / 名称 / 上下文窗口 / 最大输出，缺失的元数据以 `—` 显示——每行默认勾选。`model-discovery-failed` 拒绝（或任何传输失败）以错误行展示消息原文，空回复则渲染自己的无结果状态。

**采纳为 Provider** 对 `llm-pi-ai` 执行一次 `settings.mutate`，在 `providers.<route>` 写入完整 profile：可选的 `displayName`、线协议、`baseURL`、选中的模型，以及——仅当键入过密钥时——`apiKeyEnv`，使用与模型设置页相同的 `<ROUTE>_API_KEY` 派生规则。键入的密钥**先**通过 `credentials.set` 存入该引用，因此 profile 只在凭证确实存在后才提交；孤立的引用（随后 profile 写入被拒绝）无害。当用户未选中任何模型时，完全省略 `models`——列表缺失即服务该路由的整个目录。路由 ID 必须匹配 `[a-z0-9-]+`。采纳流程的「思考档位（可选）」勾选组会把选中档位写成每个采纳模型的 `reasoningEfforts`（`off` 按 adapter 契约写空拼写）；不勾选则不写该字段——catalog 路由的已知模型保留目录继承，只有手工声明的路由需要显式勾选。当路由 ID 是已安装 catalog 的 pi-ai 提供方（如 `anthropic`）时，勾选组自行禁用且忽略已选档位：catalog 条目本身已携带思考能力。路由 ID 若已有 profile 会被拒绝并提示去模型设置页——否则 `providers.<route>` 的 `set` 会整体覆盖既有 profile。要在手工路由上全自动获得目录推导的档位，安装姊妹插件 [`dsh-llm-catalog-sync`](../../llm-catalog-sync/README.zh.md) 并保持勾选组为空。写入携带 `settings.describe({})` 刚读到的 `llm-pi-ai` 修订号，与模型设置页完全一致：并发修改会被以 `settings-conflict` 拒绝，页面直接展示该消息而不重试。成功时只显示一行纯文案，指引用户到「模型」设置页查看——没有任何导航机制。API 密钥只写不读：它永远不会被渲染回来，只出现在探测载荷与凭证写入中。

所有探测与采纳状态都是组件局部的；该分节不声明 store、不订阅任何失效事件，每次操作都重新读取线上的状态。

## Model Experience

None, as the section renders a browser configuration UI; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **没有宿主 discovery offer 时页面不可用** —— 除非有插件为 `llm-discovery` 命名空间注册 discovery，否则探测只会以业务错误回答；本包既不声明也不校验或兜底该 offer，分节照常渲染并原样展示线上的回答。
- **不订阅推送失效事件** —— 与模型设置页不同，本分节不订阅任何转发的 settings/credentials 事件，其他页面写入的 profile 只能在下次探测/采纳时被看到；采纳的 `expectedRevision` 仍然会拒绝过期覆盖。
- **静态协议列表** —— 协议下拉是固定常量（`openai-completions`、`openai-responses`、`anthropic-messages`），不是 schema 读取；若 pi-ai schema 的联合类型扩充，本页的选择会漂移，直到手动更新。
- **思考档位是用户声明而非发现**——`LlmDiscoveredModel` 没有 reasoning 字段，端点披露的能力元数据（如 Anthropic 的 `capabilities.effort`）无法经该 seam 传回；手工声明的路由需要勾选组显式指定。
- **宽松的路由 ID 模式** —— 采纳流程接受 `[a-z0-9-]+`，因此数字开头的 ID 能通过这里的校验，但派生的凭证引用不是合法的 POSIX shell 标识符；收紧到模型设置页的前导字母模式的工作被推迟。
- **本页只写不读** —— 在此创建的 profile 需要到「模型」设置页查看和编辑；本分节没有自己的编辑界面。
