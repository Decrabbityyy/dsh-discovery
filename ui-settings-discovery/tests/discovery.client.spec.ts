/** Wire constants, derivation helpers, and presets of the discovery section. */
import { describe, expect, it } from 'vitest'
import { CUSTOM_PRESET, ENGINE_PRESETS, PROTOCOLS } from '../src/client/presets.ts'
import {
  deriveKeyRef, DISCOVERY_NS, DISCOVERY_PLUGIN, DYNAMIC_PLUGIN, isActivePlugin,
  messageOf, PI_AI_NS, ROUTE_PATTERN,
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
