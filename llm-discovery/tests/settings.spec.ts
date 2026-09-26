/**
 * 用户设置：两条宿主线上的取值，以及改完间隔后定时器重排（不用重启）。
 *
 * - 0.1.7：设置就是插件 Config 里标了 `.volatile()` 的字段，Loader 就地点更引用，
 *   再在 owner fiber 上派发 `loader/volatile-update`；
 * - 0.1.5：设置是插件自己注册的 settings 命名空间（这里是 `MemorySettings` 替身，
 *   按本仓库用到的那几个成员实现）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { DISCOVERY_SETTINGS_NS } from '../src/settings.ts'
import * as discovery from '../src/index.ts'
import { commitVolatile } from './volatile.ts'
import type { VolatileRef } from './volatile.ts'

type Ops = readonly { op: 'set' | 'unset'; path: readonly string[]; value?: unknown }[]

/**
 * 0.1.5 settings 面的替身：只实现本仓库用到的那几个成员——按命名空间注册、读生效值
 * （组成层 ∪ 用户层）、按路径改用户层并提交 `settings/updated`。
 */
function legacySettingsStub(ctx: Context): unknown {
  const doc: Record<string, Record<string, unknown>> = {}
  const bases = new Map<string, Record<string, unknown>>()
  const read = (ns: string): unknown => {
    const base = bases.get(ns)
    if (base === undefined) return undefined
    return { ...base, ...doc[ns] }
  }
  return {
    register(ns: string, _schema: unknown, options?: { base?: Record<string, unknown> }): unknown {
      bases.set(ns, structuredClone(options?.base ?? {}))
      return { get: () => read(ns) }
    },
    get: read,
    mutate(ns: string, ops: Ops): Promise<void> {
      const section = { ...doc[ns] }
      for (const op of ops) {
        if (op.op === 'set') section[op.path[0]!] = op.value
        else delete section[op.path[0]!]
      }
      doc[ns] = section
      // 0.1.7 的 d.ts 里没有这个事件（那条线上改设置走 Loader），事件名只是字符串。
      ;(ctx.emit as unknown as (name: string, ns: string) => void)('settings/updated', ns)
      return Promise.resolve()
    },
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

/** 装上 llm seam；`settings` 装上就是 0.1.5 那条线，不装就是 0.1.7 的。 */
async function boot(config?: discovery.Config, legacySettings = false): Promise<{ ctx: Context; fiber: Fiber }> {
  stubCatalogFetch()
  const booted = new Context()
  await booted.plugin(LlmRuntime)
  if (legacySettings) booted.provide('settings', legacySettingsStub(booted) as never)
  const fiber = await booted.plugin(discovery, config).await()
  ctx = booted
  return { ctx: booted, fiber }
}

/** 排定时器的调用次数，按间隔区分（定时器可能被别的东西也用到）。 */
function timerCalls(spy: { mock: { calls: unknown[][] } }, delayMs: number): number {
  return spy.mock.calls.filter(call => call[1] === delayMs).length
}

describe('catalog refresh interval from the Loader config (0.1.7)', () => {
  it('takes the volatile field value, and follows a value the Loader commits', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    const { fiber } = await boot({ catalogRefreshIntervalMinutes: 1440 })
    const ref = (fiber.config as { catalogRefreshIntervalMinutes: VolatileRef<number> }).catalogRefreshIntervalMinutes
    expect(timerCalls(setIntervalSpy, MINUTES_1440_MS)).toBe(1)

    // Loader 的做法：把新值点进引用，再只对这个 fiber 派发。
    commitVolatile(ref, 1)
    fiber.ctx.emit('loader/volatile-update', [['catalogRefreshIntervalMinutes']])
    await vi.waitFor(() => { expect(timerCalls(setIntervalSpy, 60_000)).toBe(1) })
    expect(clearIntervalSpy).toHaveBeenCalled()
  })
})

describe('catalog refresh interval from the settings namespace (0.1.5)', () => {
  it('registers the namespace with the deployment value as its base, and follows the user layer', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    const { ctx: booted } = await boot({ catalogRefreshIntervalMinutes: 1440 }, true)
    await vi.waitFor(() => { expect(timerCalls(setIntervalSpy, MINUTES_1440_MS)).toBe(1) })

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
})
