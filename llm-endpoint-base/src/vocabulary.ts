/** Browser-safe: this module must stay free of I/O and of Cordis imports. */

/** Wire protocols an endpoint route may speak (the discovery dialects). */
export const ROUTE_PROTOCOLS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai',
] as const

export type RouteProtocol = (typeof ROUTE_PROTOCOLS)[number]

/** The namespace whose host offer serves ad-hoc endpoint discovery. */
export const DISCOVERY_NS = 'llm-discovery'

/** The namespace adopted provider profiles are written into. */
export const PI_AI_NS = 'llm-pi-ai'

/** The namespace dynamic-provider routes are declared in (webui-editable). */
export const DYNAMIC_NS = 'llm-dynamic-provider'

/**
 * The levels the pi-ai adapter accepts as `reasoningEfforts` keys. Each key is
 * its own wire spelling, except `off`, which writes `null`.
 */
export const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

/**
 * Build one model entry's `reasoningEfforts` declaration from the picked
 * levels, or `undefined` when none are picked.
 */
export function reasoningEffortsOf(levels: ReadonlySet<string>): Record<string, string | null> | undefined {
  if (levels.size === 0) return undefined
  const efforts: Record<string, string | null> = {}
  for (const level of levels) efforts[level] = level === 'off' ? null : level
  return efforts
}

/**
 * Derive the conventional credential reference for a provider route
 * (`local-ollama` → `LOCAL_OLLAMA_API_KEY`), using the same derivation the
 * Models page applies.
 */
export function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/**
 * Normalize a model id to its canonical lookup key, dropping every
 * `/`-separated provider prefix.
 */
export function normalizeModelName(id: string): string {
  const slash = id.lastIndexOf('/')
  return slash === -1 ? id : id.slice(slash + 1)
}

/** Route ids accepted by the adopt flow (lowercase letters, digits, hyphens). */
export const ROUTE_PATTERN = /^[a-z0-9-]+$/

/**
 * Human text for a rejected call. A rejection need not be an Error, so
 * anything else is stringified rather than dropped.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
