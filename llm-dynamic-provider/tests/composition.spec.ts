/** Full-plugin composition: a real Cordis context mounts the llm seam and this plugin, which probes a fake endpoint and registers the discovered routes on */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { DYNAMIC_PROBE_PATH } from 'dsh-llm-discovery/engine'
import { CATALOG_SERVICE } from 'dsh-llm-discovery/vocabulary'
import * as dynamicProvider from '../src/index.ts'
import type { RouteProfile } from '../src/config.ts'
import { formsStub } from './settings-stub.ts'
import { startProbeServer } from './server.ts'
import type { ProbeServer } from './server.ts'

let ctx: Context | undefined
let server: ProbeServer | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (server !== undefined) await server.close()
  server = undefined
})

const LISTING = {
  data: [
    { id: 'deepseek-v4-flash' },
    { id: 'acme-x', context_window: 4096 },
  ],
}

/** 目录替身：这个组合里没有 models.dev 数据，只有服务本身。 */
function catalogService(): Record<string, unknown> {
  return {
    factsOf: () => undefined,
    inputModalitiesOf: () => undefined,
    envelope: () => ({ catalog: {}, modalities: {}, facts: {} }),
    status: () => ({ entries: 0, refreshedAt: null, source: 'storage' }),
    refresh: () => Promise.resolve({ entries: 0, refreshedAt: null, source: 'storage' }),
    ready: () => Promise.resolve(),
  }
}

/** A registry that mirrors the real webServer: duplicate paths throw, the disposer frees the path. */
function pathRegistry(live: Map<string, number>): { register(route: { path: string }): () => void } {
  return {
    register(route: { path: string }): () => void {
      if (live.has(route.path)) throw new Error(`duplicate ${route.path}`)
      live.set(route.path, (live.get(route.path) ?? 0) + 1)
      return () => { live.delete(route.path) }
    },
  }
}

/** 组合层写下来的那份配置：volatile 字段在这里是普通值，注册表按插件的 schema 解析成引用后才交给 `apply`。 */
type RawConfig = {
  routes?: Record<string, RouteProfile>
  timeoutMs?: number
  maxResponseBytes?: number
  enrichment?: boolean
}

/** Mount the llm seam, the settings seam, a catalog service, plus the dynamic provider. */
async function boot(config?: RawConfig): Promise<Context> {
  ctx = new Context()
  await ctx.plugin(LlmRuntime)
  const forms = formsStub()
  ctx.provide('settings', forms.service as never)
  ctx.provide(CATALOG_SERVICE, catalogService())
  const fiber: Fiber = await ctx.plugin(dynamicProvider, config as never).await()
  forms.attach(fiber)
  return ctx
}

