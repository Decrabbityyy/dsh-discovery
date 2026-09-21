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
 * Normalize a model id to its bare lookup name, dropping every
 * `/`-separated provider prefix.
 */
export function normalizeModelName(id: string): string {
  const slash = id.lastIndexOf('/')
  return slash === -1 ? id : id.slice(slash + 1)
}

/**
 * The catalog names one advertised model id may carry, widest first: the id
 * itself, then the segment before its first `/`, then the one after its last.
 * An endpoint spends a slash on both a vendor prefix (`z-ai/glm-5.2`) and a
 * variant tag (`Gemini-3.7-Flash/Antigravity`), so both halves are offered.
 */
export function catalogKeyCandidates(modelId: string): readonly string[] {
  const slash = modelId.indexOf('/')
  const head = slash === -1 ? modelId : modelId.slice(0, slash)
  const tail = normalizeModelName(modelId)
  return [...new Set([modelId, head, tail])].filter(name => name.length > 0)
}

/** Case-insensitive view over one catalog's keys. */
export interface CatalogKeyIndex {
  /** Every stored key, in the order given, deduplicated. */
  readonly keys: readonly string[]
  /** The stored key one name resolves to, ignoring case. */
  keyOf(name: string): string | undefined
}

/**
 * Build the key view every catalog lookup shares. The first spelling of a name
 * wins, mirroring the parsers' own first-model-wins rule.
 */
export function catalogKeyIndexOf(keys: Iterable<string>): CatalogKeyIndex {
  const listed = [...new Set(keys)]
  const byName = new Map<string, string>()
  for (const key of listed) {
    const name = key.toLowerCase()
    if (!byName.has(name)) byName.set(name, key)
  }
  return { keys: listed, keyOf: name => byName.get(name.toLowerCase()) }
}

/**
 * The key one advertised model id resolves to, or undefined. The id itself
 * wins. Otherwise exactly one of its head/tail candidates has to be recorded:
 * a surface that writes the facts it resolves must not guess between two
 * models, because the `input` it writes is a claim about the endpoint.
 */
export function resolveCatalogKey(modelId: string, index: CatalogKeyIndex): string | undefined {
  const exact = index.keyOf(modelId)
  if (exact !== undefined) return exact
  const found = new Set<string>()
  for (const candidate of catalogKeyCandidates(modelId)) {
    const key = index.keyOf(candidate)
    if (key !== undefined) found.add(key)
  }
  const [only] = [...found]
  if (found.size !== 1 || only === undefined) return undefined
  return only
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

/** 动态路由插件自己的端点：GET 报状态，POST 重新探测所有声明路由。 */
export const DYNAMIC_PROBE_PATH = '/llm-dynamic-provider/probe'

/** 目录状态的浏览器面端点：GET 只回状态，POST 重新读取目录。 */
export const UI_CATALOG_STATUS_PATH = '/ui-settings-discovery/catalog/status'

/** 共享目录在 Cordis 服务表里的名字。 */
export const CATALOG_SERVICE = 'modelsDevCatalog'

/** models.dev 也列 pdf/audio/video，但 pi-ai 的线路上只带得动这两种。 */
export type ModelModality = 'text' | 'image'

export interface ModelModalities {
  readonly input: readonly ModelModality[]
  readonly output: readonly ModelModality[]
}

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
  /** Provider ids that record this model, in file order; the first supplied the facts. */
  readonly sources?: readonly string[]
}

/**
 * The models.dev index a Host plugin serves to a settings surface. Keys are the
 * ids models.dev records — `glm-5.2` under `zai-org`, `x-ai/grok-4.6` under
 * `openrouter` — plus, for every id carrying a `/`, its bare name, so an
 * endpoint that omits the vendor prefix still resolves. A model absent from
 * `modalities` is unknown rather than text-only, which is what keeps an
 * unlisted id from being frozen as text.
 */
export interface CatalogEnvelope {
  /** Reasoning levels per model, for preselecting the thinking-level picker. */
  readonly catalog: Record<string, readonly string[]>
  /** Accepted and produced modalities per model. */
  readonly modalities: Record<string, { readonly input: readonly string[]; readonly output: readonly string[] }>
  /** Display name and capacities per model, for one the pi-ai catalog does not describe. */
  readonly facts: Record<string, { readonly name?: string; readonly contextWindow?: number; readonly maxTokens?: number }>
  /**
   * Which providers record each key, in file order. Several providers serve the
   * same model under different ids and disagree about its capacities, so a
   * surface that lets the user pick a key has to be able to say whose numbers
   * those are. Absent until a parser records one, which keeps the envelope a
   * surface merging an older body backward compatible.
   */
  readonly sources?: Record<string, readonly string[]>
}

/**
 * Build the envelope both Host catalog endpoints answer with: a fact with no
 * levels, no modalities, and no capacities contributes no entry at all, and a
 * snapshot whose parser recorded no provider contributes no `sources` table.
 */
