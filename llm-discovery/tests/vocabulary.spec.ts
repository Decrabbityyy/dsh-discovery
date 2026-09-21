/**
 * The shared vocabulary and the models.dev parser: the protocol list, the
 * thinking-level spelling, the credential-ref derivation, and the api.json
 * → levels index the discovery surfaces all agree on.
 */

import { describe, expect, it } from 'vitest'
import {
  DISCOVERY_NS,
  DYNAMIC_NS,
  PI_AI_NS,
  ROUTE_PROTOCOLS,
  THINKING_LEVELS,
  UI_CATALOG_PATH,
  catalogEnvelope,
  catalogKeyCandidates,
  catalogKeyIndexOf,
  deriveKeyRef,
  mergeCatalogEnvelopes,
  messageOf,
  reasoningEffortsOf,
  resolveCatalogKey,
} from '../src/vocabulary.ts'
import { inputModalitiesOf } from '../src/engine/catalog.ts'
import { MODELS_DEV_URL, normalizeLevel, normalizeModelName, parseCatalog, parseModalities, parseModelFacts } from '../src/catalog/models-dev.ts'

describe('vocabulary', () => {
  it('lists the wire protocols in the order the dialects were added', () => {
    expect(ROUTE_PROTOCOLS).toEqual(['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'])
  })

  it('lists the thinking levels low-to-high with off first', () => {
    expect(THINKING_LEVELS).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('names the three namespaces the surfaces share', () => {
    expect(DISCOVERY_NS).toBe('llm-discovery')
    expect(PI_AI_NS).toBe('llm-pi-ai')
    expect(DYNAMIC_NS).toBe('llm-dynamic-provider')
  })

  it('spells off as null and passes other wire values through', () => {
    expect(reasoningEffortsOf(new Set(['off', 'high']))).toEqual({ off: null, high: 'high' })
  })

  it('omits the declaration when no level is picked', () => {
    expect(reasoningEffortsOf(new Set())).toBeUndefined()
  })

  it('derives the credential reference from a route id', () => {
    expect(deriveKeyRef('local-ollama')).toBe('LOCAL_OLLAMA_API_KEY')
    expect(deriveKeyRef('openai')).toBe('OPENAI_API_KEY')
  })

  it('renders an Error message and coerces any other rejection', () => {
    expect(messageOf(new Error('broken'))).toBe('broken')
    expect(messageOf('plain')).toBe('plain')
    expect(messageOf(42)).toBe('42')
  })
})

describe('models-dev', () => {
  it('names the public catalog endpoint', () => {
    expect(MODELS_DEV_URL).toBe('https://models.dev/api.json')
  })

  it('normalizes the none effort to off and passes the rest through', () => {
    expect(normalizeLevel('none')).toBe('off')
    expect(normalizeLevel('high')).toBe('high')
  })

  it('indexes effort values by model id across providers', () => {
    const index = parseCatalog({
      deepseek: {
        models: {
          'deepseek-v4-flash': { reasoning: true, reasoning_options: [{ type: 'effort', values: ['high', 'max'] }] },
        },
      },
      anthropic: {
        models: {
          'claude-opus-4.7': { reasoning: true, reasoning_options: [{ type: 'effort', values: ['none', 'medium'] }] },
        },
      },
    })
    expect(index.get('deepseek-v4-flash')).toEqual(['high', 'max'])
    expect(index.get('claude-opus-4.7')).toEqual(['off', 'medium'])
  })

  it('records a reasoning model without an effort entry as an empty list', () => {
    const index = parseCatalog({ acme: { models: { 'acme-1': { reasoning: true } } } })
    expect(index.get('acme-1')).toEqual([])
  })

  it('skips non-reasoning models and keeps the first provider on a shared id', () => {
    const index = parseCatalog({
      a: { models: { shared: { reasoning: true, reasoning_options: [{ type: 'effort', values: ['low'] }] }, plain: {} } },
      b: { models: { shared: { reasoning: true, reasoning_options: [{ type: 'effort', values: ['high'] }] } } },
    })
    expect(index.get('shared')).toEqual(['low'])
    expect(index.has('plain')).toBe(false)
  })

  it('parses a non-object body to an empty index', () => {
    expect(parseCatalog('junk').size).toBe(0)
    expect(parseCatalog(null).size).toBe(0)
  })

  it('keys a provider-prefixed id under both the id and its bare name', () => {
    const index = parseCatalog({
      openrouter: { models: { 'x-ai/grok-4.6': { reasoning: true, reasoning_options: [{ type: 'effort', values: ['low'] }] } } },
    })
    expect(index.get('x-ai/grok-4.6')).toEqual(['low'])
    expect(index.get('grok-4.6')).toEqual(['low'])
  })
})

describe('models-dev modalities', () => {
  it('indexes input/output modalities, dropping values the pi-ai wire cannot carry', () => {
    const index = parseModalities({
      acme: {
        models: {
          'vision-model': { modalities: { input: ['text', 'image'], output: ['text'] } },
          'omni-model': { modalities: { input: ['text', 'image', 'audio', 'video'], output: ['text'] } },
        },
      },
    })
    expect(index.get('vision-model')).toEqual({ input: ['text', 'image'], output: ['text'] })
    expect(index.get('omni-model')).toEqual({ input: ['text', 'image'], output: ['text'] })
  })

  it('omits a model with no modalities block and keeps the first provider on a shared id', () => {
    const index = parseModalities({
      a: { models: { shared: { modalities: { input: ['text'], output: ['text'] } }, plain: {} } },
      b: { models: { shared: { modalities: { input: ['text', 'image'], output: ['text'] } } } },
    })
    expect(index.get('shared')).toEqual({ input: ['text'], output: ['text'] })
    expect(index.has('plain')).toBe(false)
  })

  it('resolves input modalities from the models.dev index before the bundled catalog', () => {
    const index = parseModalities({
      acme: { models: { 'acme-vision': { modalities: { input: ['text', 'image'], output: ['text'] } } } },
    })
    expect(inputModalitiesOf(index, 'acme-vision')).toEqual(['text', 'image'])
    // Unknown to every source: undefined, so the caller defaults.
    expect(inputModalitiesOf(index, 'never-heard-of-it')).toBeUndefined()
  })

  it('keys a provider-prefixed id under both the id and its bare name', () => {
    const index = parseModalities({
      openrouter: { models: { 'x-ai/grok-4.6': { modalities: { input: ['text', 'image'], output: ['text'] } } } },
    })
    expect(index.get('x-ai/grok-4.6')).toEqual({ input: ['text', 'image'], output: ['text'] })
    expect(index.get('grok-4.6')).toEqual({ input: ['text', 'image'], output: ['text'] })
  })
})

describe('normalizeModelName', () => {
  it('drops every provider prefix, keeping the bare model name', () => {
    expect(normalizeModelName('grok-4.6')).toBe('grok-4.6')
    expect(normalizeModelName('x-ai/grok-4.6')).toBe('grok-4.6')
    expect(normalizeModelName('xai/grok-4.6')).toBe('grok-4.6')
    expect(normalizeModelName('openrouter/x-ai/grok-4.6')).toBe('grok-4.6')
  })
})

describe('catalog key resolution', () => {
  it('offers the id itself, the segment before a slash, and the one after', () => {
    expect(catalogKeyCandidates('glm-5.2')).toEqual(['glm-5.2'])
    expect(catalogKeyCandidates('Gemini-3.7-Flash/Antigravity')).toEqual([
      'Gemini-3.7-Flash/Antigravity', 'Gemini-3.7-Flash', 'Antigravity',
    ])
  })

  it('resolves case-insensitively and prefers the id itself', () => {
    const index = catalogKeyIndexOf(['glm-5.2', 'x-ai/grok-4.6'])
    expect(index.keyOf('GLM-5.2')).toBe('glm-5.2')
    expect(index.keyOf('grok-4.6')).toBeUndefined()
    expect(resolveCatalogKey('X-AI/Grok-4.6', index)).toBe('x-ai/grok-4.6')
  })

  it('falls back to whichever half a slash left, and refuses to choose between two', () => {
    const index = catalogKeyIndexOf(['glm-5.2', 'left', 'right'])
    expect(resolveCatalogKey('z-ai/glm-5.2', index)).toBe('glm-5.2')
    expect(resolveCatalogKey('left/right', index)).toBeUndefined()
    expect(resolveCatalogKey('never-heard-of-it', index)).toBeUndefined()
  })
})

describe('parseModelFacts', () => {
  it('keeps every id a provider records and names the provider behind it', () => {
    const index = parseModelFacts({
      'xai': { models: { 'grok-4.6': { name: 'Grok 4.6', reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'high'] }], modalities: { input: ['text', 'image'], output: ['text'] }, limit: { context: 500000, output: 500000 } } } },
      'openrouter': { models: { 'x-ai/grok-4.6': { name: 'xAI: Grok 4.6', limit: { context: 999 } } } },
    })
    // Each provider keeps the id it records. The bare alias belongs to the first
    // provider that spells it, and openrouter's own numbers stay its own entry.
    expect(index.get('grok-4.6')).toEqual({
      displayName: 'Grok 4.6',
      levels: ['low', 'high'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 500000,
      maxTokens: 500000,
      sources: ['xai'],
    })
    expect(index.get('x-ai/grok-4.6')).toEqual({
      displayName: 'xAI: Grok 4.6',
      contextWindow: 999,
      sources: ['openrouter'],
    })
  })

  it('treats a zero or fractional limit as undisclosed', () => {
    const index = parseModelFacts({
      // models.dev writes `context: 0` for a window it does not know.
      'acme': {
        models: {
          'active-speaker-detection': { name: 'Active Speaker Detection', modalities: { output: ['text'] }, limit: { context: 0, output: 4096 } },
          'half-window': { name: 'Half Window', limit: { context: 128000.5 } },
        },
      },
    })
    expect(index.get('active-speaker-detection')).toEqual({
      displayName: 'Active Speaker Detection',
      outputModalities: ['text'],
      maxTokens: 4096,
      sources: ['acme'],
    })
    expect(index.get('half-window')).toEqual({ displayName: 'Half Window', sources: ['acme'] })
  })

  it('merges providers that record the same facts onto one entry', () => {
    const index = parseModelFacts({
      'zai-org': { models: { 'glm-5.2': { name: 'GLM-5.2', limit: { context: 200000 } } } },
      'fireworks': { models: { 'glm-5.2': { name: 'GLM-5.2', limit: { context: 200000 } } } },
    })
    expect(index.size).toBe(1)
    expect(index.get('glm-5.2')).toEqual({
      displayName: 'GLM-5.2',
      contextWindow: 200000,
      sources: ['zai-org', 'fireworks'],
    })
  })

  it('keeps providers that disagree on an entry of their own', () => {
    const index = parseModelFacts({
      'zai-org': { models: { 'glm-5.2': { name: 'GLM-5.2', limit: { context: 200000 } } } },
      'fireworks': { models: { 'glm-5.2': { name: 'GLM-5.2', limit: { context: 131072 }, modalities: { input: ['text'], output: ['text'] } } } },
    })
    // The first provider holds the id; the disagreeing one keeps its own numbers
    // under a provider-qualified name instead of being overwritten or dropped.
    expect(index.get('glm-5.2')).toEqual({ displayName: 'GLM-5.2', contextWindow: 200000, sources: ['zai-org'] })
    expect(index.get('fireworks/glm-5.2')).toEqual({
      displayName: 'GLM-5.2',
      contextWindow: 131072,
      inputModalities: ['text'],
      outputModalities: ['text'],
      sources: ['fireworks'],
    })
  })

  it('keys the levels and modalities views exactly as the facts view', () => {
    const body = {
      'zai-org': { models: { 'glm-5.2': { reasoning: true, reasoning_options: [{ type: 'effort', values: ['high'] }], modalities: { input: ['text', 'image'], output: ['text'] } } } },
      'fireworks': { models: { 'glm-5.2': { reasoning: true, reasoning_options: [{ type: 'effort', values: ['low'] }], modalities: { input: ['text'], output: ['text'] } } } },
    }
    expect([...parseCatalog(body).keys()]).toEqual([...parseModelFacts(body).keys()])
    expect([...parseModalities(body).keys()]).toEqual([...parseModelFacts(body).keys()])
    expect(parseCatalog(body).get('fireworks/glm-5.2')).toEqual(['low'])
    expect(parseModalities(body).get('fireworks/glm-5.2')).toEqual({ input: ['text'], output: ['text'] })
  })

  it('omits absent fields and skips non-reasoning unknowns cleanly', () => {
    const index = parseModelFacts({ acme: { models: { 'plain': { name: 'Plain' } } } })
    expect(index.get('plain')).toEqual({ displayName: 'Plain', sources: ['acme'] })
  })
})

