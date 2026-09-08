import type { Context } from '@deepseek-ai/cordis'
import { MODELS_DEV_URL, normalizeModelName, parseModelFacts } from './models-dev.ts'
import type { ModelFacts } from './models-dev.ts'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { modelCatalogDomainSpec } from './store-spec.ts'
import type { CatalogMeta, ModelRow } from './store-spec.ts'

/** The minimal storage-domain face this plugin reads. */
interface StorageDomainFace {
  open(spec: typeof modelCatalogDomainSpec): Promise<Domain<typeof modelCatalogDomainSpec>>
}

export interface CatalogRefreshOptions {
  /** Injected fetch for tests; defaults to the global fetch. */
  readonly fetchFn?: typeof fetch
  /** Per-request timeout in milliseconds (default 15,000). */
  readonly timeoutMs?: number
  /** Clock for tests; defaults to Date.now. */
  readonly now?: () => number
}

export interface OpenedCatalog {
  readonly domain: Domain<typeof modelCatalogDomainSpec>
  readonly models: KvTable<string, ModelRow>
}

/**
 * Open the catalog domain, registering its close as a fiber effect. Returns
 * `undefined` when no storage seam is mounted, leaving the caller the
 * in-memory path.
 */
export async function openModelCatalog(ctx: Context): Promise<OpenedCatalog | undefined> {
  const storageDomain = ctx.get('storageDomain') as StorageDomainFace | undefined
  if (storageDomain === undefined) return undefined
  // Loaded lazily: the spec carries the storage-domain and zod runtime values,
  // which the in-memory path must not need.
  const { modelCatalogDomainSpec } = await import('./store-spec.ts')
  const domain = await storageDomain.open(modelCatalogDomainSpec)
  ctx.effect(() => () => domain.close(), 'llm-dynamic-provider: model catalog close')
  return { domain, models: domain.table('models') }
}

/** Read one model's stored facts; the lookup normalizes provider prefixes away. */
export function catalogFactsOf(models: KvTable<string, ModelRow>, modelId: string): ModelRow | undefined {
  return models.get(normalizeModelName(modelId))
}

/**
 * Refresh the catalog from models.dev incrementally: the stored ETag rides as
 * `If-None-Match`, a 304 leaves every row untouched, and a 200 upserts each
 * parsed row. Never throws, so a fetch or parse failure keeps the stored rows.
 * @returns whether a fresh body was applied.
 */
export async function refreshModelCatalog(catalog: OpenedCatalog, options: CatalogRefreshOptions = {}): Promise<boolean> {
  const fetchFn = options.fetchFn ?? fetch
  const now = options.now ?? Date.now
  const meta: CatalogMeta = { ...catalog.domain.global.get() }
  try {
    const response = await fetchFn(MODELS_DEV_URL, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      headers: meta.etag === undefined ? {} : { 'if-none-match': meta.etag },
    })
    if (response.status === 304) return false
    if (!response.ok) throw new Error(`models.dev answered ${response.status}`)
    const facts: ReadonlyMap<string, ModelFacts> = parseModelFacts(await response.json())
    for (const [name, fact] of facts) {
      await catalog.models.put(name, fact as ModelRow)
    }
    const etag = response.headers.get('etag')
    await catalog.domain.global.set({
      ...etag === null ? {} : { etag },
      fetchedAt: now(),
    })
    return true
  } catch {
    // A refresh failure keeps the stored catalog; the next boot retries.
    return false
  }
}
