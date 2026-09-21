/** Wire constants, derivation helpers, and presets of the discovery section. */
import { describe, expect, it } from 'vitest'
import { UI_CATALOG_PATH } from 'dsh-llm-discovery/vocabulary'
import { CUSTOM_PRESET, ENGINE_PRESETS, PROTOCOLS } from '../src/client/presets.ts'
import {
  catalogKeyCandidates, catalogIndexOf, catalogSearchSeed, CREDENTIAL_REF_PATTERN, declaredInput, deriveKeyRef,
  DISCOVERY_NS, DISCOVERY_PLUGIN, DYNAMIC_PLUGIN, entryId, isActivePlugin, matchCatalogEntry, matchesPickerQuery,
  messageOf, modelDeclaration, parsePickerQuery, boundLevels,
  PI_AI_NS, providerProfileOf, ROUTE_PATTERN,
} from '../src/client/discovery.ts'
import type { CatalogEntry } from '../src/client/discovery.ts'
import { formatCapacity, formatCapacityPair, levelMarks } from '../src/client/format.ts'

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

describe('catalog resolution', () => {
  // Envelope keys are the ids models.dev records, plus their bare names.
  const tables = {
    catalog: { 'qwen2.5:7b': ['off', 'high'], 'glm-5.2': ['high', 'max'] },
    modalities: {
      'qwen2.5:7b': { input: ['text', 'image'] },
      'vision-1': { input: ['image'] },
      'llama3.2:1b': { input: ['text'] },
      'audio-only': { input: ['audio', 'video'] },
    },
    facts: { 'qwen2.5:7b': { name: 'Qwen 2.5 7B', contextWindow: 32768 }, 'glm-5.2': { name: 'GLM-5.2' } },
    sources: { 'glm-5.2': ['zai-org', 'fireworks'] },
  }
  const index = catalogIndexOf(tables)

  it('keys the union of the tables, case-insensitively', () => {
    expect(index.keyOf('GLM-5.2')).toBe('glm-5.2')
    expect(index.keyOf('ANTHROPIC/CLAUDE')).toBeUndefined()
    expect(index.entryOf('llama3.2:1b')?.levels).toEqual([])
    expect(index.entryOf('never-heard-of-it')).toBeUndefined()
  })

  it('resolves a provider-prefixed id onto its bare-name entry', () => {
    expect(matchCatalogEntry('openrouter/qwen2.5:7b', index)?.entry.input).toEqual(['text', 'image'])
    expect(matchCatalogEntry('x/acme/vision-1', index)?.key).toBe('vision-1')
  })

  it('offers both halves of a slash before giving up', () => {
    // A variant tag after the slash is not a vendor prefix.
    expect(catalogKeyCandidates('Gemini-3.7-Flash/Antigravity')).toEqual([
      'Gemini-3.7-Flash/Antigravity', 'Gemini-3.7-Flash', 'Antigravity',
    ])
    expect(matchCatalogEntry('glm-5.2/GLM-5.2', index)?.key).toBe('glm-5.2')
  })

  it('keeps the id a provider records when its bare name is recorded too', () => {
    const split = catalogIndexOf({
      catalog: {},
      modalities: {},
      facts: { 'x-ai/grok-4.6': { name: 'Grok 4.6 · openrouter' }, 'grok-4.6': { name: 'Grok 4.6 · xai' } },
      sources: { 'x-ai/grok-4.6': ['openrouter'], 'grok-4.6': ['xai', 'openrouter'] },
    })
    // The exact id wins over the bare name the tail candidate would reach.
    expect(matchCatalogEntry('x-ai/grok-4.6', split)?.entry.name).toBe('Grok 4.6 · openrouter')
    expect(matchCatalogEntry('grok-4.6', split)?.entry.name).toBe('Grok 4.6 · xai')
    // A third segment only ever prefixes, so the bare name is all that is left.
    expect(matchCatalogEntry('openrouter/x-ai/grok-4.6', split)?.key).toBe('grok-4.6')
  })

  it('carries the providers behind an entry', () => {
    expect(index.entryOf('glm-5.2')?.sources).toEqual(['zai-org', 'fireworks'])
    expect(index.entryOf('llama3.2:1b')?.sources).toEqual([])
  })

  it('resolves nothing while two candidates name a recorded model', () => {
    const ambiguous = catalogIndexOf({
      catalog: {},
      modalities: {},
      facts: { left: { name: 'Left' }, right: { name: 'Right' } },
    })
    expect(matchCatalogEntry('left/right', ambiguous)).toBeUndefined()
    // The user's own pin is what settles it.
    expect(matchCatalogEntry('left/right', ambiguous, { 'left/right': 'right' })?.key).toBe('right')
  })

  it('leaves a variant id unresolved and seeds the picker with its base', () => {
    expect(matchCatalogEntry('glm-5.2-fast-preview/cc', index)).toBeUndefined()
    expect(catalogSearchSeed('glm-5.2-fast-preview/cc', index)).toBe('glm-5.2')
    expect(catalogSearchSeed('deepseek-v4-flash-max', index)).toBe('')
  })
})

