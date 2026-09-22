# dsh-llm-discovery 开发说明

这份文件面向改这个包的人：模块划分、对外契约、扩展点与验证方式。用户视角的安装与配置见 [README.md](./README.md)，仓库级发布流程见 [../README.md](../README.md)。

## 定位

`dsh-llm-discovery` 是这三个包里的底座，另外两个包都依赖它：

- `dsh-llm-dynamic-provider`（宿主侧）用它的探测引擎与 `./vocabulary` 里的目录解析规则；
- `dsh-client-ui-settings-discovery`（浏览器侧）用它的 `./vocabulary` 与 `./catalog/models-dev`，并在宿主半边消费它的目录服务。

它自己也是插件：注册命名空间 `llm-discovery` 的模型探测 offer，并启动 models.dev 目录服务。

## 模块划分

```
src/
  index.ts              插件入口：注册探测 offer、启动目录服务
  invariant.ts          向 invariants 服务注册本包的空伴生项
  vocabulary.ts         浏览器安全的常量、目录键解析与 SharedCatalog 契约
  engine.ts             宿主侧公开面，重新导出 engine/* 与 catalog/models-dev
  engine/discover.ts    驱动引擎阶梯，收敛失败信息
  engine/engines.ts     三级探测引擎
  engine/config.ts      schemastery 配置与默认值
  engine/enrich.ts      用内置 pi-ai 目录补全探测结果
  engine/http.ts        带超时与体积上限的 JSON 请求
  engine/catalog.ts     档位与输入模态索引（取自内置 pi-ai 目录）
  catalog/models-dev.ts models.dev 响应解析
  catalog/service.ts    共享目录服务
  catalog/spec.ts       目录的存储域声明
tests/
  support/server.ts     测试用的假端点
```

## 导出面

| 子路径 | 内容 | 消费者 |
|---|---|---|
| `.` | 插件入口与 `enrichModelsFromCatalog` | 宿主 Loader |
| `./engine` | 探测引擎、配置、内置目录与补全、models.dev 解析 | `dsh-llm-dynamic-provider` |
| `./vocabulary` | 常量、协议清单、目录键解析、`SharedCatalog` 契约 | 两个插件（浏览器侧也内联它） |
| `./catalog/models-dev` | models.dev 解析与 `ModelFacts` | 设置页 |
| `./invariant` | 空的 invariant 伴生插件 | 宿主 Loader |

## 探测引擎

引擎实现是一个函数：`(facts: ProbeFacts) => Promise<EngineVerdict>`。`facts` 带 `baseURL`、已校验的 `apiKey`、`api`、`signal` 与解析后的配置；判定是三态：

- `models`：读到清单，直接返回；
- `skip`：这个端点上没有这一级要的接口，交给下一级；
- `fail`：值得报告的问题（超时、401/403、调用方取消），记录下来继续；`ABORTED` 立即中断整条阶梯。

阶梯顺序是 `ollama` → `litellm` → `openai-models`，每级由 `Config.engines` 的开关过滤。`openai-models` 是兜底：它按 `api` 分流 Anthropic 的 `x-api-key` / 版本头、Gemini 的 `x-goog-api-key` 与拼接路径，其余按 OpenAI 的 `GET /models`。全部 `fail` 或全部 `skip` 时抛出第一条失败，没有失败就报「读不到模型清单」。

新增一级引擎：在 `engine/engines.ts` 写 `probe*`，加进 `discoveryEngines` 的 ladder，并在 `EngineSwitches` 与 `Config` 里补开关与默认值（默认值写在 `resolveDiscoveryConfig`，那是唯一一处）。用例放在 `tests/engine/engines.spec.ts`，配合 `tests/support/server.ts` 起假端点。

## 目录服务

`provideModelCatalog(ctx, options)` 建目录并注册为 `CATALOG_SERVICE`（`modelsDevCatalog`）。契约是 `SharedCatalog`：`factsOf`、`inputModalitiesOf`、`envelope`、`status`、`refresh`、`ready`。

- 持久化在存储域 `llm_models_dev_catalog`：整份目录作为一条记录写在 `catalog` 表的 `models` 键下，ETag 与抓取时间放在域 global。整份存一条是因为 json 的单文件布局每次写入都会重发整个单元。
- `offline`（对外表现为 `enrichment: false`）：只读本地快照，不联网刷新。
- `refreshIntervalMs`（插件配置 `catalogRefreshIntervalMinutes`）非零时用 `ctx.effect` 起一个定时器定期刷新，随 fiber 卸载停止；`offline` 时不排定时器。`refresh()` 自带并发合并，定时器与调用方同时问只发一轮请求。
- 插件把同一个命名空间注册成设置命名空间（`src/settings.ts`），部署配置作组成层；`ctx.inject(['settings'], …)` 让 settings 可选——装了就读用户层，并在 `settings/updated` 上调用 `setRefreshIntervalMs` 重排定时器；没装就只用部署配置。`setRefreshIntervalMs` 对同样的间隔不做任何事。
- `ready()`：第一份快照进入内存后 resolve。冷启动的路由注册与探测补全都排在它之后；已有本地目录时它不等联网。
- 打开存储域失败不致命：记下 `storageError`、退回内存快照，并通过 `status()` 报出来。
- `refresh()` 永不抛：失败保留旧快照，把错误写进 `status()`。

## 目录解析

`vocabulary.ts` 里的 `catalogKeyCandidates` / `catalogKeyIndexOf` / `resolveCatalogKey` 是发现页、动态路由与联网补全共用的一套规则，改这里会同时影响三处。

`catalog/models-dev.ts` 把 models.dev 的响应按 provider 归组：数值一致的合成一条并把 provider 记进 `sources`；数值不同的用替身键（`provider/键`、`键~2`）另存，并在这些键上记 `sourceId` 指向真正对应的模型 id。档位沿用 models.dev 的 `reasoning_options`，其中 `none` 归一成 `off`；容量只接受正整数，其余当未声明。

## 浏览器安全约束

`vocabulary.ts` 会被内联进设置页的浏览器 bundle，因此不能出现 node 内建模块、cordis 或网络调用。任何需要宿主能力的东西放 `engine/`。

## 构建与测试

```sh
pnpm --filter dsh-llm-discovery build   # tsc -b 出 lib/types 声明，tsdown 出 lib/*.js
pnpm --filter dsh-llm-discovery test    # vitest
pnpm run check                          # 类型与宿主契约检查，见 ../scripts/compat/README.md
```

tsdown 的 `clean: false` 是刻意的：`lib/types` 由 `tsc -b` 写在同一个目录里，默认清理会把它删掉。`lib/` 与 `*.tsbuildinfo` 都在 gitignore 里，工作区里出现的构建产物可以直接删。

## 依赖约定

- `@deepseek-ai/dsh-*` 同时声明为 peer（运行时由宿主注入）与 devDependency（编译期钉一份）；`autoInstallPeers: false`，peer 不会自动安装。
- pi-ai 只能有一份：宿主 `dsh-llm-pi-ai` 声明的范围是权威，用 `pnpm run sync:pi-ai` 同步到各包的 peer/dev 声明。
- `zod`、`@earendil-works/pi-ai` 等留在 external，不打进产物。

## 发布

三个包同号发布。CI 在 tag 上先跑 `pnpm run check`、`pnpm -r test`、`pnpm -r build`，再逐个查询 npmjs，只发布 npm 上还不存在的版本；tag 名必须是 `v<version>`。
