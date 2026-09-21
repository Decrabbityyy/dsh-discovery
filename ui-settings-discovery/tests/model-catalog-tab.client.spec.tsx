// @vitest-environment jsdom
/**
 * 设置 → 插件 → 模型目录页：挂载时读到的状态、刷新按钮要的结果，以及两种失败怎么显示。
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { ModelCatalogTab } from '../src/client/ModelCatalogTab.tsx'
import { DYNAMIC_PROBE_PATH } from '../src/client/discovery.ts'

afterEach(cleanup)
afterEach(() => {
  vi.unstubAllGlobals()
})

const STATUS = {
  routes: 2,
  modelsDev: { entries: 1891, refreshedAt: 1_789_900_000_000, source: 'models.dev' as const },
}

/** Answer one URL with one JSON body and status. */
function scripted(reply: (init?: RequestInit) => { status?: number; body?: unknown }): Mock {
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    const { status = 200, body = {} } = reply(init)
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const refreshButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: '刷新目录与路由' }) as HTMLButtonElement

describe('model catalog tab', () => {
  it('reads the status on mount and offers the refresh', async () => {
    const fetchMock = scripted(() => ({ body: STATUS }))
    render(<ModelCatalogTab />)
    await waitFor(() => { expect(screen.getByText(/1891 条 · .*刷新 · 来源 本次启动联网获取/)).toBeDefined() })
    expect(fetchMock.mock.calls[0]?.[0]).toBe(DYNAMIC_PROBE_PATH)
    expect(screen.getByText('2 条')).toBeDefined()
    expect(refreshButton().disabled).toBe(false)
  })

  it('names the local cache as the source where the facts came from it', async () => {
    scripted(() => ({ body: { routes: 1, modelsDev: { entries: 42, refreshedAt: 1_789_900_000_000, source: 'storage' } } }))
    render(<ModelCatalogTab />)
    await waitFor(() => {
      expect(screen.getByText(/42 条 · .*刷新 · 来源 本地缓存/)).toBeDefined()
    })
  })

  it('asks for a refresh and reports every route it probed', async () => {
    scripted(init => init?.method === 'POST'
      ? {
          body: {
            ...STATUS,
            probes: [
              { route: 'upstream', models: 12 },
              { route: 'broken', error: 'connect ECONNREFUSED' },
            ],
          },
        }
      : { body: STATUS })
    render(<ModelCatalogTab />)
    await waitFor(() => { expect(screen.getByText(/1891 条/)).toBeDefined() })

    fireEvent.click(refreshButton())
    await waitFor(() => { expect(screen.getByText('已重新探测 2 条路由。')).toBeDefined() })
    expect(screen.getByText('12 个模型')).toBeDefined()
    expect(screen.getByText('connect ECONNREFUSED')).toBeDefined()
  })

  it('reports a refused refresh without losing the status it had', async () => {
    scripted(init => init?.method === 'POST'
      ? { status: 405, body: { error: 'method not allowed' } }
      : { body: STATUS })
    render(<ModelCatalogTab />)
    await waitFor(() => { expect(screen.getByText(/1891 条/)).toBeDefined() })

    fireEvent.click(refreshButton())
    await waitFor(() => { expect(screen.getByText('method not allowed')).toBeDefined() })
    expect(screen.getByText(/1891 条/)).toBeDefined()
    expect(screen.queryByText(/已重新探测/)).toBeNull()
  })

  it('reports a status it could not read and still offers the refresh', async () => {
    scripted(() => ({ status: 500 }))
    render(<ModelCatalogTab />)
    await waitFor(() => { expect(screen.getByText('HTTP 500')).toBeDefined() })
    expect(refreshButton().disabled).toBe(false)
  })

  it('explains a 404 as the plugin not being composed here', async () => {
    scripted(() => ({ status: 404 }))
    render(<ModelCatalogTab />)
    await waitFor(() => {
      expect(screen.getByText('未安装 dsh-llm-dynamic-provider')).toBeDefined()
    })
  })

  it('reports a failed facts load and no declared routes', async () => {
    scripted(init => init?.method === 'POST'
      ? { body: { routes: 0, modelsDev: { entries: 0, refreshedAt: null, error: 'offline' }, probes: [] } }
      : { body: { routes: 0, modelsDev: { entries: 0, refreshedAt: null, error: 'offline' } } })
    render(<ModelCatalogTab />)
    await waitFor(() => { expect(screen.getByText(/上次读取目录失败：offline/)).toBeDefined() })
    expect(screen.getByText('0 条')).toBeDefined()

    fireEvent.click(refreshButton())
    await waitFor(() => { expect(screen.getByText('没有声明任何路由。')).toBeDefined() })
  })
})
