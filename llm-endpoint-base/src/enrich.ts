import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-llm'
import { getBuiltinModels, getBuiltinProviders } from '@earendil-works/pi-ai/providers/all'

interface CatalogFacts {
  readonly name: string
  readonly contextWindow: number
  readonly maxTokens: number
}

let cachedIndex: ReadonlyMap<string, CatalogFacts> | undefined

/**
 * The id-keyed index over every provider the installed pi-ai catalog ships,
 * built once per process. A bare id two providers ship resolves to the first
 * provider in catalog order.
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
 * catalog. Endpoint-reported values are never overwritten.
 */
export function enrichModels(models: readonly LlmDiscoveredModel[]): LlmDiscoveredModel[] {
  const catalog = catalogIndex()
  return models.map((model) => {
    const facts = catalog.get(model.id)
    if (facts === undefined) return { ...model }
    return {
      id: model.id,
      name: model.name ?? facts.name,
      contextWindow: model.contextWindow ?? facts.contextWindow,
      maxTokens: model.maxTokens ?? facts.maxTokens,
    }
  })
}
