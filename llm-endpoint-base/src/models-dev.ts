import { catalogInputModalities } from './catalog.ts'
import { normalizeModelName } from './vocabulary.ts'

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

/** One model's fact set parsed from models.dev, keyed by bare model name. */
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

/** models.dev's `none` spells the harness level `off`; every other value passes through. */
export function normalizeLevel(value: string): string {
  return value === 'none' ? 'off' : value
}

/**
 * Parse the models.dev api.json body into a modelId → levels index. The file
 * is keyed by provider, then model id, and a model's `reasoning_options`
 * effort entry carries the accepted values; a reasoning model without one
 * records an empty list, which the picker renders as no levels.
 */
export function parseCatalog(body: unknown): Map<string, readonly string[]> {
  const index = new Map<string, readonly string[]>()
  if (typeof body !== 'object' || body === null) return index
  for (const providerData of Object.values(body)) {
    const models = (providerData as { models?: Record<string, ModelsDevModel> }).models
    if (typeof models !== 'object' || models === null) continue
    for (const [modelId, model] of Object.entries(models)) {
      if (index.has(modelId)) continue
      const effort = model.reasoning_options?.find(option => option.type === 'effort')
      if (effort?.values !== undefined && effort.values.length > 0) {
        index.set(modelId, effort.values.map(normalizeLevel))
      } else if (model.reasoning === true) {
        index.set(modelId, [])
      }
    }
  }
  return index
}

/**
 * Parse the models.dev api.json body into a modelId → modalities index, with
 * the same first-provider-wins rule as {@link parseCatalog}. A model with no
 * modalities block stays absent, which reads as unknown rather than text-only.
 */
export function parseModalities(body: unknown): Map<string, ModelModalities> {
  const index = new Map<string, ModelModalities>()
  if (typeof body !== 'object' || body === null) return index
  for (const providerData of Object.values(body)) {
    const models = (providerData as { models?: Record<string, ModelsDevModel> }).models
    if (typeof models !== 'object' || models === null) continue
    for (const [modelId, model] of Object.entries(models)) {
      if (index.has(modelId) || model.modalities === undefined) continue
      const input = keepSupported(model.modalities.input)
      const output = keepSupported(model.modalities.output)
      if (input.length === 0 && output.length === 0) continue
      index.set(modelId, { input, output })
    }
  }
  return index
}

/**
 * Resolve one model's accepted input modalities: the models.dev index first,
 * then the bundled pi-ai catalog. A model neither source knows returns
 * `undefined`, leaving the default to the caller.
 */
export function inputModalitiesOf(index: ReadonlyMap<string, ModelModalities>, modelId: string): readonly ModelModality[] | undefined {
  const listed = index.get(modelId)
  if (listed !== undefined && listed.input.length > 0) return listed.input
  return catalogInputModalities(modelId)
}

/**
 * Parse the models.dev api.json body into a bare-model-name → facts index,
 * collapsing every provider-prefixed duplicate onto its canonical name; the
 * first provider in file order wins on a collision.
 */
export function parseModelFacts(body: unknown): Map<string, ModelFacts> {
  const index = new Map<string, ModelFacts>()
  if (typeof body !== 'object' || body === null) return index
  for (const providerData of Object.values(body)) {
    const models = (providerData as { models?: Record<string, ModelsDevModel> }).models
    if (typeof models !== 'object' || models === null) continue
    for (const [modelId, model] of Object.entries(models)) {
      const key = normalizeModelName(modelId)
      if (index.has(key)) continue
      const effort = model.reasoning_options?.find(option => option.type === 'effort')
      const levels = effort?.values !== undefined && effort.values.length > 0
        ? effort.values.map(normalizeLevel)
        : model.reasoning === true ? [] : undefined
      const inputModalities = keepSupported(model.modalities?.input)
      const outputModalities = keepSupported(model.modalities?.output)
      const facts: ModelFacts = {
        ...model.name === undefined ? {} : { displayName: model.name },
        ...levels === undefined ? {} : { levels },
        ...inputModalities.length === 0 ? {} : { inputModalities },
        ...outputModalities.length === 0 ? {} : { outputModalities },
        ...typeof model.limit?.context === 'number' ? { contextWindow: model.limit.context } : {},
        ...typeof model.limit?.output === 'number' ? { maxTokens: model.limit.output } : {},
      }
      index.set(key, facts)
    }
  }
  return index
}
