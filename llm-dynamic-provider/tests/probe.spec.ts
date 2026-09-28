/**
 * 动态路由插件自己的端点：「模型发现」页里「模型目录」区块读的状态，以及刷新按钮要的重探结果。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { CATALOG_SERVICE, DYNAMIC_PROBE_PATH, DYNAMIC_ROUTES_PATH } from 'dsh-llm-discovery/vocabulary'
import * as dynamicProvider from '../src/index.ts'
import type { RouteProfile } from '../src/config.ts'
import { formsStub } from './settings-stub.ts'
import { startProbeServer } from './server.ts'
import type { ProbeServer } from './server.ts'

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

/** POST 一个 JSON body：端点只读 stream 的 data/end 事件。 */
async function postJson(route: RegisteredRoute, payload: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  let body = ''
  const res: ResponseStub = {
    statusCode: 200,
    setHeader: () => {},
    end: (value: string) => { body = value },
  }
  const request = {
    method: 'POST',
    on(event: string, listener: (chunk?: unknown) => void): void {
      if (event === 'data') listener(Buffer.from(JSON.stringify(payload)))
      else if (event === 'end') listener()
    },
  }
  await route.handler(request, res)
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

/** 组合层写下来的那份配置：volatile 字段在这里是普通值，注册表按插件的 schema 解析成引用后才交给 `apply`。 */
type RawConfig = {
  routes?: Record<string, RouteProfile>
  timeoutMs?: number
  maxResponseBytes?: number
  enrichment?: boolean
}

/** Mount the seams plus the plugin over one config, capturing its endpoints. */
async function boot(
  config?: RawConfig,
  catalog: unknown = fakeCatalog().catalog,
): Promise<Map<string, RegisteredRoute>> {
  const routes = new Map<string, RegisteredRoute>()
  const forms = formsStub()
  ctx = new Context()
  await ctx.plugin(LlmRuntime)
  ctx.provide('settings', forms.service as never)
  ctx.provide('webServer', fakeWebServer(routes))
  ctx.provide(CATALOG_SERVICE, catalog)
  const fiber: Fiber = await ctx.plugin(dynamicProvider, config as never).await()
  forms.attach(fiber)
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
    const probed = (): number => server!.requests.filter(request => request.path === '/models').length

    // 挂载时的探测是后台起的：先等它落地，再拿它当基线，计数才不受调度顺序影响。
    await vi.waitFor(() => { expect(probed()).toBe(1) })
    const before = probed()

    const { body } = await answer(probe, 'POST')
    expect(fake.refreshes()).toBe(1)
    expect(body['probes']).toEqual([{ route: 'upstream', models: 1 }])
    // The refresh probed the endpoint again rather than reusing the boot pass.
    expect(probed()).toBeGreaterThan(before)
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

describe('routes endpoint', () => {
  it('writes a route through the settings service, reprobes it, and reads it back', async () => {
    server = await startProbeServer({ '/models': { body: JSON.stringify(LISTING) } })
    const routes = await boot({ routes: {} }, fakeCatalog().catalog)
    const write = routes.get(DYNAMIC_ROUTES_PATH)!

    const written = await postJson(write, {
      op: 'set',
      routeId: 'upstream',
      route: { baseURL: server.url, api: 'openai-completions' },
    })
    expect(written.status).toBe(200)
    // 写进去的路由立刻能在 LLM 注册表上看到：Loader 点更 volatile 值后插件重探了一轮。
    await vi.waitFor(() => {
      expect(ctx!.llm.listProviders().map(provider => provider.id)).toContain('upstream')
    })
    const read = await answer(write, 'GET')
    expect(Object.keys(read.body['routes'] as Record<string, unknown>)).toEqual(['upstream'])
  })
})
