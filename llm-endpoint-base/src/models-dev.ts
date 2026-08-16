/**
 * The models.dev thinking-level parser: turn the public `api.json` body into
 * a modelId → levels index. Pure — no fetch, no disk — so the host plugin
 * wraps it with its cache and the browser client could parse an inline
 * snapshot the same way. The disk cache and the network fetch stay with the
 * host plugin that owns them.
 * @module dsh-llm-endpoint-base/models-dev
 */

import { catalogInputModalities } from './catalog.ts'
import { normalizeModelName } from './vocabulary.ts'

export { normalizeModelName }

/** The models.dev catalog endpoint. */
export const MODELS_DEV_URL = 'https://models.dev/api.json'

/** One models.dev model entry's reasoning shape this index reads. */
interface ModelsDevModel {
  readonly name?: string
  readonly reasoning?: boolean
  readonly reasoning_options?: readonly { readonly type: string; readonly values?: readonly string[] }[]
  readonly modalities?: { readonly input?: readonly string[]; readonly output?: readonly string[] }
  readonly limit?: { readonly context?: number; readonly input?: number; readonly output?: number }
}

/** One model's full fact set parsed from models.dev, keyed by bare model name. */
export interface ModelFacts {
  /** Display name (`Grok 4.6`), when models.dev records one. */
  readonly displayName?: string
  /** Accepted thinking levels (normalized; `none` → `off`). */
  readonly levels?: readonly string[]
  /** Accepted input modalities (text/image only). */
  readonly inputModalities?: readonly ModelModality[]
  /** Produced output modalities (text/image only). */
  readonly outputModalities?: readonly ModelModality[]
  /** Combined context capacity in tokens. */
  readonly contextWindow?: number
  /** Per-request output cap in tokens. */
  readonly maxTokens?: number
}

/** The harness-supported modalities; models.dev also lists pdf/audio/video, which the pi-ai wire cannot carry. */
export type ModelModality = 'text' | 'image'

/** One model's accepted input and produced output modalities (text/image only). */
export interface ModelModalities {
  readonly input: readonly ModelModality[]
  readonly output: readonly ModelModality[]
}

/** Keep only the modalities the pi-ai wire carries; pdf/audio/video are dropped. */
function keepSupported(values: readonly string[] | undefined): ModelModality[] {
  return (values ?? []).filter((value): value is ModelModality => value === 'text' || value === 'image')
}

/**
 * Normalize one models.dev effort value to the harness thinking-level
 * vocabulary: `none` spells `off` (supported, send nothing); the rest pass
 * through unchanged.
 * @param value - the models.dev effort spelling.
 * @returns the harness thinking level.
 */
export function normalizeLevel(value: string): string {
  return value === 'none' ? 'off' : value
}

/**
 * Parse the models.dev api.json body into a modelId → levels index. The file
 * is keyed by provider, then model id; a model's `reasoning_options` effort
 * entry carries the accepted values. Models without an effort entry (toggle-
 * only or non-reasoning) record an empty list so the picker shows no levels.
 * @param body - the parsed api.json body.
 * @returns the modelId → accepted-levels index.
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
 * the same first-provider-wins rule as {@link parseCatalog}. A model without
 * a modalities block is absent (unknown, not text-only); the caller defaults.
 * @param body - the parsed api.json body.
 * @returns the modelId → input/output modalities index.
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
 * `undefined` — the caller defaults (pi-ai's own default is text-only).
 * @param index - the models.dev modalities index (from {@link parseModalities}).
 * @param modelId - the model id exactly as the endpoint accepts it.
 * @returns the accepted input modalities, or `undefined` when unknown.
 */
export function inputModalitiesOf(index: ReadonlyMap<string, ModelModalities>, modelId: string): readonly ModelModality[] | undefined {
  const listed = index.get(modelId)
  if (listed !== undefined && listed.input.length > 0) return listed.input
  return catalogInputModalities(modelId)
}

/**
 * Parse the models.dev api.json body into a bare-model-name → facts index,
 * collapsing every provider-prefixed duplicate onto its canonical name (the
 * first provider in file order wins on a collision). This is the persistence
 * shape: one row per unique model, not one per provider listing.
 * @param body - the parsed api.json body.
 * @returns the bare-name → facts index.
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
