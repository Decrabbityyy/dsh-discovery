// @vitest-environment jsdom
/** Discovery section behavior over a scripted wire face. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-api-remotes/client'
import type { DiscoveryApi, DiscoveryResponse } from '../src/client/discovery.ts'
import { DiscoverySection } from '../src/client/DiscoverySection.tsx'
import { CUSTOM_PRESET } from '../src/client/presets.ts'

afterEach(cleanup)

/** Stub the thinking-level catalog fetch (`/llm-dynamic-provider/catalog`) with the given table. */
function stubCatalog(catalog: Record<string, readonly string[]>): void {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ catalog }) })))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function ok<T>(value: T): DiscoveryResponse<T> {
  return { ok: true, value } as DiscoveryResponse<T>
}
function fail<T>(message: string, code: string): DiscoveryResponse<T> {
  return { ok: false, error: { code, message } } as DiscoveryResponse<T>
}

/** One full-metadata row and one bare row, so every table cell has a sample. */
const SAMPLES: LlmDiscoveredModel[] = [
  { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B', contextWindow: 32768, maxTokens: 4096 },
  { id: 'llama3.2:1b' },
]

/** Fixture options: `unknown` keeps call-site mocks unconstrained; the defaults are the scripted happy path. */
interface ScriptedFaceOptions {
  models?: readonly LlmDiscoveredModel[]
  discover?: unknown
  describe?: unknown
  mutate?: unknown
  set?: unknown
  providers?: unknown
  /** Whether the Host inventory reports each optional plugin as active. */
  discoveryLoaded?: boolean
  dynamicLoaded?: boolean
  /** Optional inventory payload for lifecycle-state cases. */
  inventory?: unknown
  /** Optional scripted list result for inventory failure cases. */
  inventoryResult?: unknown
  /** Optional list function for transport-rejection cases. */
  pluginInventory?: unknown
}

function inventoryFor(options: ScriptedFaceOptions): unknown {
  const entries: unknown[] = []
  if (options.discoveryLoaded !== false) {
    entries.push({ entryId: 'llm-discovery', moduleName: 'dsh-llm-discovery', enabled: true, fiberPhase: 'active' })
  }
  if (options.dynamicLoaded === true) {
    entries.push({ entryId: 'llm-dynamic-provider', moduleName: 'dsh-llm-dynamic-provider', enabled: true, fiberPhase: 'active' })
  }
  return { entries }
}

function scriptedFace(options: ScriptedFaceOptions = {}): {
  api: DiscoveryApi
  discover: Mock
  describe: Mock
  mutate: Mock
  set: Mock
  providers: Mock
  pluginInventory: Mock
} {
  const models = options.models ?? SAMPLES
  // The inventory is the availability signal; discovery calls themselves only
  // represent an actual user probe. The default composition has the ad-hoc
  // discovery plugin active and the dynamic provider absent.
  const discover = (
    options.discover === undefined
      ? vi.fn(() => Promise.resolve(ok(models)))
      : options.discover
  ) as Mock
  const describe = (
    options.describe === undefined
      ? vi.fn(() => Promise.resolve(ok({
        namespaces: [{
          ns: 'llm-pi-ai',
          value: { providers: {} },
          revision: 3,
        }],
      })))
      : options.describe
  ) as Mock
  const mutate = (
    options.mutate === undefined
      ? vi.fn(() => Promise.resolve(ok({ ns: 'llm-pi-ai', revision: 4 })))
      : options.mutate
  ) as Mock
  const set = (
    options.set === undefined ? vi.fn(() => Promise.resolve(ok({}))) : options.set
  ) as Mock
  const providers = (
    options.providers === undefined ? vi.fn(() => Promise.resolve(ok([]))) : options.providers
  ) as Mock
  const pluginInventory = (
    options.pluginInventory === undefined
      ? vi.fn(() => Promise.resolve(
        options.inventoryResult ?? ok(options.inventory ?? inventoryFor(options)),
      ))
      : options.pluginInventory
  ) as Mock
  const api = {
    llm: { discoverModels: discover, listConfigurableProviders: providers },
    pluginInventory: { list: pluginInventory },
    settings: { describe, mutate },
    credentials: { set },
  } as DiscoveryApi
  return { api, discover, describe, mutate, set, providers, pluginInventory }
}

const probeButton = (): HTMLButtonElement => screen.getByRole('button', { name: '探测' }) as HTMLButtonElement
const adoptButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: '采纳为 Provider' }) as HTMLButtonElement

