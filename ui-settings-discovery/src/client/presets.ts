import { ROUTE_PROTOCOLS, THINKING_LEVELS, reasoningEffortsOf } from 'dsh-llm-discovery/vocabulary'

export { ROUTE_PROTOCOLS as PROTOCOLS, THINKING_LEVELS, reasoningEffortsOf }

export interface EnginePreset {
  /** Route id derived when the card is chosen; also the card key. */
  key: string
  label: string
  baseURL: string
  /** Prefilled into the protocol select. */
  api: string
}

/** Local engines the section offers as one-click cards. */
export const ENGINE_PRESETS: readonly EnginePreset[] = [
  { key: 'ollama', label: 'Ollama', baseURL: 'http://127.0.0.1:11434/v1', api: 'openai-completions' },
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
