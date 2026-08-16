/**
 * `dsh-llm-endpoint-base`: the shared pure primitives behind endpoint model
 * discovery. This package owns the engine ladder (`discoverEndpoint`), the
 * bundled-catalog enrichment, the protocol / thinking-level / namespace
 * vocabulary, and the models.dev catalog parser — every fact the discovery
 * offer plugin, the dynamic-provider plugin, and the settings-panel client
 * must agree on. It is pure logic with no Cordis and no environment-specific
 * I/O, so the host plugins and the browser client consume the one definition
 * and the three stay mutually independent: each depends on this base, none on
 * a sibling.
 * @module dsh-llm-endpoint-base
 */

export { Config, resolveDiscoveryConfig } from './config.ts'
export type { EngineSwitches, ResolvedDiscoveryConfig } from './config.ts'
export { DISCOVERY_NAMESPACE, discoverEndpoint } from './discover.ts'
export { enrichModels } from './enrich.ts'
export { fetchJson } from './http.ts'
export type { FetchJsonOptions, JsonFetch, JsonFetchFailure } from './http.ts'
export { catalogInputModalities, catalogReasoningEfforts } from './catalog.ts'
export type { ReasoningEfforts } from './catalog.ts'
export { MODELS_DEV_URL, inputModalitiesOf, normalizeLevel, normalizeModelName, parseCatalog, parseModalities, parseModelFacts } from './models-dev.ts'
export type { ModelFacts, ModelModalities, ModelModality } from './models-dev.ts'
export {
  DISCOVERY_NS,
  DYNAMIC_NS,
  PI_AI_NS,
  ROUTE_PATTERN,
  ROUTE_PROTOCOLS,
  THINKING_LEVELS,
  deriveKeyRef,
  messageOf,
  reasoningEffortsOf,
} from './vocabulary.ts'
export type { RouteProtocol, ThinkingLevel } from './vocabulary.ts'