/** The discovery calls made by an actual user probe. Availability uses inventory. */
function probeCalls(discover: Mock): unknown[][] {
  return discover.mock.calls
}

/** Render the section and wait for the Host inventory to reveal the probe form. */
async function renderLoaded(api: DiscoveryApi): Promise<void> {
  render(<DiscoverySection api={api} />)
  await waitFor(() => { expect(screen.getAllByLabelText('端点地址').length).toBeGreaterThan(0) })
}

/** Fill the endpoint field and run one probe, waiting for it to settle. */
async function probeWith(baseURL = 'http://127.0.0.1:11434'): Promise<void> {
  const endpoint = screen.getAllByLabelText<HTMLInputElement>('端点地址')[0]
  if (endpoint === undefined) throw new Error('discovery endpoint field is missing')
  fireEvent.change(endpoint, { target: { value: baseURL } })
  fireEvent.click(probeButton())
  await waitFor(() => { expect(screen.queryByText('探测中…')).toBeNull() })
}

/** Type a route id so the adopt button enables. */
function typeRoute(route: string): void {
  const field = screen.getAllByLabelText<HTMLInputElement>('路由 ID')[0]
  if (field === undefined) throw new Error('discovery route field is missing')
  fireEvent.change(field, { target: { value: route } })
}

describe('DiscoverySection rendering', () => {
  it('renders null until the shell injects the wire face', () => {
    expect(DiscoverySection({})).toBeNull()
    const { container } = render(<DiscoverySection api={scriptedFace().api} />)
    expect(container.textContent).toContain('模型发现')
  })

  it('keeps the probe button disabled until a base URL is entered', async () => {
    await renderLoaded(scriptedFace().api)
    expect(probeButton().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('端点地址'), { target: { value: 'http://127.0.0.1:11434' } })
    expect(probeButton().disabled).toBe(false)
  })

  it('uses the inventory for availability and makes no discovery call on mount', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ catalog: {}, routes: {} }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { api, discover, pluginInventory } = scriptedFace({ dynamicLoaded: true })
    await renderLoaded(api)
    expect(pluginInventory).toHaveBeenCalledTimes(1)
    expect(discover).not.toHaveBeenCalled()
    await waitFor(() => { expect(screen.getByText('动态路由')).toBeDefined() })
    expect(fetchMock.mock.calls.some(([url]) => url === '/llm-dynamic-provider/catalog')).toBe(true)
  })

  it('does not request dynamic metadata when the dynamic plugin is absent', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await renderLoaded(scriptedFace().api)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('gates the two optional blocks independently', async () => {
    const { api } = scriptedFace({ discoveryLoaded: false, dynamicLoaded: true })
    render(<DiscoverySection api={api} />)
    await waitFor(() => { expect(screen.getByText('动态路由')).toBeDefined() })
    expect(screen.queryByText('Ollama')).toBeNull()
  })

  it('keeps inactive inventory entries hidden', async () => {
    const { api } = scriptedFace({
      inventory: {
        entries: [
          { entryId: 'llm-discovery', moduleName: 'dsh-llm-discovery', enabled: false, fiberPhase: 'active' },
          { entryId: 'llm-dynamic-provider', moduleName: 'dsh-llm-dynamic-provider', enabled: true, fiberPhase: 'pending' },
          { entryId: 'failed-discovery', moduleName: 'dsh-llm-discovery', enabled: true, fiberPhase: 'failed' },
          { entryId: 'unobserved-dynamic', moduleName: 'dsh-llm-dynamic-provider', enabled: true, fiberPhase: null },
        ],
      },
    })
    render(<DiscoverySection api={api} />)
    await waitFor(() => { expect(screen.getByText('模型发现')).toBeDefined() })
    expect(screen.queryByLabelText('端点地址')).toBeNull()
    expect(screen.queryByText('动态路由')).toBeNull()
  })

  it('fails closed when the inventory Remote returns an error', async () => {
    const { api, discover } = scriptedFace({
      inventoryResult: fail('inventory unavailable', 'REMOTE_ERROR'),
    })
    render(<DiscoverySection api={api} />)
    await waitFor(() => { expect(screen.getByText('模型发现')).toBeDefined() })
    expect(screen.queryByLabelText('端点地址')).toBeNull()
    expect(screen.queryByText('动态路由')).toBeNull()
    expect(discover).not.toHaveBeenCalled()
  })

  it('fails closed when the inventory method throws synchronously', async () => {
    const { api, discover } = scriptedFace({
      pluginInventory: vi.fn(() => { throw new Error('inventory method missing') }),
    })
    render(<DiscoverySection api={api} />)
    await waitFor(() => { expect(screen.getByText('模型发现')).toBeDefined() })
    expect(screen.queryByLabelText('端点地址')).toBeNull()
    expect(screen.queryByText('动态路由')).toBeNull()
    expect(discover).not.toHaveBeenCalled()
  })

  it('fails closed when the inventory Remote rejects transport', async () => {
    const { api, discover } = scriptedFace({
      pluginInventory: vi.fn(() => Promise.reject(new Error('connection lost'))),
    })
    render(<DiscoverySection api={api} />)
    await waitFor(() => { expect(screen.getByText('模型发现')).toBeDefined() })
    expect(screen.queryByLabelText('端点地址')).toBeNull()
    expect(screen.queryByText('动态路由')).toBeNull()
    expect(discover).not.toHaveBeenCalled()
  })
})

