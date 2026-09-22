// @vitest-environment jsdom
/** 设置 → 插件 → 模型目录页：目录与路由两个来源，以及刷新按钮要的结果。 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { UI_CATALOG_STATUS_PATH } from 'dsh-llm-discovery/vocabulary'
import { ModelCatalogTab } from '../src/client/ModelCatalogTab.tsx'
import { DYNAMIC_PROBE_PATH } from '../src/client/discovery.ts'
import type { DiscoverySettingsSection } from '../src/client/discovery.ts'

afterEach(cleanup)
afterEach(() => {
  vi.unstubAllGlobals()
})

const CATALOG = { entries: 1891, refreshedAt: 1_789_900_000_000, source: 'models.dev' as const }

/** 按 URL 回放两个端点。 */
function scripted(reply: (url: string, init?: RequestInit) => { status?: number; body?: unknown }): Mock {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const { status = 200, body = {} } = reply(url, init)
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** 默认：目录状态来自 catalog，声明路由来自 probe。 */
function both(status: { catalog?: unknown; routes?: unknown } = {}): Mock {
  return scripted((url) => {
    if (url === UI_CATALOG_STATUS_PATH) return { body: status.catalog ?? CATALOG }
    if (url === DYNAMIC_PROBE_PATH) return { body: status.routes ?? { routes: 2 } }
    return { status: 404 }
  })
}

const refreshButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: '刷新目录与路由' }) as HTMLButtonElement

