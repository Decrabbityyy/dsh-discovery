/** Real-Loader composition coverage for `dsh-llm-discovery`: the plugin boots from a cordis.yml row, answers the `llm-discovery` namespace */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as discovery from '../src/index.ts'
import { DISCOVERY_NAMESPACE } from '../src/index.ts'
import { startProbeServer } from './support/server.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadYaml(lines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-llm-discovery-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [...lines, ''].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['dsh-llm-discovery', discovery],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('real Loader composition', () => {
  // Real-Loader composition resolves workspace packages through tsx at test
  // time; cold caches can trip the default 5s budget.
  it('boots from a cordis.yml row and answers the discovery namespace', { timeout: 60_000 }, async () => {
    const server = await startProbeServer({
      '/models': { body: JSON.stringify({ data: [{ id: 'deepseek-v4-flash' }, { id: 'acme-local' }] }) },
    })
    try {
      const loaded = await loadYaml([
        "- name: '@deepseek-ai/dsh-llm'",
        "- name: 'dsh-llm-discovery'",
        '  config:',
        '    timeoutMs: 5000',
      ])
      const unloaded = [...loaded.loader.entries()]
        .filter(entry => entry.fiber === undefined && !entry.disabled)
        .map(entry => entry.options.name)
      expect(unloaded).toEqual([])
      await expect(loaded.llm.discoverModels(DISCOVERY_NAMESPACE, { baseURL: server.url })).resolves.toEqual([
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: 1_000_000, maxTokens: 384_000 },
        { id: 'acme-local' },
      ])
    } finally {
      await server.close()
    }
  })

  it('fails to load a config the schema rejects', { timeout: 60_000 }, async () => {
    await expect(loadYaml([
      "- name: '@deepseek-ai/dsh-llm'",
      "- name: 'dsh-llm-discovery'",
      '  config:',
      '    timeoutMs: 0',
    ])).rejects.toThrow()
  })

  it('withdraws the discovery offer when the plugin fiber is disposed (HMR safety)', { timeout: 60_000 }, async () => {
    const server = await startProbeServer({
      '/models': { body: JSON.stringify({ data: [{ id: 'm' }] }) },
    })
    try {
      const ctx = new Context()
      await ctx.plugin(LlmRuntime)
      const fiber = await ctx.plugin(discovery)
      await expect(ctx.llm.discoverModels(DISCOVERY_NAMESPACE, { baseURL: server.url })).resolves.toEqual([{ id: 'm' }])
      await fiber.dispose()
      await expect(ctx.llm.discoverModels(DISCOVERY_NAMESPACE, { baseURL: server.url }))
        .rejects.toMatchObject({ code: 'NO_DISCOVERY' })
      await ctx.fiber.dispose()
    } finally {
      await server.close()
    }
  })
})
