/**
 * The shared vocabulary every endpoint-discovery surface agrees on: the wire
 * protocols a route may speak, the pi-ai thinking levels, the settings
 * namespaces, and the small derivations the client and the hosts both apply.
 * Pure constants and pure functions — no I/O, no Cordis, no environment — so
 * the host plugins and the browser client import the one definition and never
 * drift.
 * @module dsh-llm-endpoint-base/vocabulary
 */

/** Wire protocols an endpoint route may speak (the discovery dialects). */
export const ROUTE_PROTOCOLS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai',
] as const

/** One wire protocol from {@link ROUTE_PROTOCOLS}. */
export type RouteProtocol = (typeof ROUTE_PROTOCOLS)[number]

/** The namespace whose host offer serves ad-hoc endpoint discovery. */
export const DISCOVERY_NS = 'llm-discovery'

/** The namespace adopted provider profiles are written into. */
export const PI_AI_NS = 'llm-pi-ai'

/** The namespace dynamic-provider routes are declared in (webui-editable). */
export const DYNAMIC_NS = 'llm-dynamic-provider'

/**
 * Thinking levels the pi-ai adapter accepts as `reasoningEfforts` keys. The
 * wire spelling is the canonical name itself; only `off` writes `null`
 * (supported, send nothing), per the adapter's profile contract.
 */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** One thinking level from {@link THINKING_LEVELS}. */
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

/**
 * Build one model entry's `reasoningEfforts` declaration from the picked
 * levels, or `undefined` when none are picked (the field stays absent).
 * @param levels - the picked level set.
 * @returns the declaration map, or undefined.
 */
export function reasoningEffortsOf(levels: ReadonlySet<string>): Record<string, string | null> | undefined {
  if (levels.size === 0) return undefined
  const efforts: Record<string, string | null> = {}
  for (const level of levels) efforts[level] = level === 'off' ? null : level
  return efforts
}

/**
 * Derive the conventional credential reference for a provider route: the same
 * derivation the Models page applies, so an adopted profile and the stored key
 * keep one naming rule.
 * @param provider - provider route id (e.g. `local-ollama`).
 * @returns the derived reference name (e.g. `LOCAL_OLLAMA_API_KEY`).
 */
export function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/**
 * Normalize a model id to its canonical lookup key: drop every `/`-separated
 * provider prefix, keeping the bare model name. Duplicated here (not
 * re-exported from models-dev) so this vocabulary module stays free of the
 * catalog imports that only the host side may bundle.
 * @param id - the model id as reported or indexed.
 * @returns the bare model name.
 */
export function normalizeModelName(id: string): string {
  const slash = id.lastIndexOf('/')
  return slash === -1 ? id : id.slice(slash + 1)
}

/** Route ids accepted by the adopt flow (lowercase letters, digits, hyphens). */
export const ROUTE_PATTERN = /^[a-z0-9-]+$/

/**
 * Human text for a rejected call. A transport failure rejects with an Error;
 * a host or a runtime can reject with anything, and the surface still has to
 * say something.
 * @param error - the rejection value.
 * @returns the message to show.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
