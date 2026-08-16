/**
 * Bundled-catalog enrichment for discovered models. An endpoint that answers
 * with bare ids still yields serviceable candidates when the id is one the
 * installed pi-ai catalog describes; fields the endpoint reported always win,
 * and an id the catalog does not know stays honestly undisclosed.
 * @module dsh-llm-discovery/enrich
 */

import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-llm'
import { getBuiltinModels, getBuiltinProviders } from '@earendil-works/pi-ai/providers/all'

/** The catalog facts one model id can supply. */
interface CatalogFacts {
  /** Display name. */
  readonly name: string
  /** Combined request/response context capacity. */
  readonly contextWindow: number
  /** Per-request output cap. */
  readonly maxTokens: number
}

let cachedIndex: ReadonlyMap<string, CatalogFacts> | undefined

/**
 * The id-keyed index over every provider the installed pi-ai catalog ships,
 * built once per process. A bare id two providers ship resolves to the first
 * provider in catalog order — enrichment fills selector metadata, it never
 * routes, so a collision costs a wrong label at worst.
 * @returns the memoized catalog index.
 */
function catalogIndex(): ReadonlyMap<string, CatalogFacts> {
  if (cachedIndex !== undefined) return cachedIndex
  const index = new Map<string, CatalogFacts>()
  for (const provider of getBuiltinProviders()) {
    for (const model of getBuiltinModels(provider)) {
      if (index.has(model.id)) continue
      index.set(model.id, { name: model.name, contextWindow: model.contextWindow, maxTokens: model.maxTokens })
    }
  }
  cachedIndex = index
  return index
}

/**
 * Fill the fields one discovered model left undisclosed from the bundled
 * catalog. Endpoint-reported values are authoritative and never overwritten.
 * @param models - the models one engine returned.
 * @returns the same list with catalog facts filled where known.
 */
export function enrichModels(models: readonly LlmDiscoveredModel[]): LlmDiscoveredModel[] {
  const catalog = catalogIndex()
  return models.map((model) => {
    const facts = catalog.get(model.id)
    if (facts === undefined) return { ...model }
    // Catalog facts are complete, so a known id always leaves fully described.
    return {
      id: model.id,
      name: model.name ?? facts.name,
      contextWindow: model.contextWindow ?? facts.contextWindow,
      maxTokens: model.maxTokens ?? facts.maxTokens,
    }
  })
}
