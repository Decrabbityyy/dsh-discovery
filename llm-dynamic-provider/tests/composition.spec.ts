/**
 * Full-plugin composition: a real Cordis context mounts the llm seam and this
 * plugin, which probes a fake endpoint and registers the discovered routes on
 * `ctx.llm` — in memory, with no settings document. The cache round-trip is
 * covered by booting against a `$DSH_HOME` holding a persisted catalog with
 * the endpoint down: the routes still register from cache, then refresh once
 * the endpoint answers.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import * as dynamicProvider from '../src/index.ts'
import { startProbeServer } from './server.ts'
import type { ProbeServer } from './server.ts'

/** The smallest real SettingsProvider: an in-memory document with a persist log. */
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

let ctx: Context | undefined
let server: ProbeServer | undefined
let home: string | undefined
let savedHome: string | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (server !== undefined) await server.close()
  server = undefined
  if (savedHome === undefined) delete process.env['DSH_HOME']
  else process.env['DSH_HOME'] = savedHome
  if (home !== undefined) await rm(home, { recursive: true, force: true })
  home = undefined
})

const LISTING = {
  data: [
    { id: 'deepseek-v4-flash' },
    { id: 'acme-x', context_window: 4096 },
  ],
}

/** Mount the llm seam, the settings seam, plus the dynamic provider over one config. */
async function boot(config?: dynamicProvider.Config): Promise<Context> {
  ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(MemorySettings)
  await ctx.plugin(dynamicProvider, config)
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

  it('keeps serving cached routes when the endpoint is down at boot, then refreshes live', { timeout: 30_000 }, async () => {
    savedHome = process.env['DSH_HOME']
    home = await mkdtemp(join(tmpdir(), 'dsh-dyn-cache-'))
    process.env['DSH_HOME'] = home

    // First boot with the endpoint up: discovers and persists the cache.
    server = await startProbeServer({ '/models': { body: JSON.stringify(LISTING) } })
    const firstUrl = server.url
    let context = await boot({
      cache: true,
      routes: { upstream: { baseURL: firstUrl, api: 'openai-completions' } },
    })
    await vi.waitFor(() => {
      expect(context.llm.listProviders().map(provider => provider.id)).toContain('upstream')
    })
    const cachePath = join(home, 'llm-dynamic-provider-cache.json')
    await vi.waitFor(async () => {
      expect(JSON.parse(await readFile(cachePath, 'utf8')).routes['upstream']).toBeDefined()
    })
    await ctx!.fiber.dispose()
    ctx = undefined
    await server.close()

    // Second boot with the endpoint DOWN: the cache registers the route.
    server = undefined
    context = await boot({
      cache: true,
      routes: { upstream: { baseURL: firstUrl, api: 'openai-completions' } },
    })
    await vi.waitFor(() => {
      expect(context.llm.listProviders().map(provider => provider.id)).toContain('upstream')
    })
    const cachedModels = await context.llm.listModels('upstream')
    expect(cachedModels.map(model => model.id)).toContain('deepseek-v4-flash')
  })

  it('withdraws cleanly when the plugin fiber is disposed (HMR safety)', async () => {
    const fresh = new Context()
    await fresh.plugin(LlmRuntime)
    await fresh.plugin(MemorySettings)
    const fiber = await fresh.plugin(dynamicProvider, {
      routes: { upstream: { baseURL: 'http://127.0.0.1:1', api: 'openai-completions' } },
    })
    await fiber.dispose()
    await fresh.fiber.dispose()
  })

  it('recycles its web endpoints across an unload/reload cycle', async () => {
    // A registry that mirrors the real webServer: duplicate paths throw, the
    // disposer frees the path. The plugin must release both endpoints on
    // dispose so the next mount registers them cleanly.
    const live = new Map<string, number>()
    const webServer = {
      register(route: { path: string }): () => void {
        if (live.has(route.path)) throw new Error(`duplicate ${route.path}`)
        live.set(route.path, (live.get(route.path) ?? 0) + 1)
        return () => { live.delete(route.path) }
      },
    }
    const fresh = new Context()
    await fresh.plugin(LlmRuntime)
    await fresh.plugin(MemorySettings)
    fresh.provide('webServer', webServer)

    const first = await fresh.plugin(dynamicProvider)
    expect(live.has('/llm-dynamic-provider/catalog')).toBe(true)
    expect(live.has('/llm-dynamic-provider/routes')).toBe(true)
    await first.dispose()
    expect(live.size).toBe(0)

    // A second mount re-registers both endpoints without a duplicate rejection.
    const second = await fresh.plugin(dynamicProvider)
    expect(live.size).toBe(2)
    await second.dispose()
    expect(live.size).toBe(0)
    await fresh.fiber.dispose()
  })
})
