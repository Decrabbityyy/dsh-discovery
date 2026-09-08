import type { LlmDiscoveredModel, LlmModelDiscoveryRequest, RpcResponse } from '@deepseek-ai/dsh-api-remotes/client'
import {
  DISCOVERY_NS, DYNAMIC_NS, normalizeModelName, PI_AI_NS, ROUTE_PATTERN, deriveKeyRef, messageOf,
} from 'dsh-llm-endpoint-base/vocabulary'

export { DISCOVERY_NS, DYNAMIC_NS, normalizeModelName, PI_AI_NS, ROUTE_PATTERN, deriveKeyRef, messageOf }

/** Exact Loader module names (`moduleName`, not the Cordis plugin name). */
export const DISCOVERY_PLUGIN = 'dsh-llm-discovery'
export const DYNAMIC_PLUGIN = 'dsh-llm-dynamic-provider'

export interface PluginInventoryEntry {
  readonly entryId: string
  readonly moduleName: string
  readonly enabled: boolean
  readonly fiberPhase: 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null
}

export interface PluginInventorySnapshot {
  readonly entries: readonly PluginInventoryEntry[]
}

/** Whether one optional Host plugin has a live Loader fiber. */
export function isActivePlugin(
  snapshot: PluginInventorySnapshot,
  moduleName: string,
): boolean {
  return snapshot.entries.some(entry =>
    entry.moduleName === moduleName
    && entry.enabled
    && entry.fiberPhase === 'active',
  )
}

export interface DynamicRoute {
  readonly baseURL: string
  readonly api: string
  readonly apiKeyEnv?: string
  readonly displayName?: string
  readonly defaultContextWindow?: number
  readonly defaultMaxTokens?: number
}

export interface DynamicSection {
  readonly routes: Record<string, DynamicRoute>
}

/**
 * The Remote call shape every consumed method answers with: `ok` narrows to
 * either `value` or `error`. Declared locally so this package stays decoupled
 * from the exact `RpcResponse` generic layout of whichever
 * `dsh-client-connection` version the remotes facade resolved against.
 */
export type DiscoveryResponse<T> = RpcResponse<T> & {
  readonly ok: boolean
  readonly value: T
  readonly error: { readonly code: string; readonly message: string }
}

export interface SettingsNamespaceWireView {
  readonly ns: string
  readonly value: unknown
  readonly revision: number
}

export interface SettingsDescribeWireValue {
  readonly namespaces: readonly SettingsNamespaceWireView[]
}

export type SettingsWireOp =
  | { readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
  | { readonly op: 'unset'; readonly path: readonly string[] }

export interface ProviderWireEntry {
  readonly provider: string
  readonly displayName: string
  readonly settingsNs: string
  readonly settingsPath: readonly string[]
  readonly declared?: boolean
}

/**
 * The exact subset of `ctx.remote` this section calls, declared structurally
 * because the generated Typert domain typings are not part of the published
 * `ClientRemote` interface. Calls take positional arguments.
 */
export interface DiscoveryApi {
  readonly llm: {
    /** Interrogate one endpoint through a host discovery offer. */
    discoverModels(settingsNs: string, request: LlmModelDiscoveryRequest): Promise<DiscoveryResponse<readonly LlmDiscoveredModel[]>>
    listConfigurableProviders(): Promise<DiscoveryResponse<readonly ProviderWireEntry[]>>
  }
  readonly pluginInventory: {
    /** Read the current Host Loader entries for optional-feature gating. */
    list(): Promise<DiscoveryResponse<PluginInventorySnapshot>>
  }
  readonly settings: {
    describe(): Promise<DiscoveryResponse<SettingsDescribeWireValue>>
    /** Refused when the expected revision is stale. */
    mutate(ns: string, ops: readonly SettingsWireOp[], expectedRevision: number): Promise<DiscoveryResponse<unknown>>
  }
  readonly credentials: {
    set(ref: string, value: string): Promise<DiscoveryResponse<unknown>>
  }
}
