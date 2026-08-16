/**
 * Orchestration behavior of the discovery namespace: draft validation, engine
 * gating, the error taxonomy of a failed ladder, and the enrichment switch.
 */

import { describe, expect, it } from 'vitest'
import { INVALID_CREDENTIAL_CODE, LlmError } from '@deepseek-ai/dsh-llm'
import { resolveDiscoveryConfig } from '../src/config.ts'
import { discoverEndpoint } from '../src/discover.ts'
import { startProbeServer } from './server.ts'

const config = resolveDiscoveryConfig(undefined)

describe('discoverEndpoint draft validation', () => {
  it('requires a baseURL', async () => {
    await expect(discoverEndpoint({}, config)).rejects.toThrow('a baseURL is required')
    await expect(discoverEndpoint({ baseURL: '   ' }, config)).rejects.toThrow('a baseURL is required')
  })

  it('rejects a blank draft key before any request', async () => {
    const failure = await discoverEndpoint({ baseURL: 'http://127.0.0.1:1', apiKey: '   ' }, config)
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(LlmError)
    expect((failure as LlmError).code).toBe(INVALID_CREDENTIAL_CODE)
    expect((failure as LlmError).message).toContain('blank')
  })

  it('rejects a key an HTTP header cannot hold', async () => {
    const failure = await discoverEndpoint({ baseURL: 'http://127.0.0.1:1', apiKey: 'bad key' }, config)
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(LlmError)
    expect((failure as LlmError).code).toBe(INVALID_CREDENTIAL_CODE)
    expect((failure as LlmError).message).toContain('cannot hold')
  })

  it('refuses to run with every engine disabled', async () => {
    const none = resolveDiscoveryConfig({ engines: { ollama: false, litellm: false, openaiModels: false } })
    await expect(discoverEndpoint({ baseURL: 'http://127.0.0.1:1' }, none))
      .rejects.toThrow('every discovery engine is disabled')
  })

  it('stops before probing when the caller already aborted', async () => {
    const server = await startProbeServer({ '/models': { body: JSON.stringify({ data: [{ id: 'm' }] }) } })
    try {
      const controller = new AbortController()
      controller.abort()
      await expect(discoverEndpoint({ baseURL: server.url, signal: controller.signal }, config))
        .rejects.toThrow('aborted by caller')
      expect(server.requests).toEqual([])
    } finally {
      await server.close()
    }
  })

  it('summarizes a ladder of pure misses with the engines tried', async () => {
    const server = await startProbeServer({})
    try {
      const noFloor = resolveDiscoveryConfig({ engines: { openaiModels: false } })
      await expect(discoverEndpoint({ baseURL: server.url }, noFloor))
        .rejects.toThrow('no discovery engine could read a model listing')
      await expect(discoverEndpoint({ baseURL: server.url }, noFloor))
        .rejects.toThrow('tried: ollama, litellm')
    } finally {
      await server.close()
    }
  })
})

describe('discoverEndpoint enrichment switch', () => {
  it('fills undisclosed fields from the bundled catalog by default', async () => {
    const server = await startProbeServer({
      '/models': { body: JSON.stringify({ data: [{ id: 'deepseek-v4-flash' }] }) },
    })
    try {
      await expect(discoverEndpoint({ baseURL: server.url }, config)).resolves.toEqual([
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: 1_000_000, maxTokens: 384_000 },
      ])
    } finally {
      await server.close()
    }
  })

  it('returns bare ids untouched when enrichment is disabled', async () => {
    const server = await startProbeServer({
      '/models': { body: JSON.stringify({ data: [{ id: 'deepseek-v4-flash' }] }) },
    })
    try {
      const bare = resolveDiscoveryConfig({ enrichment: false })
      await expect(discoverEndpoint({ baseURL: server.url }, bare)).resolves.toEqual([{ id: 'deepseek-v4-flash' }])
    } finally {
      await server.close()
    }
  })
})
