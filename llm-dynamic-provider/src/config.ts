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

export interface Config {
  /** Base layer of the `routes` settings namespace, editable live through the UI. */
  routes?: Record<string, RouteProfile>
  /** Per-request probe timeout in milliseconds (default 10,000). */
  timeoutMs?: number
  /** Maximum probe reply size in bytes (default 4 MiB). */
  maxResponseBytes?: number
  /** Fill undisclosed fields from the bundled catalog by exact id (default true). */
  enrichment?: boolean
  /**
   * Persist the last discovered catalog to `$DSH_HOME` so a cold boot can
   * register routes from cache and refresh them in the background (default
   * false: every boot probes synchronously and a failed probe yields no route).
   */
  cache?: boolean
}

export const Config: z<Config> = z.object({
  routes: z.dict(routeProfile),
  timeoutMs: z.number().step(1).min(1),
  maxResponseBytes: z.number().step(1).min(1024),
  enrichment: z.boolean(),
  cache: z.boolean(),
})

/** The composition base merged with the user layer. */
export interface DynamicSection {
  routes: Record<string, RouteProfile>
}

/** The settings namespace schema, editable from the Web UI. */
export const NamespaceConfig: z<DynamicSection> = z.object({
  routes: z.dict(routeProfile).default({}),
})