describe('catalog envelope', () => {
  it('pins the section catalog path', () => {
    expect(UI_CATALOG_PATH).toBe('/ui-settings-discovery/catalog')
  })

  it('omits a model that declares levels, modalities, and capacities for nothing', () => {
    expect(catalogEnvelope([['bare', {}]])).toEqual({ catalog: {}, modalities: {}, facts: {} })
  })

  it('carries the levels, modalities, and capacities of a described model', () => {
    expect(catalogEnvelope([['grok-4.6', {
      displayName: 'Grok 4.6',
      levels: ['low', 'high'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 500_000,
      maxTokens: 500_000,
    }]])).toEqual({
      catalog: { 'grok-4.6': ['low', 'high'] },
      modalities: { 'grok-4.6': { input: ['text', 'image'], output: ['text'] } },
      facts: { 'grok-4.6': { name: 'Grok 4.6', contextWindow: 500_000, maxTokens: 500_000 } },
    })
  })

  it('records which providers supplied a key, and omits the table when none did', () => {
    expect(catalogEnvelope([['glm-5.2', { displayName: 'GLM-5.2', sources: ['zai-org', 'fireworks'] }]]).sources)
      .toEqual({ 'glm-5.2': ['zai-org', 'fireworks'] })
    expect(catalogEnvelope([['glm-5.2', { displayName: 'GLM-5.2', sources: [] }]])).toEqual({
      catalog: {},
      modalities: {},
      facts: { 'glm-5.2': { name: 'GLM-5.2' } },
    })
  })

  it('records a one-sided modality fact as an empty list rather than dropping it', () => {
    expect(catalogEnvelope([['vision-only', { inputModalities: ['image'] }]]).modalities)
      .toEqual({ 'vision-only': { input: ['image'], output: [] } })
  })
})

describe('mergeCatalogEnvelopes', () => {
  it('keeps the key of the first body that carries it', () => {
    const merged = mergeCatalogEnvelopes([
      { catalog: { a: ['high'] }, modalities: { a: { input: ['text', 'image'], output: ['text'] } } },
      { catalog: { a: ['low'], b: ['high'] }, modalities: { a: { input: ['text'], output: [] }, b: { input: ['text'], output: ['text'] } } },
    ])
    expect(merged.catalog).toEqual({ a: ['high'], b: ['high'] })
    expect(merged.modalities).toEqual({
      a: { input: ['text', 'image'], output: ['text'] },
      b: { input: ['text'], output: ['text'] },
    })
  })

  it('ignores a missing, malformed, or unrelated body', () => {
    const merged = mergeCatalogEnvelopes([
      undefined,
      'nope',
      7,
      [],
      { catalog: 'no' },
      { facts: { m: { name: 'M', contextWindow: 8 } } },
    ])
    expect(merged).toEqual({ catalog: {}, modalities: {}, facts: { m: { name: 'M', contextWindow: 8 } } })
  })

  it('keeps the provider list of the first body that carries a key', () => {
    const merged = mergeCatalogEnvelopes([
      { sources: { a: ['xai'] } },
      { sources: { a: ['openrouter'], b: ['acme'] } },
    ])
    expect(merged.sources).toEqual({ a: ['xai'], b: ['acme'] })
  })

  it('drops non-string members and non-numeric capacities instead of trusting the body', () => {
    const merged = mergeCatalogEnvelopes([{
      catalog: { a: ['high', 7] },
      modalities: { b: { input: 'text' } },
      facts: { c: { contextWindow: 'wide' } },
      sources: { d: ['acme', 7] },
    }])
    expect(merged).toEqual({
      catalog: { a: ['high'] },
      modalities: { b: { input: [], output: [] } },
      facts: { c: {} },
      sources: { d: ['acme'] },
    })
  })
})
