/**
 * The dynamic provider's cache endpoint — what 设置 → 插件 → 模型缓存 reads and
 * what its refresh button asks for: a status of the declared routes, the
 * models.dev facts they were enriched from, and the on-disk catalog; a POST
 * re-reads those facts, re-probes every route, and rewrites the cache.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { DYNAMIC_CACHE_PATH } from 'dsh-llm-discovery/engine'
import * as dynamicProvider from '../src/index.ts'
import { startProbeServer } from './server.ts'
import type { ProbeServer } from './server.ts'

/** The smallest real SettingsProvider: an in-memory document. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown>

  constructor(ctx: ConstructorParameters<typeof SettingsProvider>[0], options?: { doc?: Record<string, unknown> }) {
    super(ctx)
    this.doc = structuredClone(options?.doc ?? {})
  }

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: string, section: Record<string, unknown>): Promise<void> {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

interface ResponseStub {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body: string): void
}

interface RegisteredRoute {
  readonly path: string
  readonly handler: (req: unknown, res: ResponseStub) => unknown
}

/** The web server face: a path registry that records the handlers it was given. */
function fakeWebServer(routes: Map<string, RegisteredRoute>): { register(route: RegisteredRoute): () => void } {
  return {
    register(route: RegisteredRoute): () => void {
      if (routes.has(route.path)) throw new Error(`duplicate ${route.path}`)
      routes.set(route.path, route)
      return () => { routes.delete(route.path) }
    },
  }
}

/** Invoke one registered handler and parse the answer it wrote. */
async function answer(route: RegisteredRoute, method: string): Promise<{ status: number; body: Record<string, unknown> }> {
  let body = ''
  const res: ResponseStub = {
    statusCode: 200,
    setHeader: () => {},
    end: (value: string) => { body = value },
  }
  await route.handler({ method }, res)
  return { status: res.statusCode, body: body.length === 0 ? {} : JSON.parse(body) as Record<string, unknown> }
}

/** The models.dev body the specs script, keyed by provider then model id. */
const MODELS_DEV = { acme: { models: { 'acme-x': { name: 'Acme X', limit: { context: 4096 } } } } }

const LISTING = { data: [{ id: 'acme-x', context_window: 4096 }] }

let ctx: Context | undefined
let server: ProbeServer | undefined
let home: string | undefined
let savedHome: string | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (server !== undefined) await server.close()
  server = undefined
  vi.unstubAllGlobals()
  if (savedHome === undefined) delete process.env['DSH_HOME']
  else process.env['DSH_HOME'] = savedHome
  if (home !== undefined) await rm(home, { recursive: true, force: true })
  home = undefined
})

/**
 * Answer models.dev from memory while every other request keeps its real
 * carrier, so the probe against the fixture server still reaches it.
 */
function stubModelsDev(reply: 'body' | 'offline' = 'body'): void {
  const real = globalThis.fetch
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    if (!url.startsWith('https://models.dev/')) return real(input, init)
    if (reply === 'offline') return Promise.reject(new Error('offline'))
    return Promise.resolve(new Response(JSON.stringify(MODELS_DEV), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
  })
}

/** The storage-domain face: the catalog's one record behind `open`. */
function fakeStorage(): {
  open(): Promise<unknown>
  records: Map<string, { entries: Record<string, unknown> }>
} {
  const records = new Map<string, { entries: Record<string, unknown> }>()
  return {
    records,
    open: () => Promise.resolve({
      name: 'llm_dynamic_provider_models',
      global: { get: () => ({}), set: () => Promise.resolve() },
      table: () => ({
        get: (key: string) => records.get(key),
        put: (key: string, value: { entries: Record<string, unknown> }) => {
          records.set(key, value)
          return Promise.resolve()
        },
        entries: () => records.entries(),
      }),
      close: () => Promise.resolve(),
    }),
  }
}

/** Mount the seams plus the plugin over one config, capturing its endpoints. */
async function boot(config?: dynamicProvider.Config, storage?: unknown): Promise<Map<string, RegisteredRoute>> {
  const routes = new Map<string, RegisteredRoute>()
  ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(MemorySettings)
  ctx.provide('webServer', fakeWebServer(routes))
  if (storage !== undefined) ctx.provide('storageDomain', storage)
  await ctx.plugin(dynamicProvider, config)
  return routes
}

