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
import { discoverEndpoint, enrichModels, resolveDiscoveryConfig, catalogReasoningEfforts } from 'dsh-llm-discovery/engine'
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

/**
 * A profile this plugin assembled, with two invariants the harness contract
 * does not state: `piProvider` is always built here (a route that could not be
 * constructed never becomes a profile, it is reported as a probe failure), and
 * `modelErrors` is always empty (discovery drops a model before a route is
 * assembled). Readers rely on both and never re-check them.
 */
export interface DynamicProviderProfile extends ResolvedPiAiProviderProfile {
  readonly piProvider: Provider
  readonly modelErrors: ReadonlyMap<string, string>
}

/** The per-route outcome of one discovery pass. */
export interface DiscoveryOutcome {
  readonly discovered: ReadonlyMap<string, DynamicProviderProfile>
  readonly failed: readonly { readonly route: string; readonly message: string }[]
}

/** Everything a discovery pass reads for cancellation. */
export interface DiscoveryDeps {
  readonly signal: AbortSignal | undefined
}

/**
 * Resolve one route's probe credential: the credential seam first, the launch
 * environment as the fallback layer.
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
 * capacities win; the bundled catalog fills the display name and, for
 * reasoning-capable ids, the thinking levels; the route's declared defaults
 * (then pi-ai's own) size whatever both leave undisclosed. Every model carries
 * the route's protocol, matching pi-ai's explicit `api` posture.
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
 * Assemble one route's resolved profile from its probe answer. The assembly
 * materializes exactly the fields the adapter reads: `provider`, `displayName`,
 * `retryPolicy`, `streamIdleTimeoutMs`, `configuredMaxTokens`, `piProvider`,
 * plus the optional streaming knobs (`reasoning`, `headers`, `transport`,
 * `timeoutMs`, `websocketConnectTimeoutMs`, `thinkingBudgets`,
 * `cacheRetention`), and `modelErrors`, which the harness reads on every
 * prepared call (0.1.5-rc) and which is empty by construction here.
 */
export function assembleProfile(routeName: string, route: RouteProfile, models: readonly Model<Api>[]): DynamicProviderProfile {
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
    // passes it as the stream's apiKey option, so this placeholder resolves to
    // nothing and the request option wins.
    auth: { apiKey: { name: displayName, resolve: () => Promise.resolve({ auth: {}, source: displayName }) } },
    models,
    api: factory(),
  })
  return {
    provider: routeName,
    displayName,
    ...(route.apiKeyEnv === undefined ? {} : { apiKeyEnv: credentialRef(route.apiKeyEnv) }),
    // A credential-less route streams with the placeholder key (see the
    // adapter's resolveApiKey), so the empty Authorization header erases the
    // Bearer line the OpenAI SDK builds from it: keyless gateways refuse a
    // malformed bearer outright. Only openai-completions takes this posture;
    // the other dialects' SDKs would send the placeholder as a real credential.
    ...(route.apiKeyEnv === undefined && route.api === 'openai-completions' ? { headers: { authorization: '' } } : {}),
    streamIdleTimeoutMs: 300_000,
    // Image-payload budgets mirror the llm-pi-ai defaults: 20 MiB base64
    // payload, a 2048x2048 pixel budget, and a 1 MiB raw target.
    maxRequestImageBytes: 20 * 1024 * 1024,
    requestImagePixelBudget: 2048 * 2048,
    requestImageMaxBytes: 1024 * 1024,
    retryPolicy: resolveRetryPolicy(undefined, `llm-dynamic-provider: route "${routeName}" retryPolicy`),
    configuredMaxTokens: new Map(),
    modelErrors: new Map(),
    piProvider,
  }
}

/**
 * Run one discovery pass over the declared dynamic routes. Each route is
 * probed, enriched, and assembled independently; expected probe failures are
 * reported under `failed` rather than thrown, so one bad endpoint never blocks
 * the others.
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
  const discovered = new Map<string, DynamicProviderProfile>()
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
      // Anything the bundled pi-ai catalog still leaves undisclosed comes from
      // the models.dev facts.
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
