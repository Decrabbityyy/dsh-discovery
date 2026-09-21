// @vitest-environment jsdom
/**
 * 设置 → 插件 → 模型目录页：目录与路由两个来源，以及刷新按钮要的结果。
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { UI_CATALOG_STATUS_PATH } from 'dsh-llm-discovery/vocabulary'
import { ModelCatalogTab } from '../src/client/ModelCatalogTab.tsx'
import { DYNAMIC_PROBE_PATH } from '../src/client/discovery.ts'

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
})
