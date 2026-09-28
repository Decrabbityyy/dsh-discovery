# 变更日志

本仓库维护三个可发布的插件包，它们始终同号发布：`dsh-llm-discovery`（同时是另外两个共用的工具包）、`dsh-llm-dynamic-provider`、`dsh-client-ui-settings-discovery`。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

### 破坏性变更

- **只支持 0.1.7 宿主线（npm 的 `next` 频道）。** `@deepseek-ai/dsh-*` 的 peer 由 `^0.1.5-rc.1` 收窄为 `^0.1.7-rc.1`，编译所依据的副本（devDependencies）钉在 `0.1.7-rc.2`；cordis 的 peer 由 `^4.0.2` 收窄为 `~4.0.4`。宿主仍在 0.1.5-rc 线上的话，升级插件前请先升级宿主，否则宿主版本不会被 peer 范围接受。
- **`dsh-llm-discovery` 的设置导出换成 `./loader-config`。** 0.1.5 上用户设置住在插件自己注册的 settings 命名空间里，为此存在的 `./compat`、`DISCOVERY_SETTINGS_NS` 与 `DiscoverySettings` 都不再导出，`@deepseek-ai/dsh-settings` 也不再是这个包的 peer。用户设置现在是插件 `Config` 里标了 `.volatile()` 的字段（这一点从 0.1.7 起才是宿主认的写法），`dsh-llm-discovery` 自己不再碰 settings 服务。

### 新增

- **支持 0.1.7 宿主线。** 0.1.7 把插件设置整个换了：`SettingsProvider` 不再导出，`ctx.settings` 变成 `SettingsForms`，命名空间就是插件的 Loader entry id，schema 取自插件自己导出的 `Config`，只有标了 `.volatile()` 的字段可编辑，改动通知也从 `settings/updated` 换成 Loader 只发给 owner fiber 的 `loader/volatile-update`；浏览器半边的 `ctx.settingsScope` 换成 `ctx.configForms`。三个包都按这条线接好了：目录刷新间隔与动态路由表分别是各自插件 `Config` 里的 volatile 字段（读值走 `.get()`），页面改走 `configForms`，插件自己的路由端点照旧写同一份设置。
- `dsh-llm-discovery` 新增 `./loader-config` 子路径导出：volatile 配置就地点更后的通知收口，以及写设置用的 Loader entry id。

### 变更

- **旧线的兼容面与分支全部删除。** `dsh-llm-discovery/src/compat.ts` 与 `ui-settings-discovery/src/client/settings-form.ts` 两个兼容面、`dsh-llm-discovery/src/settings.ts`、`dsh-llm-dynamic-provider` 的 `NamespaceConfig` / `DynamicSection`，以及测试里的 `legacySettingsStub` 都不再存在；设置取值、写入目标与变更通知各按 0.1.7 的写法直接写在调用点上。
- 编译期的 cordis 钉到 `~4.0.4`、schemastery 钉到 `^3.18.4`：0.1.7 的包要求 cordis `~4.0.4`，装出两份 cordis 会把 `declare module` 的服务增强劈成两半，插件的 `ctx.llm` / `ctx.settings` 这类增强就全部失效。
- 写设置的目标是插件自己的 Loader entry id（从 `ctx.fiber.entry` 取，没有 Loader 时退回插件名）。
- **「模型目录」不再是「设置」→「插件」里的一个标签页**：「模型发现」这一页改成页内切页——**探测与采纳 / 动态路由 / 模型目录**（装了哪个插件才有哪一页；只剩一页时不出切页条），切页条用「设置」→「插件」分区标签那一套形状（13/20 文字、底部细线、选中项 2px 下划线），一次只挂当前那一页。插件区只留宿主自己的「插件列表」。
- 「模型目录」区块在命名空间没有服务给当前客户端时（没装 `dsh-llm-discovery`）不显示刷新间隔输入框；宿主用返回值 `false` 拒收写入时页面会报出来。
- 「模型发现」分区读提供方目录只用 `llm.listConfigurableProviders()`：为 0.1.2-alpha 时代的宿主留的 `llm.providers()` 回退与 `{ providers }` 信封兜底随旧线一并删除。
- 「模型与选项」弹窗（模型页）的大小钉住：高度到 680px（或视口留 80px）为止，滚动交给结果表自己，长 id、长地址在格子里换行而不是把整个窗口撑出滚动条。