describe('declaredInput', () => {
  const entryOf = (input: readonly string[]): CatalogEntry => ({ key: 'm', input, levels: [], sources: [] })

  it('declares the recorded modalities when the entry records image input', () => {
    expect(declaredInput(entryOf(['text', 'image']))).toEqual(['text', 'image'])
    expect(declaredInput(entryOf(['image']))).toEqual(['image'])
  })

  it('declares nothing for a text-only entry, an unresolved row, or nothing recorded', () => {
    expect(declaredInput(entryOf(['text']))).toBeUndefined()
    expect(declaredInput(entryOf([]))).toBeUndefined()
    expect(declaredInput(undefined)).toBeUndefined()
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
  const entry: CatalogEntry = { key: 'qwen2.5:7b', name: 'Qwen 2.5 7B', input: ['text', 'image'], levels: ['off', 'low'], sources: [] }
  const auto = { key: 'qwen2.5:7b', entry, bound: false }

  it('writes the picked levels, the matched image claim, and the name the row displayed', () => {
    expect(modelDeclaration(
      { id: 'qwen2.5:7b', contextWindow: 32768 },
      new Set(['off', 'high']),
      auto,
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
      undefined,
    )).toEqual({
      id: 'private-vl',
      input: ['text', 'image'],
      reasoningEfforts: { high: 'high' },
    })
  })

  it('prefers what the endpoint disclosed over the entry an id resolved to on its own', () => {
    expect(modelDeclaration({ id: 'qwen2.5:7b', name: 'Local Qwen', maxTokens: 4096 }, new Set(), auto)).toEqual({
      id: 'qwen2.5:7b',
      name: 'Local Qwen',
      maxTokens: 4096,
      input: ['text', 'image'],
    })
  })

  it('writes the entry the user pinned over the name and capacities the row carried', () => {
    const rich: CatalogEntry = { ...entry, contextWindow: 262144, maxTokens: 32768 }
    expect(modelDeclaration(
      { id: 'qwen2.5:7b', name: 'Local Qwen', contextWindow: 4096 },
      new Set(['low']),
      { key: 'qwen2.5:7b', entry: rich, bound: true },
    )).toEqual({
      id: 'qwen2.5:7b',
      name: 'Qwen 2.5 7B',
      contextWindow: 262144,
      maxTokens: 32768,
      input: ['text', 'image'],
      reasoningEfforts: { low: 'low' },
    })
  })

  it('writes no input when the entry records no image support', () => {
    expect(modelDeclaration(
      { id: 'llama3.2:1b' },
      new Set(),
      { key: 'llama3.2:1b', entry: { key: 'llama3.2:1b', input: ['text'], levels: [], sources: [] }, bound: false },
    )).toEqual({ id: 'llama3.2:1b' })
  })
})

describe('boundLevels', () => {
  const plain: CatalogEntry = { key: 'a', input: [], levels: ['low'], sources: [] }
  const rich: CatalogEntry = { key: 'b', input: [], levels: ['high', 'max'], sources: [] }

  it('takes the new entry levels when the row had none', () => {
    expect([...(boundLevels(undefined, undefined, rich) ?? [])]).toEqual(['high', 'max'])
  })

  it('follows a re-bind while the picks are still the previous entry s', () => {
    expect([...(boundLevels(new Set(['low']), plain, rich) ?? [])]).toEqual(['high', 'max'])
  })

  it('keeps picks the user made by hand', () => {
    expect(boundLevels(new Set(['off']), plain, rich)).toBeUndefined()
  })
})

describe('formatCapacity', () => {
  it('abbreviates thousands and millions', () => {
    expect(formatCapacity(272_000)).toBe('272k')
    expect(formatCapacity(32_768)).toBe('33k')
    expect(formatCapacity(4096)).toBe('4k')
    expect(formatCapacity(1_000_000)).toBe('1m')
    expect(formatCapacity(1_048_576)).toBe('1m')
    expect(formatCapacity(1_500_000)).toBe('1.5m')
  })

  it('leaves small values alone and reads a non-positive one as unstated', () => {
    expect(formatCapacity(999)).toBe('999')
    expect(formatCapacity(0)).toBeUndefined()
    expect(formatCapacity(undefined)).toBeUndefined()
  })
})

describe('formatCapacityPair', () => {
  it('joins the context and the output capacity', () => {
    expect(formatCapacityPair(256_000, 32_768)).toBe('256k/33k')
    expect(formatCapacityPair(1_000_000, 128_000)).toBe('1m/128k')
  })

  it('writes the one it has, and a dash when it has neither', () => {
    expect(formatCapacityPair(256_000, undefined)).toBe('256k')
    expect(formatCapacityPair(undefined, 32_768)).toBe('33k')
    expect(formatCapacityPair(undefined, undefined)).toBe('—')
  })
})

describe('levelMarks', () => {
  it('marks the levels an entry records, left to right', () => {
    expect(levelMarks(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])).toEqual([true, true, true, true, true, true])
    expect(levelMarks(['minimal', 'low', 'medium', 'high', 'xhigh'])).toEqual([true, true, true, true, true, false])
    expect(levelMarks(['high', 'max'])).toEqual([false, false, false, true, false, true])
  })

  it('leaves off out of the squares and shows six empty ones for nothing recorded', () => {
    expect(levelMarks(['off'])).toEqual([false, false, false, false, false, false])
    expect(levelMarks([])).toEqual([false, false, false, false, false, false])
  })
})

describe('picker query', () => {
  const entry = (key: string, name: string, sources: readonly string[]): CatalogEntry =>
    ({ key, name, input: [], levels: [], sources })
  const glm = entry('glm-5.2', 'GLM-5.2', ['zai-org', 'fireworks'])
  const nano = entry('nano-gpt/glm-5.2', 'GLM 5.2', ['nano-gpt'])

  it('reads @provider tokens apart from text words', () => {
    expect(parsePickerQuery(' glm @zai ')).toEqual({ providers: ['zai'], words: ['glm'] })
    expect(parsePickerQuery('@nano @zai')).toEqual({ providers: ['nano', 'zai'], words: [] })
    expect(parsePickerQuery('   ')).toEqual({ providers: [], words: [] })
  })

  it('matches text against the key, the name, and the sources', () => {
    expect(matchesPickerQuery(glm, parsePickerQuery('glm'))).toBe(true)
    expect(matchesPickerQuery(glm, parsePickerQuery('fire'))).toBe(true)
    expect(matchesPickerQuery(glm, parsePickerQuery('5.2'))).toBe(true)
    expect(matchesPickerQuery(glm, parsePickerQuery('qwen'))).toBe(false)
  })

  it('matches @provider against the sources only, and treats several as alternatives', () => {
    expect(matchesPickerQuery(glm, parsePickerQuery('@zai'))).toBe(true)
    expect(matchesPickerQuery(nano, parsePickerQuery('@zai'))).toBe(false)
    expect(matchesPickerQuery(nano, parsePickerQuery('@nano @zai'))).toBe(true)
  })

  it('needs every text word and the provider together', () => {
    expect(matchesPickerQuery(glm, parsePickerQuery('glm @zai'))).toBe(true)
    expect(matchesPickerQuery(glm, parsePickerQuery('glm @nano'))).toBe(false)
    expect(matchesPickerQuery(glm, parsePickerQuery('glm 5.2'))).toBe(true)
    expect(matchesPickerQuery(glm, parsePickerQuery('glm qwen'))).toBe(false)
  })
})

describe('entryId', () => {
  const entry = (key: string, id?: string): CatalogEntry =>
    ({ key, ...id === undefined ? {} : { id }, input: [], levels: [], sources: [] })

  it('prefers the id models.dev records over an internal stand-in key', () => {
    expect(entryId(entry('fireworks/glm-5.2', 'glm-5.2'))).toBe('glm-5.2')
    expect(entryId(entry('glm-5.2', 'glm-5.2'))).toBe('glm-5.2')
    expect(entryId(entry('glm-5.2'))).toBe('glm-5.2')
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
