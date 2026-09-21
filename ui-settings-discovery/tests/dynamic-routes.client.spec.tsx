// @vitest-environment jsdom
/** 模型页合并后的面板：「动态路由」区域只在动态插件于宿主 Loader 清单里 active 时渲染。 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { DiscoveryApi, DiscoveryResponse } from '../src/client/discovery.ts'
import { DiscoverySection } from '../src/client/DiscoverySection.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** Stub the plugin's routes endpoint with an in-memory store; returns the store and the recorded writes. */
function stubRoutesEndpoint(initial: Record<string, unknown> = {}): { store: Record<string, unknown>; writes: { op: string; routeId: string; route?: unknown }[] } {
  const store: Record<string, unknown> = { ...initial }
  const writes: { op: string; routeId: string; route?: unknown }[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = typeof input === 'string' ? input : (input as { url: string }).url
    if (!url.includes('/llm-dynamic-provider/routes')) {
      return { ok: false, status: 404, json: () => Promise.resolve({}) } as Response
    }
    if ((init?.method ?? 'GET') === 'GET') {
      return { ok: true, status: 200, json: () => Promise.resolve({ routes: { ...store } }) } as Response
    }
    const body = JSON.parse(init?.body ?? '{}') as { op: 'set' | 'unset'; routeId: string; route?: unknown }
    writes.push(body)
    if (body.op === 'set') store[body.routeId] = body.route
    else delete store[body.routeId]
    return { ok: true, status: 200, json: () => Promise.resolve({ routes: { ...store } }) } as Response
  }))
  return { store, writes }
}

function ok(value: unknown): DiscoveryResponse<unknown> {
  return { ok: true, value } as DiscoveryResponse<unknown>
}

/** A describe answer whose namespaces list is the given set of ns strings. */
function describeWith(namespaces: readonly { ns: string; routes?: Record<string, unknown> }[]): Mock {
  return vi.fn(() => Promise.resolve(ok({
    namespaces: namespaces.map(entry => ({
      ns: entry.ns,
      value: entry.routes === undefined ? {} : { routes: entry.routes },
      revision: 1,
    })),
  })))
}

function faceWith(overrides: {
  describe?: Mock
  mutate?: Mock
  set?: Mock
  providers?: Mock
  discover?: Mock
  pluginInventory?: Mock
  dynamicLoaded?: boolean
}): {
  api: DiscoveryApi
  describe: Mock
  mutate: Mock
  set: Mock
} {
  const describe = overrides.describe ?? describeWith([{ ns: 'llm-pi-ai' }])
  const mutate = overrides.mutate ?? vi.fn(() => Promise.resolve(ok({ ns: 'llm-dynamic-provider', revision: 2 })))
  const set = overrides.set ?? vi.fn(() => Promise.resolve(ok({})))
  const providers = overrides.providers ?? vi.fn(() => Promise.resolve(ok([])))
  const discover = overrides.discover ?? vi.fn(() => Promise.resolve(ok([])))
  const dynamicLoaded = overrides.dynamicLoaded !== false
  const pluginInventory = overrides.pluginInventory ?? vi.fn(() => Promise.resolve(ok({
    entries: [
      { entryId: 'llm-discovery', moduleName: 'dsh-llm-discovery', enabled: true, fiberPhase: 'active' },
      ...(dynamicLoaded
        ? [{ entryId: 'llm-dynamic-provider', moduleName: 'dsh-llm-dynamic-provider', enabled: true, fiberPhase: 'active' }]
        : []),
    ],
  })))
  const api = {
    llm: { discoverModels: discover, listConfigurableProviders: providers },
    pluginInventory: { list: pluginInventory },
    settings: { describe, mutate },
    credentials: { set },
  } as DiscoveryApi
  return { api, describe, mutate, set }
}

/** 渲染出来的「动态路由」区域，查询范围限定在里面，免得和发现区的字段撞名。 */
function dynamicBlock(): HTMLElement {
  return screen.getByLabelText('动态路由')
}

describe('merged Models panel gating', () => {
  it('hides the dynamic-routes block when inventory has no active dynamic plugin', async () => {
    const { api } = faceWith({ dynamicLoaded: false })
    render(<DiscoverySection api={api} />)
    await waitFor(() => { expect(screen.getByText('模型发现')).toBeTruthy() })
    await waitFor(() => { expect(screen.queryByText('动态路由')).toBeNull() })
  })

  it('shows the dynamic-routes block when inventory reports an active plugin', async () => {
    const { api } = faceWith({
      describe: describeWith([{ ns: 'llm-pi-ai' }, { ns: 'llm-dynamic-provider', routes: {} }]),
    })
    render(<DiscoverySection api={api} />)
    await waitFor(() => { expect(screen.getByText('动态路由')).toBeTruthy() })
    expect(screen.getByText('尚无动态路由。')).toBeTruthy()
  })
})

