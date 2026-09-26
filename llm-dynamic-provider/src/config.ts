import z from '@deepseek-ai/schemastery'
import { ROUTE_PROTOCOLS } from 'dsh-llm-discovery/engine'
import { volatileField } from 'dsh-llm-discovery/compat'

export { ROUTE_PROTOCOLS }

export interface RouteProfile {
  /** Endpoint base URL reprobed at startup. */
  baseURL: string
  /** Wire protocol the endpoint speaks; also selects the discovery dialect. */
  api: (typeof ROUTE_PROTOCOLS)[number]
  /** Credential reference, resolved per probe through the credential seam and then the environment. */
  apiKeyEnv?: string
  /** Selector-facing display name; defaults to the route key. */
  displayName?: string
  defaultContextWindow?: number
  defaultMaxTokens?: number
}

const routeProfile: z<RouteProfile> = z.object({
  baseURL: z.string().required(),
  api: z.union([
    z.const('openai-completions'),
    z.const('openai-responses'),
    z.const('anthropic-messages'),
    z.const('google-generative-ai'),
  ]).required(),
  apiKeyEnv: z.string(),
  displayName: z.string(),
  defaultContextWindow: z.number().step(1).min(1),
  defaultMaxTokens: z.number().step(1).min(1),
})

export interface Config {
  /** 路由声明。0.1.7 上这一格是用户可改的设置字段（设置页与插件自己的端点都写它）；
   * 0.1.5 上用户层在 `llm-dynamic-provider` 命名空间里，这里只是组成层。 */
  routes?: Record<string, RouteProfile>
  /** Per-request probe timeout in milliseconds (default 10,000). */
  timeoutMs?: number
  /** Maximum probe reply size in bytes (default 4 MiB). */
  maxResponseBytes?: number
  /** Fill undisclosed fields from the bundled catalog by exact id (default true). */
  enrichment?: boolean
}

export const Config: z<Config> = z.object({
  // 0.1.7 上整份路由表是一个 volatile 字段：Loader 就地点更它，插件不重启，
  // 设置页也能把它当作一格读写。0.1.5 的 schemastery 没有 `.volatile()`，
  // `volatileField` 原样返回。
  routes: volatileField(z.dict(routeProfile)),
  timeoutMs: z.number().step(1).min(1),
  maxResponseBytes: z.number().step(1).min(1024),
  enrichment: z.boolean(),
})

/** 0.1.5 兼容：那条线上用户层所在的 settings 命名空间的形状。 */
export interface DynamicSection {
  routes: Record<string, RouteProfile>
}

/** 0.1.5 兼容：注册给旧 settings 服务的命名空间 schema，占位默认值让页面能读到。 */
export const NamespaceConfig: z<DynamicSection> = z.object({
  routes: z.dict(routeProfile).default({}),
})
