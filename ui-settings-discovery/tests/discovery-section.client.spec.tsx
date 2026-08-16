// @vitest-environment jsdom
/** Discovery section behavior over a scripted wire face. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { DiscoveredModelView, IApiClient, RpcResponse } from '@deepseek-ai/dsh-api-remotes/client'
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

let nextRpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `r-${nextRpc++}` as never, result: { ok: true, value } }
}
function fail<T>(message: string, code: string): RpcResponse<T> {
  return { rpcId: `r-${nextRpc++}` as never, result: { ok: false, error: { code, message, details: {} } as never } }
}

/** One full-metadata row and one bare row, so every table cell has a sample. */
const SAMPLES: DiscoveredModelView[] = [
  { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B', contextWindow: 32768, maxTokens: 4096 },
  { id: 'llama3.2:1b' },
]

type WireFace = Pick<IApiClient, 'settings' | 'credentials' | 'llm'>

/** Fixture options: `unknown` keeps call-site mocks unconstrained; the defaults are the scripted happy path. */
interface ScriptedFaceOptions {
  models?: readonly DiscoveredModelView[]
  discover?: unknown
  describe?: unknown
  mutate?: unknown
  set?: unknown
  providers?: unknown
  /** When true the dynamic-plugin sentinel answers a network error (offer present), so the catalog fetch fires. */
  dynamicLoaded?: boolean
}

function scriptedFace(options: ScriptedFaceOptions = {}): {
  api: WireFace
  discover: Mock
  describe: Mock
  mutate: Mock
  set: Mock
  providers: Mock
} {
  const models = options.models ?? SAMPLES
  // The panel probes each host plugin's offer with the sentinel baseURL to
  // test registration. These specs assume the discovery plugin loaded (the
  // probe form shows) and the dynamic plugin absent (its block stays hidden):
  // the discovery sentinel answers a network error (offer present), the
  // dynamic sentinel answers the not-registered rejection. Real probe calls
  // return the scripted models. A custom `discover` is wrapped so the
  // discovery-sentinel still reports loaded regardless of the script.
  const base = options.discover === undefined
    ? vi.fn((request: { settingsNs?: string; baseURL?: string }) => {
      if (request.baseURL !== 'http://127.0.0.1:1') return Promise.resolve(ok({ models }))
      if (request.settingsNs === 'llm-discovery') {
        return Promise.resolve({ result: { ok: false, error: { code: 'model-discovery-failed', message: 'connect ECONNREFUSED 127.0.0.1:1' } } })
      }
      return options.dynamicLoaded === true
        ? Promise.resolve({ result: { ok: false, error: { code: 'model-discovery-failed', message: 'connect ECONNREFUSED 127.0.0.1:1' } } })
        : Promise.resolve({ result: { ok: false, error: { code: 'model-discovery-failed', message: 'no model discovery is registered for "llm-dynamic-provider"' } } })
    })
    : (options.discover as (request: { settingsNs?: string; baseURL?: string }) => unknown)
  const discover = vi.fn((request: { settingsNs?: string; baseURL?: string }) =>
    request.baseURL === 'http://127.0.0.1:1' && request.settingsNs === 'llm-discovery'
      ? Promise.resolve({ result: { ok: false, error: { code: 'model-discovery-failed', message: 'connect ECONNREFUSED 127.0.0.1:1' } } })
      : base(request)) as Mock
  const describe = (
    options.describe === undefined
      ? vi.fn(() => Promise.resolve(ok({
        writable: true,
        hasDocument: true,
        namespaces: [{
          ns: 'llm-pi-ai',
          schema: {},
          value: { providers: {} },
          applies: 'live',
          secrets: [],
          revision: 3,
        }],
      })))
      : options.describe
  ) as Mock
  const mutate = (
    options.mutate === undefined
      ? vi.fn(() => Promise.resolve(ok({
        ns: 'llm-pi-ai',
        schema: {},
        value: { providers: {} },
        applies: 'live',
        secrets: [],
        revision: 4,
      })))
      : options.mutate
  ) as Mock
  const set = (
    options.set === undefined ? vi.fn(() => Promise.resolve(ok({}))) : options.set
  ) as Mock
  const providers = (
    options.providers === undefined ? vi.fn(() => Promise.resolve(ok({ providers: [] }))) : options.providers
  ) as Mock
  const api = {
    llm: { discoverModels: discover, providers },
    settings: { describe, mutate },
    credentials: { set },
  } as unknown as WireFace
  return { api, discover, describe, mutate, set, providers }
}

const probeButton = (): HTMLButtonElement => screen.getByRole('button', { name: '探测' }) as HTMLButtonElement
const adoptButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: '采纳为 Provider' }) as HTMLButtonElement

