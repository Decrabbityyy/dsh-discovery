import { normalizeModelName } from '../vocabulary.ts'

export { normalizeModelName }

export const MODELS_DEV_URL = 'https://models.dev/api.json'

/** The fields of one models.dev entry this module reads. */
interface ModelsDevModel {
  readonly name?: string
  readonly reasoning?: boolean
  readonly reasoning_options?: readonly { readonly type: string; readonly values?: readonly string[] }[]
  readonly modalities?: { readonly input?: readonly string[]; readonly output?: readonly string[] }
  readonly limit?: { readonly context?: number; readonly input?: number; readonly output?: number }
}

/** One model's fact set parsed from models.dev, keyed by the id models.dev records. */
export interface ModelFacts {
  readonly displayName?: string
  /** Normalized; models.dev's `none` becomes `off`. */
  readonly levels?: readonly string[]
  /** Accepted input modalities, filtered to what the pi-ai wire carries. */
  readonly inputModalities?: readonly ModelModality[]
  /** Produced output modalities, filtered the same way. */
  readonly outputModalities?: readonly ModelModality[]
  readonly contextWindow?: number
  readonly maxTokens?: number
  /**
   * Provider ids behind this entry, in file order. Providers that record the
   * same facts share one entry and are all listed here; a provider whose facts
   * differ gets an entry of its own, named by this list too.
   */
  readonly sources?: readonly string[]
}

/** models.dev also lists pdf/audio/video, which the pi-ai wire cannot carry. */
export type ModelModality = 'text' | 'image'

export interface ModelModalities {
  readonly input: readonly ModelModality[]
  readonly output: readonly ModelModality[]
}

function keepSupported(values: readonly string[] | undefined): ModelModality[] {
  return (values ?? []).filter((value): value is ModelModality => value === 'text' || value === 'image')
}

/**
 * The keys one models.dev model is indexed under: the id exactly as recorded,
 * plus its bare name when that differs, so an endpoint that drops the vendor
 * prefix (`z-ai/glm-5.2` for `glm-5.2`) resolves too.
 */
function keysOf(modelId: string): readonly string[] {
  const bare = normalizeModelName(modelId)
  return bare === modelId ? [modelId] : [modelId, bare]
}

/** One indexed model of one models.dev body, in file order. */
interface IndexedModel {
  readonly id: string
  readonly keys: readonly string[]
  readonly provider: string
  readonly model: ModelsDevModel
}

/** Walk every models.dev body's providers and models in file order. */
function* indexedModels(body: unknown): Generator<IndexedModel> {
  if (typeof body !== 'object' || body === null) return
  for (const [provider, providerData] of Object.entries(body)) {
    const models = (providerData as { models?: Record<string, ModelsDevModel> }).models
    if (typeof models !== 'object' || models === null) continue
    for (const [modelId, model] of Object.entries(models)) {
      yield { id: modelId, keys: keysOf(modelId), provider, model }
    }
  }
}

/**
 * A capacity the catalog disclosed. Zero, negatives, and fractions mean it did
 * not: the stored row schema accepts only positive integers, so carrying one of
 * those through would make the stored catalog unreadable on the next boot.
 */
function capacity(value: number | undefined): number | undefined {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : undefined
}

/** The facts one models.dev model records, without the provider that recorded them. */
function factsOf(model: ModelsDevModel): ModelFacts {
  const effort = model.reasoning_options?.find(option => option.type === 'effort')
  const levels = effort?.values !== undefined && effort.values.length > 0
    ? effort.values.map(normalizeLevel)
    : model.reasoning === true ? [] : undefined
  const inputModalities = keepSupported(model.modalities?.input)
  const outputModalities = keepSupported(model.modalities?.output)
  const contextWindow = capacity(model.limit?.context)
  const maxTokens = capacity(model.limit?.output)
  return {
    ...model.name === undefined ? {} : { displayName: model.name },
    ...levels === undefined ? {} : { levels },
    ...inputModalities.length === 0 ? {} : { inputModalities },
    ...outputModalities.length === 0 ? {} : { outputModalities },
    ...contextWindow === undefined ? {} : { contextWindow },
    ...maxTokens === undefined ? {} : { maxTokens },
  }
}

/** What one model records, as a value two providers can be compared on. */
function factSignature(facts: ModelFacts): string {
  return JSON.stringify([
    facts.displayName ?? null,
    facts.levels ?? null,
    facts.inputModalities ?? null,
    facts.outputModalities ?? null,
    facts.contextWindow ?? null,
    facts.maxTokens ?? null,
  ])
}

