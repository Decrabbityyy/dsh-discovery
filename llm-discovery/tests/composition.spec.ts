/** Real-Loader composition coverage for `dsh-llm-discovery`: the plugin boots from a cordis.yml row, answers the `llm-discovery` namespace */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as discovery from '../src/index.ts'
import { DISCOVERY_NAMESPACE } from '../src/index.ts'
import { loaderEntryId } from '../src/loader-config.ts'
import { startProbeServer } from './support/server.ts'

let root: string | undefined
let context: Context | undefined

/** 排定时器的调用次数，按间隔区分（定时器可能被别的东西也用到）。 */
function timerCalls(spy: { mock: { calls: unknown[][] } }, delayMs: number): number {
  return spy.mock.calls.filter(call => call[1] === delayMs).length
}

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

  it('does not serve discovery when the config fails the schema', { timeout: 60_000 }, async () => {
    // 0.1.7 的 Loader 用 Promise.allSettled 等条目，schema 拒掉的配置不会再让 `await()`
    // 抛出来（条目照样起不来）。所以断言的是行为：这个 offer 没有注册上。
    const loaded = await loadYaml([
      "- name: '@deepseek-ai/dsh-llm'",
      "- name: 'dsh-llm-discovery'",
      '  config:',
      '    timeoutMs: 0',
    ])
    await expect(loaded.llm.discoverModels(DISCOVERY_NAMESPACE, { baseURL: 'http://127.0.0.1:1' }))
      .rejects.toMatchObject({ code: 'NO_DISCOVERY' })
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

  // 这一条走的是真实 Loader 的就地点更：entry.update 只换 volatile 那一格时，
  // Loader 把新值点进运行中 fiber 的引用，再派发 `loader/volatile-update`。
  it('follows a volatile-only config change the Loader commits', { timeout: 60_000 }, async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    try {
      const loaded = await loadYaml([
        "- name: '@deepseek-ai/dsh-llm'",
        '- id: renamed-discovery',
        "  name: 'dsh-llm-discovery'",
        '  config:',
        '    catalogRefreshIntervalMinutes: 1440',
      ])
      expect(timerCalls(setIntervalSpy, 1440 * 60_000)).toBe(1)

      const entry = [...loaded.loader.entries()].find(candidate => candidate.options.id === 'renamed-discovery')!
      // 写设置的目标是组合层给这条 entry 起的 id，不是插件名。
      expect(loaderEntryId(entry.fiber!.ctx, 'dsh-llm-discovery')).toBe('renamed-discovery')

      await entry.update({ config: { catalogRefreshIntervalMinutes: 1 } })
      await vi.waitFor(() => { expect(timerCalls(setIntervalSpy, 60_000)).toBe(1) })
    } finally {
      setIntervalSpy.mockRestore()
    }
  })
})