/** The probe calls a discover mock saw, excluding the dynamic-plugin detection ping (sentinel baseURL). */
function probeCalls(discover: Mock): unknown[][] {
  return discover.mock.calls.filter(call => (call[0] as { baseURL?: string }).baseURL !== 'http://127.0.0.1:1')
}

/** Render the section and wait for the discovery-offer detection to reveal the probe form. */
async function renderLoaded(api: WireFace): Promise<void> {
  render(<DiscoverySection api={api} />)
  await waitFor(() => { expect(screen.getByLabelText('端点地址')).toBeDefined() })
}

/** Fill the endpoint field and run one probe, waiting for it to settle. */
async function probeWith(baseURL = 'http://127.0.0.1:11434'): Promise<void> {
  fireEvent.change(screen.getByLabelText('端点地址'), { target: { value: baseURL } })
  fireEvent.click(probeButton())
  await waitFor(() => { expect(screen.queryByText('探测中…')).toBeNull() })
}

/** Type a route id so the adopt button enables. */
function typeRoute(route: string): void {
  fireEvent.change(screen.getByLabelText('路由 ID'), { target: { value: route } })
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
})

describe('preset cards', () => {
  it('prefill the form and derive the route id until the user edits it', async () => {
    const { api } = scriptedFace()
    await renderLoaded(api)
    const baseURL = screen.getByLabelText<HTMLInputElement>('端点地址')

    // First card: the empty route id follows it.
    fireEvent.click(screen.getByText('Ollama'))
    expect(baseURL.value).toBe('http://127.0.0.1:11434')
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
    expect(probeCalls(discover)[0]![0]).toEqual({
      settingsNs: 'llm-discovery',
      baseURL: 'http://127.0.0.1:11434',
      api: 'openai-completions',
      apiKey: 'sk-abc',
    })
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
    expect(probeCalls(discover)[0]![0]).toEqual({
      settingsNs: 'llm-discovery',
      baseURL: 'http://127.0.0.1:11434',
      api: 'openai-completions',
    })
  })

  it('rides the selected protocol in the payload', async () => {
    const { api, discover } = scriptedFace()
    await renderLoaded(api)
    fireEvent.change(screen.getByLabelText('协议'), { target: { value: 'anthropic-messages' } })
    await probeWith()
    expect(probeCalls(discover)[0]![0]).toEqual({
      settingsNs: 'llm-discovery',
      baseURL: 'http://127.0.0.1:11434',
      api: 'anthropic-messages',
    })
  })

  it('shows a model-discovery-failed rejection verbatim', async () => {
    const { api } = scriptedFace({
      discover: vi.fn((request: { baseURL?: string }) => request.baseURL === 'http://127.0.0.1:1'
        ? Promise.resolve(fail('no model discovery is registered for "llm-dynamic-provider"', 'model-discovery-failed'))
        : Promise.resolve(fail('无法连接到 127.0.0.1:11434，请检查服务是否已启动', 'model-discovery-failed'))),
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

  it('shows the busy label and freezes the form while a probe is in flight', async () => {
    let resolveProbe!: (response: RpcResponse<{ models: readonly DiscoveredModelView[] }>) => void
    const { api } = scriptedFace({
      discover: vi.fn(() => new Promise<RpcResponse<{ models: readonly DiscoveredModelView[] }>>((resolve) => {
        resolveProbe = resolve
      })),
    })
    await renderLoaded(api)
    fireEvent.change(screen.getByLabelText('端点地址'), { target: { value: 'http://127.0.0.1:11434' } })
    fireEvent.click(probeButton())
    expect(screen.getByText('探测中…')).toBeDefined()
    expect((screen.getByLabelText<HTMLInputElement>('端点地址')).disabled).toBe(true)
    expect((screen.getByLabelText<HTMLSelectElement>('协议')).disabled).toBe(true)
    await act(async () => { resolveProbe(ok({ models: SAMPLES })) })
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
    expect(describe.mock.calls[0]).toEqual([{}])
    // The key write lands before the profile write.
    expect(set.mock.calls[0]).toEqual([{ ref: 'LOCAL_QWEN_API_KEY', value: 'sk-local' }])
    expect(mutate.mock.calls[0]![0]).toEqual({
      ns: 'llm-pi-ai',
      expectedRevision: 3,
      ops: [{
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
    })
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
    const { api, mutate } = scriptedFace()
    await renderLoaded(api)
    await probeWith()
    // The catalog defaults preselect each model's levels (off writes the empty
    // wire spelling); adopting without touching the pickers writes them.
    typeRoute('local-qwen')
    fireEvent.click(adoptButton())
    await waitFor(() => { expect(mutate.mock.calls).toHaveLength(1) })
    expect(mutate.mock.calls[0]![0]).toEqual({
      ns: 'llm-pi-ai',
      expectedRevision: 3,
      ops: [{
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
              reasoningEfforts: { off: '', high: 'high' },
            },
            { id: 'llama3.2:1b', reasoningEfforts: { high: 'high' } },
          ],
        },
      }],
    })
  })

  it('lets a catalog route inherit reasoning and ignores the picked levels', async () => {
    const { api, mutate } = scriptedFace({
      providers: vi.fn(() => Promise.resolve(ok({
        providers: [{
          provider: 'anthropic',
          displayName: 'Anthropic',
          settingsNs: 'llm-pi-ai',
          settingsPath: ['providers', 'anthropic'],
          active: false,
          declared: false,
        }],
      }))),
    })
    await renderLoaded(api)
    await probeWith()
    typeRoute('anthropic')
    await waitFor(() => { expect(screen.getByText(/自动继承/)).toBeDefined() })
    fireEvent.click(adoptButton())
    await waitFor(() => { expect(mutate.mock.calls).toHaveLength(1) })
    expect(mutate.mock.calls[0]![0]).toEqual({
      ns: 'llm-pi-ai',
      expectedRevision: 3,
      ops: [{
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
    })
  })

  it('refuses to clobber an existing provider profile', async () => {
    const { api, mutate } = scriptedFace({
      describe: vi.fn(() => Promise.resolve(ok({
        writable: true,
        hasDocument: true,
        namespaces: [{
          ns: 'llm-pi-ai',
          schema: {},
          value: { providers: { ollama: { api: 'openai-completions' } } },
          applies: 'live',
          secrets: [],
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
    expect(mutate.mock.calls[0]![0]).toEqual({
      ns: 'llm-pi-ai',
      expectedRevision: 3,
      ops: [{
        op: 'set',
        path: ['providers', 'custom'],
        value: {
          api: 'openai-completions',
          baseURL: 'http://127.0.0.1:11434',
        },
      }],
    })
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
      describe: vi.fn(() => Promise.resolve(ok({ writable: true, hasDocument: true, namespaces: [] }))),
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
    expect(set.mock.calls[0]).toEqual([{ ref: 'CUSTOM_API_KEY', value: 'sk' }])
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
    let resolveMutate!: (response: RpcResponse<{ ns: string; revision: number }>) => void
    const { api, mutate } = scriptedFace({
      mutate: vi.fn(() => new Promise<RpcResponse<{ ns: string; revision: number }>>((resolve) => {
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
      resolveMutate(ok({ ns: 'llm-pi-ai', schema: {}, value: {}, applies: 'live', secrets: [], revision: 4 }))
    })
    await waitFor(() => { expect(screen.getByText(/已采纳「/)).toBeDefined() })
  })
})
