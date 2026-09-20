// @vitest-environment jsdom
/**
 * The 模型缓存 page of 设置 → 插件: the status it reads on mount, the refresh it
 * asks for, and what it shows when either call fails.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { ModelCacheTab } from '../src/client/ModelCacheTab.tsx'
import { DYNAMIC_CACHE_PATH } from '../src/client/discovery.ts'

afterEach(cleanup)
afterEach(() => {
  vi.unstubAllGlobals()
})

const STATUS = {
  routes: 2,
  modelsDev: { entries: 1891, refreshedAt: 1_789_900_000_000, source: 'models.dev' as const },
  cacheFile: { path: 'C:\\Users\\me\\.dsh\\llm-dynamic-provider-cache.json', writtenAt: 1_789_900_100_000, routes: 2 },
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
  screen.getByRole('button', { name: '刷新缓存' }) as HTMLButtonElement

describe('model cache tab', () => {
  it('reads the status on mount and offers the refresh', async () => {
    const fetchMock = scripted(() => ({ body: STATUS }))
    render(<ModelCacheTab />)
    await waitFor(() => { expect(screen.getByText(/1891 条 · .*刷新 · 来源 内存（本次启动从网络拉取）/)).toBeDefined() })
    expect(fetchMock.mock.calls[0]?.[0]).toBe(DYNAMIC_CACHE_PATH)
    expect(screen.getByText('2 条')).toBeDefined()
    expect(screen.getByText(/llm-dynamic-provider-cache\.json · 2 条路由 · 写入于/)).toBeDefined()
    expect(refreshButton().disabled).toBe(false)
  })

  it('names the stored catalog as the source where the facts came from it', async () => {
    scripted(() => ({ body: { routes: 1, modelsDev: { entries: 42, refreshedAt: 1_789_900_000_000, source: 'storage' } } }))
    render(<ModelCacheTab />)
    await waitFor(() => {
      expect(screen.getByText(/42 条 · .*刷新 · 来源 本地存储域（按 ETag 增量刷新）/)).toBeDefined()
    })
    expect(screen.queryByText(/没有落在本地存储域/)).toBeNull()
  })

  it('reports a memory-only load and why the stored catalog was not used', async () => {
    scripted(() => ({
      body: {
        routes: 1,
        modelsDev: {
          entries: 42,
          refreshedAt: 1_789_900_000_000,
          source: 'models.dev',
          storageError: 'Cannot find package \'@deepseek-ai/dsh-storage\'',
        },
      },
    }))
    render(<ModelCacheTab />)
    await waitFor(() => { expect(screen.getByText(/来源 内存（本次启动从网络拉取）/)).toBeDefined() })
    expect(screen.getByText(/没有落在本地存储域：Cannot find package/)).toBeDefined()
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
    render(<ModelCacheTab />)
    await waitFor(() => { expect(screen.getByText(/1891 条/)).toBeDefined() })

    fireEvent.click(refreshButton())
    await waitFor(() => { expect(screen.getByText('已刷新 2 条路由。')).toBeDefined() })
    expect(screen.getByText('12 个模型')).toBeDefined()
    expect(screen.getByText('connect ECONNREFUSED')).toBeDefined()
  })

  it('reports a refused refresh without losing the status it had', async () => {
    scripted(init => init?.method === 'POST'
      ? { status: 405, body: { error: 'method not allowed' } }
      : { body: STATUS })
    render(<ModelCacheTab />)
    await waitFor(() => { expect(screen.getByText(/1891 条/)).toBeDefined() })

    fireEvent.click(refreshButton())
    await waitFor(() => { expect(screen.getByText('method not allowed')).toBeDefined() })
    expect(screen.getByText(/1891 条/)).toBeDefined()
    expect(screen.queryByText(/已刷新/)).toBeNull()
  })

  it('reports a status it could not read and still offers the refresh', async () => {
    scripted(() => ({ status: 500 }))
    render(<ModelCacheTab />)
    await waitFor(() => { expect(screen.getByText('HTTP 500')).toBeDefined() })
    expect(refreshButton().disabled).toBe(false)
  })

  it('explains a 404 as the plugin not being composed here', async () => {
    scripted(() => ({ status: 404 }))
    render(<ModelCacheTab />)
    await waitFor(() => {
      expect(screen.getByText('未安装 dsh-llm-dynamic-provider，本页没有可显示的缓存')).toBeDefined()
    })
  })

  it('reports a deployment without a cache file, a failed facts load, and no routes', async () => {
    scripted(init => init?.method === 'POST'
      ? { body: { routes: 0, modelsDev: { entries: 0, refreshedAt: null, error: 'offline' }, probes: [] } }
      : { body: { routes: 0, modelsDev: { entries: 0, refreshedAt: null, error: 'offline' } } })
    render(<ModelCacheTab />)
    await waitFor(() => { expect(screen.getByText(/上次读取目录失败：offline/)).toBeDefined() })
    expect(screen.getByText('未启用：组合没有开启 cache，每次启动都重新探测')).toBeDefined()

    fireEvent.click(refreshButton())
    await waitFor(() => { expect(screen.getByText('没有声明任何路由。')).toBeDefined() })
  })
})
