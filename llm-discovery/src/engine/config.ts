import z from '@deepseek-ai/schemastery'
import { configValue, volatileField } from '../compat.ts'

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
  /** How often to poll models.dev for changes, in minutes. 0 (default) refreshes once at mount; 1440 is a day. */
  catalogRefreshIntervalMinutes?: number
  /** Context window for an Ollama model whose `/api/show` metadata carries no `*.context_length` (default 128,000). */
  ollamaDefaultContextWindow?: number
  /** Per-engine kill switches; an engine omitted from the map stays enabled. */
  engines?: EngineSwitches
}

export const Config: z<Config> = z.object({
  timeoutMs: z.number().step(1).min(1),
  maxResponseBytes: z.number().step(1).min(1024),
  enrichment: z.boolean(),
  // 0.1.7 上这一格是用户可改的设置字段（设置页写它、本插件读它）；0.1.5 上
  // `volatileField` 原样返回，用户层由下面 `legacySettings()` 注册的命名空间承担。
  catalogRefreshIntervalMinutes: volatileField(z.number().step(1).min(0)),
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
  catalogRefreshIntervalMinutes: number
  ollamaDefaultContextWindow: number
  engines: Required<EngineSwitches>
}

/**
 * Resolve the deployment config into its fully-defaulted form. This is the one place the defaults live.
 *
 * 每一个字段都过一遍 `configValue`：0.1.7 交下来的配置里，标了 `.volatile()` 的字段
 * 是引用而不是值（见 `../compat.ts`）。
 */
export function resolveDiscoveryConfig(config: Config | undefined): ResolvedDiscoveryConfig {
  return {
    timeoutMs: configValue(config?.timeoutMs) ?? 10_000,
    maxResponseBytes: configValue(config?.maxResponseBytes) ?? 4 * 1024 * 1024,
    enrichment: configValue(config?.enrichment) ?? true,
    catalogRefreshIntervalMinutes: configValue(config?.catalogRefreshIntervalMinutes) ?? 0,
    ollamaDefaultContextWindow: configValue(config?.ollamaDefaultContextWindow) ?? 128_000,
    engines: {
      ollama: configValue(config?.engines?.ollama) ?? true,
      litellm: configValue(config?.engines?.litellm) ?? true,
      openaiModels: configValue(config?.engines?.openaiModels) ?? true,
    },
  }
}
