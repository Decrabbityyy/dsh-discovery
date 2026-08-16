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
  deriveKeyRef,
  messageOf,
  reasoningEffortsOf,
} from '../src/vocabulary.ts'
import { MODELS_DEV_URL, inputModalitiesOf, normalizeLevel, normalizeModelName, parseCatalog, parseModalities, parseModelFacts } from '../src/models-dev.ts'

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

  it('spells off as the empty wire value and passes other levels through', () => {
    expect(reasoningEffortsOf(new Set(['off', 'high']))).toEqual({ off: '', high: 'high' })
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
})

describe('normalizeModelName', () => {
  it('drops every provider prefix, keeping the bare model name', () => {
    expect(normalizeModelName('grok-4.6')).toBe('grok-4.6')
    expect(normalizeModelName('x-ai/grok-4.6')).toBe('grok-4.6')
    expect(normalizeModelName('xai/grok-4.6')).toBe('grok-4.6')
    expect(normalizeModelName('openrouter/x-ai/grok-4.6')).toBe('grok-4.6')
  })
})

describe('parseModelFacts', () => {
  it('collapses provider-prefixed duplicates onto the bare name with full facts', () => {
    const index = parseModelFacts({
      'xai': { models: { 'grok-4.6': { name: 'Grok 4.6', reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'high'] }], modalities: { input: ['text', 'image'], output: ['text'] }, limit: { context: 500000, output: 500000 } } } },
      'openrouter': { models: { 'x-ai/grok-4.6': { name: 'xAI: Grok 4.6 (dup)', limit: { context: 999 } } } },
    })
    // The first provider in file order wins; the duplicate never overwrites.
    expect(index.size).toBe(1)
    expect(index.get('grok-4.6')).toEqual({
      displayName: 'Grok 4.6',
      levels: ['low', 'high'],
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      contextWindow: 500000,
      maxTokens: 500000,
    })
  })

  it('omits absent fields and skips non-reasoning unknowns cleanly', () => {
    const index = parseModelFacts({ acme: { models: { 'plain': { name: 'Plain' } } } })
    expect(index.get('plain')).toEqual({ displayName: 'Plain' })
  })
})
