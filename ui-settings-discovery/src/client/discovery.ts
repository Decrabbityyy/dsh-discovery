import type { LlmDiscoveredModel, LlmModelDiscoveryRequest, RpcResponse } from '@deepseek-ai/dsh-api-remotes/client'
import {
  catalogKeyCandidates, catalogKeyIndexOf, CREDENTIAL_REF_PATTERN, DISCOVERY_NS, DYNAMIC_CACHE_PATH, DYNAMIC_NS,
  mergeCatalogEnvelopes, PI_AI_NS, ROUTE_PATTERN, resolveCatalogKey, UI_CATALOG_PATH, deriveKeyRef, messageOf,
} from 'dsh-llm-discovery/vocabulary'
import type { CatalogEnvelope, CatalogKeyIndex } from 'dsh-llm-discovery/vocabulary'
import { reasoningEffortsOf } from './presets.ts'

export {
  catalogKeyCandidates, CREDENTIAL_REF_PATTERN, DISCOVERY_NS, DYNAMIC_CACHE_PATH, DYNAMIC_NS, mergeCatalogEnvelopes,
  PI_AI_NS, ROUTE_PATTERN, UI_CATALOG_PATH, deriveKeyRef, messageOf,
}
export type { CatalogEnvelope }

/** Modalities one model's catalog entry records, keyed by bare model name. */
export type ModelModalities = CatalogEnvelope['modalities'][string]

/** The catalog tables one snapshot serves, keyed by catalog key. */
export interface CatalogTables {
  readonly catalog: Readonly<Record<string, readonly string[]>>
  readonly modalities: Readonly<Record<string, { readonly input?: readonly string[]; readonly output?: readonly string[] }>>
  readonly facts: Readonly<Record<string, { readonly name?: string; readonly contextWindow?: number; readonly maxTokens?: number }>>
  /** Providers behind each key, in file order; absent in a legacy body. */
  readonly sources?: Readonly<Record<string, readonly string[]>>
}

/** Everything the catalog records for one entry. */
export interface CatalogEntry {
  /** The key the catalog stores the entry under. */
  readonly key: string
  readonly name?: string
  readonly contextWindow?: number
  readonly maxTokens?: number
  /** Inputs the pi-ai wire carries, deduplicated; empty when none are recorded. */
  readonly input: readonly string[]
  /** Thinking levels the entry records; empty when it records none. */
  readonly levels: readonly string[]
  /** Providers that record this key, in file order; the first supplied the rest. */
  readonly sources: readonly string[]
}

/** One snapshot's tables, indexed for case-insensitive lookup by key. */
export interface CatalogIndex extends CatalogKeyIndex {
  /** The entry one stored key reads, or undefined for a key no table carries. */
  entryOf(key: string): CatalogEntry | undefined
}

/** One row's resolved catalog entry: the key it matched and what that key records. */
export interface CatalogMatch {
  readonly key: string
  readonly entry: CatalogEntry
}

/**
 * Build the index every row lookup and the picker share. Keys come from the
 * union of the three data tables: an entry may carry levels without capacities,
 * or modalities without levels, and the row it belongs to must still resolve.
 */
export function catalogIndexOf(tables: CatalogTables): CatalogIndex {
  const keys = catalogKeyIndexOf([
    ...Object.keys(tables.catalog),
    ...Object.keys(tables.modalities),
    ...Object.keys(tables.facts),
  ])
  return {
    ...keys,
    entryOf: (key) => {
      const levels = tables.catalog[key]
      const modalities = tables.modalities[key]
      const facts = tables.facts[key]
      if (levels === undefined && modalities === undefined && facts === undefined) return undefined
      return {
        key,
        ...facts?.name === undefined ? {} : { name: facts.name },
        ...facts?.contextWindow === undefined ? {} : { contextWindow: facts.contextWindow },
        ...facts?.maxTokens === undefined ? {} : { maxTokens: facts.maxTokens },
        input: [...new Set((modalities?.input ?? []).filter(value => value === 'text' || value === 'image'))],
        levels: levels ?? [],
        sources: tables.sources?.[key] ?? [],
      }
    },
  }
}

