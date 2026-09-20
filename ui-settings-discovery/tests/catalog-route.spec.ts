/**
 * The settings section's own catalog endpoint. Its browser half is the only
 * consumer and the per-model `input` modalities it adopts come from here, so
 * the route must answer the models.dev snapshot while the plugin is loaded and
 * leave with its fiber.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { UI_CATALOG_PATH } from 'dsh-llm-endpoint-base/vocabulary'
import { apply } from '../src/index.ts'

/** One models.dev body carrying a vision model and a text-only one. */
const MODELS_DEV_BODY = {
  xai: {
    models: {
      'grok-4.6': {
        name: 'Grok 4.6',
        reasoning: true,
        reasoning_options: [{ type: 'effort', values: ['low', 'high'] }],
        modalities: { input: ['text', 'image'], output: ['text'] },
        limit: { context: 500_000, output: 500_000 },
      },
      'chat-only': { name: 'Chat Only', modalities: { input: ['text'], output: ['text'] } },
    },
  },
}

interface CatalogRoute {
  readonly path: string
  readonly handler: (req: unknown, res: ResponseStub) => unknown
}

/** The web server face: a path registry mirroring duplicate rejection and disposal. */
interface ResponseStub {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body: string): void
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

/** Invoke one registered route and parse the JSON body it answers with. */
function answer(route: CatalogRoute): unknown {
  let body = ''
  route.handler(undefined, {
    statusCode: 200,
    setHeader: () => {},
    end: (value: string) => { body = value },
  })
  return JSON.parse(body)
}

/** Stub the mount-time models.dev fetch with one bodied or failing reply. */
function stubModelsDev(reply: { body?: unknown } | 'reject'): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() => (reply === 'reject'
    ? Promise.reject(new Error('offline'))
    : Promise.resolve({ ok: true, json: () => Promise.resolve(reply.body) })))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('section catalog endpoint', () => {
  it('answers the models.dev levels, modalities, and capacities of the mount-time snapshot', async () => {
    const fetchMock = stubModelsDev({ body: MODELS_DEV_BODY })
    const routes = new Map<string, CatalogRoute>()
    const ctx = new Context()
    ctx.provide('webServer', fakeWebServer(routes))
    await ctx.plugin(apply)
    const route = routes.get(UI_CATALOG_PATH)
    expect(route).toBeDefined()
    expect(fetchMock).toHaveBeenCalledWith('https://models.dev/api.json', expect.anything())
    // The envelope fills once the mount-time fetch resolves; until then it is empty.
    await vi.waitFor(() => {
      expect(answer(route!)).toMatchObject({
        catalog: { 'grok-4.6': ['low', 'high'] },
        modalities: {
          'grok-4.6': { input: ['text', 'image'], output: ['text'] },
          'chat-only': { input: ['text'], output: ['text'] },
        },
      })
    })
    expect(answer(route!)).toEqual({
      catalog: { 'grok-4.6': ['low', 'high'] },
      modalities: {
        'grok-4.6': { input: ['text', 'image'], output: ['text'] },
        'chat-only': { input: ['text'], output: ['text'] },
      },
      facts: {
        'grok-4.6': { name: 'Grok 4.6', contextWindow: 500_000, maxTokens: 500_000 },
        'chat-only': { name: 'Chat Only' },
      },
      sources: { 'grok-4.6': ['xai'], 'chat-only': ['xai'] },
    })
    await ctx.fiber.dispose()
  })

  it('withdraws the route with its fiber and re-registers on the next mount', async () => {
    stubModelsDev({ body: MODELS_DEV_BODY })
    const routes = new Map<string, CatalogRoute>()
    const ctx = new Context()
    ctx.provide('webServer', fakeWebServer(routes))
    const first = await ctx.plugin(apply)
    expect(routes.has(UI_CATALOG_PATH)).toBe(true)
    await first.dispose()
    expect(routes.size).toBe(0)
    // A reload finds the path free rather than rejected as a duplicate.
    const second = await ctx.plugin(apply)
    expect(routes.has(UI_CATALOG_PATH)).toBe(true)
    await second.dispose()
    await ctx.fiber.dispose()
  })

  it('waits for a web server that mounts after the plugin', async () => {
    stubModelsDev({ body: MODELS_DEV_BODY })
    const routes = new Map<string, CatalogRoute>()
    const ctx = new Context()
    const fiber = await ctx.plugin(apply)
    expect(routes.has(UI_CATALOG_PATH)).toBe(false)
    ctx.provide('webServer', fakeWebServer(routes))
    await vi.waitFor(() => { expect(routes.has(UI_CATALOG_PATH)).toBe(true) })
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('answers an empty index instead of failing the mount when models.dev is unreachable', async () => {
    stubModelsDev('reject')
    const routes = new Map<string, CatalogRoute>()
    const ctx = new Context()
    ctx.provide('webServer', fakeWebServer(routes))
    await ctx.plugin(apply)
    await vi.waitFor(() => { expect(routes.has(UI_CATALOG_PATH)).toBe(true) })
    expect(answer(routes.get(UI_CATALOG_PATH)!)).toEqual({ catalog: {}, modalities: {}, facts: {} })
    await ctx.fiber.dispose()
  })
})