### 修复

- **原来的设置集成在 0.1.7 上整体不可用。** 它用的 `ctx.settings.register(...)` / `get(...)` 与 `settings/updated` 在 0.1.7 上都不存在，插件会在设置这一步直接失败；现在整条链路按 0.1.7 写。
- `dsh-llm-dynamic-provider` 把路由表交给 settings 组成层当普通对象用时，会拿到 volatile 引用；现在取值统一走 `.get()`。

### 开发

- `pnpm run check` 参数不再需要写成 `-- --host`（那个 `--` 会被脚本按未知参数拒掉）；宿主树用 `.compat/hosts/next`（0.1.7-rc.2），做法记在 [`scripts/compat/README.md`](./scripts/compat/README.md)。
- 测试用真实 schema（schemastery 3.18.4 + cordis 4.0.4 会把 volatile 字段解析成引用）加 `tests/volatile.ts` 里照着 Loader 做法提交的写入；直接调 `resolveDiscoveryConfig` 的用例用同一个模块里的 `volatileRef()` 造引用，程序化挂载则按 `ctx.plugin` 的类型要求把写下来的普通配置传给 schema。`dsh-llm-dynamic-provider` 的 `@deepseek-ai/dsh-attachment` devDependency 只为测试导入 `dsh-llm-pi-ai` 时需要，不是本插件的运行时依赖。
- 0.1.7 的 Loader 用 `Promise.allSettled` 等条目，被 schema 拒掉的配置不会让 `loader.await()` 抛出；相关的组合用例改为断言插件没有注册探测 offer。

## [0.2.0] - 2026-09-23

### 破坏性变更

- **`dsh-llm-dynamic-provider` 与 `dsh-client-ui-settings-discovery` 开始依赖 `dsh-llm-discovery`。** 两者都把 `modelsDevCatalog` 声明为服务依赖，没装 `dsh-llm-discovery` 时它们的宿主行不会激活：模型选择器里没有动态路由，设置页也读不到目录。此前「只装动态插件」「只装设置页」以及「动态插件 + 设置页」三种组合不再受支持，升级时请一并安装 `dsh-llm-discovery`。
- **`dsh-llm-dynamic-provider` 不再有路由缓存。** 插件配置的 `cache` 项、`$DSH_HOME/llm-dynamic-provider-cache.json` 的读写、状态里的 `cacheFile` 与「模型目录」页上对应那一行都不再存在；端点 `/llm-dynamic-provider/cache` 改名为 `/llm-dynamic-provider/probe`，只读的 `/llm-dynamic-provider/catalog` 一并删除。旧缓存文件不再被任何代码读取，可以直接删除；重启后端点不可用的路由不再有上一次的清单兜底（同一次运行中探测失败仍沿用上一轮成功的结果）。
- **`dsh-llm-discovery` 的 `enrichment: false` 语义收窄。** 目录服务照常提供，但这个开关下不联网刷新、只用本地已有的目录，也不补全自己的探测回复。

### 新增