describe('cache endpoint', () => {
  it('reports the declared routes and where the facts came from', async () => {
    stubModelsDev()
    server = await startProbeServer({ '/models': { body: JSON.stringify(LISTING) } })
    const routes = await boot({ routes: { upstream: { baseURL: server.url, api: 'openai-completions' } } })
    const cache = routes.get(DYNAMIC_CACHE_PATH)
    expect(routes.has('/llm-dynamic-provider/routes')).toBe(true)
    expect(cache).toBeDefined()

    // The boot-time load lands asynchronously; the status reports it once it has.
    await vi.waitFor(async () => {
      const { body } = await answer(cache!, 'GET')
      expect(body['modelsDev']).toMatchObject({ entries: 1, source: 'models.dev' })
    })
    const { body } = await answer(cache!, 'GET')
    expect(body['routes']).toBe(1)
    // No DSH_HOME cache without `cache: true`.
    expect(body['cacheFile']).toBeUndefined()
    // Nor a storage domain in this composition, which the status admits.
    expect(body['modelsDev']).toMatchObject({ storageError: 'no storage domain is mounted in this composition' })
  })

  it('loads and stores the facts through the storage domain when one is mounted', async () => {
    stubModelsDev()
    const storage = fakeStorage()
    const routes = await boot(undefined, storage)
    const cache = routes.get(DYNAMIC_CACHE_PATH)!

    const { body } = await answer(cache, 'POST')
    expect(body['modelsDev']).toMatchObject({ entries: 1, source: 'storage' })
    expect((body['modelsDev'] as Record<string, unknown>)['storageError']).toBeUndefined()
    // The parsed catalog went through the domain as its one record.
    expect([...storage.records.keys()]).toEqual(['models'])
    expect(Object.keys(storage.records.get('models')?.entries ?? {})).toHaveLength(1)
  })

  it('reports a storage domain that will not open instead of quietly using the network', async () => {
    stubModelsDev()
    const routes = await boot(undefined, { open: () => Promise.reject(new Error('no kv backend for this domain')) })
    const cache = routes.get(DYNAMIC_CACHE_PATH)!

    const { body } = await answer(cache, 'POST')
    expect(body['modelsDev']).toMatchObject({
      entries: 1,
      source: 'models.dev',
      storageError: 'no kv backend for this domain',
    })
  })

  it('re-reads the facts and re-probes every route on POST', async () => {
    stubModelsDev()
    server = await startProbeServer({ '/models': { body: JSON.stringify(LISTING) } })
    const routes = await boot({ routes: { upstream: { baseURL: server.url, api: 'openai-completions' } } })
    const cache = routes.get(DYNAMIC_CACHE_PATH)!

    const { body } = await answer(cache, 'POST')
    expect(body['probes']).toEqual([{ route: 'upstream', models: 1 }])
    expect(body['modelsDev']).toMatchObject({ entries: 1, source: 'models.dev' })
    // The refresh probed the endpoint again rather than reusing the boot pass.
    expect(server.requests.filter(request => request.path === '/models').length).toBeGreaterThanOrEqual(2)
  })

  it('reports a facts load that failed and a route whose probe did', async () => {
    stubModelsDev('offline')
    const routes = await boot({ routes: { broken: { baseURL: 'http://127.0.0.1:1', api: 'openai-completions' } } })
    const cache = routes.get(DYNAMIC_CACHE_PATH)!

    const { body } = await answer(cache, 'POST')
    expect(body['modelsDev']).toMatchObject({ entries: 0, error: 'offline' })
    const probes = body['probes'] as Record<string, unknown>[]
    expect(probes[0]?.['route']).toBe('broken')
    expect(typeof probes[0]?.['error']).toBe('string')
    expect(probes[0]?.['models']).toBeUndefined()
  })

  it('reports the cache file it rewrote', async () => {
    savedHome = process.env['DSH_HOME']
    home = await mkdtemp(join(tmpdir(), 'dsh-dyn-cache-card-'))
    process.env['DSH_HOME'] = home
    stubModelsDev()
    server = await startProbeServer({ '/models': { body: JSON.stringify(LISTING) } })
    const routes = await boot({ cache: true, routes: { upstream: { baseURL: server.url, api: 'openai-completions' } } })
    const cache = routes.get(DYNAMIC_CACHE_PATH)!

    const { body } = await answer(cache, 'POST')
    expect(body['cacheFile']).toMatchObject({ routes: 1 })
    expect(typeof (body['cacheFile'] as Record<string, unknown>)['writtenAt']).toBe('number')
    const written = JSON.parse(await readFile(join(home, 'llm-dynamic-provider-cache.json'), 'utf8')) as Record<string, unknown>
    expect(written['writtenAt']).toBeGreaterThan(0)
    expect((written['routes'] as Record<string, unknown>)['upstream']).toBeDefined()
  })

  it('refuses a method it does not serve', async () => {
    stubModelsDev()
    const routes = await boot()
    const refused = await answer(routes.get(DYNAMIC_CACHE_PATH)!, 'DELETE')
    expect(refused.status).toBe(405)
    expect(refused.body).toEqual({ error: 'method not allowed' })
  })
})
