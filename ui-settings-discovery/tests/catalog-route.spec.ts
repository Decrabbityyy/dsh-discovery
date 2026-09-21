/**
 * 设置页的宿主半边：把共享目录服务的 envelope 与状态转给浏览器半边，并随插件卸载撤销。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CATALOG_SERVICE, UI_CATALOG_PATH, UI_CATALOG_STATUS_PATH } from 'dsh-llm-discovery/vocabulary'
import { apply } from '../src/index.ts'

/** 目录服务的替身：只有宿主半边真正读的那几个成员。 */
const ENVELOPE = {
  catalog: { 'grok-4.6': ['low', 'high'] },
  modalities: { 'grok-4.6': { input: ['text', 'image'], output: ['text'] } },
  facts: { 'grok-4.6': { name: 'Grok 4.6', contextWindow: 500_000, maxTokens: 500_000 } },
  sources: { 'grok-4.6': ['xai'] },
}

function fakeCatalog(): { service: Record<string, unknown>; refreshes: () => number } {
  let refreshes = 0
  const status = { entries: 2, refreshedAt: 1_789_900_000_000, source: 'storage' as const }
  return {
    refreshes: () => refreshes,
    service: {
      factsOf: () => undefined,
      inputModalitiesOf: () => undefined,
      envelope: () => ENVELOPE,
      status: () => status,
      refresh: () => {
        refreshes += 1
        return Promise.resolve(status)
      },
      ready: () => Promise.resolve(),
    },
  }
}

interface ResponseStub {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body: string): void
}

interface CatalogRoute {
  readonly path: string
  readonly handler: (req: unknown, res: ResponseStub) => unknown
}

/** A path registry mirroring the real webServer: duplicate paths throw, the disposer frees the path. */
function fakeWebServer(routes: Map<string, CatalogRoute>): { register(route: CatalogRoute): () => void } {
  return {
    register(route: CatalogRoute): () => void {
      if (routes.has(route.path)) throw new Error(`duplicate ${route.path}`)
      routes.set(route.path, route)
      return () => { routes.delete(route.path) }
    },
  }
}

/** Invoke one registered route and parse the answer it wrote. */
async function answer(route: CatalogRoute, method = 'GET'): Promise<{ status: number; body: unknown }> {
  let body = ''
  const res: ResponseStub = {
    statusCode: 200,
    setHeader: () => {},
    end: (value: string) => { body = value },
  }
  await route.handler({ method }, res)
  return { status: res.statusCode, body: body.length === 0 ? undefined : JSON.parse(body) }
}

async function mount(routes: Map<string, CatalogRoute>, catalog: Record<string, unknown>): Promise<Context> {
  const ctx = new Context()
  ctx.provide('webServer', fakeWebServer(routes))
  ctx.provide(CATALOG_SERVICE, catalog)
  await ctx.plugin(apply)
  return ctx
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('section catalog endpoints', () => {
  it('answers the shared envelope on the catalog path', async () => {
    const routes = new Map<string, CatalogRoute>()
    const ctx = await mount(routes, fakeCatalog().service)
    await expect(answer(routes.get(UI_CATALOG_PATH)!)).resolves.toEqual({ status: 200, body: ENVELOPE })
    await ctx.fiber.dispose()
  })

  it('answers the status on the status path and refreshes on POST', async () => {
    const routes = new Map<string, CatalogRoute>()
    const fake = fakeCatalog()
    const ctx = await mount(routes, fake.service)
    const route = routes.get(UI_CATALOG_STATUS_PATH)!

    await expect(answer(route)).resolves.toEqual({
      status: 200,
      body: { entries: 2, refreshedAt: 1_789_900_000_000, source: 'storage' },
    })
    expect(fake.refreshes()).toBe(0)
    await answer(route, 'POST')
    expect(fake.refreshes()).toBe(1)
    await expect(answer(route, 'DELETE')).resolves.toEqual({ status: 405, body: { error: 'method not allowed' } })
    await ctx.fiber.dispose()
  })

  it('withdraws its routes with the fiber and re-registers on the next mount', async () => {
    const routes = new Map<string, CatalogRoute>()
    const ctx = new Context()
    ctx.provide('webServer', fakeWebServer(routes))
    ctx.provide(CATALOG_SERVICE, fakeCatalog().service)
    const first = await ctx.plugin(apply)
    expect(routes.size).toBe(2)
    await first.dispose()
    expect(routes.size).toBe(0)
    // A reload finds the paths free rather than rejected as duplicates.
    const second = await ctx.plugin(apply)
    expect(routes.size).toBe(2)
    await second.dispose()
    await ctx.fiber.dispose()
  })

  it('waits for a web server that mounts after the plugin', async () => {
    const routes = new Map<string, CatalogRoute>()
    const ctx = new Context()
    ctx.provide(CATALOG_SERVICE, fakeCatalog().service)
    const fiber = await ctx.plugin(apply)
    expect(routes.size).toBe(0)
    ctx.provide('webServer', fakeWebServer(routes))
    await vi.waitFor(() => { expect(routes.size).toBe(2) })
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
})
