// @vitest-environment jsdom
/** The provider card's model editor: the entry button, the stored-profile read that seeds it, the probe that adds models, and the write that lands on the */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { ReactNode } from 'react'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-api-remotes/client'
import type { ProviderDirectoryEntry } from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { ProviderModelsCard } from '../src/client/ProviderModelsDialog.tsx'
import type { DiscoveryApi, DiscoveryResponse } from '../src/client/discovery.ts'
import { resetCatalogCache } from '../src/client/catalogStore.ts'

afterEach(cleanup)
afterEach(() => {
  vi.unstubAllGlobals()
})

// The catalog is cached per page session; each case stubs its own fetch.
beforeEach(() => {
  resetCatalogCache()
})

/** The card's directory row: a hand-declared llm-pi-ai route with a profile. */
const PROVIDER: ProviderDirectoryEntry = {
  provider: 'local-qwen',
  displayName: '本地 Qwen',
  settingsNs: 'llm-pi-ai',
  settingsPath: ['providers', 'local-qwen'],
  active: true,
  declared: true,
}

/** The stored profile the dialog reads back: one model with a declared level. */
const PROFILE = {
  baseURL: 'http://127.0.0.1:11434/v1',
  api: 'openai-completions',
  models: [
    {
      id: 'qwen2.5:7b',
      name: 'Qwen 2.5 7B',
      contextWindow: 32768,
      maxTokens: 4096,
      reasoningEfforts: { off: null, low: 'low' },
    },
  ],
}

/** The catalog tables the section's own endpoint answers with. */
const ENVELOPE = {
  catalog: { 'qwen2.5:7b': ['off', 'low', 'high'] },
  modalities: { 'qwen2.5:7b': { input: ['text', 'image'], output: ['text'] } },
  facts: {},
}

const REVISION = 7

function ok<T>(value: T): DiscoveryResponse<T> {
  return { ok: true, value } as DiscoveryResponse<T>
}

function scripted(options: {
  readonly profile?: unknown
  readonly discovered?: readonly LlmDiscoveredModel[]
  readonly mutate?: unknown
  readonly described?: unknown
  readonly envelope?: unknown
} = {}): {
  api: DiscoveryApi
  discover: Mock
  mutate: Mock
  fetchMock: Mock
} {
  const discover = vi.fn(() => Promise.resolve(ok(options.discovered ?? []))) as Mock
  const mutate = (options.mutate ?? vi.fn(() => Promise.resolve(ok({})))) as Mock
  const describe = vi.fn(() => Promise.resolve(ok(options.described ?? {
    namespaces: [{
      ns: 'llm-pi-ai',
      value: { providers: { 'local-qwen': options.profile ?? PROFILE } },
      revision: REVISION,
    }],
  }))) as Mock
  const api = {
    llm: { discoverModels: discover, listConfigurableProviders: vi.fn(() => Promise.resolve(ok([]))) },
    pluginInventory: { list: vi.fn(() => Promise.resolve(ok({ entries: [] }))) },
    settings: { describe, mutate },
    credentials: { set: vi.fn(() => Promise.resolve(ok({}))) },
  } as unknown as DiscoveryApi
  const fetchMock = vi.fn(() => Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(options.envelope ?? ENVELOPE),
  }))
  vi.stubGlobal('fetch', fetchMock)
  return { api, discover, mutate, fetchMock }
}

/** Render the card and open its dialog, waiting for the profile read. */
async function openDialog(api: DiscoveryApi, configured = true): Promise<void> {
  render(<ProviderModelsCard api={api} provider={PROVIDER} configured={configured} />)
  fireEvent.click(screen.getByRole('button', { name: '模型与选项' }))
  await waitFor(() => { expect(screen.getByRole('dialog')).toBeDefined() })
  await waitFor(() => { expect(screen.getByRole('button', { name: '保存' })).toBeDefined() })
}

/** 按 Models 页实际结构搭的提供方卡片：行头带自己的按钮、扩展格外面套插槽锚点，点「编辑」后卡片里还会多一个密钥输入框。 */
function HostCard({ editing, children }: { readonly editing: boolean; readonly children: ReactNode }): ReactNode {
  return (
    <ul>
      <li>
        <div>
          <button type="button">编辑</button>
        </div>
        <div data-slot="settings.models.provider-card">{children}</div>
        {editing ? <div><input aria-label="API 密钥" /></div> : null}
      </li>
    </ul>
  )
}

