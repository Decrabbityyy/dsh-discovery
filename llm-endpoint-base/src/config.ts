/**
 * Deployment configuration for `dsh-llm-discovery`. Every field is
 * optional; the resolve step below is the one place defaults are applied.
 * @module dsh-llm-discovery/config
 */

import z from '@deepseek-ai/schemastery'

/** Which endpoint engines the discovery ladder may try. */
export interface EngineSwitches {
  /** Ollama native API (`/api/tags` + per-model `/api/show`). Default true. */
  ollama?: boolean
  /** LiteLLM management endpoints (`/model_group/info` and fallbacks). Default true. */
  litellm?: boolean
  /** Generic OpenAI-compatible `GET /models` listing. Default true. */
  openaiModels?: boolean
}

/** Tunables of the endpoint-discovery plugin. */
export interface Config {
  /** Per-request probe timeout in milliseconds (default 10,000). */
  timeoutMs?: number
  /** Maximum reply size in bytes before a probe is refused (default 4 MiB). */
  maxResponseBytes?: number
  /**
   * Fill fields an endpoint leaves undisclosed from the bundled pi-ai model
   * catalog, matched by exact model id (default true). Endpoint-reported facts
   * always win; unknown ids stay undisclosed.
   */
  enrichment?: boolean
  /**
   * Context window reported for an Ollama model whose `/api/show` metadata
   * carries no `*.context_length` (default 128,000).
   */
  ollamaDefaultContextWindow?: number
  /** Per-engine kill switches; an engine omitted from the map stays enabled. */
  engines?: EngineSwitches
}

/** Schemastery configuration for the endpoint-discovery plugin. */
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
  /** See {@link Config.timeoutMs}. */
  timeoutMs: number
  /** See {@link Config.maxResponseBytes}. */
  maxResponseBytes: number
  /** See {@link Config.enrichment}. */
  enrichment: boolean
  /** See {@link Config.ollamaDefaultContextWindow}. */
  ollamaDefaultContextWindow: number
  /** See {@link Config.engines}. */
  engines: Required<EngineSwitches>
}

/**
 * Resolve the deployment config into its fully-defaulted form.
 * @param config - the raw cordis.yml entry config, already schema-validated.
 * @returns the resolved discovery configuration.
 */
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
