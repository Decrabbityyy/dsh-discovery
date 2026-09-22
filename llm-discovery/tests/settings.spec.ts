/**
 * 用户设置：命名空间注册、组成层与用户层的取值，以及改间隔后定时器重排（不用重启）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { DISCOVERY_SETTINGS_NS } from '../src/settings.ts'
import type { DiscoverySettingsSection } from '../src/settings.ts'
import * as discovery from '../src/index.ts'

/** 最小的真实 SettingsProvider：一份内存文档。 */
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

/** 目录抓取的替身：只回一份最小目录，不碰网络。 */
function stubCatalogFetch(): void {
  const body = { acme: { models: { 'acme-x': { name: 'Acme X', limit: { context: 4096, output: 1024 } } } } }
  vi.stubGlobal('fetch', () => Promise.resolve({
    status: 200,
    ok: true,
    json: () => Promise.resolve(body),
    headers: { get: () => null },
  }))
}

const MINUTES_1440_MS = 1440 * 60_000

let ctx: Context | undefined

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await ctx?.fiber.dispose()
  ctx = undefined
})

/** 装上 llm 与 settings 两个 seam，再装本插件。 */
async function boot(config?: discovery.Config): Promise<Context> {
  stubCatalogFetch()
  ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(MemorySettings)
  await ctx.plugin(discovery, config)
  return ctx
}

/** 排定时器的调用次数，按间隔区分（定时器可能被别的东西也用到）。 */
function timerCalls(spy: { mock: { calls: unknown[][] } }, delayMs: number): number {
  return spy.mock.calls.filter(call => call[1] === delayMs).length
}

describe('catalog refresh settings', () => {
  it('registers the namespace with the deployment value as its base', async () => {
    const booted = await boot({ catalogRefreshIntervalMinutes: 1440 })
    const section = booted.settings.get(DISCOVERY_SETTINGS_NS) as DiscoverySettingsSection | undefined
    expect(section?.catalogRefreshIntervalMinutes).toBe(1440)
  })

  it('reschedules the timer when the user changes the interval', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    const booted = await boot({ catalogRefreshIntervalMinutes: 1440 })
    expect(timerCalls(setIntervalSpy, MINUTES_1440_MS)).toBe(1)

    // 用户层改成一分钟：重排成 60 秒，并清掉原来那个。
    await booted.settings.mutate(DISCOVERY_SETTINGS_NS, [{
      op: 'set',
      path: ['catalogRefreshIntervalMinutes'],
      value: 1,
    }])
    await vi.waitFor(() => { expect(timerCalls(setIntervalSpy, 60_000)).toBe(1) })
    expect(clearIntervalSpy).toHaveBeenCalled()

    // 清掉用户层就回到组成层的一小时级值。
    await booted.settings.mutate(DISCOVERY_SETTINGS_NS, [{
      op: 'unset',
      path: ['catalogRefreshIntervalMinutes'],
    }])
    await vi.waitFor(() => { expect(timerCalls(setIntervalSpy, MINUTES_1440_MS)).toBe(2) })
  })

  it('leaves the timer off while the deployment value and the user layer are zero', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    await boot({ catalogRefreshIntervalMinutes: 0 })
    expect(setIntervalSpy).not.toHaveBeenCalled()
  })
})
