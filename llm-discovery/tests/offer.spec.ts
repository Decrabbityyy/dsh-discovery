/**
 * 探测 offer 的冷启动：存储里已有目录、models.dev 不回话，第一次探测回复就带上目录补的名称与容量。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as discovery from '../src/index.ts'
import { DISCOVERY_NAMESPACE } from '../src/index.ts'
import { startProbeServer } from './support/server.ts'
import type { ProbeServer } from './support/server.ts'

/** 只提供已经存好的那条记录：没有刷新，也不会被写。 */
function storedCatalog(): { open(): Promise<unknown> } {
  const table = {
    get: () => ({ entries: { 'grok-4.6': { displayName: 'Grok 4.6', contextWindow: 1_000_000, maxTokens: 128_000 } } }),
    put: () => Promise.resolve(),
    entries: () => new Map().entries(),
  }
  return {
    open: () => Promise.resolve({
      name: 'llm_models_dev_catalog',
      global: { get: () => ({ fetchedAt: 7 }), set: () => Promise.resolve() },
      table: () => table,
      close: () => Promise.resolve(),
    }),
  }
}

let ctx: Context | undefined
let server: ProbeServer | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (server !== undefined) await server.close()
  server = undefined
  vi.unstubAllGlobals()
})

describe('discovery offer enrichment', () => {
  it('fills the reply from the stored catalog while the network hangs', async () => {
    const real = globalThis.fetch
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.startsWith('https://models.dev/')) return new Promise<Response>(() => {})
      return real(input, init)
    })

    server = await startProbeServer({ '/models': { body: JSON.stringify({ data: [{ id: 'xai/grok-4.6' }] }) } })
    ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.provide('storageDomain', storedCatalog())
    await ctx.plugin(discovery)

    await expect(ctx.llm.discoverModels(DISCOVERY_NAMESPACE, { baseURL: server.url })).resolves.toEqual([
      { id: 'xai/grok-4.6', name: 'Grok 4.6', contextWindow: 1_000_000, maxTokens: 128_000 },
    ])
  })
})
