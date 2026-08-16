/**
 * Assembly of a self-hosted pi-ai adapter's resolved profiles from runtime
 * discovery. Each declared route is reprobed against its endpoint, translated
 * into pi-ai `Model`s (endpoint facts, bundled-catalog enrichment,
 * catalog-derived `reasoningEfforts`), and materialized into a
 * `ResolvedPiAiProviderProfile` through pi-ai's public `createProvider` — no
 * settings document is read or written; the catalog lives in the in-memory
 * LLM registry behind `ctx.llm.registerAdapter`.
 *
 * pi-ai's own `resolveProfiles`/`buildProvider` are not reachable from the
 * published entry point, so the resolved profile is assembled here from the
 * same public building blocks (`createProvider`, the per-protocol lazy API
 * factories, `credentialRef`, `resolveRetryPolicy`). The adapter consumes a
 * documented subset of profile fields (see {@link assembleProfile}); the
 * per-request credential flows through `resolveApiKey`, not `piProvider.auth`.
 * @module dsh-llm-dynamic-provider/provider
 */

import { createProvider } from '@earendil-works/pi-ai'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { googleGenerativeAIApi } from '@earendil-works/pi-ai/api/google-generative-ai.lazy'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import type { Api, Model, Provider, ProviderStreams } from '@earendil-works/pi-ai'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { assertUsableApiKey, LlmError, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { discoverEndpoint, enrichModels, resolveDiscoveryConfig, catalogReasoningEfforts } from 'dsh-llm-endpoint-base'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-llm'
import type { Config, RouteProfile } from './config.ts'

/** The wire protocols a dynamic route may speak, mapped to pi-ai's lazy API factories. */
const PROTOCOLS: Readonly<Record<string, () => ProviderStreams>> = {
  'openai-completions': openAICompletionsApi,
  'openai-responses': openAIResponsesApi,
  'anthropic-messages': anthropicMessagesApi,
  'google-generative-ai': googleGenerativeAIApi,
}

/** pi-ai's sizing defaults, mirrored so a discovered model is always fully sized. */
const DEFAULT_CONTEXT_WINDOW = 262_144
const DEFAULT_MAX_TOKENS = 32_768

/** The per-route outcome of one discovery pass. */
export interface DiscoveryOutcome {
  /** Routes that probed successfully and assembled to a serviceable profile. */
  readonly discovered: ReadonlyMap<string, ResolvedPiAiProviderProfile>
  /** Routes whose probe failed or answered empty before assembling. */
  readonly failed: readonly { readonly route: string; readonly message: string }[]
}

/** Everything a discovery pass reads for cancellation. */
export interface DiscoveryDeps {
  /** Caller cancellation for the whole pass. */
  readonly signal: AbortSignal | undefined
}

/**
 * Resolve one route's probe credential: credential seam first, launch
 * environment as the fallback layer. Mirrors pi-ai's own resolution so a
 * dynamic route authenticates its probe exactly as it would a request.
 */
async function resolveKey(ctx: Context, ref: string | undefined): Promise<string | undefined> {
  if (ref === undefined) return undefined
  const credentials = ctx.get('credentials')
  const hit = credentials !== undefined
    ? (await credentials.resolve(credentialRef(ref)))?.value
    : launchEnvironmentOf(ctx).get(ref)?.value
  return hit !== undefined && hit.length > 0 ? assertUsableApiKey(hit, 'dsh-llm-dynamic-provider', ref) : undefined
}

/**
 * Translate one discovered model into a pi-ai `Model`. Endpoint-disclosed
 * capacities win; the bundled catalog fills the display name and, for ids it
 * records as reasoning-capable, the thinking levels; the route's declared
 * defaults (then pi-ai's own) size whatever both leave undisclosed. Every
 * model on a route carries the route's protocol, matching pi-ai's explicit
 * `api` posture for a non-catalog route.
 */
export function toModel(routeName: string, route: RouteProfile, discovered: LlmDiscoveredModel, inputModalities?: readonly string[]): Model<Api> {
  const reasoningEfforts = catalogReasoningEfforts(discovered.id)
  return {
    id: discovered.id,
    name: discovered.name ?? discovered.id,
    api: route.api,
    // The route key: pi-ai's Models registry resolves `model.provider`
    // against its registered provider ids at stream time (`requireProvider`).
    provider: routeName,
    baseUrl: route.baseURL,
    reasoning: reasoningEfforts !== undefined,
    // The catalog records the accepted input modalities; an unknown id stays
    // text-only (pi-ai's own default for a model it cannot size).
    input: (inputModalities === undefined || inputModalities.length === 0 ? ['text'] : inputModalities) as Model<Api>['input'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: discovered.contextWindow ?? route.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: discovered.maxTokens ?? route.defaultMaxTokens ?? DEFAULT_MAX_TOKENS,
    ...(reasoningEfforts === undefined
      ? {}
      : { thinkingLevelMap: reasoningEfforts as Model<Api>['thinkingLevelMap'] }),
  } as Model<Api>
}

/**
 * Assemble one route's resolved profile from its probe answer. The adapter
 * reads a documented subset of fields — `provider`, `displayName`,
 * `retryPolicy`, `streamIdleTimeoutMs`, `configuredMaxTokens`, `piProvider`,
 * plus the optional streaming knobs (`reasoning`, `headers`, `transport`,
 * `timeoutMs`, `websocketConnectTimeoutMs`, `thinkingBudgets`,
 * `cacheRetention`) — so the assembly materializes exactly those. The
 * credential does not flow through `piProvider.auth`: the adapter resolves it
 * per request through `resolveApiKey` and passes it as the `apiKey` stream
 * option, so the provider's auth is an ambient placeholder.
 */
export function assembleProfile(routeName: string, route: RouteProfile, models: readonly Model<Api>[]): ResolvedPiAiProviderProfile {
  const factory = PROTOCOLS[route.api]
  if (factory === undefined) {
    throw new LlmError(
      `llm-dynamic-provider: route "${routeName}" names api "${route.api}", which this build cannot serve;`
      + ` supported protocols are ${Object.keys(PROTOCOLS).join(', ')}`,
      'UNSUPPORTED_PROTOCOL',
    )
  }
  const displayName = route.displayName ?? routeName
  const piProvider: Provider = createProvider({
    id: routeName,
    name: displayName,
    baseUrl: route.baseURL,
    // Ambient-only auth: the harness resolves the credential per request and
    // passes it as the stream's apiKey option, so the provider never resolves
    // a key of its own. This placeholder resolves to nothing and the request
    // option wins.
    auth: { apiKey: { name: displayName, resolve: () => Promise.resolve({ auth: {}, source: displayName }) } },
    models,
    api: factory(),
  })
  return {
    provider: routeName,
    displayName,
    ...(route.apiKeyEnv === undefined ? {} : { apiKeyEnv: credentialRef(route.apiKeyEnv) }),
    // A credential-less route streams with the placeholder key (see the
    // adapter's resolveApiKey); the empty Authorization header erases the
    // Bearer line the OpenAI SDK builds from it — keyless gateways refuse a
    // malformed bearer outright, so the request must carry no bearer value.
    // Only openai-completions takes this posture: the other dialects' SDKs
    // would send the placeholder as a real credential (x-api-key and kin).
    ...(route.apiKeyEnv === undefined && route.api === 'openai-completions' ? { headers: { authorization: '' } } : {}),
    streamIdleTimeoutMs: 300_000,
    retryPolicy: resolveRetryPolicy(undefined, `llm-dynamic-provider: route "${routeName}" retryPolicy`),
    configuredMaxTokens: new Map(),
    piProvider,
  } as ResolvedPiAiProviderProfile
}

/**
 * Run one discovery pass over the declared dynamic routes. Each route is
 * probed, enriched, and assembled independently; a route that throws is
 * reported under `failed` and absent from `discovered`, so one bad endpoint
 * never blocks the others.
 * @param ctx - the host context (credential seam + launch environment).
 * @param routes - the declared dynamic routes.
 * @param config - the plugin's probe configuration.
 * @param deps - caller cancellation.
 * @returns the per-route outcome; expected probe failures are reported, not thrown.
 */
export async function discoverDynamicProviders(
  ctx: Context,
  routes: Readonly<Record<string, RouteProfile>>,
  config: Config | undefined,
  deps: DiscoveryDeps,
  catalog?: {
    inputModalitiesOf(modelId: string): readonly string[] | undefined
    /** models.dev facts by endpoint id, for enriching what the bundled catalog misses. */
    factsOf(modelId: string): { displayName?: string; contextWindow?: number; maxTokens?: number } | undefined
  },
): Promise<DiscoveryOutcome> {
  const discovered = new Map<string, ResolvedPiAiProviderProfile>()
  const failed: { route: string; message: string }[] = []
  const discovery = resolveDiscoveryConfig(config)
  for (const [routeName, route] of Object.entries(routes)) {
    try {
      const apiKey = await resolveKey(ctx, route.apiKeyEnv)
      const raw = await discoverEndpoint(
        {
          baseURL: route.baseURL,
          api: route.api,
          ...(apiKey === undefined ? {} : { apiKey }),
          ...(deps.signal === undefined ? {} : { signal: deps.signal }),
        },
        discovery,
      )
      if (raw.length === 0) throw new LlmError(`endpoint "${route.baseURL}" advertises no models`, 'DISCOVERY_EMPTY')
      const piEnriched = discovery.enrichment ? enrichModels(raw) : [...raw]
      // Fill whatever the bundled pi-ai catalog still leaves undisclosed from
      // the models.dev facts — a fresh model pi-ai has not catalogued yet
      // (a new grok) still gets its real name and capacities.
      const enriched = piEnriched.map((model) => {
        const fact = catalog?.factsOf(model.id)
        if (fact === undefined) return model
        return {
          ...model,
          ...model.name === undefined && fact.displayName !== undefined ? { name: fact.displayName } : {},
          ...model.contextWindow === undefined && fact.contextWindow !== undefined ? { contextWindow: fact.contextWindow } : {},
          ...model.maxTokens === undefined && fact.maxTokens !== undefined ? { maxTokens: fact.maxTokens } : {},
        }
      })
      discovered.set(routeName, assembleProfile(routeName, route, enriched.map(model => toModel(routeName, route, model, catalog?.inputModalitiesOf(model.id)))))
    } catch (error) {
      failed.push({ route: routeName, message: error instanceof Error ? error.message : String(error) })
    }
  }
  return { discovered, failed }
}