- **models.dev 目录成为共享服务。** `dsh-llm-discovery` 持有整份目录（落在存储域 `llm_models_dev_catalog`，默认只在挂载时按 ETag 校验一次，给 `catalogRefreshIntervalMinutes` 一个非零分钟数就按该间隔自动刷新），以 Cordis 服务 `modelsDevCatalog` 提供给另外两个插件与设置页。此前三个入口各存一份，合计约 16 MB。
- 设置 →「插件」新增「模型目录」页面：显示声明路由数、目录条数、刷新时间与来源，按钮「刷新目录与路由」不等重启就重新读取目录、重新探测所有声明路由，并逐条回报每条路由的模型数或失败原因；页面只在宿主报的下一次刷新时刻之后再重读一次状态，默认的「只在挂载时刷一次」不会再发请求。
- 「模型」设置页的 `llm-pi-ai` 提供方卡片新增「模型与选项」入口，卡片展开时出现：弹窗按该提供方已保存的端点与协议探测模型清单，增删模型后写回 `llm-pi-ai.providers.<路由>.models`。
- 结果表每行新增「匹配目录」：目录里没有的变体 id（`deepseek-v4-flash-max`、`glm-5.2-fast-preview/cc` 等）可以手动指定它对应 models.dev 的哪一条，选定后按该条目显示并写入名称、容量、模态与思考档位；选择器支持 `@供应商` 筛选，默认把该 id 的最长已收录前缀填进搜索框。
- 「匹配目录」的条目选择器每行给名称、收录它的 provider 标签与一行摘要（`256k/33k · 文·图 · □□□■□■`：容量缩写、模态、六个档位方块，`off` 不占位），行上不显示 id（搜索与悬停仍按 id）；同一个 id 被多家收录时，数值一致的合并成一条（标签写 `zai-org 等 2 家`），数值不同的各自单列，你选哪条就用哪条的数值。
- 采纳模型时按每个模型写入多模态声明：models.dev 记录该模型接受图片输入时，条目带上 `input: [text, image]`，视觉模型之后才能接收图片附件或使用 `read_image`。此前「模态」列只显示，不写入。
- **只装发现插件与设置页时，「模态」「思考档位」两列不再恒为空。** 此前这两列的数据只有装了 `dsh-llm-dynamic-provider` 才拿得到；现在设置页的宿主半边自己把目录交给浏览器半边（`/ui-settings-discovery/catalog` 与 `/catalog/status`，没有 Web 服务器时不注册，随插件卸载撤销）。
- **目录刷新间隔可以在页面里改。** 「设置」→「插件」→「模型目录」页多出一个「目录自动刷新间隔」输入框，保存后立即重排定时器，不用重启；部署配置里的 `catalogRefreshIntervalMinutes` 是组成层默认值，清掉用户层就回到它。

### 变更

- **思考档位不再逐档勾选，只标注。** 此前每个模型按目录记录列出可勾选的档位，勾掉一档就少写一档；现在这一列只写文字（如 `off/low/high`），采纳与保存时按「匹配到的条目记录的全部档位 + 配置里已声明的」写入。
- 结果表的「上下文窗口」「最大输出」两列改用缩写（`256k`、`1m`）。

### 修复

- **目录匹配取错片段。** 带变体的 id（`Gemini-3.7-Flash/Antigravity`、`glm-5.2-fast-preview/cc`）此前只按最后一个 `/` 之后的段匹配，还区分大小写。现在按整条 id、第一个 `/` 之前、最后一个 `/` 之后依次尝试，整条 id 优先，候选不唯一时交给「匹配目录」。
- 手动指定目录条目后，行上的名称与容量不跟着改；现在手动指定的条目连名称与容量一起作数。
- 目录选择器把插件自己拼的键当成模型 id 显示；现在这类条目显示 models.dev 记录的那个 id，内部键只留在悬停里。
- **目录此前没有真正落盘。** 依赖缺失让存储域每次打开都失败又被吞掉，于是每次启动都联网重抓、只留在内存里；逐模型存盘时一次刷新要跑几分钟。现在整份目录存一条记录，失败会记进日志与状态，历史行里的 `0` 与 `null` 也一律读回「未声明」。
- 「模型与选项」弹窗保存过一次之后再保存会被拒（一直用打开时读到的 revision）；现在采用宿主返回的新 revision，真正的并发冲突仍然会被拒。
- 采纳与保存没有把表格上显示的名称与容量写进 profile，模型选择器里只有原始 id；结果表按带提供方前缀的 id（如 `x-ai/grok-4.6`）也取不到模态与档位。
- 动态路由编辑时的密钥输入框提示改为「留空则不保存密钥」：留空实际会让该路由不带凭证引用。

### 开发

