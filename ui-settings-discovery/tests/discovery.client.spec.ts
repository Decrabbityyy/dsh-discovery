/** Wire constants, derivation helpers, and presets of the discovery section. */
import { describe, expect, it } from 'vitest'
import { UI_CATALOG_PATH } from 'dsh-llm-endpoint-base/vocabulary'
import { CUSTOM_PRESET, ENGINE_PRESETS, PROTOCOLS } from '../src/client/presets.ts'
import {
  CREDENTIAL_REF_PATTERN, declaredInputOf, deriveKeyRef, DISCOVERY_NS, DISCOVERY_PLUGIN, DYNAMIC_PLUGIN,
  isActivePlugin, messageOf, modelDeclaration, PI_AI_NS, providerProfileOf, ROUTE_PATTERN,
} from '../src/client/discovery.ts'

describe('discovery wire constants', () => {
  it('pins the fixed namespaces of the OMP wire', () => {
    expect(DISCOVERY_NS).toBe('llm-discovery')
    expect(PI_AI_NS).toBe('llm-pi-ai')
  })

  it('offers the three local-engine presets and the custom card', () => {
    expect(ENGINE_PRESETS.map(preset => preset.key)).toEqual(['ollama', 'lm-studio', 'llama-cpp'])
    expect(ENGINE_PRESETS.map(preset => preset.label)).toEqual(['Ollama', 'LM Studio', 'llama.cpp'])
    expect(CUSTOM_PRESET).toEqual({ key: 'custom', label: '自定义端点', baseURL: '', api: 'openai-completions' })
  })

  it('lists the static protocol choices', () => {
    expect(PROTOCOLS).toEqual(['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'])
  })
})

describe('plugin inventory gating', () => {
  const entries = [
    { entryId: 'custom-id', moduleName: DISCOVERY_PLUGIN, enabled: true, fiberPhase: 'active' as const },
    { entryId: 'disabled', moduleName: DYNAMIC_PLUGIN, enabled: false, fiberPhase: 'active' as const },
    { entryId: 'pending', moduleName: DYNAMIC_PLUGIN, enabled: true, fiberPhase: 'pending' as const },
    { entryId: 'failed', moduleName: DYNAMIC_PLUGIN, enabled: true, fiberPhase: 'failed' as const },
    { entryId: 'wrong-module', moduleName: 'dsh-llm-discovery-copy', enabled: true, fiberPhase: 'active' as const },
  ]

  it('accepts only an exact active enabled module entry', () => {
    expect(isActivePlugin({ entries }, DISCOVERY_PLUGIN)).toBe(true)
    expect(isActivePlugin({ entries }, DYNAMIC_PLUGIN)).toBe(false)
  })
})

describe('messageOf', () => {
  it('uses the message of an Error rejection', () => {
    expect(messageOf(new Error('broken'))).toBe('broken')
  })

  it('stringifies any other rejection', () => {
    expect(messageOf('broken')).toBe('broken')
    expect(messageOf(42)).toBe('42')
  })
})

describe('catalog path', () => {
  it('pins the section endpoint', () => {
    expect(UI_CATALOG_PATH).toBe('/ui-settings-discovery/catalog')
  })
})

describe('declaredInputOf', () => {
  // Envelope keys are bare model names, exactly as parseModelFacts stores them.
  const table = {
    'qwen2.5:7b': { input: ['text', 'image'] },
    'vision-1': { input: ['image'] },
    'llama3.2:1b': { input: ['text'] },
    'audio-only': { input: ['audio', 'video'] },
  }

  it('declares the recorded modalities when the catalog records image input', () => {
    expect(declaredInputOf(table, 'qwen2.5:7b')).toEqual(['text', 'image'])
    expect(declaredInputOf(table, 'acme/vision-1')).toEqual(['image'])
  })

  it('resolves a provider-prefixed id onto its bare-name entry', () => {
    expect(declaredInputOf(table, 'openrouter/qwen2.5:7b')).toEqual(['text', 'image'])
    expect(declaredInputOf(table, 'x/acme/vision-1')).toEqual(['image'])
  })

  it('declares nothing for a text-only, non-raster, or unknown model', () => {
    expect(declaredInputOf(table, 'llama3.2:1b')).toBeUndefined()
    expect(declaredInputOf(table, 'audio-only')).toBeUndefined()
    expect(declaredInputOf(table, 'never-heard-of-it')).toBeUndefined()
    expect(declaredInputOf({}, 'qwen2.5:7b')).toBeUndefined()
  })

  it('drops values the pi-ai field cannot carry and any duplicate', () => {
    expect(declaredInputOf({ m: { input: ['image', 'image', 'audio'] } }, 'm')).toEqual(['image'])
  })
})

