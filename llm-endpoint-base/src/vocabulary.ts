/**
 * Browser-safe: this module must stay free of I/O and of Cordis imports. It
 * carries the shared vocabulary both halves need, including the catalog
 * envelope a Host plugin serves and a settings surface reads.
 */

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
 * The grammar a credential reference must satisfy: the host brands one as a
 * POSIX-style environment-variable name and `credentials.set` refuses anything
 * else as `gateway/bad-request`. A route id is free to start with a digit, so
 * `deriveKeyRef` can produce a reference this rejects — a surface that stores a
 * typed key has to check the derived reference before calling.
 */
export const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Human text for a rejected call. A rejection need not be an Error, so
 * anything else is stringified rather than dropped.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The exact-path HTTP route the discovery settings section's own host half
 * serves the models.dev index on. The only consumer is its browser half, so
 * the section owns the endpoint and it exists exactly while that page does.
 */
export const UI_CATALOG_PATH = '/ui-settings-discovery/catalog'

/**
 * One model's models.dev fact set as the catalog envelope carries it. The host
 * parsers' `ModelFacts` is structurally assignable to this, so a browser
 * surface can read an envelope without importing the host-side parser (which
 * pulls the bundled pi-ai catalog).
 */
export interface CatalogFact {
  readonly levels?: readonly string[]
  readonly inputModalities?: readonly string[]
  readonly outputModalities?: readonly string[]
  readonly displayName?: string
  readonly contextWindow?: number
  readonly maxTokens?: number
}

/**
 * The models.dev index a Host plugin serves to a settings surface, keyed by
 * bare model name. A model absent from `modalities` is unknown rather than
 * text-only, which is what keeps an unlisted id from being frozen as text.
 */
export interface CatalogEnvelope {
  /** Reasoning levels per model, for preselecting the thinking-level picker. */
  readonly catalog: Record<string, readonly string[]>
  /** Accepted and produced modalities per model. */
  readonly modalities: Record<string, { readonly input: readonly string[]; readonly output: readonly string[] }>
  /** Display name and capacities per model, for one the pi-ai catalog does not describe. */
  readonly facts: Record<string, { readonly name?: string; readonly contextWindow?: number; readonly maxTokens?: number }>
}

/**
 * Build the envelope both Host catalog endpoints answer with: a fact with no
 * levels, no modalities, and no capacities contributes no entry at all.
 */
export function catalogEnvelope(entries: Iterable<readonly [string, CatalogFact]>): CatalogEnvelope {
  const envelope: {
    catalog: Record<string, readonly string[]>
    modalities: Record<string, { readonly input: readonly string[]; readonly output: readonly string[] }>
    facts: Record<string, { readonly name?: string; readonly contextWindow?: number; readonly maxTokens?: number }>
  } = { catalog: {}, modalities: {}, facts: {} }
  for (const [name, fact] of entries) {
    if (fact.levels !== undefined) envelope.catalog[name] = fact.levels
    if (fact.inputModalities !== undefined || fact.outputModalities !== undefined) {
      envelope.modalities[name] = { input: fact.inputModalities ?? [], output: fact.outputModalities ?? [] }
    }
    if (fact.displayName !== undefined || fact.contextWindow !== undefined || fact.maxTokens !== undefined) {
      envelope.facts[name] = {
        ...fact.displayName === undefined ? {} : { name: fact.displayName },
        ...fact.contextWindow === undefined ? {} : { contextWindow: fact.contextWindow },
        ...fact.maxTokens === undefined ? {} : { maxTokens: fact.maxTokens },
      }
    }
  }
  return envelope
}

/** One plain-object view of an unknown value, or undefined for anything else. */
function entryRecordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** The string members of an unknown value, dropping anything else. */
function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((member): member is string => typeof member === 'string') : []
}

/**
 * Merge parsed catalog bodies into one envelope in source order: the first
 * body carrying a key keeps it, and later bodies only fill what is missing. A
 * malformed body or entry contributes nothing, so a surface merging a failed
 * endpoint with a live one still renders the live answer.
 */
export function mergeCatalogEnvelopes(bodies: readonly unknown[]): CatalogEnvelope {
  const envelope: {
    catalog: Record<string, readonly string[]>
    modalities: Record<string, { readonly input: readonly string[]; readonly output: readonly string[] }>
    facts: Record<string, { readonly name?: string; readonly contextWindow?: number; readonly maxTokens?: number }>
  } = { catalog: {}, modalities: {}, facts: {} }
  for (const body of bodies) {
    const parsed = entryRecordOf(body)
    if (parsed === undefined) continue
    for (const [name, levels] of Object.entries(entryRecordOf(parsed['catalog']) ?? {})) {
      if (name in envelope.catalog) continue
      envelope.catalog[name] = stringsOf(levels)
    }
    for (const [name, value] of Object.entries(entryRecordOf(parsed['modalities']) ?? {})) {
      if (name in envelope.modalities) continue
      const modalities = entryRecordOf(value)
      if (modalities === undefined) continue
      envelope.modalities[name] = { input: stringsOf(modalities['input']), output: stringsOf(modalities['output']) }
    }
    for (const [name, value] of Object.entries(entryRecordOf(parsed['facts']) ?? {})) {
      if (name in envelope.facts) continue
      const fact = entryRecordOf(value)
      if (fact === undefined) continue
      envelope.facts[name] = {
        ...typeof fact['name'] === 'string' ? { name: fact['name'] } : {},
        ...typeof fact['contextWindow'] === 'number' ? { contextWindow: fact['contextWindow'] } : {},
        ...typeof fact['maxTokens'] === 'number' ? { maxTokens: fact['maxTokens'] } : {},
      }
    }
  }
  return envelope
}