/** Swap the host card between collapsed and expanded, letting the cell observe it. */
async function setEditing(view: { rerender: (ui: ReactNode) => void }, api: DiscoveryApi, editing: boolean): Promise<void> {
  await act(async () => {
    view.rerender(
      <HostCard editing={editing}>
        <ProviderModelsCard api={api} provider={PROVIDER} configured />
      </HostCard>,
    )
    // The cell reads the card through a MutationObserver, so the change lands
    // one microtask after React commits it.
    await Promise.resolve()
  })
}

const saveButton = (): HTMLButtonElement => screen.getByRole('button', { name: '保存' }) as HTMLButtonElement

describe('provider card entry', () => {
  it('renders nothing without an injected face, a row, or a configured profile', () => {
    const { api } = scripted()
    expect(ProviderModelsCard({ api })).toBeNull()
    expect(ProviderModelsCard({ api, provider: PROVIDER, configured: false })).toBeNull()
    expect(ProviderModelsCard({ provider: PROVIDER, configured: true })).toBeNull()
  })

  it('offers the editor on a configured provider card', () => {
    const { api } = scripted()
    render(<ProviderModelsCard api={api} provider={PROVIDER} configured />)
    expect(screen.getByRole('button', { name: '模型与选项' })).toBeDefined()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps the entry off a collapsed card and offers it while the card is open', async () => {
    const { api } = scripted()
    const view = render(
      <HostCard editing={false}>
        <ProviderModelsCard api={api} provider={PROVIDER} configured />
      </HostCard>,
    )
    expect(screen.getByRole('button', { name: '编辑' })).toBeDefined()
    expect(screen.queryByRole('button', { name: '模型与选项' })).toBeNull()

    await setEditing(view, api, true)
    expect(screen.getByRole('button', { name: '模型与选项' })).toBeDefined()

    await setEditing(view, api, false)
    expect(screen.queryByRole('button', { name: '模型与选项' })).toBeNull()
  })

  it('keeps a dialog the user opened after the card collapses again', async () => {
    const { api } = scripted()
    const view = render(
      <HostCard editing={false}>
        <ProviderModelsCard api={api} provider={PROVIDER} configured />
      </HostCard>,
    )
    await setEditing(view, api, true)
    fireEvent.click(screen.getByRole('button', { name: '模型与选项' }))
    await waitFor(() => { expect(screen.getByRole('dialog')).toBeDefined() })

    await setEditing(view, api, false)
    expect(screen.getByRole('dialog')).toBeDefined()
  })
})

