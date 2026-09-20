import type { LlmDiscoveredModel, LlmModelDiscoveryRequest, RpcResponse } from '@deepseek-ai/dsh-api-remotes/client'
import {
  CREDENTIAL_REF_PATTERN, DISCOVERY_NS, DYNAMIC_NS, mergeCatalogEnvelopes, normalizeModelName, PI_AI_NS, ROUTE_PATTERN,
  UI_CATALOG_PATH, deriveKeyRef, messageOf,
} from 'dsh-llm-endpoint-base/vocabulary'
import type { CatalogEnvelope } from 'dsh-llm-endpoint-base/vocabulary'
import { reasoningEffortsOf } from './presets.ts'

export {
  CREDENTIAL_REF_PATTERN, DISCOVERY_NS, DYNAMIC_NS, mergeCatalogEnvelopes, normalizeModelName, PI_AI_NS, ROUTE_PATTERN,
  UI_CATALOG_PATH, deriveKeyRef, messageOf,
}
export type { CatalogEnvelope }

/** Modalities one model's catalog entry records, keyed by bare model name. */
export type ModelModalities = CatalogEnvelope['modalities'][string]

/**
 * The per-model `input` declaration to write for one adopted model, or
 * undefined when the catalog records nothing for it or no image support.
 *
 * Only a positive image claim is written. `input` has no settings-surface
 * editor, so writing `['text']` for a model the catalog still lists without
 * modalities would freeze it as text-only with no way back when the catalog
 * learns it accepts images; an unwritten field stays inheritable.
 */
export function declaredInputOf(
  modalities: Readonly<Record<string, { readonly input?: readonly string[] }>>,
  modelId: string,
): readonly string[] | undefined {
  const recorded = modalities[normalizeModelName(modelId)]?.input ?? []
  const accepted = [...new Set(recorded.filter(value => value === 'text' || value === 'image'))]
  return accepted.includes('image') ? accepted : undefined
}

/** One model read back out of a stored profile, plus the options it already declares. */
export interface ProfileModel {
  readonly id: string
  readonly name?: string
  readonly contextWindow?: number
  readonly maxTokens?: number
  /** Inputs the profile declares; kept when the catalog claims nothing. */
  readonly input?: readonly string[]
  /** Levels the profile declares; kept when none are picked. */
  readonly reasoningEfforts?: Readonly<Record<string, string | null>>
}

/** What the provider dialog reads out of one described pi-ai profile. */
export interface ProviderProfileDraft {
  readonly baseURL?: string
  readonly api?: string
  /** The models the profile lists explicitly; a catalog-served route lists none. */
  readonly models: readonly ProfileModel[]
}

/** One plain-object view of an unknown value, or undefined for anything else. */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function positiveIntegerOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function stringsOf(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) ? value.filter((member): member is string => typeof member === 'string') : undefined
}

/** The level → wire-spelling record of one stored declaration, when it carries one. */
function levelsOf(value: unknown): Readonly<Record<string, string | null>> | undefined {
  const record = recordOf(value)
  if (record === undefined) return undefined
  const levels: Record<string, string | null> = {}
  for (const [level, spelling] of Object.entries(record)) {
    if (spelling === null || typeof spelling === 'string') levels[level] = spelling
  }
  return levels
}

/**
 * Read one provider profile out of a described namespace value. A shape this
 * cannot read yields an empty draft rather than throwing: a hand-edited
 * settings file must still open, and the dialog writes back only what it can
 * describe.
 */
export function providerProfileOf(namespaceValue: unknown, routeId: string): ProviderProfileDraft {
  const profile = recordOf(recordOf(recordOf(namespaceValue)?.['providers'])?.[routeId])
  if (profile === undefined) return { models: [] }
  const models: ProfileModel[] = []
  for (const entry of Array.isArray(profile['models']) ? profile['models'] : []) {
    const record = recordOf(entry)
    if (record === undefined) continue
    const id = stringOf(record['id'])
    if (id === undefined) continue
    const name = stringOf(record['name'])
    const contextWindow = positiveIntegerOf(record['contextWindow'])
    const maxTokens = positiveIntegerOf(record['maxTokens'])
    const input = stringsOf(record['input'])
    const reasoningEfforts = levelsOf(record['reasoningEfforts'])
    models.push({
      id,
      ...name === undefined ? {} : { name },
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxTokens === undefined ? {} : { maxTokens },
      ...input === undefined ? {} : { input },
      ...reasoningEfforts === undefined ? {} : { reasoningEfforts },
    })
  }
  const baseURL = stringOf(profile['baseURL'])
  const api = stringOf(profile['api'])
  return {
    ...baseURL === undefined ? {} : { baseURL },
    ...api === undefined ? {} : { api },
    models,
  }
}

/**
 * One model entry to write back. The picked levels and the catalog's image
 * claim win; a field neither supplies keeps what the stored profile already
 * declared, so an edit that does not touch it cannot silently drop it.
 */
export function modelDeclaration(
  row: ProfileModel,
  levels: ReadonlySet<string>,
  modalities: Readonly<Record<string, { readonly input?: readonly string[] }>>,
): ProfileModel {
  const reasoningEfforts = reasoningEffortsOf(levels) ?? row.reasoningEfforts
  const input = declaredInputOf(modalities, row.id) ?? row.input
  return {
    id: row.id,
    ...row.name === undefined ? {} : { name: row.name },
    ...row.contextWindow === undefined ? {} : { contextWindow: row.contextWindow },
    ...row.maxTokens === undefined ? {} : { maxTokens: row.maxTokens },
    ...input === undefined ? {} : { input },
    ...reasoningEfforts === undefined ? {} : { reasoningEfforts },
  }
}

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