describe('preset cards', () => {
  it('prefill the form and derive the route id until the user edits it', async () => {
    const { api } = scriptedFace()
    await renderLoaded(api)
    const baseURL = screen.getByLabelText<HTMLInputElement>('端点地址')

    // First card: the empty route id follows it.
    fireEvent.click(screen.getByText('Ollama'))
    expect(baseURL.value).toBe('http://127.0.0.1:11434/v1')
    expect((screen.getByLabelText<HTMLSelectElement>('协议')).value).toBe('openai-completions')

    // A second card while the id still holds the previous card's default.
    fireEvent.click(screen.getByText('LM Studio'))
    expect(baseURL.value).toBe('http://127.0.0.1:1234/v1')

    // The custom card derives `custom`.
    fireEvent.click(screen.getByText(CUSTOM_PRESET.label))
    expect(baseURL.value).toBe('')

    // A card switch while the id holds the custom default follows too.
    fireEvent.click(screen.getByText('llama.cpp'))
    expect(baseURL.value).toBe('http://127.0.0.1:8080')

    // Reveal the adopt card, then hand-edit the id: later switches keep it.
    await probeWith('http://127.0.0.1:8080')
    expect((screen.getByLabelText<HTMLInputElement>('路由 ID')).value).toBe('llama-cpp')
    typeRoute('my-engine')
    fireEvent.click(screen.getByText('Ollama'))
    expect((screen.getByLabelText<HTMLInputElement>('路由 ID')).value).toBe('my-engine')
    fireEvent.click(screen.getByText(CUSTOM_PRESET.label))
    expect((screen.getByLabelText<HTMLInputElement>('路由 ID')).value).toBe('my-engine')
  })

  it('marks the chosen card as active', async () => {
    const { api } = scriptedFace()
    await renderLoaded(api)
    expect(screen.getByText('Ollama').className).not.toContain('presetCardActive')
    fireEvent.click(screen.getByText('Ollama'))
    expect(screen.getByText('Ollama').className).toContain('presetCardActive')
    expect(screen.getByText(CUSTOM_PRESET.label).className).not.toContain('presetCardActive')
    fireEvent.click(screen.getByText(CUSTOM_PRESET.label))
    expect(screen.getByText(CUSTOM_PRESET.label).className).toContain('presetCardActive')
    expect(screen.getByText('Ollama').className).not.toContain('presetCardActive')
  })
})

