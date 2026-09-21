/**
 * 动态路由插件自己的端点：设置 → 插件 → 模型目录读的状态，以及刷新按钮要的重探结果。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { CATALOG_SERVICE, DYNAMIC_PROBE_PATH } from 'dsh-llm-discovery/vocabulary'
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

const LISTING = { data: [{ id: 'acme-x', context_window: 4096 }] }

/** 目录替身：只有 dyn 真正读的那几个成员，刷新次数可查。 */
function fakeCatalog(options: { entries?: number; ready?: Promise<void> } = {}): {
  catalog: unknown
  refreshes: () => number
} {
  let refreshes = 0
  const entries = options.entries ?? 1
  const status = { entries, refreshedAt: 1_789_900_000_000, source: 'storage' as const }
  return {
    refreshes: () => refreshes,
    catalog: {
      factsOf: () => undefined,
      inputModalitiesOf: () => undefined,
      envelope: () => ({ catalog: {}, modalities: {}, facts: {} }),
      status: () => status,
      refresh: () => {
        refreshes += 1
        return Promise.resolve(status)
      },
      ready: () => options.ready ?? Promise.resolve(),
    },
  }
}

let ctx: Context | undefined
let server: ProbeServer | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (server !== undefined) await server.close()
  server = undefined
})

/** Mount the seams plus the plugin over one config, capturing its endpoints. */
async function boot(config?: dynamicProvider.Config, catalog: unknown = fakeCatalog().catalog): Promise<Map<string, RegisteredRoute>> {
  const routes = new Map<string, RegisteredRoute>()
  ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(MemorySettings)
  ctx.provide('webServer', fakeWebServer(routes))
  ctx.provide(CATALOG_SERVICE, catalog)
  await ctx.plugin(dynamicProvider, config)
  return routes
}

describe('probe endpoint', () => {
  it('reports the declared routes and the catalog status it reads from the service', async () => {
    server = await startProbeServer({ '/models': { body: JSON.stringify(LISTING) } })
    const routes = await boot({ routes: { upstream: { baseURL: server.url, api: 'openai-completions' } } })
    const probe = routes.get(DYNAMIC_PROBE_PATH)
    expect(routes.has('/llm-dynamic-provider/routes')).toBe(true)

    const { body } = await answer(probe!, 'GET')
    expect(body['routes']).toBe(1)
    expect(body['modelsDev']).toMatchObject({ entries: 1, source: 'storage' })
  })

  it('refreshes the catalog and re-probes every route on POST', async () => {
    const fake = fakeCatalog()
    server = await startProbeServer({ '/models': { body: JSON.stringify(LISTING) } })
    const routes = await boot({ routes: { upstream: { baseURL: server.url, api: 'openai-completions' } } }, fake.catalog)
    const probe = routes.get(DYNAMIC_PROBE_PATH)!

    const { body } = await answer(probe, 'POST')
    expect(fake.refreshes()).toBe(1)
    expect(body['probes']).toEqual([{ route: 'upstream', models: 1 }])
    // The refresh probed the endpoint again rather than reusing the boot pass.
    expect(server.requests.filter(request => request.path === '/models').length).toBeGreaterThanOrEqual(2)
  })

  it('reports a route whose probe failed', async () => {
    const routes = await boot({ routes: { broken: { baseURL: 'http://127.0.0.1:1', api: 'openai-completions' } } })
    const probe = routes.get(DYNAMIC_PROBE_PATH)!

    const { body } = await answer(probe, 'POST')
    const probes = body['probes'] as Record<string, unknown>[]
    expect(probes[0]?.['route']).toBe('broken')
    expect(typeof probes[0]?.['error']).toBe('string')
    expect(probes[0]?.['models']).toBeUndefined()
  })

  it('waits for the catalog before the first probe', async () => {
    const gate = Promise.withResolvers<void>()
    server = await startProbeServer({ '/models': { body: JSON.stringify(LISTING) } })
    await boot({ routes: { upstream: { baseURL: server.url, api: 'openai-completions' } } }, fakeCatalog({ ready: gate.promise }).catalog)
    await new Promise(resolve => setTimeout(resolve, 10))
    // 目录还没就绪：一条路由都不注册。
    expect(ctx!.llm.listProviders().map(provider => provider.id)).toEqual([])

    gate.resolve()
    await vi.waitFor(() => {
      expect(ctx!.llm.listProviders().map(provider => provider.id)).toContain('upstream')
    })
  })

  it('refuses a method it does not serve', async () => {
    const routes = await boot()
    const refused = await answer(routes.get(DYNAMIC_PROBE_PATH)!, 'DELETE')
    expect(refused.status).toBe(405)
    expect(refused.body).toEqual({ error: 'method not allowed' })
  })
})
