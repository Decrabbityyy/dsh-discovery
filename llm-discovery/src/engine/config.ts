import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export interface EngineSwitches {
  /** Ollama native API (`/api/tags` + per-model `/api/show`). Default true. */
  ollama?: boolean
  /** LiteLLM management endpoints (`/model_group/info` and fallbacks). Default true. */
  litellm?: boolean
  /** Generic OpenAI-compatible `GET /models` listing. Default true. */
  openaiModels?: boolean
}

/**
 * Tunables of the endpoint-discovery plugin; every field is optional.
 *
 * 标了 `.volatile()` 的字段是用户可改的设置：Loader 把生效值交下来时，它们是可就地
 * 点更的引用（`.get()` 读当前快照），而不是普通值。其余字段只是部署配置。
 */
export interface Config {
  /** Per-request probe timeout in milliseconds (default 10,000). */
  timeoutMs?: number
  /** Maximum reply size in bytes before a probe is refused (default 4 MiB). */
  maxResponseBytes?: number
  /** Fill fields an endpoint leaves undisclosed from the bundled pi-ai catalog, matched by exact model id (default true). */
  enrichment?: boolean
  /** How often to poll models.dev for changes, in minutes. 0 (default) refreshes once at mount; 1440 is a day. */
  catalogRefreshIntervalMinutes?: Volatile<number | undefined>
  /** Context window for an Ollama model whose `/api/show` metadata carries no `*.context_length` (default 128,000). */
  ollamaDefaultContextWindow?: number
  /** Per-engine kill switches; an engine omitted from the map stays enabled. */
  engines?: EngineSwitches
}

/** Runtime schema for {@link Config}. */
export const Config = z.object({
  timeoutMs: z.number().step(1).min(1),
  maxResponseBytes: z.number().step(1).min(1024),
  enrichment: z.boolean(),
  // 只有标了 `.volatile()` 的字段进设置页、才能被页面改写：刷新间隔是唯一一格用户设置。
  catalogRefreshIntervalMinutes: z.number().step(1).min(0).volatile(),
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
 * 刷新间隔那一格是 volatile 引用，取值要走 `.get()`（见 `../loader-config.ts`）。
 */
export function resolveDiscoveryConfig(config: Config | undefined): ResolvedDiscoveryConfig {
  return {
    timeoutMs: config?.timeoutMs ?? 10_000,
    maxResponseBytes: config?.maxResponseBytes ?? 4 * 1024 * 1024,
    enrichment: config?.enrichment ?? true,
    catalogRefreshIntervalMinutes: config?.catalogRefreshIntervalMinutes?.get() ?? 0,
    ollamaDefaultContextWindow: config?.ollamaDefaultContextWindow ?? 128_000,
    engines: {
      ollama: config?.engines?.ollama ?? true,
      litellm: config?.engines?.litellm ?? true,
      openaiModels: config?.engines?.openaiModels ?? true,
    },
  }
}
