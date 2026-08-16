/**
 * Configuration for `dsh-llm-dynamic-provider`: the `routes` dict declaring
 * which endpoints to reprobe, plus the probe knobs forwarded to the discovery
 * engine and the optional model-cache toggle. Routes are declared in the
 * plugin's own `llm-dynamic-provider` settings namespace (whose composition
 * base is the cordis.yml entry's `routes`), so a deployment can predeclare
 * them and a configuration surface can edit them live; the discovered model
 * catalogs still live only in the in-memory LLM registry, never in the
 * settings document.
 * @module dsh-llm-dynamic-provider/config
 */

import z from '@deepseek-ai/schemastery'
import { ROUTE_PROTOCOLS } from 'dsh-llm-endpoint-base'

export { ROUTE_PROTOCOLS }

/** One dynamically-probed provider route. */
export interface RouteProfile {
  /** Endpoint base URL reprobed at startup. */
  baseURL: string
  /** Wire protocol the endpoint speaks (also selects the discovery dialect). */
  api: (typeof ROUTE_PROTOCOLS)[number]
  /** Credential reference resolved per probe through the credential seam, then the environment. */
  apiKeyEnv?: string
  /** Selector-facing display name; defaults to the route key. */
  displayName?: string
  /** Context capacity for a model the endpoint and catalog leave unsized. */
  defaultContextWindow?: number
  /** Output capability for a model the endpoint and catalog leave unsized. */
  defaultMaxTokens?: number
}

/** Schemastery schema for one route profile. */
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

/** The plugin's cordis.yml configuration. */
export interface Config {
  /** Dynamic routes to reprobe, keyed by provider route name (the namespace's composition base). */
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

/** Schemastery configuration for the plugin. */
export const Config: z<Config> = z.object({
  routes: z.dict(routeProfile),
  timeoutMs: z.number().step(1).min(1),
  maxResponseBytes: z.number().step(1).min(1024),
  enrichment: z.boolean(),
  cache: z.boolean(),
})

/** The resolved `llm-dynamic-provider` namespace value. */
export interface DynamicSection {
  /** Every declared dynamic route, composition base merged with the user layer. */
  routes: Record<string, RouteProfile>
}

/** The `llm-dynamic-provider` settings namespace schema (webui-editable route declarations). */
export const NamespaceConfig: z<DynamicSection> = z.object({
  routes: z.dict(routeProfile).default({}),
})
