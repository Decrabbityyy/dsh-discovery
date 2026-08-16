# dsh-discovery — DeepSeek Harness 发现套件

面向 **API 中转站/聚合网关** 与本地引擎的模型发现 monorepo。一个 pnpm workspace，四个包；共享代码收在内部库 `llm-endpoint-base`，打包时内联进各 tarball，所以**每个可安装包都是自洽的 bundle**（自带 `cordis.patch.yml` 插层），按需单独安装，无需装全。

| 包 | 角色 | 安装？ |
|---|---|---|
| [`llm-endpoint-base`](./llm-endpoint-base) | 纯库：引擎阶梯（Ollama / LiteLLM / OpenAI 兼容含 vLLM 与 Anthropic 方言）、有界探测 HTTP、models.dev 目录解析与持久化、共享词汇 | 不单独安装；构建期 `alwaysBundle` 内联 |
| [`llm-dynamic-provider`](./llm-dynamic-provider/README.md) | 自治托管：声明端点路由，每次启动重探测，目录注册进内存 LLM 注册表；支持无 key 路由 | ✅ |
| [`llm-discovery`](./llm-discovery/README.md) | 只读探测 offer：`llm.discoverModels` RPC，供配置界面按需探测草稿端点 | ✅ |
| [`ui-settings-discovery`](./ui-settings-discovery/README.md) | Web 设置页「模型发现」：预设卡片 → 探测 → 采纳为 pi-ai provider；动态路由区块实时编辑 `llm-dynamic-provider` 命名空间 | ✅（面板，可选） |

依赖方向单向：`llm-endpoint-base` 被其余三包共享；`llm-dynamic-provider` 与 `llm-discovery` 互不引用；面板可选地同时消费两者的公开 RPC/HTTP 端点。对 harness 的 `@deepseek-ai/*` 与 pi-ai 依赖全部是 peer dependency，由宿主安装闭包在运行时解析。

## 开发

```sh
pnpm install
pnpm -r run build
pnpm -r run test
```

## 安装（装好的 dsh）

```sh
pnpm -C llm-dynamic-provider pack
pnpm -C llm-discovery pack
pnpm -C ui-settings-discovery pack
dsh plugin --profile web add ./llm-dynamic-provider/dsh-llm-dynamic-provider-0.1.0.tgz
dsh plugin --profile web add ./llm-discovery/dsh-llm-discovery-0.1.0.tgz
dsh plugin --profile web add ./ui-settings-discovery/dsh-client-ui-settings-discovery-0.1.0.tgz
```

源码检出下开发（`pnpm dsh`）可按目录直接 add（tsx 启动器兜底裸导入解析），重建后重启生效。
