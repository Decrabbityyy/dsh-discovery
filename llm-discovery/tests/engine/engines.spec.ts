/** Engine-ladder behavior of `dsh-llm-discovery` against a real local HTTP fixture: per-engine parsing, skip/fail classification, ladder */

import { createServer as createNetServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { resolveDiscoveryConfig } from '../../src/engine/config.ts'
import type { ResolvedDiscoveryConfig } from '../../src/engine/config.ts'
import { discoverEndpoint } from '../../src/engine/discover.ts'
import { startProbeServer } from '../support/server.ts'
import type { ProbeServer, RouteTable } from '../support/server.ts'

const config = resolveDiscoveryConfig(undefined)

function withOverrides(overrides: Parameters<typeof resolveDiscoveryConfig>[0]): ResolvedDiscoveryConfig {
  return resolveDiscoveryConfig(overrides)
}

async function withServer(routes: RouteTable, run: (server: ProbeServer) => Promise<void>): Promise<void> {
  const server = await startProbeServer(routes)
  try {
    await run(server)
  } finally {
    await server.close()
  }
}

describe('ollama engine', () => {
  it('discovers models with per-model context lengths and engine defaults', async () => {
    await withServer({
      '/api/tags': { body: JSON.stringify({ models: [{ name: 'qwen3:8b' }, { name: 'deepseek-v4-flash' }, { details: {} }] }) },
      '/api/show': (body: string) => (body.includes('qwen')
        ? { body: JSON.stringify({ model_info: { 'llama.context_length': 40960 } }) }
        : { body: JSON.stringify({ model_info: { 'llama.context_length': 'not-a-number', 'llama.rope': 1 } }) }),
    }, async (server) => {
      const models = await discoverEndpoint({ baseURL: server.url }, config)
      expect(models).toEqual([
        { id: 'qwen3:8b', contextWindow: 40960 },
        // /api/show carries no context_length for this id: the engine default
        // applies, and enrichment fills name/maxTokens around it.
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: 128_000, maxTokens: 384_000 },
      ])
      expect(server.requests.map(request => `${request.method} ${request.path}`)).toEqual([
        'GET /api/tags',
        'POST /api/show',
        'POST /api/show',
      ])
    })
  })

  it('aborts between per-model metadata reads', async () => {
    const controller = new AbortController()
    await withServer({
      '/api/tags': { body: JSON.stringify({ models: [{ name: 'a' }, { name: 'b' }] }) },
      '/api/show': () => {
        controller.abort()
        return { body: '{}' }
      },
    }, async (server) => {
      await expect(discoverEndpoint({ baseURL: server.url, signal: controller.signal }, config))
        .rejects.toThrow('aborted by caller')
    })
  })

  it('times out on a silent tags endpoint', async () => {
    await withServer({
      '/api/tags': { delayMs: 500, body: '{}' },
    }, async (server) => {
      const fast = withOverrides({ timeoutMs: 60, engines: { litellm: false, openaiModels: false } })
      await expect(discoverEndpoint({ baseURL: server.url }, fast))
        .rejects.toThrow('did not answer in time')
    })
  })

  it('probes the native API on a /v1-suffixed base', async () => {
    await withServer({
      '/api/tags': { body: JSON.stringify({ models: [{ name: 'qwen3:8b' }] }) },
      '/api/show': { body: JSON.stringify({}) },
    }, async (server) => {
      const models = await discoverEndpoint({ baseURL: `${server.url}/v1` }, config)
      expect(models).toEqual([{ id: 'qwen3:8b', contextWindow: 128_000 }])
    })
  })

  it('falls through to the generic listing when the tags endpoint is absent', async () => {
    await withServer({
      '/models': { body: JSON.stringify({ data: [{ id: 'local-model', context_length: 32_768 }] }) },
    }, async (server) => {
      const models = await discoverEndpoint({ baseURL: server.url }, config)
      expect(models).toEqual([{ id: 'local-model', contextWindow: 32_768 }])
    })
  })

  it('skips when the tags answer is not JSON', async () => {
    await withServer({
      '/api/tags': { body: 'plain text' },
      '/models': { body: JSON.stringify({ data: [{ id: 'm1' }] }) },
    }, async (server) => {
      const models = await discoverEndpoint({ baseURL: server.url }, config)
      expect(models).toEqual([{ id: 'm1' }])
    })
  })

  it('skips when the tags answer carries no models array', async () => {
    await withServer({
      '/api/tags': { body: JSON.stringify({}) },
      '/models': { body: JSON.stringify({ data: [{ id: 'm2' }] }) },
    }, async (server) => {
      const models = await discoverEndpoint({ baseURL: server.url }, config)
      expect(models).toEqual([{ id: 'm2' }])
    })
  })

  it('reports the earliest auth refusal when every rung is refused', async () => {
    await withServer({
      '/api/tags': { status: 401, body: '{}' },
      '/models': { status: 401, body: '{}' },
    }, async (server) => {
      await expect(discoverEndpoint({ baseURL: server.url }, config))
        .rejects.toThrow('/api/tags answered 401; check the API key')
    })
  })

  it('aborts cleanly while reading per-model metadata', async () => {
    await withServer({
      '/api/tags': { body: JSON.stringify({ models: [{ name: 'a' }, { name: 'b' }] }) },
      '/api/show': { delayMs: 300, body: '{}' },
    }, async (server) => {
      const controller = new AbortController()
      const pending = discoverEndpoint({ baseURL: server.url, signal: controller.signal }, config)
      setTimeout(() => {
        controller.abort()
      }, 60)
      await expect(pending).rejects.toThrow('aborted by caller')
    })
  })
})