describe('model catalog tab', () => {
  it('reads the catalog and the declared routes on mount', async () => {
    const fetchMock = both()
    render(<ModelCatalogTab />)
    await waitFor(() => { expect(screen.getByText(/1891 条 · .*刷新 · 来源 本次启动联网获取/)).toBeDefined() })
    expect(screen.getByText('2 条')).toBeDefined()
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([UI_CATALOG_STATUS_PATH, DYNAMIC_PROBE_PATH])
    expect(refreshButton().disabled).toBe(false)
  })

  it('names the local cache as the source where the facts came from it', async () => {
    both({ catalog: { ...CATALOG, entries: 42, source: 'storage' } })
    render(<ModelCatalogTab />)
    await waitFor(() => { expect(screen.getByText(/42 条 · .*刷新 · 来源 本地缓存/)).toBeDefined() })
  })

  it('refreshes both sources and reports every route it probed', async () => {
    scripted((url, init) => {
      if (init?.method !== 'POST') return { body: url === UI_CATALOG_STATUS_PATH ? CATALOG : { routes: 2 } }
      if (url === UI_CATALOG_STATUS_PATH) return { body: CATALOG }
      return {
        body: {
          routes: 2,
          probes: [
            { route: 'upstream', models: 12 },
            { route: 'broken', error: 'connect ECONNREFUSED' },
          ],
        },
      }
    })
    render(<ModelCatalogTab />)
    await waitFor(() => { expect(screen.getByText(/1891 条/)).toBeDefined() })

    fireEvent.click(refreshButton())
    await waitFor(() => { expect(screen.getByText('已重新探测 2 条路由。')).toBeDefined() })
    expect(screen.getByText('12 个模型')).toBeDefined()
    expect(screen.getByText('connect ECONNREFUSED')).toBeDefined()
  })

  it('keeps the catalog row when the dynamic plugin is not composed here', async () => {
    scripted((url) => (url === UI_CATALOG_STATUS_PATH ? { body: CATALOG } : { status: 404 }))
    render(<ModelCatalogTab />)
    await waitFor(() => { expect(screen.getByText('未安装 dsh-llm-dynamic-provider')).toBeDefined() })
    expect(screen.getByText(/1891 条/)).toBeDefined()
  })

  it('reports a refused catalog refresh without losing the status it had', async () => {
    scripted((url, init) => {
      if (init?.method === 'POST' && url === UI_CATALOG_STATUS_PATH) return { status: 405 }
      return { body: url === UI_CATALOG_STATUS_PATH ? CATALOG : { routes: 2 } }
    })
    render(<ModelCatalogTab />)
    await waitFor(() => { expect(screen.getByText(/1891 条/)).toBeDefined() })

    fireEvent.click(refreshButton())
    await waitFor(() => { expect(screen.getByText('HTTP 405')).toBeDefined() })
    expect(screen.getByText(/1891 条/)).toBeDefined()
  })

  it('reports a failed catalog load and no declared routes', async () => {
    scripted((url, init) => {
      if (url === DYNAMIC_PROBE_PATH) {
        return { body: init?.method === 'POST' ? { routes: 0, probes: [] } : { routes: 0 } }
      }
      return { body: { entries: 0, refreshedAt: null, error: 'offline' } }
    })
    render(<ModelCatalogTab />)
    await waitFor(() => { expect(screen.getByText(/上次读取目录失败：offline/)).toBeDefined() })
    expect(screen.getByText('0 条')).toBeDefined()

    fireEvent.click(refreshButton())
    await waitFor(() => { expect(screen.getByText('没有声明任何路由。')).toBeDefined() })
  })

  it('re-reads only after the host says its next refresh is due', async () => {
    vi.useFakeTimers()
    try {
      let entries = 10
      const fetchMock = scripted((url) => (url === UI_CATALOG_STATUS_PATH
        ? {
            body: {
              entries,
              refreshedAt: Date.now(),
              source: 'storage',
              refreshIntervalMs: 60_000,
              nextRefreshAt: Date.now() + 60_000,
            },
          }
        : { body: { routes: 1 } }))
      render(<ModelCatalogTab />)
      await act(async () => { await Promise.resolve() })
      expect(screen.getByText(/10 条/)).toBeDefined()
      expect(fetchMock.mock.calls).toHaveLength(2)

      // 离宿主说的下一次刷新还早：页面不打扰它。
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
      expect(fetchMock.mock.calls).toHaveLength(2)

      // 到点之后宿主已经刷过一次，页面跟着读一次就看到了。
      entries = 20
      await act(async () => { await vi.advanceTimersByTimeAsync(33_000) })
      expect(screen.getByText(/20 条/)).toBeDefined()
      expect(fetchMock.mock.calls).toHaveLength(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves a mount-only catalog alone', async () => {
    const fetchMock = both()
    render(<ModelCatalogTab />)
    await waitFor(() => { expect(screen.getByText(/1891 条/)).toBeDefined() })

    // 默认配置没有定时器（回答里没有 nextRefreshAt）：挂载读过一次就再也不问了。
    vi.useFakeTimers()
    try {
      await vi.advanceTimersByTimeAsync(10 * 60_000)
      expect(fetchMock.mock.calls).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops asking once the page is gone', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = scripted((url) => (url === UI_CATALOG_STATUS_PATH
        ? { body: { entries: 10, refreshedAt: Date.now(), source: 'storage', nextRefreshAt: Date.now() + 60_000 } }
        : { body: { routes: 1 } }))
      const { unmount } = render(<ModelCatalogTab />)
      await act(async () => { await Promise.resolve() })
      expect(fetchMock.mock.calls).toHaveLength(2)

      unmount()
      await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000) })
      expect(fetchMock.mock.calls).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

/** 一张内存 scope：写入会更新快照并通知订阅者，和真实 scope 的可观察行为一致。 */
function fakeScope(options: { minutes?: number; overridden?: boolean; writable?: boolean } = {}): {
  scope: SettingsScope<DiscoverySettingsSection>
  sets: { field: string; value: unknown }[]
  unsets: string[]
  failWith?: string
} {
  const listeners = new Set<() => void>()
  const fake = { sets: [], unsets: [] } as unknown as {
    scope: SettingsScope<DiscoverySettingsSection>
    sets: { field: string; value: unknown }[]
    unsets: string[]
    failWith?: string
  }
  let snapshot: SettingsScopeSnapshot<DiscoverySettingsSection> = {
    status: 'ready',
    value: options.minutes === undefined ? {} : { catalogRefreshIntervalMinutes: options.minutes },
    base: { catalogRefreshIntervalMinutes: 0 },
    user: options.overridden === true ? { catalogRefreshIntervalMinutes: options.minutes ?? 0 } : {},
    revision: 1,
    writable: options.writable ?? true,
    mode: 'host',
  }
  const publish = (next: SettingsScopeSnapshot<DiscoverySettingsSection>): void => {
    snapshot = next
    for (const listener of listeners) listener()
  }
  fake.scope = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    mutate: () => Promise.resolve(),
    set: (field, value) => {
      if (fake.failWith !== undefined) return Promise.reject(new Error(fake.failWith))
      fake.sets.push({ field, value })
      publish({ ...snapshot, value: { [field]: value as number }, user: { [field]: value } })
      return Promise.resolve()
    },
    unset: (field) => {
      if (fake.failWith !== undefined) return Promise.reject(new Error(fake.failWith))
      fake.unsets.push(field)
      publish({ ...snapshot, value: {}, user: {} })
      return Promise.resolve()
    },
  }
  return fake
}

const intervalInput = (): HTMLInputElement =>
  screen.getByLabelText('目录自动刷新间隔（分钟）') as HTMLInputElement
const saveInterval = (): HTMLButtonElement =>
  screen.getByRole('button', { name: '保存刷新间隔' }) as HTMLButtonElement
const resetInterval = (): HTMLButtonElement =>
  screen.getByRole('button', { name: '恢复部署配置' }) as HTMLButtonElement

describe('catalog refresh interval on the page', () => {
  it('shows the effective value and saves only a change', async () => {
    both()
    const fake = fakeScope({ minutes: 60 })
    render(<ModelCatalogTab scope={fake.scope} />)
    await waitFor(() => { expect(screen.getByText(/当前生效：每 60 分钟。/)).toBeDefined() })
    expect(intervalInput().value).toBe('60')
    expect(saveInterval().disabled).toBe(true)

    fireEvent.change(intervalInput(), { target: { value: '120' } })
    expect(saveInterval().disabled).toBe(false)
    fireEvent.click(saveInterval())
    await waitFor(() => { expect(screen.getByText('已保存，立即生效。')).toBeDefined() })
    expect(fake.sets).toEqual([{ field: 'catalogRefreshIntervalMinutes', value: 120 }])
  })

  it('clears the user layer when the field is emptied', async () => {
    both()
    const fake = fakeScope({ minutes: 60, overridden: true })
    render(<ModelCatalogTab scope={fake.scope} />)
    fireEvent.change(intervalInput(), { target: { value: '' } })
    fireEvent.click(saveInterval())

    await waitFor(() => { expect(fake.unsets).toEqual(['catalogRefreshIntervalMinutes']) })
    expect(fake.sets).toEqual([])
  })

  it('restores the deployment value with the reset button', async () => {
    both()
    const fake = fakeScope({ minutes: 60, overridden: true })
    render(<ModelCatalogTab scope={fake.scope} />)
    await waitFor(() => { expect(resetInterval().disabled).toBe(false) })
    fireEvent.click(resetInterval())

    await waitFor(() => { expect(fake.unsets).toEqual(['catalogRefreshIntervalMinutes']) })
  })

  it('refuses a draft that is not a whole number of minutes', () => {
    both()
    const fake = fakeScope({ minutes: 60 })
    render(<ModelCatalogTab scope={fake.scope} />)
    fireEvent.change(intervalInput(), { target: { value: '1.5' } })
    expect(screen.getByText('请填 0 或正整数分钟数。')).toBeDefined()
    expect(saveInterval().disabled).toBe(true)
    expect(fake.sets).toEqual([])
  })

  it('reports a refused write and keeps the draft', async () => {
    both()
    const fake = fakeScope({ minutes: 60 })
    fake.failWith = 'settings namespace "llm-discovery" changed since it was read'
    render(<ModelCatalogTab scope={fake.scope} />)
    fireEvent.change(intervalInput(), { target: { value: '120' } })
    fireEvent.click(saveInterval())

    await waitFor(() => { expect(screen.getByText(/changed since it was read/)).toBeDefined() })
    expect(intervalInput().value).toBe('120')
  })

  it('leaves the interval controls out when no scope is injected', async () => {
    both()
    render(<ModelCatalogTab />)
    await waitFor(() => { expect(screen.getByText(/1891 条/)).toBeDefined() })
    expect(screen.queryByLabelText('目录自动刷新间隔（分钟）')).toBeNull()
  })

  it('re-reads the status right after the interval is saved', async () => {
    const fetchMock = both()
    const fake = fakeScope({ minutes: 60 })
    render(<ModelCatalogTab scope={fake.scope} />)
    await waitFor(() => { expect(fetchMock.mock.calls).toHaveLength(2) })

    // 宿主刚换了定时器，页面手上的下一次刷新时刻已经过期：保存后立刻重读一次。
    fireEvent.change(intervalInput(), { target: { value: '120' } })
    fireEvent.click(saveInterval())
    await waitFor(() => { expect(fetchMock.mock.calls).toHaveLength(4) })
  })
})