export function catalogEnvelope(entries: Iterable<readonly [string, CatalogFact]>): CatalogEnvelope {
  const catalog: Record<string, readonly string[]> = {}
  const modalities: Record<string, { readonly input: readonly string[]; readonly output: readonly string[] }> = {}
  const facts: Record<string, { readonly name?: string; readonly contextWindow?: number; readonly maxTokens?: number }> = {}
  const sources: Record<string, readonly string[]> = {}
  for (const [name, fact] of entries) {
    if (fact.levels !== undefined) catalog[name] = fact.levels
    if (fact.inputModalities !== undefined || fact.outputModalities !== undefined) {
      modalities[name] = { input: fact.inputModalities ?? [], output: fact.outputModalities ?? [] }
    }
    if (fact.displayName !== undefined || fact.contextWindow !== undefined || fact.maxTokens !== undefined) {
      facts[name] = {
        ...fact.displayName === undefined ? {} : { name: fact.displayName },
        ...fact.contextWindow === undefined ? {} : { contextWindow: fact.contextWindow },
        ...fact.maxTokens === undefined ? {} : { maxTokens: fact.maxTokens },
      }
    }
    if (fact.sources !== undefined && fact.sources.length > 0) sources[name] = fact.sources
  }
  return Object.keys(sources).length === 0
    ? { catalog, modalities, facts }
    : { catalog, modalities, facts, sources }
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
/**
 * Merge parsed catalog bodies into one envelope in source order: the first
 * body carrying a key keeps it, and later bodies only fill what is missing. A
 * malformed body or entry contributes nothing, so a surface merging a failed
 * endpoint with a live one still renders the live answer. A body that carries
 * no provider list at all leaves the merged envelope without one.
 */
export function mergeCatalogEnvelopes(bodies: readonly unknown[]): CatalogEnvelope {
  const catalog: Record<string, readonly string[]> = {}
  const modalities: Record<string, { readonly input: readonly string[]; readonly output: readonly string[] }> = {}
  const facts: Record<string, { readonly name?: string; readonly contextWindow?: number; readonly maxTokens?: number }> = {}
  const sources: Record<string, readonly string[]> = {}
  for (const body of bodies) {
    const parsed = entryRecordOf(body)
    if (parsed === undefined) continue
    for (const [name, levels] of Object.entries(entryRecordOf(parsed['catalog']) ?? {})) {
      if (name in catalog) continue
      catalog[name] = stringsOf(levels)
    }
    for (const [name, value] of Object.entries(entryRecordOf(parsed['modalities']) ?? {})) {
      if (name in modalities) continue
      const entry = entryRecordOf(value)
      if (entry === undefined) continue
      modalities[name] = { input: stringsOf(entry['input']), output: stringsOf(entry['output']) }
    }
    for (const [name, value] of Object.entries(entryRecordOf(parsed['facts']) ?? {})) {
      if (name in facts) continue
      const fact = entryRecordOf(value)
      if (fact === undefined) continue
      facts[name] = {
        ...typeof fact['name'] === 'string' ? { name: fact['name'] } : {},
        ...typeof fact['contextWindow'] === 'number' ? { contextWindow: fact['contextWindow'] } : {},
        ...typeof fact['maxTokens'] === 'number' ? { maxTokens: fact['maxTokens'] } : {},
      }
    }
    for (const [name, value] of Object.entries(entryRecordOf(parsed['sources']) ?? {})) {
      if (name in sources) continue
      sources[name] = stringsOf(value)
    }
  }
  return Object.keys(sources).length === 0
    ? { catalog, modalities, facts }
    : { catalog, modalities, facts, sources }
}

/** 这份目录现在的样子：条数、来源，以及没能落在存储域或上次刷新失败的原因。 */
export interface CatalogStatus {
  readonly entries: number
  readonly refreshedAt: number | null
  readonly source: 'storage' | 'models.dev'
  readonly storageError?: string
  readonly error?: string
}

/** 三面共用的 models.dev 目录：由 dsh-llm-discovery 提供，其余插件只读它。 */
export interface SharedCatalog {
  /** 一个模型 id 的 facts，按 models.dev 记录的键解析；解析不出来就是 undefined。 */
  factsOf(modelId: string): CatalogFact | undefined
  /** 接受的输入模态：目录优先，退回内置 pi-ai 目录。 */
  inputModalitiesOf(modelId: string): readonly ModelModality[] | undefined
  /** 浏览器面要的整份投影；同一份快照内是同一个对象。 */
  envelope(): CatalogEnvelope
  status(): CatalogStatus
  /** 按 ETag 增量刷新一次；永不抛，失败保留旧快照。 */
  refresh(): Promise<CatalogStatus>
  /** 第一份快照已在内存；冷启动的注册与补全排在它后面。 */
  ready(): Promise<void>
}
