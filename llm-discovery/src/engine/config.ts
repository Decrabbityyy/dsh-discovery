import z from '@deepseek-ai/schemastery'

export interface EngineSwitches {
  /** Ollama native API (`/api/tags` + per-model `/api/show`). Default true. */
  ollama?: boolean
  /** LiteLLM management endpoints (`/model_group/info` and fallbacks). Default true. */
  litellm?: boolean
  /** Generic OpenAI-compatible `GET /models` listing. Default true. */
  openaiModels?: boolean
}

/** Tunables of the endpoint-discovery plugin; every field is optional. */
export interface Config {
  /** Per-request probe timeout in milliseconds (default 10,000). */
  timeoutMs?: number
  /** Maximum reply size in bytes before a probe is refused (default 4 MiB). */
  maxResponseBytes?: number
  /** Fill fields an endpoint leaves undisclosed from the bundled pi-ai catalog, matched by exact model id (default true). */
  enrichment?: boolean
  /** Context window for an Ollama model whose `/api/show` metadata carries no `*.context_length` (default 128,000). */
  ollamaDefaultContextWindow?: number
  /** Per-engine kill switches; an engine omitted from the map stays enabled. */
  engines?: EngineSwitches
}

export const Config: z<Config> = z.object({
  timeoutMs: z.number().step(1).min(1),
  maxResponseBytes: z.number().step(1).min(1024),
  enrichment: z.boolean(),
  ollamaDefaultContextWindow: z.number().step(1).min(1),
  engines: z.object({
    ollama: z.boolean(),
    litellm: z.boolean(),
    openaiModels: z.boolean(),
  }),
})

/** The configuration with every default applied. */
export interface ResolvedDiscoveryConfig {
  timeoutMs: number
  maxResponseBytes: number
  enrichment: boolean
  ollamaDefaultContextWindow: number
  engines: Required<EngineSwitches>
}

/** Resolve the deployment config into its fully-defaulted form. This is the one place the defaults live. */
export function resolveDiscoveryConfig(config: Config | undefined): ResolvedDiscoveryConfig {
  return {
    timeoutMs: config?.timeoutMs ?? 10_000,
    maxResponseBytes: config?.maxResponseBytes ?? 4 * 1024 * 1024,
    enrichment: config?.enrichment ?? true,
    ollamaDefaultContextWindow: config?.ollamaDefaultContextWindow ?? 128_000,
    engines: {
      ollama: config?.engines?.ollama ?? true,
      litellm: config?.engines?.litellm ?? true,
      openaiModels: config?.engines?.openaiModels ?? true,
    },
  }
}
