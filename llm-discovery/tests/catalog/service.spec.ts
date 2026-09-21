/**
 * 目录服务：一次刷新一次写、ETag 增量、ready 的语义，以及三面读得到的那几个查询。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { parseModelFacts } from '../../src/catalog/models-dev.ts'
import { provideModelCatalog } from '../../src/catalog/service.ts'
import { modelCatalogDomainSpec } from '../../src/catalog/spec.ts'
import { CATALOG_SERVICE } from '../../src/vocabulary.ts'
import type { CatalogRow, ModelRow } from '../../src/catalog/spec.ts'

/** One scripted HTTP response. */
interface Script {
  status: number
  body?: unknown
  etag?: string
}

/** 回放脚本的 fetch，并记下每次请求发出的 If-None-Match。 */
function scriptedFetch(scripts: readonly Script[]): {
  fetchFn: typeof fetch
  ifNoneMatch: (string | undefined)[]
  calls: () => number
} {
  const ifNoneMatch: (string | undefined)[] = []
  let calls = 0
  const fetchFn = ((_: unknown, init?: { headers?: Record<string, string> }) => {
    const script = scripts[Math.min(calls, scripts.length - 1)] ?? { status: 500 }
    calls += 1
    ifNoneMatch.push(init?.headers?.['if-none-match'])
    return Promise.resolve({
      status: script.status,
      ok: script.status >= 200 && script.status < 300,
      json: () => Promise.resolve(script.body ?? {}),
      headers: { get: (name: string) => (name === 'etag' ? (script.etag ?? null) : null) },
    } as unknown as Response)
  }) as typeof fetch
  return { fetchFn, ifNoneMatch, calls: () => calls }
}

/** 内存里的存储域：一张单记录表，加一个 global。 */
function fakeStorageDomain(initial: Record<string, ModelRow> = {}, meta: { etag?: string; fetchedAt?: number } = {}): {
  open(spec: unknown): Promise<unknown>
  opened: unknown[]
  puts: CatalogRow[]
  global: { etag?: string; fetchedAt?: number }
} {
  const records = new Map<string, CatalogRow>()
  if (Object.keys(initial).length > 0) records.set('models', { entries: structuredClone(initial) })
  const puts: CatalogRow[] = []
  const opened: unknown[] = []
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
  return {
    opened,
    puts,
    global,
    open: (spec: unknown) => {
      opened.push(spec)
      return Promise.resolve({
        name: 'llm_models_dev_catalog',
        global: {
          get: () => global,
          set: (value: { etag?: string; fetchedAt?: number }) => {
            Object.assign(global, value)
            return Promise.resolve()
          },
        },
        table: () => table,
        close: () => Promise.resolve(),
      })
    },
  }
}

const BODY = {
  'xai': { models: { 'grok-4.6': { name: 'Grok 4.6', reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'high'] }], modalities: { input: ['text', 'image'], output: ['text'] }, limit: { context: 500_000, output: 500_000 } } } },
  'openrouter': { models: { 'x-ai/grok-4.6': { name: 'xAI: Grok 4.6', limit: { context: 999 } } } },
}

const contexts: Context[] = []

/** 挂上可选的存储域与 fetch 之后建目录。 */
function boot(options: { storage?: unknown; fetchFn?: typeof fetch; offline?: boolean } = {}): ReturnType<typeof provideModelCatalog> {
  const ctx = new Context()
  contexts.push(ctx)
  if (options.storage !== undefined) ctx.provide('storageDomain', options.storage)
  return provideModelCatalog(ctx, {
    ...options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn },
    ...options.offline === undefined ? {} : { offline: options.offline },
    now: () => 1000,
  })
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

