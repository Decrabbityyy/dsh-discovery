/**
 * Local-engine presets and the wire-protocol list of the discovery section.
 * The protocol list, the thinking-level vocabulary, and the reasoning-effort
 * spelling all come from `dsh-llm-endpoint-base` so the panel, the discovery
 * host, and the dynamic provider agree on the one definition. Presets only
 * prefill the probe form — every field stays editable — and derive the
 * default route id of the adoption write.
 */

import { ROUTE_PROTOCOLS, THINKING_LEVELS, reasoningEffortsOf } from 'dsh-llm-endpoint-base/vocabulary'

export { ROUTE_PROTOCOLS as PROTOCOLS, THINKING_LEVELS, reasoningEffortsOf }

/** One selectable engine card. */
export interface EnginePreset {
  /** Route id derived when the card is chosen (also keys the card). */
  key: string
  /** Card title. */
  label: string
  /** Endpoint the engine listens on, prefilled into the baseURL field. */
  baseURL: string
  /** Wire protocol the engine speaks, prefilled into the protocol select. */
  api: string
}

/** Local engines the section offers as one-click cards. */
export const ENGINE_PRESETS: readonly EnginePreset[] = [
  { key: 'ollama', label: 'Ollama', baseURL: 'http://127.0.0.1:11434', api: 'openai-completions' },
  { key: 'lm-studio', label: 'LM Studio', baseURL: 'http://127.0.0.1:1234/v1', api: 'openai-completions' },
  { key: 'llama-cpp', label: 'llama.cpp', baseURL: 'http://127.0.0.1:8080', api: 'openai-completions' },
]

/** The custom-endpoint card: no prefill, route id defaults to `custom`. */
export const CUSTOM_PRESET: EnginePreset = {
  key: 'custom',
  label: '自定义端点',
  baseURL: '',
  api: 'openai-completions',
}
