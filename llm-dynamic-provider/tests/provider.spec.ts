/**
 * The discovery pass and the in-memory registration against a real Cordis
 * context, a real `LlmRuntime`, and a fake `/models` endpoint: routes probe,
 * assemble, and register on `ctx.llm` with no settings document involved.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { discoverDynamicProviders } from '../src/index.ts'
import { startProbeServer } from './server.ts'
import type { ProbeServer } from './server.ts'

let ctx: Context | undefined
let server: ProbeServer | undefined

afterEach(async () => {
  if (server !== undefined) await server.close()
  server = undefined
  await ctx?.fiber.dispose()
  ctx = undefined
})

async function boot(): Promise<Context> {
  ctx = new Context()
  await ctx.plugin(LlmRuntime)
  return ctx
}

const LISTING = {
  data: [
    { id: 'deepseek-v4-flash' },
    { id: 'acme-x', context_window: 4096, max_output_tokens: 1024 },
  ],
}

describe('discoverDynamicProviders', () => {
  it('assembles discovered routes into resolved profiles with catalog reasoning', async () => {
    const context = await boot()
    server = await startProbeServer({ '/models': { body: JSON.stringify(LISTING) } })
    const outcome = await discoverDynamicProviders(context, {
      gw: { baseURL: server.url, api: 'openai-completions', displayName: 'GW' },
    }, undefined, { signal: undefined })

    expect(outcome.failed).toEqual([])
    const gw = outcome.discovered.get('gw')
    expect(gw?.displayName).toBe('GW')
    expect(gw?.provider).toBe('gw')
    const models = gw?.piProvider.getModels() ?? []
    // Catalog-known id carries enrichment + reasoning; endpoint-only id keeps
    // its endpoint capacities with no guessed reasoning.
    expect(models.map(model => model.id)).toEqual(['deepseek-v4-flash', 'acme-x'])
    const flash = models[0]!
    expect(flash.name).toBe('DeepSeek V4 Flash')
    expect(flash.contextWindow).toBe(1_000_000)
    expect(flash.reasoning).toBe(true)
    const acme = models[1]!
    expect(acme.contextWindow).toBe(4096)
    expect(acme.maxTokens).toBe(1024)
    expect(acme.reasoning).toBe(false)
    // pi-ai's Models registry resolves `model.provider` against registered
    // provider ids at stream time; a baseURL there fails with "Unknown provider".
    for (const model of models) expect(model.provider).toBe('gw')
  })

  it('enriches a model the bundled catalog misses from the models.dev facts', async () => {
    // The fixture id is deliberately fictional: a real vendor id drifts into
    // the bundled pi-ai catalog over time (grok-4.6 did, once 0.85 shipped),
    // and a catalog-known id stops exercising the models.dev fallback this
    // test is about — the catalog would fill capacities and win.
    const context = await boot()
    server = await startProbeServer({ '/models': { body: JSON.stringify({ data: [{ id: 'acme-future-1' }] }) } })
    const outcome = await discoverDynamicProviders(context, {
      xai: { baseURL: server.url, api: 'openai-completions' },
    }, undefined, { signal: undefined }, {
      inputModalitiesOf: () => ['text', 'image'],
      factsOf: (id) => id === 'acme-future-1'
        ? { displayName: 'Acme Future 1', contextWindow: 500000, maxTokens: 500000 }
        : undefined,
    })
    expect(outcome.failed).toEqual([])
    const model = outcome.discovered.get('xai')?.piProvider.getModels()[0]
    expect(model?.name).toBe('Acme Future 1')
    expect(model?.contextWindow).toBe(500000)
    expect(model?.maxTokens).toBe(500000)
    expect(model?.input).toEqual(['text', 'image'])
  })

  it('supports every OpenAI/Anthropic wire protocol a route may name', async () => {
    const context = await boot()
    // The Anthropic dialect pages the same listing at `?limit=1000`; the OpenAI
    // dialects hit the bare path. Serve both spellings.
    server = await startProbeServer({
      '/models': { body: JSON.stringify({ data: [{ id: 'm1' }] }) },
      '/models?limit=1000': { body: JSON.stringify({ data: [{ id: 'm1' }] }) },
    })
    for (const api of ['openai-completions', 'openai-responses', 'anthropic-messages'] as const) {
      const outcome = await discoverDynamicProviders(context, {
        r: { baseURL: server.url, api },
      }, undefined, { signal: undefined })
      expect(outcome.failed, api).toEqual([])
      expect(outcome.discovered.get('r')?.piProvider.getModels()[0]?.api).toBe(api)
    }
  })

  it('assembles a google-generative-ai route once the native endpoint lists models', async () => {
    const context = await boot()
    server = await startProbeServer({
      '/models?pageSize=1000': {
        body: JSON.stringify({
          models: [{ baseModelId: 'gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] }],
        }),
      },
    })
    const outcome = await discoverDynamicProviders(context, {
      gemini: { baseURL: server.url, api: 'google-generative-ai' },
    }, undefined, { signal: undefined })
    expect(outcome.failed).toEqual([])
    const profile = outcome.discovered.get('gemini')
    expect(profile?.piProvider.getModels()[0]?.api).toBe('google-generative-ai')
    expect(profile?.piProvider.getModels()[0]?.id).toBe('gemini-2.5-pro')
  })

  it('reports failures per route without blocking the healthy ones', async () => {
    const context = await boot()
    server = await startProbeServer({ '/models': { body: JSON.stringify(LISTING) } })
    const outcome = await discoverDynamicProviders(context, {
      good: { baseURL: server.url, api: 'openai-completions' },
      down: { baseURL: 'http://127.0.0.1:1', api: 'openai-completions' },
    }, undefined, { signal: undefined })
    expect(outcome.discovered.has('good')).toBe(true)
    expect(outcome.discovered.has('down')).toBe(false)
    expect(outcome.failed).toHaveLength(1)
    expect(outcome.failed[0]?.route).toBe('down')
  })

  it('refuses an empty listing rather than assemble a model-less route', async () => {
    const context = await boot()
    server = await startProbeServer({ '/models': { body: JSON.stringify({ data: [] }) } })
    const outcome = await discoverDynamicProviders(context, {
      gw: { baseURL: server.url, api: 'openai-completions' },
    }, undefined, { signal: undefined })
    expect(outcome.discovered.size).toBe(0)
    expect(outcome.failed[0]?.message).toContain('no models')
  })

  it('marks a credential-less openai-completions route with the keyless posture', async () => {
    const context = await boot()
    server = await startProbeServer({
      '/models': { body: JSON.stringify(LISTING) },
      '/models?limit=1000': { body: JSON.stringify(LISTING) },
    })
    process.env['KEYED_PROBE_KEY'] = 'sk-keyed'
    try {
      const outcome = await discoverDynamicProviders(context, {
        free: { baseURL: server.url, api: 'openai-completions' },
        keyed: { baseURL: server.url, api: 'openai-completions', apiKeyEnv: 'KEYED_PROBE_KEY' },
        anthro: { baseURL: server.url, api: 'anthropic-messages' },
      }, undefined, { signal: undefined })
      expect(outcome.failed).toEqual([])
      // The keyless openai-completions route erases the SDK's Bearer line; a
      // route naming a credential does not, and neither do dialects that send
      // the placeholder as a real credential.
      expect(outcome.discovered.get('free')?.headers).toEqual({ authorization: '' })
      expect(outcome.discovered.get('keyed')?.headers).toBeUndefined()
      expect(outcome.discovered.get('anthro')?.headers).toBeUndefined()
    } finally {
      delete process.env['KEYED_PROBE_KEY']
    }
    // The keyless probes carried no Authorization header; the keyed one did.
    expect(server.requests.some(request => request.authorization === undefined)).toBe(true)
    expect(server.requests.some(request => request.authorization === 'Bearer sk-keyed')).toBe(true)
  })

  it('resolves the probe key through the environment when no credential seam is mounted', async () => {
    const context = await boot()
    server = await startProbeServer({ '/models': { body: JSON.stringify(LISTING) } })
    process.env['GW_PROBE_KEY'] = 'sk-from-env'
    try {
      await discoverDynamicProviders(context, {
        gw: { baseURL: server.url, api: 'openai-completions', apiKeyEnv: 'GW_PROBE_KEY' },
      }, undefined, { signal: undefined })
      expect(server.requests[0]?.authorization).toBe('Bearer sk-from-env')
    } finally {
      delete process.env['GW_PROBE_KEY']
    }
  })
})