describe('plugin composition', () => {
  it('registers discovered routes on the llm registry with no settings document', async () => {
    server = await startProbeServer({ '/models': { body: JSON.stringify(LISTING) } })
    const context = await boot({
      routes: { upstream: { baseURL: server.url, api: 'openai-completions', displayName: 'Upstream' } },
    })
    await vi.waitFor(() => {
      expect(context.llm.listProviders().map(provider => provider.id)).toContain('upstream')
    })
    const upstream = context.llm.listProviders().find(provider => provider.id === 'upstream')!
    expect(upstream.name).toBe('Upstream')
    const models = await context.llm.listModels('upstream')
    expect(models.map(model => model.id)).toEqual(['deepseek-v4-flash', 'acme-x'])
  })

  it('mirrors declared routes into the configurable-provider directory (exposes the namespace)', async () => {
    server = await startProbeServer({ '/models': { body: JSON.stringify(LISTING) } })
    const context = await boot({
      routes: { upstream: { baseURL: server.url, api: 'openai-completions', displayName: 'Upstream' } },
    })
    await vi.waitFor(() => {
      const entry = context.llm.listConfigurableProviders().find(candidate => candidate.provider === 'upstream')
      expect(entry?.settingsNs).toBe('llm-dynamic-provider')
      expect(entry?.settingsPath).toEqual(['routes', 'upstream'])
    })
  })

  it('registers a route only once its endpoint answers, and reprobes on a settings update', { timeout: 30_000 }, async () => {
    // Boot against a dead endpoint: nothing registers.
    const context = await boot({ routes: { upstream: { baseURL: 'http://127.0.0.1:1', api: 'openai-completions' } } })
    await vi.waitFor(() => {
      expect(context.llm.listConfigurableProviders().map(entry => entry.provider)).toContain('upstream')
    })
    expect(context.llm.listProviders().map(provider => provider.id)).not.toContain('upstream')

    // Point the route at a live endpoint; the settings update reprobes it.
    server = await startProbeServer({ '/models': { body: JSON.stringify(LISTING) } })
    await context.settings.mutate('llm-dynamic-provider', [{
      op: 'set',
      path: ['routes', 'upstream'],
      value: { baseURL: server.url, api: 'openai-completions' },
    }])
    await vi.waitFor(() => {
      expect(context.llm.listProviders().map(provider => provider.id)).toContain('upstream')
    })
    const models = await context.llm.listModels('upstream')
    expect(models.map(model => model.id)).toEqual(['deepseek-v4-flash', 'acme-x'])
  })

  it('withdraws cleanly when the plugin fiber is disposed (HMR safety)', async () => {
    const fresh = new Context()
    await fresh.plugin(LlmRuntime)
    const forms = formsStub()
    fresh.provide('settings', forms.service as never)
    fresh.provide(CATALOG_SERVICE, catalogService())
    const fiber = await fresh.plugin(dynamicProvider, {
      routes: { upstream: { baseURL: 'http://127.0.0.1:1', api: 'openai-completions' } },
    } as never)
    forms.attach(fiber)
    await fiber.dispose()
    await fresh.fiber.dispose()
  })

  it('recycles its web endpoints across an unload/reload cycle', async () => {
    // The plugin must release its endpoints on dispose so the next mount
    // registers them cleanly.
    const live = new Map<string, number>()
    const fresh = new Context()
    await fresh.plugin(LlmRuntime)
    const forms = formsStub()
    fresh.provide('settings', forms.service as never)
    fresh.provide('webServer', pathRegistry(live))
    fresh.provide(CATALOG_SERVICE, catalogService())

    const first = await fresh.plugin(dynamicProvider)
    forms.attach(first)
    expect(live.has('/llm-dynamic-provider/routes')).toBe(true)
    expect(live.has(DYNAMIC_PROBE_PATH)).toBe(true)
    expect(live.size).toBe(2)
    await first.dispose()
    expect(live.size).toBe(0)

    // A second mount re-registers the endpoints without a duplicate rejection.
    const second = await fresh.plugin(dynamicProvider)
    forms.attach(second)
    expect(live.size).toBe(2)
    await second.dispose()
    expect(live.size).toBe(0)
    await fresh.fiber.dispose()
  })

  it('registers its endpoints when the web server mounts after the plugin', async () => {
    // The real web server's service is visible only while its own fiber is
    // active, which is after its listen resolves; the settings page's endpoints
    // must still appear when this plugin mounted first.
    const live = new Map<string, number>()
    const fresh = new Context()
    await fresh.plugin(LlmRuntime)
    const forms = formsStub()
    fresh.provide('settings', forms.service as never)
    fresh.provide(CATALOG_SERVICE, catalogService())
    const fiber = await fresh.plugin(dynamicProvider)
    forms.attach(fiber)
    expect(live.size).toBe(0)

    fresh.provide('webServer', pathRegistry(live))
    await vi.waitFor(() => {
      expect(live.has('/llm-dynamic-provider/routes')).toBe(true)
      expect(live.has(DYNAMIC_PROBE_PATH)).toBe(true)
    })

    // Disposing the plugin must withdraw what the late web server registered.
    await fiber.dispose()
    expect(live.size).toBe(0)
    await fresh.fiber.dispose()
  })
})
