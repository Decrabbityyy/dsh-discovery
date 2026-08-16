/**
 * The models.dev catalog store: persists the parsed model facts in the
 * storage-domain seam so a cold boot skips the network and enrichment stays
 * complete for models the bundled pi-ai catalog has not caught up with. The
 * domain is optional — when the composition mounts no storage seam the caller
 * falls back to an in-memory snapshot and behaves exactly as before.
 *
 * Host-only: this module imports the storage-domain seam and (through
 * `./store-spec.ts`) zod, so it must stay out of any browser bundle. Browser
 * consumers import only the pure `./vocabulary` / `./models-dev` parsers.
 * @module dsh-llm-endpoint-base/store
 */

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

/** The fetch knobs the refresh path accepts (tests inject `fetchFn`). */
export interface CatalogRefreshOptions {
  /** Injected fetch for tests; defaults to the global fetch. */
  readonly fetchFn?: typeof fetch
  /** Per-request timeout in milliseconds (default 15,000). */
  readonly timeoutMs?: number
  /** Clock for tests; defaults to Date.now. */
  readonly now?: () => number
}

/**
 * The opened catalog: the live domain and its `models` table, or `undefined`
 * when no storage seam is mounted (the caller then uses the in-memory path).
 */
export interface OpenedCatalog {
  readonly domain: Domain<typeof modelCatalogDomainSpec>
  readonly models: KvTable<string, ModelRow>
}

/**
 * Open the catalog domain when the storage seam is mounted, registering its
 * close as a fiber effect so an HMR reload or unload releases it. Returns
 * `undefined` when the seam is absent.
 * @param ctx - the plugin context.
 * @returns the opened catalog, or undefined.
 */
export async function openModelCatalog(ctx: Context): Promise<OpenedCatalog | undefined> {
  const storageDomain = ctx.get('storageDomain') as StorageDomainFace | undefined
  if (storageDomain === undefined) return undefined
  // The spec carries the storage-domain and zod runtime values, so it loads
  // lazily: a composition without the storage seam never resolves those
  // imports, and the in-memory path needs neither package present.
  const { modelCatalogDomainSpec } = await import('./store-spec.ts')
  const domain = await storageDomain.open(modelCatalogDomainSpec)
  ctx.effect(() => () => domain.close(), 'llm-dynamic-provider: model catalog close')
  return { domain, models: domain.table('models') }
}

/**
 * Read one model's facts by endpoint-reported id (provider prefixes are
 * normalized away before lookup).
 * @param models - the opened models table.
 * @param modelId - the model id exactly as the endpoint accepts it.
 * @returns the stored facts, or undefined.
 */
export function catalogFactsOf(models: KvTable<string, ModelRow>, modelId: string): ModelRow | undefined {
  return models.get(normalizeModelName(modelId))
}

/**
 * Refresh the catalog from models.dev with an incremental validator: the
 * stored ETag rides as `If-None-Match`, a 304 leaves every row untouched, and
 * a 200 upserts each parsed bare-name row inside the domain's write chain.
 * The validators are persisted in the domain global so the next boot resumes
 * from them. Never throws — a fetch or parse failure keeps the stored rows.
 * @param catalog - the opened catalog.
 * @param options - fetch knobs.
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
