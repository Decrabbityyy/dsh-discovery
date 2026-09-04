/**
 * Wire and derivation helpers of the discovery section: the namespaces whose
 * host offers serve probing and hold the route declarations, and the wire
 * faces the section reads and writes. The namespace constants and the small
 * derivations live in `dsh-llm-endpoint-base` so the panel and the two host
 * plugins share one definition.
 */

import type { LlmDiscoveredModel, LlmModelDiscoveryRequest, RpcResponse } from '@deepseek-ai/dsh-api-remotes/client'
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

/**
 * The Remote call shape every consumed method answers with. Declared locally
 * rather than named from a remotes type export so this package stays decoupled
 * from the exact `RpcResponse` generic layout of whichever
 * `dsh-client-connection` version the remotes facade resolved against: the
 * alpha.4 contract every caller here relies on is `response.ok` narrowing to
 * `response.value` / `response.error`.
 */
export type DiscoveryResponse<T> = RpcResponse<T> & {
  readonly ok: boolean
  readonly value: T
  readonly error: { readonly code: string; readonly message: string }
}

/** One registered settings namespace as the describe wire reports it. */
export interface SettingsNamespaceWireView {
  readonly ns: string
  readonly value: unknown
  readonly revision: number
}

/** The settings.describe wire answer. */
export interface SettingsDescribeWireValue {
  readonly namespaces: readonly SettingsNamespaceWireView[]
}

/** One path-addressed settings edit. */
export type SettingsWireOp =
  | { readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
  | { readonly op: 'unset'; readonly path: readonly string[] }

/** One listed provider entry of the llm.providers wire answer. */
export interface ProviderWireEntry {
  readonly provider: string
  readonly settingsNs: string
  readonly declared?: boolean
}

/**
 * The Remote faces the discovery section reads and writes, declared
 * structurally after the alpha.4 `ctx.remote` contract: positional
 * arguments, `response.ok` narrowing. Declared locally (not picked from
 * `ClientRemote`) because the generated Typert domain typings are not part
 * of the published `ClientRemote` interface — the runtime domains are the
 * contract, and this is the exact subset this section calls.
 */
export interface DiscoveryApi {
  readonly llm: {
    /** Interrogate one endpoint through a host discovery offer. */
    discoverModels(settingsNs: string, request: LlmModelDiscoveryRequest): Promise<DiscoveryResponse<readonly LlmDiscoveredModel[]>>
    /** List the registered provider routes. */
    providers(): Promise<DiscoveryResponse<{ readonly providers: readonly ProviderWireEntry[] }>>
  }
  readonly settings: {
    /** Read every registered namespace with its revision. */
    describe(): Promise<DiscoveryResponse<SettingsDescribeWireValue>>
    /** Apply path edits, refused on a stale expected revision. */
    mutate(ns: string, ops: readonly SettingsWireOp[], expectedRevision: number): Promise<DiscoveryResponse<unknown>>
  }
  readonly credentials: {
    /** Store one secret under its reference. */
    set(ref: string, value: string): Promise<DiscoveryResponse<unknown>>
  }
}