/** One models.dev model as one key's contributor. */
interface ModelRecord {
  readonly id: string
  readonly provider: string
  readonly facts: ModelFacts
}

/** The providers of one key that record the same facts. */
interface RecordGroup {
  readonly facts: ModelFacts
  readonly providers: string[]
  /** The id and provider of the group's first record, for naming a divergent entry. */
  readonly id: string
  readonly provider: string
}

/**
 * Store one group's facts under the first candidate key that is free or already
 * carries them. An occupied key holding the same facts only gains the providers
 * of this group; one holding other facts is left alone, because both sets have
 * to stay reachable.
 */
function placeFacts(index: Map<string, ModelFacts>, group: RecordGroup, key: string, candidates: readonly string[]): void {
  const signature = factSignature(group.facts)
  for (const candidate of [...candidates, `${group.provider}/${key}`, `${group.provider}/${key}~2`, `${group.provider}/${key}~3`]) {
    const existing = index.get(candidate)
    if (existing === undefined) {
      index.set(candidate, { ...group.facts, sources: [...group.providers] })
      return
    }
    if (factSignature(existing) === signature) {
      index.set(candidate, {
        ...existing,
        sources: [...new Set([...(existing.sources ?? []), ...group.providers])],
      })
      return
    }
  }
  // Unreachable in practice: it would take a provider whose recorded id spells
  // three other providers' qualified keys. The key's own winner stands.
}

/** models.dev's `none` spells the harness level `off`; every other value passes through. */
export function normalizeLevel(value: string): string {
  return value === 'none' ? 'off' : value
}

/**
 * Parse the models.dev api.json body into a modelKey → levels index, keyed
 * exactly as {@link parseModelFacts} keys it. A model with no levels stays out;
 * a reasoning model without an effort entry records an empty list, which the
 * picker renders as no levels.
 */
export function parseCatalog(body: unknown): Map<string, readonly string[]> {
  const index = new Map<string, readonly string[]>()
  for (const [key, facts] of parseModelFacts(body)) {
    if (facts.levels !== undefined) index.set(key, facts.levels)
  }
  return index
}

/**
 * Parse the models.dev api.json body into a modelKey → modalities index, keyed
 * exactly as {@link parseModelFacts} keys it. A model with no modalities block
 * stays absent, which reads as unknown rather than text-only.
 */
export function parseModalities(body: unknown): Map<string, ModelModalities> {
  const index = new Map<string, ModelModalities>()
  for (const [key, facts] of parseModelFacts(body)) {
    if (facts.inputModalities === undefined && facts.outputModalities === undefined) continue
    index.set(key, { input: facts.inputModalities ?? [], output: facts.outputModalities ?? [] })
  }
  return index
}

/**
 * Parse the models.dev api.json body into a modelKey → facts index. Keys are the
 * ids models.dev records plus their bare names, so an endpoint that drops the
 * vendor prefix still resolves.
 *
 * Every provider recording one key contributes to it. Providers that record the
 * same facts share that key's entry and are all named in its `sources`; a
 * provider whose facts differ keeps an entry of its own, under the id it records
 * or a provider-qualified name. Merging the agreements keeps the index small,
 * and splitting the disagreements is what lets a surface say whose capacities an
 * entry carries instead of silently taking the first provider's.
 */
export function parseModelFacts(body: unknown): Map<string, ModelFacts> {
  // Every provider recording one key, in file order.
  const contributions = new Map<string, ModelRecord[]>()
  for (const { id, keys, provider, model } of indexedModels(body)) {
    const record: ModelRecord = { id, provider, facts: factsOf(model) }
    for (const key of keys) {
      const records = contributions.get(key)
      if (records === undefined) contributions.set(key, [record])
      else records.push(record)
    }
  }
  const index = new Map<string, ModelFacts>()
  for (const [key, records] of contributions) {
    const groups = new Map<string, RecordGroup>()
    for (const record of records) {
      const signature = factSignature(record.facts)
      const group = groups.get(signature)
      if (group === undefined) {
        groups.set(signature, {
          facts: record.facts,
          providers: [record.provider],
          id: record.id,
          provider: record.provider,
        })
      } else if (!group.providers.includes(record.provider)) {
        group.providers.push(record.provider)
      }
    }
    let position = 0
    for (const group of groups.values()) {
      // The agreeing group that comes first holds the key itself; the others go
      // to the id their provider records, which is where that provider's own
      // entry belongs anyway.
      placeFacts(
        index,
        group,
        key,
        position === 0 ? [key, group.id] : [group.id],
      )
      position += 1
    }
  }
  return index
}