describe('dynamic-routes management', () => {
  const existing = {
    routes: {
      upstream: { baseURL: 'http://gw.internal/v1', api: 'openai-completions', displayName: 'Upstream' },
    },
  }

  it('lists declared routes from the namespace', async () => {
    stubRoutesEndpoint(existing.routes)
    const { api } = faceWith({
      describe: describeWith([{ ns: 'llm-pi-ai' }, { ns: 'llm-dynamic-provider', ...existing }]),
    })
    render(<DiscoverySection api={api} />)
    await waitFor(() => { expect(screen.getByText('upstream')).toBeTruthy() })
    expect(screen.getByText('http://gw.internal/v1')).toBeTruthy()
    expect(screen.getByText('Upstream')).toBeTruthy()
  })

  it('adds a route through a set write to the routes endpoint', async () => {
    const { writes } = stubRoutesEndpoint()
    const { api } = faceWith({
      describe: describeWith([{ ns: 'llm-pi-ai' }, { ns: 'llm-dynamic-provider', routes: {} }]),
    })
    render(<DiscoverySection api={api} />)
    await waitFor(() => { expect(screen.getByText('动态路由')).toBeTruthy() })
    const block = dynamicBlock()

    fireEvent.change(within(block).getByLabelText('路由 ID'), { target: { value: 'newroute' } })
    fireEvent.change(within(block).getByLabelText('端点地址'), { target: { value: 'http://x.internal/v1' } })
    fireEvent.click(within(block).getByRole('button', { name: '添加路由' }))
    await waitFor(() => {
      expect(writes).toEqual([expect.objectContaining({
        op: 'set',
        routeId: 'newroute',
        route: expect.objectContaining({ baseURL: 'http://x.internal/v1' }),
      })])
    })
  })

  it('removes a route through an unset write', async () => {
    const { writes } = stubRoutesEndpoint(existing.routes)
    const { api } = faceWith({
      describe: describeWith([{ ns: 'llm-pi-ai' }, { ns: 'llm-dynamic-provider', ...existing }]),
    })
    render(<DiscoverySection api={api} />)
    await waitFor(() => { expect(screen.getByText('upstream')).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => {
      expect(writes).toEqual([expect.objectContaining({ op: 'unset', routeId: 'upstream' })])
    })
  })

  it('stores a typed key first and records apiKeyEnv on save', async () => {
    const { writes } = stubRoutesEndpoint()
    const set = vi.fn(() => Promise.resolve(ok({})))
    const { api } = faceWith({
      describe: describeWith([{ ns: 'llm-pi-ai' }, { ns: 'llm-dynamic-provider', routes: {} }]),
      set,
    })
    render(<DiscoverySection api={api} />)
    await waitFor(() => { expect(screen.getByText('动态路由')).toBeTruthy() })
    const block = dynamicBlock()

    fireEvent.change(within(block).getByLabelText('路由 ID'), { target: { value: 'secure' } })
    fireEvent.change(within(block).getByLabelText('端点地址'), { target: { value: 'http://s.internal/v1' } })
    fireEvent.change(within(block).getByLabelText('API 密钥（可选）'), { target: { value: 'sk-live' } })
    fireEvent.click(within(block).getByRole('button', { name: '添加路由' }))
    await waitFor(() => {
      expect(set).toHaveBeenCalledWith('SECURE_API_KEY', 'sk-live')
    })
    await waitFor(() => {
      expect(writes).toEqual([expect.objectContaining({
        op: 'set',
        routeId: 'secure',
        route: expect.objectContaining({ apiKeyEnv: 'SECURE_API_KEY' }),
      })])
    })
  })

  it('refuses a key the derived reference cannot name', async () => {
    const { writes } = stubRoutesEndpoint()
    const set = vi.fn(() => Promise.resolve(ok({})))
    const { api } = faceWith({
      describe: describeWith([{ ns: 'llm-pi-ai' }, { ns: 'llm-dynamic-provider', routes: {} }]),
      set,
    })
    render(<DiscoverySection api={api} />)
    await waitFor(() => { expect(screen.getByText('动态路由')).toBeTruthy() })
    const block = dynamicBlock()

    // `9router` is a legal route id, but `9ROUTER_API_KEY` is not a legal
    // credential reference, so the host would refuse the store.
    fireEvent.change(within(block).getByLabelText('路由 ID'), { target: { value: '9router' } })
    fireEvent.change(within(block).getByLabelText('端点地址'), { target: { value: 'http://x.internal/v1' } })
    fireEvent.change(within(block).getByLabelText('API 密钥（可选）'), { target: { value: 'sk' } })
    expect(within(block).getByRole<HTMLButtonElement>('button', { name: '添加路由' }).disabled).toBe(true)
    expect(within(block).getByText('路由 ID「9router」的凭证引用「9ROUTER_API_KEY」不是合法的环境变量名（必须以字母或下划线开头）；请改用字母开头的路由 ID，或清空 API 密钥。')).toBeTruthy()
    fireEvent.click(within(block).getByRole('button', { name: '添加路由' }))
    expect(set).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })
})