describe('litellm engine', () => {
  it('reads rich metadata from the first answering management route', async () => {
    await withServer({
      '/model_group/info': { status: 404, body: '{}' },
      '/v2/model/info': {
        body: JSON.stringify({
          data: [
            { model_group: 'gpt-4.1', max_input_tokens: 1000, max_output_tokens: 500 },
            { model_name: 'acme-m', model_info: { max_input_tokens: 999 } },
            { model_name: 'bare-m' },
            'junk-row',
            { model_group: 42 },
          ],
        }),
      },
    }, async (server) => {
      const models = await discoverEndpoint({ baseURL: server.url, apiKey: 'sk-test' }, config)
      expect(models).toEqual([
        { id: 'gpt-4.1', name: 'GPT-4.1', contextWindow: 1000, maxTokens: 500 },
        { id: 'acme-m', contextWindow: 999 },
        { id: 'bare-m' },
      ])
      expect(server.requests[0]?.authorization).toBe('Bearer sk-test')
    })
  })

  it('walks past routes without a data array', async () => {
    await withServer({
      '/model_group/info': { body: '{}' },
      '/v2/model/info': { body: '{}' },
      '/model/info': { body: '{}' },
      '/v1/model/info': { body: '{}' },
      '/models': { body: JSON.stringify({ data: [{ id: 'gm', context_length: 777 }] }) },
    }, async (server) => {
      const models = await discoverEndpoint({ baseURL: server.url }, config)
      expect(models).toEqual([{ id: 'gm', contextWindow: 777 }])
    })
  })

  it('prefers the litellm refusal when the listing also fails auth', async () => {
    const refused = { status: 401, body: '{}' }
    await withServer({
      '/model_group/info': refused,
      '/v2/model/info': refused,
      '/model/info': refused,
      '/v1/model/info': refused,
      '/models': refused,
    }, async (server) => {
      await expect(discoverEndpoint({ baseURL: server.url }, config))
        .rejects.toThrow('/model_group/info answered 401; check the API key')
    })
  })

  it('stops probing when the caller aborts', async () => {
    await withServer({
      '/model_group/info': { delayMs: 300, body: '{}' },
    }, async (server) => {
      const controller = new AbortController()
      const pending = discoverEndpoint({ baseURL: server.url, signal: controller.signal }, config)
      setTimeout(() => {
        controller.abort()
      }, 60)
      await expect(pending).rejects.toThrow('aborted by caller')
    })
  })
})

