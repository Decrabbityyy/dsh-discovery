import { describe, expect, it } from 'vitest'
import type { ModelFacts } from 'dsh-llm-endpoint-base'
import { enrichModelsFromOnline } from '../src/index.ts'

describe('models.dev enrichment', () => {
  it('fills undisclosed fields by normalized model id', () => {
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