/**
 * The entry one row reads its facts from: the key the user pinned when there is
 * one, else the key its id resolves to. A key the pinned name no longer carries
 * falls back to resolution rather than losing the row's facts.
 */
export function matchCatalogEntry(
  modelId: string,
  index: CatalogIndex,
  bindings: Readonly<Record<string, string>> = {},
): CatalogMatch | undefined {
  const bound = bindings[modelId]
  if (bound !== undefined) {
    const entry = index.entryOf(bound)
    return entry === undefined ? undefined : { key: bound, entry }
  }
  const key = resolveCatalogKey(modelId, index)
  if (key === undefined) return undefined
  const entry = index.entryOf(key)
  return entry === undefined ? undefined : { key, entry }
}

/**
 * The longest catalog key one id spells, as the picker's opening search: a
 * variant id like `deepseek-v4-flash-max` seeds `deepseek-v4-flash`, while an
 * id the catalog has never heard of seeds nothing and lists every entry.
 */
export function catalogSearchSeed(modelId: string, index: CatalogIndex): string {
  for (const candidate of catalogKeyCandidates(modelId)) {
    const exact = index.keyOf(candidate)
    if (exact !== undefined) return exact
    for (let cut = candidate.lastIndexOf('-'); cut > 0; cut = candidate.lastIndexOf('-', cut - 1)) {
      const prefix = index.keyOf(candidate.slice(0, cut))
      if (prefix !== undefined) return prefix
    }
  }
  return ''
}

/**
 * The per-model `input` declaration to write for one entry, or undefined when
 * the catalog records nothing for it or no image support.
 *
 * Only a positive image claim is written. `input` has no settings-surface
 * editor, so writing `['text']` for a model the catalog still lists without
 * modalities would freeze it as text-only with no way back when the catalog
 * learns it accepts images; an unwritten field stays inheritable.
 */
export function declaredInput(entry: CatalogEntry | undefined): readonly string[] | undefined {
  return entry !== undefined && entry.input.includes('image') ? entry.input : undefined
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
 * One model entry to write back. The picked levels and the catalog entry the
 * row matched win; a field neither supplies keeps what the stored profile
 * already declared, so an edit that does not touch it cannot silently drop it.
 * The name and capacities a row displays but its endpoint never disclosed come
 * from the catalog the same way, which is what makes them survive the write.
 */
export function modelDeclaration(
  row: ProfileModel,
  levels: ReadonlySet<string>,
  entry: CatalogEntry | undefined,
): ProfileModel {
  const reasoningEfforts = reasoningEffortsOf(levels) ?? row.reasoningEfforts
  const input = declaredInput(entry) ?? row.input
  const name = row.name ?? entry?.name
  const contextWindow = row.contextWindow ?? entry?.contextWindow
  const maxTokens = row.maxTokens ?? entry?.maxTokens
  return {
    id: row.id,
    ...name === undefined ? {} : { name },
    ...contextWindow === undefined ? {} : { contextWindow },
    ...maxTokens === undefined ? {} : { maxTokens },
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

/** One route's outcome in a cache refresh report. */
export interface RouteProbe {
  readonly route: string
  /** Models the route now serves; absent when the probe failed. */
  readonly models?: number
  readonly error?: string
}

/** What the dynamic provider's cache endpoint reports, as the 模型缓存 tab reads it. */
export interface DynamicCacheStatus {
  /** Declared routes, whether or not their probe succeeded. */
  readonly routes: number
  readonly modelsDev: {
    readonly entries: number
    readonly refreshedAt: number | null
    readonly source?: 'storage' | 'models.dev'
    /** Why the facts are not storage-backed, when they are not. */
    readonly storageError?: string
    /** Why the last load failed; the facts of the previous one stay in place. */
    readonly error?: string
  }
  /** The catalog cache file, present only where the deployment caches. */
  readonly cacheFile?: {
    readonly path: string
    readonly writtenAt: number | null
    readonly routes: number
  }
  /** Present only in the answer to a refresh. */
  readonly probes?: readonly RouteProbe[]
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
