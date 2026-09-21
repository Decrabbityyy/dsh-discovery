import type { Context } from '@deepseek-ai/cordis'
import { MODELS_DEV_URL, parseModelFacts } from './models-dev.ts'
import type { ModelFacts } from './models-dev.ts'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { modelCatalogDomainSpec } from './spec.ts'
import type { CatalogMeta, CatalogRow, ModelRow } from './spec.ts'

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
  /** The table holding the catalog's single record. */
  readonly catalog: KvTable<string, CatalogRow>
}

/** The key that record is stored under. */
export const CATALOG_RECORD = 'models'

/**
 * Open the catalog domain, registering its close as a fiber effect. Returns
 * `undefined` when no storage seam is mounted, leaving the caller the in-memory
 * path.
 */
export async function openModelCatalog(ctx: Context): Promise<OpenedCatalog | undefined> {
  const storageDomain = ctx.get('storageDomain') as StorageDomainFace | undefined
  if (storageDomain === undefined) return undefined
  // Loaded lazily: the spec carries the storage-domain and zod runtime values,
  // which the in-memory path must not need.
  const { modelCatalogDomainSpec } = await import('./spec.ts')
  const domain = await storageDomain.open(modelCatalogDomainSpec)
  ctx.effect(() => () => domain.close(), 'llm-discovery: model catalog close')
  return { domain, catalog: domain.table('catalog') }
}

/** The stored key → facts map, empty before the first refresh. */
export function catalogEntries(opened: OpenedCatalog): Readonly<Record<string, ModelRow>> {
  return opened.catalog.get(CATALOG_RECORD)?.entries ?? {}
}

/**
 * One stored entry as the facts shape the enrichment paths read. The cast
 * bridges the mutable arrays zod infers and the readonly ones the parser emits.
 */
export function factsOfRow(row: ModelRow): ModelFacts {
  return row as ModelFacts
}

/**
 * Refresh the catalog from models.dev incrementally: the stored ETag rides as
 * `If-None-Match`, a 304 leaves the stored catalog alone, and a 200 replaces it
 * with one durable write. Never throws, so a fetch or parse failure keeps the
 * stored catalog.
 * @returns whether a fresh body was applied.
 */
export async function refreshModelCatalog(catalog: OpenedCatalog, options: CatalogRefreshOptions = {}): Promise<boolean> {
  const fetchFn = options.fetchFn ?? fetch
  const now = options.now ?? Date.now
  const meta: CatalogMeta = { ...catalog.domain.global.get() }
  // The ETag only means anything next to the rows it describes: offering it for
  // a catalog that holds none could earn a 304 and leave nothing to enrich from.
  const stored = catalogEntries(catalog)
  const headers = meta.etag === undefined || Object.keys(stored).length === 0 ? {} : { 'if-none-match': meta.etag }
  try {
    const response = await fetchFn(MODELS_DEV_URL, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      headers,
    })
    if (response.status === 304) return false
    if (!response.ok) throw new Error(`models.dev answered ${response.status}`)
    const entries: Record<string, ModelRow> = {}
    for (const [name, fact] of parseModelFacts(await response.json())) entries[name] = fact as ModelRow
    await catalog.catalog.put(CATALOG_RECORD, { entries })
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