- **未发布的 `dsh-llm-endpoint-base` 并入 `dsh-llm-discovery`**：探测引擎、models.dev 解析、存储域声明与共享词表集中到一个包，浏览器安全入口是 `./vocabulary` 与 `./catalog/models-dev`；目录键解析也收敛成一套共用规则。
- 新增 [`llm-discovery/DEVELOPMENT.md`](./llm-discovery/DEVELOPMENT.md)；三份包 README 与根 README 同步到实现并删去实现细节，[`scripts/compat/README.md`](./scripts/compat/README.md) 改为客观描述（脚本里的 "gate" 改为 "checks"），中英混写的注释改为单语。
- 新增 `pnpm run coverage`（v8 提供器，只统计 `src`，文本报告），`vitest` 与 `@vitest/coverage-v8` 一并对齐到 4.1.11。
- 发布产物不再带构建残留：`build` 先清空 `lib` 再 `tsc -b --force`，`tsBuildInfoFile` 移出 `lib`。
- 界面与内部整理：发现页与模型页弹窗共用同一个结果表组件；目录解析按 provider 分组（`sources` / `sourceId`）；删除重复声明的 `DynamicRouteStatus`；新增 `@deepseek-ai/dsh-client-ui-settings-models` 可选 peer。

## [0.1.2] - 2026-09-12

### 破坏性变更

- **不再支持 0.1.2-alpha 宿主线。** `@deepseek-ai/dsh-*` 的 peer 范围由 `^0.1.2-alpha.4` 收窄为 `^0.1.5-rc.1`，只覆盖 rc 线；编译所依据的副本（devDependencies）钉在 `^0.1.5-rc.2`。宿主仍在 0.1.2-alpha 线上的话，升级插件前请先升级宿主，否则宿主版本不会被 peer 范围接受。

### 新增

- 发现结果表格支持按模型 ID 或名称搜索，并提供「全选」「全不选」「反选」三个操作。反选作用于本次探测到的全部模型，而不是当前筛选后可见的行。
- 借助 models.dev 目录补全模型信息：端点未披露的显示名称、上下文窗口和最大输出由该目录补齐，内置 pi-ai 目录里还没有的新模型也能拿到这些字段。探测结果中的模型会按该目录记录预选思考档位。
- 新增兼容性检查 `pnpm run check`，包含依赖版本、pi-ai 对齐、宿主运行时导出、`src` 与 `tests` 类型检查、宿主 `.d.ts` 类型检查和 dsh 清单契约六道检查，详见 [`scripts/compat/README.md`](./scripts/compat/README.md)。

### 修复

- 动态路由在 Web 界面保存路由或凭证时会失败。设置代理在该命名空间被列入可配置提供方目录之前会拒绝它，而目录本身又需要至少一条路由才能建立，形成死循环。动态路由现在改走插件自己的 HTTP 端点（`/llm-dynamic-provider/routes`），由它直接写入 settings。
- 发现页面的可选区域改为依据宿主插件是否启用且已成功加载来显示（读取 Host Loader 的插件清单快照），不再只看配置里是否声明。宿主插件未加载时不再展示点了也没用的表单；插件清单 Remote 不可用时按安全策略隐藏区域，此时运行时状态未知，并不等同于插件未安装。
- 路由 ID 以数字开头时无法保存 API 密钥。派生出的环境变量名（如 `9router` → `9ROUTER_API_KEY`）不合法，宿主会在存储时拒绝；现在两个界面都会在写入前提示并禁用采纳按钮。不带密钥的数字开头路由 ID 不受影响。

### 变更

- `ctx.remote` 契约统一为位置参数加 `response.ok` / `value` / `error`，不再依赖 `dsh-client-runtime`。
- 动态路由界面读取提供方列表改用 `llm.listConfigurableProviders()`（保留旧的 `llm.providers()` 回退）。

### 开发

- Harness 依赖改为从 npm 的发布频道解析，不再需要 checkout Harness 源码；CI 相应简化为单仓库的安装 → 测试 → 构建 → 发布。

[0.2.0]: https://github.com/Decrabbityyy/dsh-discovery/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/Decrabbityyy/dsh-discovery/releases/tag/v0.1.2
