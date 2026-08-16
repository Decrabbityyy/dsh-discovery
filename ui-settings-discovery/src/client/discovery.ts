/**
 * Wire and derivation helpers of the discovery section: the namespaces whose
 * host offers serve probing and hold the route declarations, and the wire
 * faces the section reads and writes. The namespace constants and the small
 * derivations live in `dsh-llm-endpoint-base` so the panel and the two host
 * plugins share one definition.
 */

import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { DISCOVERY_NS, DYNAMIC_NS, normalizeModelName, PI_AI_NS, ROUTE_PATTERN, deriveKeyRef, messageOf } from 'dsh-llm-endpoint-base/vocabulary'

export { DISCOVERY_NS, DYNAMIC_NS, normalizeModelName, PI_AI_NS, ROUTE_PATTERN, deriveKeyRef, messageOf }

/** One dynamic route declaration as stored under the dynamic namespace. */
export interface DynamicRoute {
  readonly baseURL: string
  readonly api: string
  readonly apiKeyEnv?: string
  readonly displayName?: string
  readonly defaultContextWindow?: number
  readonly defaultMaxTokens?: number
}

/** The resolved `llm-dynamic-provider` section the panel reads and writes. */
export interface DynamicSection {
  readonly routes: Record<string, DynamicRoute>
}

/** The wire faces the discovery section reads and writes. */
export type DiscoveryApi = Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
