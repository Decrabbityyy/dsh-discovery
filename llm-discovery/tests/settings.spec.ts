/**
 * 用户设置：刷新间隔是插件 Config 里标了 `.volatile()` 的那一格。Loader 就地点更
 * 引用，再在 owner fiber 上派发 `loader/volatile-update`，插件据此重排定时器。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as discovery from '../src/index.ts'
import { commitVolatile } from './volatile.ts'
import type { VolatileRef } from './volatile.ts'

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

/** 组合层写下来的那份配置：volatile 字段在这里是普通值，注册表按插件的 schema 解析成引用后才交给 `apply`。 */
type RawConfig = { catalogRefreshIntervalMinutes?: number }

async function boot(config?: RawConfig): Promise<Fiber> {
  stubCatalogFetch()
  const booted = new Context()
  await booted.plugin(LlmRuntime)
  const fiber = await booted.plugin(discovery, config as never).await()
  ctx = booted
  return fiber
}

/** 排定时器的调用次数，按间隔区分（定时器可能被别的东西也用到）。 */
function timerCalls(spy: { mock: { calls: unknown[][] } }, delayMs: number): number {
  return spy.mock.calls.filter(call => call[1] === delayMs).length
}

describe('catalog refresh interval from the Loader config', () => {
  it('takes the volatile field value, and follows a value the Loader commits', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    const fiber = await boot({ catalogRefreshIntervalMinutes: 1440 })
    const ref = (fiber.config as { catalogRefreshIntervalMinutes: VolatileRef<number> }).catalogRefreshIntervalMinutes
    expect(timerCalls(setIntervalSpy, MINUTES_1440_MS)).toBe(1)

    // Loader 的做法：把新值点进引用，再只对这个 fiber 派发。
    commitVolatile(ref, 1)
    fiber.ctx.emit('loader/volatile-update', [['catalogRefreshIntervalMinutes']])
    await vi.waitFor(() => { expect(timerCalls(setIntervalSpy, 60_000)).toBe(1) })
    expect(clearIntervalSpy).toHaveBeenCalled()
  })
})
