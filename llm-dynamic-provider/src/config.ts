import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ROUTE_PROTOCOLS } from 'dsh-llm-discovery/engine'

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

/** 路由表按 id 索引；单独命名是为了让推断出的 schema 类型可移植（`z.dict` 交回的是 cosmokit 的 `Dict`）。 */
type RouteTable = Record<string, RouteProfile>

const routeTable: z<RouteTable> = z.dict(routeProfile) as z<RouteTable>

/**
 * Tunables of the dynamic-provider plugin.
 *
 * 标了 `.volatile()` 的字段是用户可改的设置：Loader 把生效值交下来时，它们是可就地
 * 点更的引用（`.get()` 读当前快照），而不是普通值。整份路由表就是这样一格。
 */
export interface Config {
  /** Route declarations: the settings page and this plugin's own endpoint both write this field. */
  routes?: Volatile<Record<string, RouteProfile> | undefined>
  /** Per-request probe timeout in milliseconds (default 10,000). */
  timeoutMs?: number
  /** Maximum probe reply size in bytes (default 4 MiB). */
  maxResponseBytes?: number
  /** Fill undisclosed fields from the bundled catalog by exact id (default true). */
  enrichment?: boolean
}

/** Runtime schema for {@link Config}. */
export const Config = z.object({
  // 整份路由表是一个 volatile 字段：Loader 就地点更它，插件不重启，设置页也能把它当作一格读写。
  routes: routeTable.volatile(),
  timeoutMs: z.number().step(1).min(1),
  maxResponseBytes: z.number().step(1).min(1024),
  enrichment: z.boolean(),
})