describe('probe', () => {
  it('asks the discovery namespace and renders the discovered metadata', async () => {
    const { api, discover } = scriptedFace()
    await renderLoaded(api)
    fireEvent.change(screen.getByLabelText('端点地址'), { target: { value: ' http://127.0.0.1:11434 ' } })
    fireEvent.change(screen.getByLabelText('API 密钥（可选）'), { target: { value: ' sk-abc ' } })
    fireEvent.click(probeButton())
    await waitFor(() => { expect(probeCalls(discover)).toHaveLength(1) })
    // The key is trimmed and travels only inside the probe payload.
    expect(probeCalls(discover)[0]).toEqual([
      'llm-discovery',
      {
        baseURL: 'http://127.0.0.1:11434',
        api: 'openai-completions',
        apiKey: 'sk-abc',
      },
    ])
    const table = screen.getByRole('table')
    expect(within(table).getByText('qwen2.5:7b')).toBeDefined()
    expect(within(table).getByText('Qwen 2.5 7B')).toBeDefined()
    expect(within(table).getByText('32768')).toBeDefined()
    expect(within(table).getByText('4096')).toBeDefined()
    expect(within(table).getByText('llama3.2:1b')).toBeDefined()
    // Absent metadata renders as the dash: the bare row (llama3.2:1b) shows
    // one in name, context, and output (3); the thinking column adds one per
    // row with no catalog levels (2); the modality column adds one per row
    // with no catalog modalities (2). 3 + 2 + 2.
    expect(within(table).getAllByText('—')).toHaveLength(7)
    // Everything found starts checked.
    expect((screen.getByLabelText<HTMLInputElement>('选择 qwen2.5:7b')).checked).toBe(true)
    expect((screen.getByLabelText<HTMLInputElement>('选择 llama3.2:1b')).checked).toBe(true)
  })

  it('omits the key from the payload when the field is blank', async () => {
    const { api, discover } = scriptedFace()
    await renderLoaded(api)
    await probeWith()
    expect(probeCalls(discover)[0]).toEqual([
      'llm-discovery',
      {
        baseURL: 'http://127.0.0.1:11434',
        api: 'openai-completions',
      },
    ])
  })

  it('rides the selected protocol in the payload', async () => {
    const { api, discover } = scriptedFace()
    await renderLoaded(api)
    fireEvent.change(screen.getByLabelText('协议'), { target: { value: 'anthropic-messages' } })
    await probeWith()
    expect(probeCalls(discover)[0]).toEqual([
      'llm-discovery',
      {
        baseURL: 'http://127.0.0.1:11434',
        api: 'anthropic-messages',
      },
    ])
  })

  it('shows a model-discovery-failed rejection verbatim', async () => {
    const { api } = scriptedFace({
      discover: vi.fn(() => Promise.resolve(fail('无法连接到 127.0.0.1:11434，请检查服务是否已启动', 'model-discovery-failed'))),
    })
    await renderLoaded(api)
    await probeWith()
    expect(screen.getByText('无法连接到 127.0.0.1:11434，请检查服务是否已启动')).toBeDefined()
    expect(screen.queryByLabelText('路由 ID')).toBeNull()
  })

  it('shows the transport failure text when the probe rejects', async () => {
    const { api } = scriptedFace({
      discover: vi.fn(() => Promise.reject(new Error('连接已断开'))),
    })
    await renderLoaded(api)
    await probeWith()
    expect(screen.getByText('连接已断开')).toBeDefined()
  })

  it('renders an empty line and no adopt card when nothing is found', async () => {
    const { api } = scriptedFace({ models: [] })
    await renderLoaded(api)
    await probeWith()
    expect(screen.getByText('未发现任何模型')).toBeDefined()
    expect(screen.queryByLabelText('路由 ID')).toBeNull()
  })

describe('results filtering and bulk selection', () => {
  it('filters rows by model id, case-insensitively, and reports no matches', async () => {
    const { api } = scriptedFace()
    await renderLoaded(api)
    await probeWith()
    const table = screen.getByRole('table')
    expect(within(table).getByText('qwen2.5:7b')).toBeDefined()

    fireEvent.change(screen.getByLabelText('搜索模型'), { target: { value: 'LLAMA' } })
    expect(screen.queryByText('qwen2.5:7b')).toBeNull()
    expect(within(screen.getByRole('table')).getByText('llama3.2:1b')).toBeDefined()

    fireEvent.change(screen.getByLabelText('搜索模型'), { target: { value: 'no-such-model' } })
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('没有匹配「no-such-model」的模型')).toBeDefined()
  })

  it('filters rows by display name and keeps hidden rows picked', async () => {
    const { api, mutate } = scriptedFace()
    await renderLoaded(api)
    await probeWith()
    fireEvent.change(screen.getByLabelText('搜索模型'), { target: { value: 'qwen 2.5' } })
    expect(screen.queryByText('llama3.2:1b')).toBeNull()
    // The hidden row stays selected: the counter still reports both picks.
    expect(screen.getByText('已选 2 / 共 2')).toBeDefined()
    // Adoption still takes the hidden row along.
    typeRoute('custom')
    fireEvent.click(adoptButton())
    await waitFor(() => { expect(mutate.mock.calls).toHaveLength(1) })
    expect(mutate.mock.calls[0]![0]).toBe('llm-pi-ai')
    expect(mutate.mock.calls[0]![1]).toMatchObject([{
      op: 'set',
      value: {
        models: [
          { id: 'qwen2.5:7b' },
          { id: 'llama3.2:1b' },
        ],
      },
    }])
    expect(mutate.mock.calls[0]![2]).toBe(3)
  })

  it('selects all and clears all with the toolbar buttons', async () => {
    const { api } = scriptedFace()
    await renderLoaded(api)
    await probeWith()
    fireEvent.click(screen.getByLabelText('选择 qwen2.5:7b'))
    expect(screen.getByText('已选 1 / 共 2')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: '全选' }))
    expect((screen.getByLabelText<HTMLInputElement>('选择 qwen2.5:7b')).checked).toBe(true)
    expect((screen.getByLabelText<HTMLInputElement>('选择 llama3.2:1b')).checked).toBe(true)
    expect(screen.getByText('已选 2 / 共 2')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: '全不选' }))
    expect((screen.getByLabelText<HTMLInputElement>('选择 qwen2.5:7b')).checked).toBe(false)
    expect((screen.getByLabelText<HTMLInputElement>('选择 llama3.2:1b')).checked).toBe(false)
    expect(screen.getByText('已选 0 / 共 2')).toBeDefined()
  })

  it('inverts the selection across every discovered model', async () => {
    const { api } = scriptedFace()
    await renderLoaded(api)
    await probeWith()
    fireEvent.click(screen.getByLabelText('选择 llama3.2:1b'))
    expect(screen.getByText('已选 1 / 共 2')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: '反选' }))
    expect((screen.getByLabelText<HTMLInputElement>('选择 qwen2.5:7b')).checked).toBe(false)
    expect((screen.getByLabelText<HTMLInputElement>('选择 llama3.2:1b')).checked).toBe(true)
    expect(screen.getByText('已选 1 / 共 2')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: '反选' }))
    expect((screen.getByLabelText<HTMLInputElement>('选择 qwen2.5:7b')).checked).toBe(true)
    expect((screen.getByLabelText<HTMLInputElement>('选择 llama3.2:1b')).checked).toBe(false)
  })

  it('resets the filter when a fresh probe lands', async () => {
    const { api } = scriptedFace()
    await renderLoaded(api)
    await probeWith()
    fireEvent.change(screen.getByLabelText('搜索模型'), { target: { value: 'llama' } })
    expect(screen.queryByText('qwen2.5:7b')).toBeNull()

    fireEvent.click(probeButton())
    await waitFor(() => { expect(probeCalls(api.llm.discoverModels as Mock)).toHaveLength(2) })
    expect((screen.getByLabelText<HTMLInputElement>('搜索模型')).value).toBe('')
    expect(within(screen.getByRole('table')).getByText('qwen2.5:7b')).toBeDefined()
  })
})
  it('shows the busy label and freezes the form while a probe is in flight', async () => {
    let resolveProbe!: (response: DiscoveryResponse<readonly LlmDiscoveredModel[]>) => void
    const { api } = scriptedFace({
      discover: vi.fn(() => new Promise<DiscoveryResponse<readonly LlmDiscoveredModel[]>>((resolve) => {
        resolveProbe = resolve
      })),
    })
    await renderLoaded(api)
    fireEvent.change(screen.getByLabelText('端点地址'), { target: { value: 'http://127.0.0.1:11434' } })
    fireEvent.click(probeButton())
    expect(screen.getByText('探测中…')).toBeDefined()
    expect((screen.getByLabelText<HTMLInputElement>('端点地址')).disabled).toBe(true)
    expect((screen.getByLabelText<HTMLSelectElement>('协议')).disabled).toBe(true)
    await act(async () => { resolveProbe(ok(SAMPLES)) })
    expect(probeButton().disabled).toBe(false)
  })
})

