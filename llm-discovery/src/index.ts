import type { Context } from '@deepseek-ai/cordis'
import {
  catalogKeyIndexOf, DISCOVERY_NAMESPACE, discoverEndpoint, enrichModels, MODELS_DEV_URL, parseModelFacts,
  resolveCatalogKey, resolveDiscoveryConfig,
} from './engine.ts'
import type { Config, ModelFacts } from './engine.ts'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-llm'

export { Config, resolveDiscoveryConfig } from './engine.ts'
export type { EngineSwitches, ResolvedDiscoveryConfig } from './engine.ts'
export { DISCOVERY_NAMESPACE, discoverEndpoint, enrichModels } from './engine.ts'

export const name = 'llm-discovery'
/** Service dependency: the LLM registry the discovery offer registers on. */
export const inject = ['llm']

/**
 * Fetch the current models.dev fact index. A failed fetch yields an empty index
 * rather than throwing, leaving the endpoint and bundled-catalog fields usable.
 */
async function loadOnlineFacts(): Promise<ReadonlyMap<string, ModelFacts>> {
  const facts = new Map<string, ModelFacts>()
  try {
    const response = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) return facts
    for (const [name, fact] of parseModelFacts(await response.json())) facts.set(name, fact)
  } catch {
    // Offline startup must not make the discovery offer unavailable.
  }
  return facts
}

/**
 * Fill fields omitted by an endpoint from the current models.dev snapshot.
 * Endpoint values win, and an id resolves to its own entry when models.dev
 * records it, else to the one its head or tail names — `x-ai/grok-4.6` keeps
 * the id that provider records rather than collapsing onto another's.
 */
export function enrichModelsFromOnline(
  models: readonly LlmDiscoveredModel[],
  facts: ReadonlyMap<string, ModelFacts>,
): LlmDiscoveredModel[] {
  const index = catalogKeyIndexOf(facts.keys())
  return models.map((model) => {
    const key = resolveCatalogKey(model.id, index)
    const fact = key === undefined ? undefined : facts.get(key)
    if (fact === undefined) return { ...model }
    return {
      ...model,
      ...model.name === undefined && fact.displayName !== undefined ? { name: fact.displayName } : {},
      ...model.contextWindow === undefined && fact.contextWindow !== undefined ? { contextWindow: fact.contextWindow } : {},
      ...model.maxTokens === undefined && fact.maxTokens !== undefined ? { maxTokens: fact.maxTokens } : {},
    }
  })
}

export function apply(ctx: Context, config?: Config): void {
  const resolved = resolveDiscoveryConfig(config)
  // Refresh once per plugin mount. The request waits for this snapshot, so a
  // successful online catalog is applied even when the first probe is immediate.
  const onlineFacts = resolved.enrichment ? loadOnlineFacts() : Promise.resolve(new Map<string, ModelFacts>())
  ctx.llm.registerModelDiscovery(DISCOVERY_NAMESPACE, async (request) => {
    const [raw, facts] = await Promise.all([discoverEndpoint(request, resolved), onlineFacts])
    const bundled = resolved.enrichment ? enrichModels(raw) : [...raw]
    return enrichModelsFromOnline(bundled, facts)
  })
}
