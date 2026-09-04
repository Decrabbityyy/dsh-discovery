/**
 * OMP-style endpoint model discovery for the DeepSeek Harness LLM seam: one
 * plugin registering the `llm-discovery` discovery offer on `ctx.llm`. The
 * engine ladder and shared catalog parsers live in
 * `dsh-llm-endpoint-base`; this plugin is the thin Cordis shell that mounts
 * that engine as the `llm-discovery` offer and enriches undisclosed fields
 * from the online `models.dev` catalog. Configuration surfaces reach it
 * through the existing `llm.discoverModels` RPC with
 * `settingsNs: 'llm-discovery'`; no adapter or gateway changes are involved.
 * Named exports preserve loader injection metadata.
 * @module dsh-llm-discovery
 */

import type { Context } from '@deepseek-ai/cordis'
import { DISCOVERY_NAMESPACE, discoverEndpoint, enrichModels, MODELS_DEV_URL, normalizeModelName, parseModelFacts, resolveDiscoveryConfig } from 'dsh-llm-endpoint-base'
import type { Config, ModelFacts } from 'dsh-llm-endpoint-base'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-llm'

export { Config, resolveDiscoveryConfig } from 'dsh-llm-endpoint-base'
export type { EngineSwitches, ResolvedDiscoveryConfig } from 'dsh-llm-endpoint-base'
export { DISCOVERY_NAMESPACE, discoverEndpoint, enrichModels } from 'dsh-llm-endpoint-base'

/** Cordis plugin name. */
export const name = 'llm-discovery'
/** Service dependency: the LLM registry the discovery offer registers on. */
export const inject = ['llm']

/**
 * Fetch the current models.dev fact index. Network failure is deliberately
 * non-fatal: endpoint-provided fields and the bundled pi-ai catalog remain
 * usable when the online catalog is unavailable.
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
 * Endpoint values are authoritative; model ids are normalized so providers
 * returning `provider/model` can use the same online fact as a bare id.
 */
export function enrichModelsFromOnline(
  models: readonly LlmDiscoveredModel[],
  facts: ReadonlyMap<string, ModelFacts>,
): LlmDiscoveredModel[] {
  return models.map((model) => {
    const fact = facts.get(normalizeModelName(model.id))
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
