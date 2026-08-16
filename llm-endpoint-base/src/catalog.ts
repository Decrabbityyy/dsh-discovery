/**
 * The catalog reasoning index: exact model id → the `reasoningEfforts`
 * declaration the pi-ai profile contract accepts. The translation copies the
 * catalog model's own `thinkingLevelMap` spellings through
 * `getSupportedThinkingLevels`: mapped levels keep their wire value, an
 * unmapped base level spells its canonical name, and `off` writes `null`
 * ("supported, send nothing"). Nothing is guessed.
 * @module dsh-llm-endpoint-base/catalog
 */

import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import { getBuiltinModels, getBuiltinProviders } from '@earendil-works/pi-ai/providers/all'
import type { ModelModality } from './models-dev.ts'

/** One `reasoningEfforts` declaration: level → wire spelling (null only for `off`). */
export type ReasoningEfforts = Record<string, string | null>

let cachedIndex: ReadonlyMap<string, ReasoningEfforts> | undefined

/**
 * Build the exact-id index once per process. Only reasoning models get an
 * entry; a shared id resolves to the first provider in catalog order.
 * @returns the memoized index.
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
 * The catalog's reasoning declaration for one model id.
 * @param id - the model id exactly as the endpoint accepts it.
 * @returns the `reasoningEfforts` to write, or `undefined` when the catalog
 *   records no reasoning capability for the id.
 */
export function catalogReasoningEfforts(id: string): ReasoningEfforts | undefined {
  const efforts = reasoningIndex().get(id)
  return efforts === undefined ? undefined : { ...efforts }
}

let cachedModalityIndex: ReadonlyMap<string, readonly ModelModality[]> | undefined

/**
 * Build the exact-id input-modality index once per process. A shared id
 * resolves to the first provider in catalog order, matching the reasoning index.
 * @returns the memoized index.
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
 * The catalog's accepted input modalities for one model id.
 * @param id - the model id exactly as the endpoint accepts it.
 * @returns the accepted input modalities, or `undefined` when the catalog
 *   does not know the id.
 */
export function catalogInputModalities(id: string): readonly ModelModality[] | undefined {
  return modalityIndex().get(id)
}