describe('generic OpenAI listing engine', () => {
  it('reads every capacity and label alias including vLLM max_model_len', async () => {
    await withServer({
      '/models': {
        body: JSON.stringify({
          data: [
            { id: 'a', context_window: 100, name: 'A' },
            { id: 'b', context_length: 200, display_name: 'B' },
            { id: 'c', max_model_len: 300, max_tokens: 33 },
            { id: 'd', max_output_tokens: 44 },
            'junk-row',
            { name: 'no-id' },
          ],
        }),
      },
    }, async (server) => {
      const models = await discoverEndpoint({ baseURL: server.url }, config)
      expect(models).toEqual([
        { id: 'a', name: 'A', contextWindow: 100 },
        { id: 'b', name: 'B', contextWindow: 200 },
        { id: 'c', contextWindow: 300, maxTokens: 33 },
        { id: 'd', maxTokens: 44 },
      ])
    })
  })

  it('reads an Anthropic listing with its own auth headers and field names', async () => {
    await withServer({
      '/models?limit=1000': {
        body: JSON.stringify({
          data: [
            { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', max_input_tokens: 200_000, max_tokens: 64_000, type: 'model' },
          ],
          has_more: false,
        }),
      },
    }, async (server) => {
      const models = await discoverEndpoint(
        { baseURL: server.url, api: 'anthropic-messages', apiKey: 'sk-ant-test' },
        config,
      )
      // The endpoint's display_name wins over the catalog's longer label.
      expect(models).toEqual([
        { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', contextWindow: 200_000, maxTokens: 64_000 },
      ])
      const listing = server.requests.find(request => request.path === '/models?limit=1000')
      expect(listing).toBeDefined()
      expect(listing?.authorization).toBeUndefined()
      expect(listing?.headers['x-api-key']).toBe('sk-ant-test')
      expect(listing?.headers['anthropic-version']).toBe('2023-06-01')
    })
  })

  it('reads a native Google listing with its auth header and token limits', async () => {
    await withServer({
      '/models?pageSize=1000': {
        body: JSON.stringify({
          models: [
            {
              name: 'models/gemini-native-test-001',
              baseModelId: 'gemini-native-test',
              displayName: 'Gemini Native Test',
              inputTokenLimit: 1_000_000,
              outputTokenLimit: 65_536,
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/text-embedding-test',
              supportedGenerationMethods: ['embedContent'],
            },
            {
              name: 'models/gemini-resource-only',
              supportedGenerationMethods: ['generateContent'],
            },
            'junk-row',
          ],
        }),
      },
    }, async (server) => {
      const models = await discoverEndpoint(
        { baseURL: server.url, api: 'google-generative-ai', apiKey: 'google-test-key' },
        config,
      )
      expect(models).toEqual([
        { id: 'gemini-native-test', name: 'Gemini Native Test', contextWindow: 1_000_000, maxTokens: 65_536 },
        { id: 'gemini-resource-only' },
      ])
      const listing = server.requests.find(request => request.path === '/models?pageSize=1000')
      expect(listing?.authorization).toBeUndefined()
      expect(listing?.headers['x-goog-api-key']).toBe('google-test-key')
    })
  })

  it('fails when the listing has no data array', async () => {
    await withServer({
      '/models': { body: JSON.stringify({}) },
    }, async (server) => {
      await expect(discoverEndpoint({ baseURL: server.url }, config))
        .rejects.toThrow('has no "data" array')
    })
  })

  it('fails with the status on a bare refusal', async () => {
    await withServer({
      '/models': { status: 500, body: '{}' },
    }, async (server) => {
      await expect(discoverEndpoint({ baseURL: server.url }, config))
        .rejects.toThrow('answered 500')
    })
  })

  it('hints at the key on an auth refusal', async () => {
    await withServer({
      '/models': { status: 403, body: '{}' },
    }, async (server) => {
      await expect(discoverEndpoint({ baseURL: server.url }, config))
        .rejects.toThrow('answered 403; check the API key')
    })
  })

  it('refuses a reply that grows past the ceiling while streaming', async () => {
    await withServer({
      '/models': { chunked: ['{"data":[{"id":"', 'x'.repeat(4096), '"}]}'] },
    }, async (server) => {
      await expect(discoverEndpoint({ baseURL: server.url }, withOverrides({ maxResponseBytes: 1024 })))
        .rejects.toThrow('larger than the configured ceiling')
    })
  })

  it('refuses a reply that declares an oversized length before transfer', async () => {
    // A raw socket server can declare a dishonest content-length a Node http
    // server refuses to emit.
    const server = createNetServer((socket) => {
      socket.on('data', () => {
        socket.write('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 10485760\r\nConnection: close\r\n\r\n{"data":[]}')
        socket.end()
      })
    })
    const listening = Promise.withResolvers<undefined>()
    server.listen(0, '127.0.0.1', () => {
      listening.resolve(undefined)
    })
    await listening.promise
    const { port } = server.address() as AddressInfo
    try {
      await expect(discoverEndpoint({ baseURL: `http://127.0.0.1:${port}` }, config))
        .rejects.toThrow('larger than the configured ceiling')
    } finally {
      server.close()
    }
  })

  it('fails on a non-JSON answer', async () => {
    await withServer({
      '/models': { body: 'hello' },
    }, async (server) => {
      await expect(discoverEndpoint({ baseURL: server.url }, config))
        .rejects.toThrow('did not answer with JSON')
    })
  })

  it('treats a 204 answer as no JSON', async () => {
    await withServer({
      '/models': { status: 204 },
    }, async (server) => {
      await expect(discoverEndpoint({ baseURL: server.url }, config))
        .rejects.toThrow('did not answer with JSON')
    })
  })

  it('times out on a silent endpoint', async () => {
    await withServer({
      '/models': { delayMs: 500, body: JSON.stringify({ data: [] }) },
    }, async (server) => {
      const fast = withOverrides({ timeoutMs: 60, engines: { ollama: false, litellm: false } })
      await expect(discoverEndpoint({ baseURL: server.url }, fast))
        .rejects.toThrow('did not answer in time')
    })
  })

  it('fails when the endpoint is unreachable', async () => {
    const server = await startProbeServer({})
    const url = server.url
    await server.close()
    await expect(discoverEndpoint({ baseURL: url }, withOverrides({ engines: { ollama: false, litellm: false } })))
      .rejects.toThrow('could not reach')
  })

  it('aborts while streaming the reply body', async () => {
    await withServer({
      '/models': { drip: '{"data":[' },
    }, async (server) => {
      const controller = new AbortController()
      const pending = discoverEndpoint(
        { baseURL: server.url, signal: controller.signal },
        withOverrides({ engines: { ollama: false, litellm: false } }),
      )
      setTimeout(() => {
        controller.abort()
      }, 60)
      await expect(pending).rejects.toThrow('aborted by caller')
    })
  })

  it('answers an empty listing truthfully', async () => {
    await withServer({
      '/models': { body: JSON.stringify({ data: [] }) },
    }, async (server) => {
      await expect(discoverEndpoint({ baseURL: server.url }, config)).resolves.toEqual([])
    })
  })
})
