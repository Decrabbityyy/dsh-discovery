/**
 * The model-catalog store: incremental refresh (ETag 304 / 200 upsert) and
 * bare-name normalization, over a scripted in-memory domain.
 */

import { describe, expect, it } from 'vitest'
import { catalogFactsOf, refreshModelCatalog } from '../src/store.ts'
import type { OpenedCatalog } from '../src/store.ts'
import type { ModelRow } from '../src/store-spec.ts'

/** A scripted response the fetch mock replays. */
interface Script {
  status: number
  body?: unknown
  etag?: string
}

/** An in-memory domain stand-in recording puts and global writes. */
function fakeDomain(initial: Record<string, ModelRow> = {}, meta: { etag?: string } = {}): {
  catalog: OpenedCatalog
  rows: Map<string, ModelRow>
  global: { etag?: string; fetchedAt?: number }
} {
  const rows = new Map<string, ModelRow>(Object.entries(initial))
  const global: { etag?: string; fetchedAt?: number } = { ...meta }
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
    models: undefined as never,
  } as unknown as OpenedCatalog
  const table = {
    get: (key: string) => rows.get(key),
    put: (key: string, value: ModelRow) => {
      rows.set(key, value)
      return Promise.resolve()
    },
    entries: () => rows.entries(),
  }
  // Rewire the table onto the catalog now that it exists.
  ;(catalog as { models: unknown }).models = table
  return { catalog, rows, global }
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
  'openrouter': { models: { 'x-ai/grok-4.6': { name: 'dup' } } }, // provider-prefixed dup collapses, first wins
}

describe('refreshModelCatalog', () => {
  it('upserts parsed rows keyed by the bare model name and records the ETag', async () => {
    const { catalog, rows, global } = fakeDomain()
    const applied = await refreshModelCatalog(catalog, { fetchFn: fetchOf({ status: 200, body: BODY, etag: 'W/"v1"' }), now: () => 1000 })
    expect(applied).toBe(true)
    expect(rows.has('grok-4.6')).toBe(true)
    expect(rows.get('grok-4.6')).toMatchObject({ displayName: 'Grok 4.6', contextWindow: 500000, inputModalities: ['text', 'image'] })
    expect(rows.has('x-ai/grok-4.6')).toBe(false)
    expect(global.etag).toBe('W/"v1"')
    expect(global.fetchedAt).toBe(1000)
  })

  it('sends the stored ETag and leaves rows untouched on a 304', async () => {
    const { catalog, rows } = fakeDomain({ 'grok-4.6': { displayName: 'Grok 4.6' } }, { etag: 'W/"v1"' })
    let seenIfNoneMatch: string | undefined
    const fetchFn = ((_: unknown, init?: { headers?: Record<string, string> }) => {
      seenIfNoneMatch = init?.headers?.['if-none-match']
      return Promise.resolve({ status: 304, ok: false, json: () => Promise.resolve({}), headers: { get: () => null } } as unknown as Response)
    }) as typeof fetch
    const applied = await refreshModelCatalog(catalog, { fetchFn })
    expect(applied).toBe(false)
    expect(seenIfNoneMatch).toBe('W/"v1"')
    expect(rows.get('grok-4.6')).toEqual({ displayName: 'Grok 4.6' })
  })

  it('keeps the stored rows on a fetch failure', async () => {
    const { catalog, rows } = fakeDomain({ 'grok-4.6': { displayName: 'Grok 4.6' } })
    const applied = await refreshModelCatalog(catalog, { fetchFn: () => Promise.reject(new Error('offline')) })
    expect(applied).toBe(false)
    expect(rows.get('grok-4.6')).toEqual({ displayName: 'Grok 4.6' })
  })
})

describe('catalogFactsOf', () => {
  it('normalizes provider prefixes away before lookup', () => {
    const { catalog } = fakeDomain({ 'grok-4.6': { displayName: 'Grok 4.6' } })
    expect(catalogFactsOf(catalog.models, 'grok-4.6')?.displayName).toBe('Grok 4.6')
    expect(catalogFactsOf(catalog.models, 'x-ai/grok-4.6')?.displayName).toBe('Grok 4.6')
    expect(catalogFactsOf(catalog.models, 'openrouter/x-ai/grok-4.6')?.displayName).toBe('Grok 4.6')
    expect(catalogFactsOf(catalog.models, 'unknown')).toBeUndefined()
  })
})
