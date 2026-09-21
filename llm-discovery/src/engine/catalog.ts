import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import { getBuiltinModels, getBuiltinProviders } from '@earendil-works/pi-ai/providers/all'
import type { ModelModalities, ModelModality } from '../catalog/models-dev.ts'

/** A level → wire spelling map; only `off` may map to `null`. */
export type ReasoningEfforts = Record<string, string | null>

let cachedIndex: ReadonlyMap<string, ReasoningEfforts> | undefined

/**
 * The exact-id index, built once per process. Only reasoning models get an
 * entry, and a shared id resolves to the first provider in catalog order.
 */
function reasoningIndex(): ReadonlyMap<string, ReasoningEfforts> {
  if (cachedIndex !== undefined) return cachedIndex
  const index = new Map<string, ReasoningEfforts>()
  for (const provider of getBuiltinProviders()) {
    for (const model of getBuiltinModels(provider)) {
      if (!model.reasoning || index.has(model.id)) continue
      const map = model.thinkingLevelMap
      const efforts: ReasoningEfforts = {}
      for (const level of getSupportedThinkingLevels(model)) {
        efforts[level] = level === 'off' ? (map?.['off'] ?? null) : (map?.[level] ?? level)
      }
      index.set(model.id, efforts)
    }
  }
  cachedIndex = index
  return index
}

/**
 * The catalog's `reasoningEfforts` for one model id, or `undefined` when the
 * catalog records no reasoning capability for it.
 */
export function catalogReasoningEfforts(id: string): ReasoningEfforts | undefined {
  const efforts = reasoningIndex().get(id)
  return efforts === undefined ? undefined : { ...efforts }
}

let cachedModalityIndex: ReadonlyMap<string, readonly ModelModality[]> | undefined

/**
 * The exact-id input-modality index, built once per process. A shared id
 * resolves to the first provider in catalog order, matching the reasoning index.
 */
function modalityIndex(): ReadonlyMap<string, readonly ModelModality[]> {
  if (cachedModalityIndex !== undefined) return cachedModalityIndex
  const index = new Map<string, readonly ModelModality[]>()
  for (const provider of getBuiltinProviders()) {
    for (const model of getBuiltinModels(provider)) {
      if (index.has(model.id)) continue
      index.set(model.id, model.input as readonly ModelModality[])
    }
  }
  cachedModalityIndex = index
  return index
}

/**
 * The catalog's accepted input modalities for one model id, or `undefined`
 * when the catalog does not know the id.
 */
export function catalogInputModalities(id: string): readonly ModelModality[] | undefined {
  return modalityIndex().get(id)
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