describe('provider models dialog', () => {
  it('seeds the table from the stored profile and asks for no route id or key', async () => {
    const { api } = scripted()
    await openDialog(api)
    const table = within(screen.getByRole('table'))
    expect(table.getByText('qwen2.5:7b')).toBeDefined()
    expect(table.getByText('Qwen 2.5 7B')).toBeDefined()
    expect(table.getByText('文·图')).toBeDefined()
    // The provider owns its id and credential, so neither is editable here.
    expect(screen.queryByLabelText('路由 ID')).toBeNull()
    expect(screen.queryByLabelText('API 密钥（可选）')).toBeNull()
    // The profile's own level is preselected; the catalog's extra one is not.
    expect(screen.getByLabelText<HTMLInputElement>('qwen2.5:7b 档位 low').checked).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>('qwen2.5:7b 档位 off').checked).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>('qwen2.5:7b 档位 high').checked).toBe(false)
  })

  it('probes the stored endpoint without a key and adds advertised models unchecked', async () => {
    const { api, discover } = scripted({
      discovered: [{ id: 'qwen2.5:7b' }, { id: 'qwen3-vl:8b', contextWindow: 65536 }],
    })
    await openDialog(api)
    fireEvent.click(screen.getByRole('button', { name: '探测端点' }))
    await waitFor(() => { expect(discover.mock.calls).toHaveLength(1) })
    // Endpoint and protocol come from the profile; the credential stays host-side.
    expect(discover.mock.calls[0]).toEqual([
      'llm-pi-ai',
      { provider: 'local-qwen', baseURL: 'http://127.0.0.1:11434/v1', api: 'openai-completions' },
    ])
    await waitFor(() => { expect(within(screen.getByRole('table')).getByText('qwen3-vl:8b')).toBeDefined() })
    // The stored model stays picked; the newly advertised one is not configured yet.
    expect(screen.getByLabelText<HTMLInputElement>('选择 qwen2.5:7b').checked).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>('选择 qwen3-vl:8b').checked).toBe(false)
  })

  it('writes the picked models, their levels, and the catalog image claim to the provider path', async () => {
    const { api, mutate } = scripted()
    await openDialog(api)
    // Add a level the profile did not declare.
    fireEvent.click(screen.getByLabelText('qwen2.5:7b 档位 high'))
    fireEvent.click(saveButton())
    await waitFor(() => { expect(mutate.mock.calls).toHaveLength(1) })
    expect(mutate.mock.calls[0]).toEqual([
      'llm-pi-ai',
      [{
        op: 'set',
        path: ['providers', 'local-qwen', 'models'],
        value: [{
          id: 'qwen2.5:7b',
          name: 'Qwen 2.5 7B',
          contextWindow: 32768,
          maxTokens: 4096,
          input: ['text', 'image'],
          reasoningEfforts: { off: null, low: 'low', high: 'high' },
        }],
      }],
      REVISION,
    ])
    expect(screen.getByText('已保存该提供方的模型配置。')).toBeDefined()
  })

  it('keeps the stored declaration of a field the dialog does not supply', async () => {
    const { api, mutate } = scripted({
      profile: {
        baseURL: 'http://127.0.0.1:11434/v1',
        api: 'openai-completions',
        models: [{ id: 'private-vl', input: ['text', 'image'], reasoningEfforts: { high: 'high' } }],
      },
    })
    await openDialog(api)
    fireEvent.click(saveButton())
    await waitFor(() => { expect(mutate.mock.calls).toHaveLength(1) })
    // Neither the catalog nor the picker knows this id, so its own declaration stands.
    expect(mutate.mock.calls[0]?.[1]).toEqual([{
      op: 'set',
      path: ['providers', 'local-qwen', 'models'],
      value: [{ id: 'private-vl', input: ['text', 'image'], reasoningEfforts: { high: 'high' } }],
    }])
  })

  it('refuses to save an empty selection without writing', async () => {
    const { api, mutate } = scripted()
    await openDialog(api)
    fireEvent.click(screen.getByRole('button', { name: '全不选' }))
    expect(saveButton().disabled).toBe(true)
    // The guard is what keeps an empty list off the wire.
    fireEvent.click(screen.getByLabelText('选择 qwen2.5:7b'))
    fireEvent.click(saveButton())
    await waitFor(() => { expect(mutate.mock.calls).toHaveLength(1) })
  })

  it('binds a row the catalog cannot resolve and writes what the pinned entry records', async () => {
    const { api, mutate } = scripted({
      profile: { baseURL: 'http://127.0.0.1:11434/v1', api: 'openai-completions', models: [{ id: 'glm-5.2-fast-preview/cc' }] },
      envelope: {
        catalog: { 'glm-5.2': ['high', 'max'] },
        modalities: { 'glm-5.2': { input: ['text', 'image'] } },
        facts: { 'glm-5.2': { name: 'GLM-5.2', contextWindow: 200000, maxTokens: 128000 } },
      },
    })
    await openDialog(api)
    const entry = screen.getByRole('button', { name: 'glm-5.2-fast-preview/cc 的目录条目' })
    expect(entry.textContent).toBe('匹配目录')
    fireEvent.click(entry)
    fireEvent.click(screen.getByRole('button', { name: '把 glm-5.2-fast-preview/cc 匹配到 glm-5.2' }))

    fireEvent.click(saveButton())
    await waitFor(() => { expect(mutate.mock.calls).toHaveLength(1) })
    expect(mutate.mock.calls[0]?.[1]).toEqual([{
      op: 'set',
      path: ['providers', 'local-qwen', 'models'],
      value: [{
        id: 'glm-5.2-fast-preview/cc',
        name: 'GLM-5.2',
        contextWindow: 200000,
        maxTokens: 128000,
        input: ['text', 'image'],
        // Binding also seeds the row's levels from the entry it was pinned to.
        reasoningEfforts: { high: 'high', max: 'max' },
      }],
    }])
  })

  it('saves the entry a row was re-bound to, over what the profile declared', async () => {
    const { api, mutate } = scripted({
      profile: {
        baseURL: 'http://127.0.0.1:11434/v1',
        api: 'openai-completions',
        models: [{ id: 'glm-5.2-fast-preview/cc', name: '旧名', contextWindow: 4096 }],
      },
      envelope: {
        catalog: { 'glm-5.2': ['high', 'max'], 'glm-5.2-air': ['low'] },
        modalities: { 'glm-5.2': { input: ['text', 'image'] }, 'glm-5.2-air': { input: ['text'] } },
        facts: {
          'glm-5.2': { name: 'GLM-5.2', contextWindow: 200000, maxTokens: 128000 },
          'glm-5.2-air': { name: 'GLM-5.2 Air', contextWindow: 128000, maxTokens: 64000 },
        },
      },
    })
    await openDialog(api)
    const entry = (): HTMLElement => screen.getByRole('button', { name: 'glm-5.2-fast-preview/cc 的目录条目' })
    fireEvent.click(entry())
    fireEvent.click(screen.getByRole('button', { name: '把 glm-5.2-fast-preview/cc 匹配到 glm-5.2' }))
    fireEvent.click(entry())
    fireEvent.click(screen.getByRole('button', { name: '把 glm-5.2-fast-preview/cc 匹配到 glm-5.2-air' }))

    fireEvent.click(saveButton())
    await waitFor(() => { expect(mutate.mock.calls).toHaveLength(1) })
    expect(mutate.mock.calls[0]?.[1]).toEqual([{
      op: 'set',
      path: ['providers', 'local-qwen', 'models'],
      value: [{
        id: 'glm-5.2-fast-preview/cc',
        name: 'GLM-5.2 Air',
        contextWindow: 128000,
        maxTokens: 64000,
        // 上一次绑定的档位是 glm-5.2 带出来的，换条之后跟着换成新的。
        reasoningEfforts: { low: 'low' },
      }],
    }])
  })

  it('keeps the revision a save returned so a second save in the same dialog is not refused', async () => {
    let current = REVISION
    const mutate = vi.fn((_ns: string, _ops: unknown, expected: number) => {
      if (expected !== current) {
        return Promise.resolve({
          ok: false,
          error: { code: 'settings/conflict', message: `settings namespace "llm-pi-ai" changed since it was read (expected revision ${expected}, now ${current})` },
        })
      }
      current += 1
      return Promise.resolve(ok({ ns: 'llm-pi-ai', value: {}, revision: current }))
    })
    const { api } = scripted({ mutate })
    await openDialog(api)

    fireEvent.click(saveButton())
    await waitFor(() => { expect(mutate.mock.calls).toHaveLength(1) })
    fireEvent.click(saveButton())
    await waitFor(() => { expect(mutate.mock.calls).toHaveLength(2) })

    expect(mutate.mock.calls[0]?.[2]).toBe(REVISION)
    expect(mutate.mock.calls[1]?.[2]).toBe(REVISION + 1)
    expect(screen.queryByText(/changed since it was read/)).toBeNull()
  })

  it('closes the catalog picker on Escape without closing the dialog', async () => {
    const { api } = scripted()
    await openDialog(api)
    fireEvent.click(screen.getByRole('button', { name: 'qwen2.5:7b 的目录条目' }))
    const search = screen.getByLabelText('搜索目录条目：qwen2.5:7b')
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(screen.queryByLabelText('搜索目录条目：qwen2.5:7b')).toBeNull()
    expect(screen.getByRole('dialog')).toBeDefined()
  })

  it('reports a refused write and stays open', async () => {
    const { api } = scripted({
      mutate: vi.fn(() => Promise.resolve({
        ok: false,
        error: { code: 'settings/conflict', message: '设置已被其他页面修改' },
      })),
    })
    await openDialog(api)
    fireEvent.click(saveButton())
    await waitFor(() => { expect(screen.getByText('设置已被其他页面修改')).toBeDefined() })
    expect(screen.getByRole('dialog')).toBeDefined()
  })

  it('reports a profile it cannot read instead of showing an empty editor', async () => {
    const { api } = scripted({ described: { namespaces: [] } })
    render(<ProviderModelsCard api={api} provider={PROVIDER} configured />)
    fireEvent.click(screen.getByRole('button', { name: '模型与选项' }))
    await waitFor(() => { expect(screen.getByText(/缺少 llm-pi-ai 设置命名空间/)).toBeDefined() })
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('closes on Escape without writing', async () => {
    const { api, mutate } = scripted()
    await openDialog(api)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(mutate).not.toHaveBeenCalled()
  })
})
