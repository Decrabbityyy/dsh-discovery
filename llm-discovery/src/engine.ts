export { DISCOVERY_NAMESPACE, discoverEndpoint } from './engine/discover.ts'
export { Config, resolveDiscoveryConfig } from './engine/config.ts'
export type { EngineSwitches, ResolvedDiscoveryConfig } from './engine/config.ts'
export { enrichModels } from './engine/enrich.ts'
export { fetchJson } from './engine/http.ts'
export type { FetchJsonOptions, JsonFetch, JsonFetchFailure } from './engine/http.ts'
export { catalogInputModalities, catalogReasoningEfforts, inputModalitiesOf } from './engine/catalog.ts'
export type { ReasoningEfforts } from './engine/catalog.ts'
export { MODELS_DEV_URL, normalizeLevel, normalizeModelName, parseCatalog, parseModalities, parseModelFacts } from './catalog/models-dev.ts'
export type { ModelFacts } from './catalog/models-dev.ts'
export {
  CATALOG_SERVICE, CREDENTIAL_REF_PATTERN, DISCOVERY_NS, DYNAMIC_NS, DYNAMIC_PROBE_PATH, PI_AI_NS, ROUTE_PATTERN,
  ROUTE_PROTOCOLS, THINKING_LEVELS, UI_CATALOG_PATH, UI_CATALOG_STATUS_PATH, catalogEnvelope, catalogKeyCandidates,
  catalogKeyIndexOf, deriveKeyRef, mergeCatalogEnvelopes, messageOf, reasoningEffortsOf, resolveCatalogKey,
} from './vocabulary.ts'
export type {
  CatalogEnvelope, CatalogFact, CatalogKeyIndex, CatalogStatus, ModelModalities, ModelModality, RouteProtocol,
  SharedCatalog, ThinkingLevel,
} from './vocabulary.ts'