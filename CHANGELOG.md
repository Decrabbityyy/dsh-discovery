# 变更日志

本仓库维护三个可发布的插件包，它们始终同号发布：`dsh-llm-discovery`、`dsh-llm-dynamic-provider`、`dsh-client-ui-settings-discovery`。`dsh-llm-endpoint-base` 是它们共用的私有包，随这三个包一起构建，不单独发布。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.1.2] - 2026-09-12

### 破坏性变更

- **不再支持 0.1.2-alpha 宿主线。** `@deepseek-ai/dsh-*` 的 peer 范围由 `^0.1.2-alpha.4` 收窄为 `^0.1.5-rc.1`，只覆盖 rc 线；编译所依据的副本（devDependencies）钉在 `^0.1.5-rc.2`。宿主仍在 0.1.2-alpha 线上的话，升级插件前请先升级宿主，否则宿主版本不会被 peer 范围接受。

### 新增

- 发现结果表格支持按模型 ID 或名称搜索，并提供「全选」「全不选」「反选」三个操作。反选作用于本次探测到的全部模型，而不是当前筛选后可见的行。
- 借助 models.dev 目录补全模型信息：端点未披露的显示名称、上下文窗口和最大输出由该目录补齐，内置 pi-ai 目录里还没有的新模型也能拿到这些字段。探测结果中的模型会按该目录记录预选思考档位。
- 新增兼容性门禁 `pnpm run check`，包含依赖版本、pi-ai 对齐、宿主运行时导出、`src` 与 `tests` 类型检查、宿主 `.d.ts` 类型检查和 dsh 清单契约六道检查，详见 [`scripts/compat/README.md`](./scripts/compat/README.md)。

### 修复

- 动态路由在 Web 界面保存路由或凭证时会失败。设置代理在该命名空间被列入可配置提供方目录之前会拒绝它，而目录本身又需要至少一条路由才能建立，形成死循环。动态路由现在改走插件自己的 HTTP 端点（`/llm-dynamic-provider/routes`），由它直接写入 settings。
- 发现页面的可选区域改为依据宿主插件是否启用且已成功加载来显示（读取 Host Loader 的插件清单快照），不再只看配置里是否声明。宿主插件未加载时不再展示点了也没用的表单；插件清单 Remote 不可用时按安全策略隐藏区域，此时运行时状态未知，并不等同于插件未安装。
- 路由 ID 以数字开头时无法保存 API 密钥。派生出的环境变量名（如 `9router` → `9ROUTER_API_KEY`）不合法，宿主会在存储时拒绝；现在两个界面都会在写入前提示并禁用采纳按钮。不带密钥的数字开头路由 ID 不受影响。

### 变更

- `ctx.remote` 契约统一为位置参数加 `response.ok` / `value` / `error`，不再依赖 `dsh-client-runtime`。
- 动态路由界面读取提供方列表改用 `llm.listConfigurableProviders()`（保留旧的 `llm.providers()` 回退）。

### 开发

- Harness 依赖改为从 npm 的发布频道解析，不再需要 checkout Harness 源码；CI 相应简化为单仓库的安装 → 测试 → 构建 → 发布。

[Unreleased]: https://github.com/Decrabbityyy/dsh-discovery/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/Decrabbityyy/dsh-discovery/releases/tag/v0.1.2