describe('providerProfileOf', () => {
  const described = {
    providers: {
      'local-qwen': {
        baseURL: 'http://127.0.0.1:11434/v1',
        api: 'openai-completions',
        models: [
          {
            id: 'qwen2.5:7b',
            name: 'Qwen 2.5 7B',
            contextWindow: 32768,
            maxTokens: 4096,
            input: ['text', 'image'],
            reasoningEfforts: { off: null, low: 'low' },
          },
          { id: 'llama3.2:1b' },
        ],
      },
    },
  }

  it('reads the endpoint, protocol, and declared models of one route', () => {
    expect(providerProfileOf(described, 'local-qwen')).toEqual({
      baseURL: 'http://127.0.0.1:11434/v1',
      api: 'openai-completions',
      models: [
        {
          id: 'qwen2.5:7b',
          name: 'Qwen 2.5 7B',
          contextWindow: 32768,
          maxTokens: 4096,
          input: ['text', 'image'],
          reasoningEfforts: { off: null, low: 'low' },
        },
        { id: 'llama3.2:1b' },
      ],
    })
  })

  it('reads a missing route, a catalog-served route, and an unreadable shape as an empty draft', () => {
    expect(providerProfileOf(described, 'other').models).toEqual([])
    // A catalog route lists no models at all: it inherits the installed catalog.
    expect(providerProfileOf({ providers: { anthropic: { api: 'anthropic-messages' } } }, 'anthropic'))
      .toEqual({ api: 'anthropic-messages', models: [] })
    expect(providerProfileOf(undefined, 'local-qwen')).toEqual({ models: [] })
    expect(providerProfileOf({ providers: 'nope' }, 'local-qwen')).toEqual({ models: [] })
  })

  it('drops entries it cannot identify and fields of the wrong shape', () => {
    expect(providerProfileOf({
      providers: {
        route: {
          baseURL: '',
          api: 7,
          models: ['nope', {}, { id: '' }, { id: 'kept', contextWindow: -1, maxTokens: 'many', input: 'text', reasoningEfforts: 'high' }],
        },
      },
    }, 'route')).toEqual({ models: [{ id: 'kept' }] })
  })
})

describe('modelDeclaration', () => {
  const catalogModalities = { 'qwen2.5:7b': { input: ['text', 'image'] } }

  it('writes the picked levels and the catalog image claim', () => {
    expect(modelDeclaration(
      { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B', contextWindow: 32768 },
      new Set(['off', 'high']),
      catalogModalities,
    )).toEqual({
      id: 'qwen2.5:7b',
      name: 'Qwen 2.5 7B',
      contextWindow: 32768,
      input: ['text', 'image'],
      reasoningEfforts: { off: null, high: 'high' },
    })
  })

  it('keeps the stored declaration for fields neither source supplies', () => {
    expect(modelDeclaration(
      { id: 'private-vl', input: ['text', 'image'], reasoningEfforts: { high: 'high' } },
      new Set(),
      {},
    )).toEqual({
      id: 'private-vl',
      input: ['text', 'image'],
      reasoningEfforts: { high: 'high' },
    })
  })

  it('writes no input when the catalog records no image support', () => {
    expect(modelDeclaration({ id: 'llama3.2:1b' }, new Set(), catalogModalities))
      .toEqual({ id: 'llama3.2:1b' })
  })
})

describe('deriveKeyRef', () => {
  it('uppercases the route id and underscores non-alphanumeric runs', () => {
    expect(deriveKeyRef('local-ollama')).toBe('LOCAL_OLLAMA_API_KEY')
    expect(deriveKeyRef('custom')).toBe('CUSTOM_API_KEY')
  })
})

describe('ROUTE_PATTERN', () => {
  it('accepts lowercase ids with digits and hyphens', () => {
    expect('local-ollama'.match(ROUTE_PATTERN)).not.toBeNull()
    expect('a1-b2'.match(ROUTE_PATTERN)).not.toBeNull()
    expect('custom'.match(ROUTE_PATTERN)).not.toBeNull()
  })

  it('rejects uppercase, underscores, spaces, and empty ids', () => {
    expect('Bad_Route'.match(ROUTE_PATTERN)).toBeNull()
    expect('has space'.match(ROUTE_PATTERN)).toBeNull()
    expect(''.match(ROUTE_PATTERN)).toBeNull()
  })
})

describe('CREDENTIAL_REF_PATTERN', () => {
  it('accepts the references deriveKeyRef produces for letter-leading route ids', () => {
    expect('LOCAL_OLLAMA_API_KEY'.match(CREDENTIAL_REF_PATTERN)).not.toBeNull()
    expect('_API_KEY'.match(CREDENTIAL_REF_PATTERN)).not.toBeNull()
  })

  it('rejects a reference derived from a digit-leading route id', () => {
    // The route id is a legal settings key, but the host brands a credential
    // reference as an environment-variable name and refuses this one.
    expect(ROUTE_PATTERN.test('9router')).toBe(true)
    expect('9ROUTER_API_KEY'.match(CREDENTIAL_REF_PATTERN)).toBeNull()
    expect(deriveKeyRef('9router').match(CREDENTIAL_REF_PATTERN)).toBeNull()
    expect(deriveKeyRef('router-9').match(CREDENTIAL_REF_PATTERN)).not.toBeNull()
  })
})
