/**
 * The model-catalog store: the domain declaration it writes through, the
 * incremental refresh (ETag 304 / 200 replace) and the single-record layout
 * that makes a refresh one durable write.
 */

import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { parseModelFacts } from '../src/models-dev.ts'
import { modelCatalogDomainSpec } from '../src/store-spec.ts'
import { CATALOG_RECORD, catalogEntries, factsOfRow, openModelCatalog, refreshModelCatalog } from '../src/store.ts'
import type { OpenedCatalog } from '../src/store.ts'
import type { CatalogRow, ModelRow } from '../src/store-spec.ts'

/** A scripted response the fetch mock replays. */
interface Script {
  status: number
  body?: unknown
  etag?: string
}

/** An in-memory domain stand-in holding the one catalog record. */
function fakeDomain(initial: Record<string, ModelRow> = {}, meta: { etag?: string } = {}): {
  catalog: OpenedCatalog
  records: Map<string, CatalogRow>
  puts: CatalogRow[]
  global: { etag?: string; fetchedAt?: number }
} {
  const records = new Map<string, CatalogRow>()
  if (Object.keys(initial).length > 0) records.set(CATALOG_RECORD, { entries: structuredClone(initial) })
  const puts: CatalogRow[] = []
  const global: { etag?: string; fetchedAt?: number } = { ...meta }
  const table = {
    get: (key: string) => records.get(key),
    put: (key: string, value: CatalogRow) => {
      records.set(key, value)
      puts.push(value)
      return Promise.resolve()
    },
    entries: () => records.entries(),
  }
  const catalog = {
    domain: {
      name: 'test',
      global: {
        get: () => global,
        set: (value: { etag?: string; fetchedAt?: number }) => {
          Object.assign(global, value)
          return Promise.resolve()
        },
      },
      table: () => table,
      close: () => Promise.resolve(),
    },
    catalog: table,
  } as unknown as OpenedCatalog
  return { catalog, records, puts, global }
}

function fetchOf(script: Script): typeof fetch {
  return (() => Promise.resolve({
    status: script.status,
    ok: script.status >= 200 && script.status < 300,
    json: () => Promise.resolve(script.body),
    headers: { get: (name: string) => (name === 'etag' ? (script.etag ?? null) : null) },
  } as unknown as Response)) as typeof fetch
}

const BODY = {
  'xai': { models: { 'grok-4.6': { name: 'Grok 4.6', reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'high'] }], modalities: { input: ['text', 'image'], output: ['text'] }, limit: { context: 500000, output: 500000 } } } },
  'openrouter': { models: { 'x-ai/grok-4.6': { name: 'xAI: Grok 4.6', limit: { context: 999 } } } }, // its own id, plus the bare alias
}

describe('refreshModelCatalog', () => {
  it('replaces the whole catalog with one write and records the ETag', async () => {
    const { catalog, puts, global } = fakeDomain()
    const applied = await refreshModelCatalog(catalog, { fetchFn: fetchOf({ status: 200, body: BODY, etag: 'W/"v1"' }), now: () => 1000 })
    expect(applied).toBe(true)
    // One record, whatever the catalog's size: the `single` layout republishes
    // the whole unit per write, so per-model rows would cost one write per model.
    expect(puts).toHaveLength(1)
    const entries = catalogEntries(catalog)
    // The id openrouter records keeps its own entry; xai's bare id is the alias.
    expect(entries['grok-4.6']).toMatchObject({ displayName: 'Grok 4.6', contextWindow: 500000, inputModalities: ['text', 'image'] })
    expect(entries['x-ai/grok-4.6']).toMatchObject({ displayName: 'xAI: Grok 4.6', contextWindow: 999 })
    expect(global.etag).toBe('W/"v1"')
    expect(global.fetchedAt).toBe(1000)
  })

  it('sends the stored ETag and leaves the catalog alone on a 304', async () => {
    const { catalog, puts } = fakeDomain({ 'grok-4.6': { displayName: 'Grok 4.6' } }, { etag: 'W/"v1"' })
    let seenIfNoneMatch: string | undefined
    const fetchFn = ((_: unknown, init?: { headers?: Record<string, string> }) => {
      seenIfNoneMatch = init?.headers?.['if-none-match']
      return Promise.resolve({ status: 304, ok: false, json: () => Promise.resolve({}), headers: { get: () => null } } as unknown as Response)
    }) as typeof fetch

    const applied = await refreshModelCatalog(catalog, { fetchFn })
    expect(applied).toBe(false)
    expect(seenIfNoneMatch).toBe('W/"v1"')
    expect(puts).toHaveLength(0)
    expect(catalogEntries(catalog)['grok-4.6']).toEqual({ displayName: 'Grok 4.6' })
  })

  it('does not offer the ETag of a catalog that holds no rows', async () => {
    // A 304 here would leave nothing to enrich from, so the ETag is withheld
    // until there are rows it describes.
    const { catalog } = fakeDomain({}, { etag: 'W/"v1"' })
    let seenIfNoneMatch: string | undefined = 'unset'
    const fetchFn = ((_: unknown, init?: { headers?: Record<string, string> }) => {
      seenIfNoneMatch = init?.headers?.['if-none-match']
      return Promise.resolve({
        status: 200,
        ok: true,
        json: () => Promise.resolve(BODY),
        headers: { get: () => 'W/"v1"' },
      } as unknown as Response)
    }) as typeof fetch

    expect(await refreshModelCatalog(catalog, { fetchFn })).toBe(true)
    expect(seenIfNoneMatch).toBeUndefined()
    expect(Object.keys(catalogEntries(catalog)).length).toBeGreaterThan(0)
  })

  it('keeps the stored catalog on a fetch failure', async () => {
    const { catalog, puts } = fakeDomain({ 'grok-4.6': { displayName: 'Grok 4.6' } })
    const applied = await refreshModelCatalog(catalog, { fetchFn: () => Promise.reject(new Error('offline')) })
    expect(applied).toBe(false)
    expect(puts).toHaveLength(0)
    expect(catalogEntries(catalog)['grok-4.6']).toEqual({ displayName: 'Grok 4.6' })
  })
})

