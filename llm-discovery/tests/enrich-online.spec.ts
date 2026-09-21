import { describe, expect, it } from 'vitest'
import type { ModelFacts } from 'dsh-llm-discovery/engine'
import { enrichModelsFromOnline } from '../src/index.ts'

describe('models.dev enrichment', () => {
  it('fills undisclosed fields from the entry an id resolves to', () => {
    const facts = new Map<string, ModelFacts>([['grok-4.6', {
      displayName: 'Grok 4.6',
      contextWindow: 1_000_000,
      maxTokens: 128_000,
    }]])
    expect(enrichModelsFromOnline([{ id: 'xai/grok-4.6' }], facts)).toEqual([{
      id: 'xai/grok-4.6',
      name: 'Grok 4.6',
      contextWindow: 1_000_000,
      maxTokens: 128_000,
    }])
  })

  it('prefers the id the catalog records over the bare name it also records', () => {
    const facts = new Map<string, ModelFacts>([
      ['x-ai/grok-4.6', { displayName: 'xAI: Grok 4.6', contextWindow: 999 }],
      ['grok-4.6', { displayName: 'Grok 4.6', contextWindow: 1_000_000 }],
    ])
    expect(enrichModelsFromOnline([{ id: 'x-ai/grok-4.6' }], facts)).toEqual([{
      id: 'x-ai/grok-4.6',
      name: 'xAI: Grok 4.6',
      contextWindow: 999,
    }])
    // A third segment only ever prefixes, so the bare name is all that is left.
    expect(enrichModelsFromOnline([{ id: 'vendor/x-ai/grok-4.6' }], facts)).toEqual([{
      id: 'vendor/x-ai/grok-4.6',
      name: 'Grok 4.6',
      contextWindow: 1_000_000,
    }])
  })

  it('keeps endpoint metadata authoritative', () => {
    const facts = new Map<string, ModelFacts>([['claude-fable-5-1', {
      displayName: 'Claude Fable 5.1',
      contextWindow: 1_000_000,
      maxTokens: 128_000,
    }]])
    expect(enrichModelsFromOnline([{
      id: 'claude-fable-5-1',
      name: 'Gateway alias',
      contextWindow: 42,
    }], facts)).toEqual([{
      id: 'claude-fable-5-1',
      name: 'Gateway alias',
      contextWindow: 42,
      maxTokens: 128_000,
    }])
  })

  it('leaves ids absent from the online catalog unchanged', () => {
    expect(enrichModelsFromOnline([{ id: 'private-alias' }], new Map())).toEqual([{ id: 'private-alias' }])
  })
})
