// @vitest-environment jsdom
/**
 * The merged Models panel: the 动态路由 block renders only when the
 * dynamic-provider host plugin is mounted, and manages routes through the
 * plugin's own `/llm-dynamic-provider/routes` HTTP endpoint (not the gated
 * settings RPC, which refuses the namespace before its first route exists).
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { DiscoverySection } from '../src/client/DiscoverySection.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

type WireFace = Pick<IApiClient, 'settings' | 'credentials' | 'llm'>

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

function ok(value: unknown): { result: { ok: true; value: unknown } } {
  return { result: { ok: true, value } }
}

/** A describe answer whose namespaces list is the given set of ns strings. */
function describeWith(namespaces: readonly { ns: string; routes?: Record<string, unknown> }[]): Mock {
  return vi.fn(() => Promise.resolve(ok({
    writable: true,
    hasDocument: true,
    namespaces: namespaces.map(entry => ({
      ns: entry.ns,
      schema: {},
      value: entry.routes === undefined ? {} : { routes: entry.routes },
      applies: 'live',
      secrets: [],
      revision: 1,
    })),
  })))
}

function faceWith(overrides: { describe?: Mock; mutate?: Mock; set?: Mock; providers?: Mock; discover?: Mock }): {
  api: WireFace
  describe: Mock
  mutate: Mock
  set: Mock
} {
  const describe = overrides.describe ?? describeWith([{ ns: 'llm-pi-ai' }])
  const mutate = overrides.mutate ?? vi.fn(() => Promise.resolve(ok({ ns: 'llm-dynamic-provider', revision: 2 })))
  const set = overrides.set ?? vi.fn(() => Promise.resolve(ok({})))
  const providers = overrides.providers ?? vi.fn(() => Promise.resolve(ok({ providers: [] })))
  // Default: the dynamic discovery offer answers (network error = loaded).
  const discover = overrides.discover ?? vi.fn(() => Promise.resolve({
    result: { ok: false, error: { code: 'model-discovery-failed', message: 'could not reach http://127.0.0.1:1/models' } },
  }))
  const api = {
    llm: { discoverModels: discover, providers },
    settings: { describe, mutate },
    credentials: { set },
  } as unknown as WireFace
  return { api, describe, mutate, set }
}

/** The discover rejection an UNREGISTERED dynamic namespace produces. */
function notRegisteredDiscover(): Mock {
  return vi.fn(() => Promise.resolve({
    result: { ok: false, error: { code: 'model-discovery-failed', message: 'no model discovery is registered for "llm-dynamic-provider"' } },
  }))
}

/** The rendered 动态路由 block, scoped so its fields don't collide with the discovery block's. */
function dynamicBlock(): HTMLElement {
  return screen.getByLabelText('动态路由')
}

describe('merged Models panel gating', () => {
  it('hides the dynamic-routes block when the dynamic discovery offer is not registered', async () => {
    const { api } = faceWith({ discover: notRegisteredDiscover() })
    render(<DiscoverySection api={api} />)
    await waitFor(() => { expect(screen.getByText('模型发现')).toBeTruthy() })
    await waitFor(() => { expect(screen.queryByText('动态路由')).toBeNull() })
  })

  it('shows the dynamic-routes block when the dynamic discovery offer is registered', async () => {
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
      expect(set).toHaveBeenCalledWith({ ref: 'SECURE_API_KEY', value: 'sk-live' })
    })
    await waitFor(() => {
      expect(writes).toEqual([expect.objectContaining({
        op: 'set',
        routeId: 'secure',
        route: expect.objectContaining({ apiKeyEnv: 'SECURE_API_KEY' }),
      })])
    })
  })
})
