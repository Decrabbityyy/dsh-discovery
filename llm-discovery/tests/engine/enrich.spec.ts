/** Bundled-catalog enrichment semantics: exact-id fill, endpoint-wins, and honest unknowns, plus the configuration resolve step's defaults. */

import { describe, expect, it } from 'vitest'
import { resolveDiscoveryConfig } from '../../src/engine/config.ts'
import { enrichModels } from '../../src/engine/enrich.ts'

describe('enrichModels', () => {
  it('fills every undisclosed field of a catalog-known id', () => {
    expect(enrichModels([{ id: 'claude-haiku-4-5' }])).toEqual([
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5 (latest)', contextWindow: 200_000, maxTokens: 64_000 },
    ])
  })

  it('never overwrites endpoint-reported values', () => {
    expect(enrichModels([{ id: 'claude-haiku-4-5', name: 'Mirror', contextWindow: 5, maxTokens: 6 }])).toEqual([
      { id: 'claude-haiku-4-5', name: 'Mirror', contextWindow: 5, maxTokens: 6 },
    ])
    expect(enrichModels([{ id: 'claude-haiku-4-5', maxTokens: 6 }])).toEqual([
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5 (latest)', contextWindow: 200_000, maxTokens: 6 },
    ])
  })

  it('leaves catalog-unknown ids honestly undisclosed', () => {
    expect(enrichModels([{ id: 'acme-private', name: 'Acme' }])).toEqual([{ id: 'acme-private', name: 'Acme' }])
  })

  it('serves repeat calls from the memoized index', () => {
    enrichModels([{ id: 'claude-haiku-4-5' }])
    expect(enrichModels([{ id: 'gpt-4.1' }])).toEqual([
      { id: 'gpt-4.1', name: 'GPT-4.1', contextWindow: 1_047_576, maxTokens: 32_768 },
    ])
  })
})

describe('resolveDiscoveryConfig', () => {
  it('applies the documented defaults', () => {
    expect(resolveDiscoveryConfig(undefined)).toEqual({
      timeoutMs: 10_000,
      maxResponseBytes: 4 * 1024 * 1024,
      enrichment: true,
      catalogRefreshIntervalMs: 0,
      ollamaDefaultContextWindow: 128_000,
      engines: { ollama: true, litellm: true, openaiModels: true },
    })
  })

  it('keeps explicit values and fills the rest', () => {
    expect(resolveDiscoveryConfig({ timeoutMs: 5_000, catalogRefreshIntervalMs: 3_600_000, engines: { ollama: false } })).toEqual({
      timeoutMs: 5_000,
      maxResponseBytes: 4 * 1024 * 1024,
      enrichment: true,
      catalogRefreshIntervalMs: 3_600_000,
      ollamaDefaultContextWindow: 128_000,
      engines: { ollama: false, litellm: true, openaiModels: true },
    })
  })
})