describe('adoption', () => {
  it('writes the exact mutate ops and stores the key first under the derived ref', async () => {
    const { api, describe, set, mutate } = scriptedFace()
    await renderLoaded(api)
    await probeWith()
    // Drop the metadata-poor row, then re-check it: both toggle directions.
    fireEvent.click(screen.getByLabelText('选择 llama3.2:1b'))
    fireEvent.click(screen.getByLabelText('选择 llama3.2:1b'))
    fireEvent.click(screen.getByLabelText('选择 llama3.2:1b'))
    typeRoute('local-qwen')
    fireEvent.change(screen.getByLabelText('显示名称'), { target: { value: ' 本地 Qwen ' } })
    fireEvent.change(screen.getByLabelText('API 密钥（可选）'), { target: { value: 'sk-local' } })
    fireEvent.click(adoptButton())
    await waitFor(() => { expect(mutate.mock.calls).toHaveLength(1) })
    expect(describe.mock.calls[0]).toEqual([])
    // The key write lands before the profile write.
    expect(set.mock.calls[0]).toEqual(['LOCAL_QWEN_API_KEY', 'sk-local'])
    expect(mutate.mock.calls[0]).toEqual([
      'llm-pi-ai',
      [{
        op: 'set',
        path: ['providers', 'local-qwen'],
        value: {
          displayName: '本地 Qwen',
          apiKeyEnv: 'LOCAL_QWEN_API_KEY',
          api: 'openai-completions',
          baseURL: 'http://127.0.0.1:11434',
          models: [{ id: 'qwen2.5:7b', name: 'Qwen 2.5 7B', contextWindow: 32768, maxTokens: 4096 }],
        },
      }],
      3,
    ])
    expect(screen.getByText('已采纳「local-qwen」，请在「模型」设置页查看该提供方。')).toBeDefined()

    // A fresh probe clears the confirmation.
    fireEvent.click(probeButton())
    await waitFor(() => { expect(probeCalls(api.llm.discoverModels as Mock)).toHaveLength(2) })
    expect(screen.queryByText(/已采纳「/)).toBeNull()
  })

  it('writes catalog-default thinking levels onto every adopted model', async () => {
    stubCatalog({
      'qwen2.5:7b': ['off', 'high'],
      'llama3.2:1b': ['high'],
    })
    const { api, mutate } = scriptedFace({ dynamicLoaded: true })
    await renderLoaded(api)
    await probeWith()
    // The catalog defaults preselect each model's levels (`off: null` means
    // supported while omitting the reasoning option); adoption preserves them.
    typeRoute('local-qwen')
    fireEvent.click(adoptButton())
    await waitFor(() => { expect(mutate.mock.calls).toHaveLength(1) })
    expect(mutate.mock.calls[0]).toEqual([
      'llm-pi-ai',
      [{
        op: 'set',
        path: ['providers', 'local-qwen'],
        value: {
          api: 'openai-completions',
          baseURL: 'http://127.0.0.1:11434',
          models: [
            {
              id: 'qwen2.5:7b',
              name: 'Qwen 2.5 7B',
              contextWindow: 32768,
              maxTokens: 4096,
              reasoningEfforts: { off: null, high: 'high' },
            },
            { id: 'llama3.2:1b', reasoningEfforts: { high: 'high' } },
          ],
        },
      }],
      3,
    ])
  })

  it('lets a catalog route inherit reasoning and ignores the picked levels', async () => {
    const { api, mutate } = scriptedFace({
      providers: vi.fn(() => Promise.resolve(ok([
        {
          provider: 'anthropic',
          displayName: 'Anthropic',
          settingsNs: 'llm-pi-ai',
          settingsPath: ['providers', 'anthropic'],
          declared: false,
        },
      ]))),
    })
    await renderLoaded(api)
    await probeWith()
    typeRoute('anthropic')
    await waitFor(() => { expect(screen.getByText(/自动继承/)).toBeDefined() })
    fireEvent.click(adoptButton())
    await waitFor(() => { expect(mutate.mock.calls).toHaveLength(1) })
    expect(mutate.mock.calls[0]).toEqual([
      'llm-pi-ai',
      [{
        op: 'set',
        path: ['providers', 'anthropic'],
        value: {
          api: 'openai-completions',
          baseURL: 'http://127.0.0.1:11434',
          models: [
            { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B', contextWindow: 32768, maxTokens: 4096 },
            { id: 'llama3.2:1b' },
          ],
        },
      }],
      3,
    ])
  })

  it('refuses to clobber an existing provider profile', async () => {
    const { api, mutate } = scriptedFace({
      describe: vi.fn(() => Promise.resolve(ok({
        namespaces: [{
          ns: 'llm-pi-ai',
          value: { providers: { ollama: { api: 'openai-completions' } } },
          revision: 3,
        }],
      }))),
    })
    await renderLoaded(api)
    await probeWith()
    typeRoute('ollama')
    fireEvent.click(adoptButton())
    await waitFor(() => {
      expect(screen.getByText('路由「ollama」已存在，请到「模型」设置页编辑该提供方')).toBeDefined()
    })
    expect(mutate.mock.calls).toHaveLength(0)
  })

  it('omits apiKeyEnv, the credential write, and the models list when absent', async () => {
    const { api, set, mutate } = scriptedFace()
    await renderLoaded(api)
    await probeWith()
    // Clear every selection: the absent list serves the whole catalog.
    fireEvent.click(screen.getByLabelText('选择 qwen2.5:7b'))
    fireEvent.click(screen.getByLabelText('选择 llama3.2:1b'))
    typeRoute('custom')
    fireEvent.click(adoptButton())
    await waitFor(() => { expect(mutate.mock.calls).toHaveLength(1) })
    expect(set.mock.calls).toHaveLength(0)
    expect(mutate.mock.calls[0]).toEqual([
      'llm-pi-ai',
      [{
        op: 'set',
        path: ['providers', 'custom'],
        value: {
          api: 'openai-completions',
          baseURL: 'http://127.0.0.1:11434',
        },
      }],
      3,
    ])
    expect(screen.getByText('已采纳「custom」，请在「模型」设置页查看该提供方。')).toBeDefined()
  })

  it('refuses an invalid route id and stays disabled on an empty one', async () => {
    const { api } = scriptedFace()
    await renderLoaded(api)
    await probeWith()
    expect(adoptButton().disabled).toBe(true)
    typeRoute('Bad_Route!')
    expect(screen.getByText('路由 ID 只能包含小写字母、数字和连字符。')).toBeDefined()
    expect(adoptButton().disabled).toBe(true)
    typeRoute('good-route')
    expect(screen.queryByText('路由 ID 只能包含小写字母、数字和连字符。')).toBeNull()
    expect(adoptButton().disabled).toBe(false)
  })

  it('reports a describe rejection without writing', async () => {
    const { api, mutate } = scriptedFace({
      describe: vi.fn(() => Promise.resolve(fail('设置读取失败', 'settings-unavailable'))),
    })
    await renderLoaded(api)
    await probeWith()
    typeRoute('custom')
    fireEvent.click(adoptButton())
    await waitFor(() => { expect(screen.getByText('设置读取失败')).toBeDefined() })
    expect(mutate.mock.calls).toHaveLength(0)
  })

  it('reports a missing llm-pi-ai namespace honestly', async () => {
    const { api, mutate } = scriptedFace({
      describe: vi.fn(() => Promise.resolve(ok({ namespaces: [] }))),
    })
    await renderLoaded(api)
    await probeWith()
    typeRoute('custom')
    fireEvent.click(adoptButton())
    await waitFor(() => {
      expect(screen.getByText('缺少 llm-pi-ai 设置命名空间，无法写入提供方配置')).toBeDefined()
    })
    expect(mutate.mock.calls).toHaveLength(0)
  })

  it('surfaces a settings-conflict message verbatim', async () => {
    const { api, set } = scriptedFace({
      mutate: vi.fn(() => Promise.resolve(fail('设置已被其他页面修改', 'settings-conflict'))),
    })
    await renderLoaded(api)
    await probeWith()
    typeRoute('custom')
    fireEvent.change(screen.getByLabelText('API 密钥（可选）'), { target: { value: 'sk' } })
    fireEvent.click(adoptButton())
    await waitFor(() => { expect(screen.getByText('设置已被其他页面修改')).toBeDefined() })
    // The key landed first; only the profile write was refused.
    expect(set.mock.calls[0]).toEqual(['CUSTOM_API_KEY', 'sk'])
  })

  it('reports a credential write failure and does not mutate', async () => {
    const { api, set, mutate } = scriptedFace({
      set: vi.fn(() => Promise.resolve(fail('凭证存储失败', 'credential-write-failed'))),
    })
    await renderLoaded(api)
    await probeWith()
    typeRoute('custom')
    fireEvent.change(screen.getByLabelText('API 密钥（可选）'), { target: { value: 'sk' } })
    fireEvent.click(adoptButton())
    await waitFor(() => { expect(screen.getByText('凭证存储失败')).toBeDefined() })
    expect(set.mock.calls).toHaveLength(1)
    expect(mutate.mock.calls).toHaveLength(0)
  })

  it('shows the transport failure text when the adoption rejects', async () => {
    const { api } = scriptedFace({
      mutate: vi.fn(() => Promise.reject(new Error('连接已断开'))),
    })
    await renderLoaded(api)
    await probeWith()
    typeRoute('custom')
    fireEvent.click(adoptButton())
    await waitFor(() => { expect(screen.getByText('连接已断开')).toBeDefined() })
  })

  it('stringifies a non-Error adoption rejection', async () => {
    const { api } = scriptedFace({
      // The contract under test is stringifying arbitrary rejection values, so
      // the stub rejects with a non-Error on purpose.
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- non-Error rejection on purpose
      mutate: vi.fn(() => Promise.reject('写入失败')),
    })
    await renderLoaded(api)
    await probeWith()
    typeRoute('custom')
    fireEvent.click(adoptButton())
    await waitFor(() => { expect(screen.getByText('写入失败')).toBeDefined() })
  })

  it('shows the busy label while an adoption is in flight', async () => {
    let resolveMutate!: (response: DiscoveryResponse<unknown>) => void
    const { api, mutate } = scriptedFace({
      mutate: vi.fn(() => new Promise<DiscoveryResponse<unknown>>((resolve) => {
        resolveMutate = resolve
      })),
    })
    await renderLoaded(api)
    await probeWith()
    typeRoute('custom')
    fireEvent.click(adoptButton())
    // The describe leg runs first, so the mutate mock is only constructed a
    // microtask later; give the chain a beat before asserting the busy state.
    await waitFor(() => { expect(mutate.mock.calls).toHaveLength(1) })
    expect(screen.getByText('采纳中…')).toBeDefined()
    expect((screen.getByLabelText<HTMLInputElement>('路由 ID')).disabled).toBe(true)
    await act(async () => {
      resolveMutate(ok({ ns: 'llm-pi-ai', revision: 4 }))
    })
    await waitFor(() => { expect(screen.getByText(/已采纳「/)).toBeDefined() })
  })
})