describe('model catalog service', () => {
  it('writes the whole catalog as one record and records the ETag', async () => {
    const storage = fakeStorageDomain()
    const { fetchFn } = scriptedFetch([{ status: 200, body: BODY, etag: 'W/"v1"' }])
    const catalog = boot({ storage, fetchFn })
    await catalog.ready()

    // One record, whatever the catalog's size: the json single layout republishes
    // the whole unit per write, so per-model rows would cost one write per model.
    expect(storage.puts).toHaveLength(1)
    expect(storage.global).toMatchObject({ etag: 'W/"v1"', fetchedAt: 1000 })
    expect(catalog.status()).toMatchObject({ entries: 2, source: 'storage' })
    expect(storage.opened[0]).toMatchObject({ name: 'llm_models_dev_catalog', version: 0 })
  })

  it('resolves ready from the stored catalog and sends its ETag without waiting for the network', async () => {
    const storage = fakeStorageDomain({ 'grok-4.6': { displayName: 'Grok 4.6' } }, { etag: 'W/"v1"', fetchedAt: 7 })
    const seen: (string | undefined)[] = []
    const fetchFn = ((_: unknown, init?: { headers?: Record<string, string> }) => {
      seen.push(init?.headers?.['if-none-match'])
      return new Promise<Response>(() => {})
    }) as unknown as typeof fetch

    const catalog = boot({ storage, fetchFn })
    await catalog.ready()

    expect(catalog.status()).toMatchObject({ entries: 1, source: 'storage', refreshedAt: 7 })
    expect(catalog.factsOf('grok-4.6')).toMatchObject({ displayName: 'Grok 4.6' })
    // 后台校验是异步起的：它带着存储里的 ETag 去问，但 ready 不等它。
    await vi.waitFor(() => { expect(seen).toEqual(['W/"v1"']) })
  })

  it('keeps the stored catalog on a 304', async () => {
    const storage = fakeStorageDomain({ 'grok-4.6': { displayName: 'Grok 4.6' } }, { etag: 'W/"v1"', fetchedAt: 5 })
    const { fetchFn, ifNoneMatch } = scriptedFetch([{ status: 304 }])
    const catalog = boot({ storage, fetchFn })
    await catalog.ready()

    expect((await catalog.refresh()).refreshedAt).toBe(1000)
    expect(ifNoneMatch).toEqual(['W/"v1"', 'W/"v1"'])
    expect(storage.puts).toHaveLength(0)
    expect(catalog.factsOf('grok-4.6')).toMatchObject({ displayName: 'Grok 4.6' })
  })

  it('does not offer the ETag of a catalog that holds no rows', async () => {
    // A 304 here would leave nothing to enrich from, so the ETag is withheld.
    const storage = fakeStorageDomain({}, { etag: 'W/"stale"' })
    const { fetchFn, ifNoneMatch } = scriptedFetch([{ status: 200, body: BODY, etag: 'W/"v1"' }])
    const catalog = boot({ storage, fetchFn })
    await catalog.ready()

    expect(ifNoneMatch).toEqual([undefined])
    expect(catalog.status()).toMatchObject({ entries: 2, source: 'storage' })
  })

  it('keeps the previous snapshot and reports a failed refresh', async () => {
    const storage = fakeStorageDomain({ 'grok-4.6': { displayName: 'Grok 4.6' } }, { etag: 'W/"v1"' })
    const catalog = boot({ storage, fetchFn: (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch })
    await catalog.ready()

    expect((await catalog.refresh()).error).toBe('offline')
    expect(catalog.status()).toMatchObject({ entries: 1, source: 'storage' })
    expect(catalog.factsOf('grok-4.6')).toMatchObject({ displayName: 'Grok 4.6' })
  })

  it('reads only the stored catalog when offline', async () => {
    const storage = fakeStorageDomain({ 'grok-4.6': { displayName: 'Grok 4.6' } })
    const { fetchFn, calls } = scriptedFetch([{ status: 200, body: BODY }])
    const catalog = boot({ storage, fetchFn, offline: true })
    await catalog.ready()
    await catalog.refresh()

    expect(calls()).toBe(0)
    expect(catalog.status()).toMatchObject({ entries: 1, source: 'storage' })
  })

  it('falls back to the network, and says why the storage domain was not used', async () => {
    const { fetchFn } = scriptedFetch([{ status: 200, body: BODY, etag: 'W/"v1"' }])
    const catalog = boot({ fetchFn })
    await catalog.ready()

    expect(catalog.status()).toMatchObject({
      entries: 2,
      source: 'models.dev',
      storageError: 'no storage domain is mounted in this composition',
    })
    expect(catalog.factsOf('grok-4.6')).toMatchObject({ contextWindow: 500_000 })
    expect(catalog.inputModalitiesOf('grok-4.6')).toEqual(['text', 'image'])
  })

  it('reports a storage domain that will not open instead of quietly using the network', async () => {
    const { fetchFn } = scriptedFetch([{ status: 200, body: BODY }])
    const ctx = new Context()
    contexts.push(ctx)
    ctx.provide('storageDomain', { open: () => Promise.reject(new Error('no kv backend for this domain')) })
    const catalog = provideModelCatalog(ctx, { fetchFn })
    await catalog.ready()

    expect(catalog.status()).toMatchObject({
      entries: 2,
      source: 'models.dev',
      storageError: 'no kv backend for this domain',
    })
  })

  it('builds the envelope once per snapshot', async () => {
    const storage = fakeStorageDomain({ 'grok-4.6': { displayName: 'Grok 4.6' } }, { etag: 'W/"v1"' })
    const { fetchFn } = scriptedFetch([{ status: 304 }])
    const catalog = boot({ storage, fetchFn })
    await catalog.ready()

    const first = catalog.envelope()
    expect(catalog.envelope()).toBe(first)
    expect(first.facts['grok-4.6']).toMatchObject({ name: 'Grok 4.6' })
    await catalog.refresh()
    expect(catalog.envelope()).toBe(first)
  })

  it('registers itself under the catalog service name and refuses a second one', () => {
    const ctx = new Context()
    contexts.push(ctx)
    const first = provideModelCatalog(ctx)
    expect(ctx.get(CATALOG_SERVICE)).toBe(first)
    expect(() => provideModelCatalog(ctx)).toThrow(/modelsDevCatalog/)
  })
})

describe('the catalog domain declaration', () => {
  it('reads a row that recorded an unknown capacity as zero', () => {
    // models.dev says "unknown" as 0, and earlier parser versions stored that
    // verbatim: 163 rows on disk in a real deployment say `contextWindow: 0`.
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