describe('catalogEntries', () => {
  it('reads the record the refresh wrote, and nothing before it', () => {
    const empty = fakeDomain()
    expect(catalogEntries(empty.catalog)).toEqual({})
    const stored = fakeDomain({ 'grok-4.6': { displayName: 'Grok 4.6' } })
    expect(factsOfRow(catalogEntries(stored.catalog)['grok-4.6']!)).toEqual({ displayName: 'Grok 4.6' })
  })
})

describe('openModelCatalog', () => {
  it('opens the catalog with its own domain spec and closes it with the fiber', async () => {
    const table = { get: () => undefined, put: () => Promise.resolve(), entries: () => new Map<string, CatalogRow>().entries() }
    let closed = false
    const domain = {
      name: 'llm_dynamic_provider_models',
      global: { get: () => ({}), set: () => Promise.resolve() },
      table: () => table,
      close: () => {
        closed = true
        return Promise.resolve()
      },
    }
    const specs: unknown[] = []
    const effects: (() => void)[] = []
    const ctx = {
      get: (name: string) => (name === 'storageDomain'
        ? { open: (spec: unknown) => { specs.push(spec); return Promise.resolve(domain) } }
        : undefined),
      effect: (callback: () => (() => void) | undefined) => {
        const dispose = callback()
        if (dispose !== undefined) effects.push(dispose)
        return () => { dispose?.() }
      },
    } as unknown as Context

    const opened = await openModelCatalog(ctx)
    expect(opened?.catalog).toBe(table)
    // The declaration rides in from `./store-spec.ts`, so this also fails if
    // that module (or a seam it imports) cannot be resolved at runtime.
    expect(specs).toHaveLength(1)
    expect(specs[0]).toMatchObject({ name: 'llm_dynamic_provider_models', version: 0 })
    expect(Object.keys((specs[0] as { tables: object }).tables)).toEqual(['catalog'])
    expect(effects).toHaveLength(1)
    effects[0]?.()
    expect(closed).toBe(true)
  })

  it('returns undefined where the composition mounts no storage domain', async () => {
    const ctx = { get: () => undefined, effect: () => () => {} } as unknown as Context
    expect(await openModelCatalog(ctx)).toBeUndefined()
  })
})

describe('the catalog domain declaration', () => {
  it('reads a row that recorded an unknown capacity as zero', () => {
    // models.dev says "unknown" as 0, and earlier parser versions stored that
    // verbatim: 163 rows on disk in a real deployment say `contextWindow: 0`.
    // With the catalog in one record, rejecting such a value would cost the
    // whole catalog, which the plugin then reports as "no local catalog" and
    // works around by re-fetching every model over the network.
    const row = modelCatalogDomainSpec.tables.catalog.valueSchema.parse({
      entries: {
        'active-speaker-detection': { displayName: 'Active Speaker Detection', outputModalities: ['text'], contextWindow: 0, maxTokens: 4096 },
      },
    })
    expect(row.entries['active-speaker-detection']).toEqual({
      displayName: 'Active Speaker Detection',
      outputModalities: ['text'],
      maxTokens: 4096,
    })
  })

  it('only parses entries that the record schema can read back', () => {
    const recordSchema = modelCatalogDomainSpec.tables.catalog.valueSchema
    const parsed = parseModelFacts({
      acme: {
        models: {
          'unknown-window': { name: 'Unknown Window', limit: { context: 0, output: 0 } },
          'known-window': { name: 'Known Window', modalities: { input: ['text'], output: ['text'] }, limit: { context: 4096, output: 1024 } },
        },
      },
    })
    expect(parsed.size).toBe(2)
    for (const [key, facts] of parsed) {
      const stored = recordSchema.safeParse({ entries: { [key]: facts } })
      expect(stored.success, `${key} must be storable`).toBe(true)
    }
  })
})
