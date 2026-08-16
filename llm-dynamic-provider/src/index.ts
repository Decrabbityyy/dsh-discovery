/**
 * `dsh-llm-dynamic-provider`: OMP-style runtime model discovery on a
 * self-hosted pi-ai adapter. Each declared route is reprobed against its
 * endpoint at startup, assembled into a resolved pi-ai profile (endpoint
 * facts, bundled-catalog enrichment, catalog-derived `reasoningEfforts`),
 * and registered on `ctx.llm` through a self-constructed `PiAiAdapter` — the
 * discovered catalog lives in the in-memory LLM registry and is rebuilt on
 * every boot, never written to any settings document (the plugin's namespace
 * persists only the route declarations). With `cache: true` the last
 * discovered catalog persists under `$DSH_HOME` so a cold boot registers
 * routes immediately and refreshes them in the background once the probe
 * answers. Four wire protocols are served (openai-completions,
 * openai-responses, anthropic-messages, google-generative-ai). Named exports
 * preserve loader injection metadata.
 * @module dsh-llm-dynamic-provider
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle, LlmDiscoveredModel } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-settings/types'
import type { LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import type { DirectoryRegistrationHandle } from '@deepseek-ai/dsh-llm'
import type { Config, DynamicSection } from './config.ts'
import { NamespaceConfig } from './config.ts'
import { assembleProfile, discoverDynamicProviders, toModel } from './provider.ts'
import { openModelCatalog, refreshModelCatalog } from 'dsh-llm-endpoint-base/store'
import { catalogInputModalities, catalogReasoningEfforts, discoverEndpoint, enrichModels, MODELS_DEV_URL, normalizeModelName, parseModelFacts, resolveDiscoveryConfig } from 'dsh-llm-endpoint-base'
import type { ModelFacts } from 'dsh-llm-endpoint-base'

export { Config, NamespaceConfig } from './config.ts'
export type { DynamicSection, RouteProfile } from './config.ts'
export { catalogReasoningEfforts } from 'dsh-llm-endpoint-base'
export type { ReasoningEfforts } from 'dsh-llm-endpoint-base'
export { assembleProfile, discoverDynamicProviders, toModel } from './provider.ts'
export type { DiscoveryDeps, DiscoveryOutcome } from './provider.ts'

/** The minimal webServer face this plugin reads: named exact-path route registration. */
interface WebServerFace {
  register(route: {
    kind: 'exact'
    path: string
    handler: (req: unknown, res: { statusCode: number; setHeader(name: string, value: string): void; end(body: string): void }) => void | Promise<void>
  }): () => void
}

/** Cordis plugin name. */
export const name = 'llm-dynamic-provider'
/** The llm seam owns the registry; the settings seam owns the route namespace. */
export const inject = ['llm', 'settings']

/** This plugin's settings namespace: the webui-editable dynamic route declarations. */
export const DYNAMIC_NS = settingsNamespace('llm-dynamic-provider')

/** The cache file name under the harness home. */
const CACHE_FILE = 'llm-dynamic-provider-cache.json'

/** The on-disk cache: the discovered model facts per route, keyed by route name. */
interface DynamicCache {
  readonly routes: Record<string, { readonly models: readonly LlmDiscoveredModel[] }>
}

/** Read the persisted cache, tolerating absence and corruption as empty. */
async function readCache(home: string): Promise<DynamicCache> {
  try {
    const raw = JSON.parse(await readFile(join(home, CACHE_FILE), 'utf8')) as DynamicCache
    return typeof raw === 'object' && raw !== null && typeof raw.routes === 'object' ? raw : { routes: {} }
  } catch {
    return { routes: {} }
  }
}

/** Persist the discovered model facts behind the resolved profiles. */
async function writeCache(home: string, profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>): Promise<void> {
  const routes: DynamicCache['routes'] = {}
  for (const [route, profile] of profiles) {
    routes[route] = {
      models: profile.piProvider.getModels().map((model: { id: string; name: string; contextWindow: number; maxTokens: number }) => ({
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
      })),
    }
  }
  await mkdir(home, { recursive: true })
  await writeFile(join(home, CACHE_FILE), JSON.stringify({ routes }, null, 2), 'utf8')
}

/**
 * Mount the dynamic-provider adapter. Declared routes register on first
 * successful probe; with `cache` on, a cold boot registers from the persisted
 * catalog synchronously and lets the live probe refresh the registration.
 * @param ctx - registrant context carrying the llm seam.
 * @param config - the cordis.yml entry config; `routes` is the route set.
 */
export function apply(ctx: Context, config?: Config): void {
  ctx.settings.register(DYNAMIC_NS, NamespaceConfig, { base: { routes: config?.routes ?? {} } })
  const home = config?.cache === true ? resolveDshHome() : undefined

  // The models.dev catalog (thinking levels + input/output modalities +
  // capacities), keyed by bare model name. When the composition mounts the
  // storage seam it is persisted there (cold boot skips the network, an ETag
  // refresh upserts only changed rows); otherwise it is an in-memory snapshot
  // refreshed from models.dev on boot. Served over an HTTP route when a web
  // server is mounted, so the settings panel preselects each discovered
  // model's levels and modality. Headless compositions (no webServer) skip the
  // route. The in-memory map is the synchronous read path for enrichment and
  // modality lookups; the domain is the durable layer.
  // The in-memory read path. Values may come from the storage domain (zod
  // optional fields) or the in-memory fallback, so the map is read loosely.
  const facts = new Map<string, ModelFacts>()
  // The modality read path: the models.dev facts first (fresh, prefixed or
  // not), then the bundled pi-ai catalog for ids models.dev does not list.
  const modalitiesOf = (modelId: string): readonly string[] | undefined => {
    const fact = facts.get(normalizeModelName(modelId))
    if (fact?.inputModalities !== undefined && fact.inputModalities.length > 0) return fact.inputModalities
    return catalogInputModalities(modelId)
  }
  void (async () => {
    const opened = await openModelCatalog(ctx).catch(() => undefined)
    if (opened !== undefined) {
      // Durable path: load persisted rows, then refresh incrementally. The
      // domain row and ModelFacts are structurally the same record; the cast
      // only bridges zod's `| undefined` optionals to exact-optional types.
      for (const [name, row] of opened.models.entries()) facts.set(name, row as ModelFacts)
      await refreshModelCatalog(opened)
      // Re-read after refresh so the map carries the upserted rows.
      facts.clear()
      for (const [name, row] of opened.models.entries()) facts.set(name, row as ModelFacts)
      return
    }
    // In-memory path: a full fetch into the map (no durability).
    try {
      const response = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(15_000) })
      if (response.ok) {
        for (const [name, fact] of parseModelFacts(await response.json())) facts.set(name, fact)
      }
    } catch {
      // No network on boot: the map stays empty and enrichment falls back to pi-ai only.
    }
  })()
  const webServer = ctx.get('webServer') as WebServerFace | undefined
  // Route registrations are effects: an HMR reload or unload must withdraw both
  // endpoints, or the next mount's register throws `duplicate exact route`.
  if (webServer !== undefined) {
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/llm-dynamic-provider/catalog',
      handler: (_req, res) => {
        const levels: Record<string, readonly string[]> = {}
        const modalities: Record<string, { input: readonly string[]; output: readonly string[] }> = {}
        const modelFacts: Record<string, { name?: string; contextWindow?: number; maxTokens?: number }> = {}
        for (const [name, fact] of facts) {
          if (fact.levels !== undefined) levels[name] = fact.levels
          if (fact.inputModalities !== undefined || fact.outputModalities !== undefined) {
            modalities[name] = { input: fact.inputModalities ?? [], output: fact.outputModalities ?? [] }
          }
          if (fact.displayName !== undefined || fact.contextWindow !== undefined || fact.maxTokens !== undefined) {
            modelFacts[name] = {
              ...fact.displayName === undefined ? {} : { name: fact.displayName },
              ...fact.contextWindow === undefined ? {} : { contextWindow: fact.contextWindow },
              ...fact.maxTokens === undefined ? {} : { maxTokens: fact.maxTokens },
            }
          }
        }
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ catalog: levels, modalities, facts: modelFacts }))
      },
    }), 'llm-dynamic-provider: catalog endpoint')
  }

  // The route read/write endpoint. The settings RPC refuses this namespace
  // until the configurable-provider directory names it, and the directory
  // needs ≥1 route — so the very write that adds the first route can never
  // pass through the proxy. The panel therefore talks to the plugin's own
  // endpoint, which writes through the settings seam directly (same process,
  // no proxy exposure gate). Served only where a web server is mounted.
  const readBody = (req: unknown): Promise<unknown> => new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    // The web server passes a Node IncomingMessage; only its stream events are read.
    const stream = req as { on(event: 'data', cb: (chunk: Buffer) => void): void; on(event: 'end', cb: () => void): void; on(event: 'error', cb: (error: Error) => void): void }
    stream.on('data', (chunk) => { chunks.push(chunk) })
    stream.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
    stream.on('error', (error) => { reject(error) })
  })
  const sendJson = (res: { statusCode: number; setHeader(name: string, value: string): void; end(body: string): void }, status: number, body: unknown): void => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(body))
  }
  if (webServer !== undefined) {
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/llm-dynamic-provider/routes',
      handler: async (req, res) => {
        const method = (req as { method?: string }).method ?? 'GET'
        if (method === 'GET') {
          const section = ctx.settings.get(DYNAMIC_NS) as DynamicSection | undefined
          sendJson(res, 200, { routes: section?.routes ?? {} })
          return
        }
        if (method !== 'POST') {
          sendJson(res, 405, { error: 'method not allowed' })
          return
        }
        let body: { op?: unknown; routeId?: unknown; route?: unknown }
        try {
          body = await readBody(req) as typeof body
        } catch {
          sendJson(res, 400, { error: 'invalid JSON body' })
          return
        }
        const routeId = typeof body.routeId === 'string' ? body.routeId : ''
        if (!/^[a-z0-9-]+$/.test(routeId)) {
          sendJson(res, 400, { error: 'routeId must be lowercase letters, digits, and hyphens' })
          return
        }
        try {
          if (body.op === 'set') {
            await ctx.settings.mutate(DYNAMIC_NS, [{ op: 'set', path: ['routes', routeId], value: body.route }])
          } else if (body.op === 'unset') {
            await ctx.settings.mutate(DYNAMIC_NS, [{ op: 'unset', path: ['routes', routeId] }])
          } else {
            sendJson(res, 400, { error: 'op must be set or unset' })
            return
          }
        } catch (error) {
          sendJson(res, 422, { error: error instanceof Error ? error.message : String(error) })
          return
        }
        const section = ctx.settings.get(DYNAMIC_NS) as DynamicSection | undefined
        sendJson(res, 200, { routes: section?.routes ?? {} })
      },
    }), 'llm-dynamic-provider: routes endpoint')
  }

  // The discovery offer doubles as the loaded-signal the settings panel
  // probes: `llm.discoverModels` against this namespace answers only while
  // this plugin is mounted, so the panel shows its block exactly then. The
  // reply enriches each model with the catalog's reasoning levels, which the
  // panel preselects — the wire passes the extra field through.
  const discovery = resolveDiscoveryConfig(config)
  ctx.llm.registerModelDiscovery(DYNAMIC_NS, async (request) => {
    const raw = await discoverEndpoint(request, discovery)
    const enriched = discovery.enrichment ? enrichModels(raw) : [...raw]
    // A model the bundled pi-ai catalog has not caught up with (e.g. a fresh
    // grok) still enriches from the models.dev facts: endpoint-reported facts
    // always win, then pi-ai, then models.dev fills what is still missing.
    return enriched.map((model) => {
      const fact = facts.get(normalizeModelName(model.id))
      return {
        ...model,
        ...model.name === undefined && fact?.displayName !== undefined ? { name: fact.displayName } : {},
        ...model.contextWindow === undefined && fact?.contextWindow !== undefined ? { contextWindow: fact.contextWindow } : {},
        ...model.maxTokens === undefined && fact?.maxTokens !== undefined ? { maxTokens: fact.maxTokens } : {},
        reasoningEfforts: catalogReasoningEfforts(model.id),
      }
    })
  })

  // Live profiles the adapter reads per request. Rebuilt on each reprobe;
  // starts from the cache (when enabled) so a cold boot has routes to serve.
  let current = new Map<string, ResolvedPiAiProviderProfile>()
  let registration: AdapterRegistrationHandle | undefined

  const adapter = new PiAiAdapter({
    profiles: () => current,
    resolveApiKey: async (provider, profile) => {
      const ref = profile.apiKeyEnv
      // A route naming no credential is an unauthenticated endpoint (a local
      // engine, a free gateway). pi-ai's dialects require SOME apiKey string
      // to construct their client, so an inert placeholder satisfies the
      // check; on the openai-completions dialect the profile's empty
      // Authorization header then erases the Bearer line the SDK builds from
      // it, so the request carries no credential value at all.
      if (ref === undefined) return 'dsh-no-key'
      const credentials = ctx.get('credentials')
      const hit = credentials !== undefined
        ? (await credentials.resolve(ref))?.value
        : launchEnvironmentOf(ctx).get(ref)?.value
      if (hit !== undefined && hit.length > 0) return assertUsableApiKey(hit, 'dsh-llm-dynamic-provider', ref)
      throw new LlmError(
        `llm-dynamic-provider: no credential for provider route "${provider}"; its profile resolves ${String(ref)},`
        + ' which is not set — store it through the credentials service or export it',
        'MISSING_CREDENTIAL',
      )
    },
  })

  /** Swap the served profile set, registering on first use and replacing after. */
  const serve = (next: Map<string, ResolvedPiAiProviderProfile>): void => {
    current = next
    const names = [...next.keys()]
    if (registration === undefined) {
      if (names.length === 0) return
      registration = ctx.llm.registerAdapter(names, adapter)
    } else {
      registration.replace(names)
    }
  }

  /** The declared routes: the namespace's merged composition base + user layer. */
  const declaredRoutes = (): Record<string, import('./config.ts').RouteProfile> => {
    const section = ctx.settings.get(DYNAMIC_NS) as DynamicSection | undefined
    return section?.routes ?? {}
  }

  /**
   * Mirror the declared routes into the LLM configurable-provider directory.
   * Registration is what places the `llm-dynamic-provider` namespace inside
   * the host proxy's exposed set (`modelProviderNamespaces()`), so the Web
   * settings client can read and edit the routes — without it the namespace
   * is filtered out of `settings.describe` and every write is refused as
   * `settings-not-exposed`. The directory follows the DECLARED routes (not
   * only the successfully probed ones) so the namespace stays editable even
   * while every endpoint is down.
   */
  let directory: DirectoryRegistrationHandle | undefined
  const syncDirectory = (): void => {
    const entries: LlmConfigurableProvider[] = Object.entries(declaredRoutes()).map(([routeKey, route]) => ({
      provider: routeKey,
      displayName: route.displayName ?? routeKey,
      settingsNs: DYNAMIC_NS,
      settingsPath: ['routes', routeKey],
      declared: true,
    }))
    if (directory === undefined) {
      if (entries.length === 0) return
      directory = ctx.llm.registerConfigurableProviders(entries)
    } else {
      directory.replace(entries)
    }
  }

  /** Register from the persisted cache, if enabled and present. */
  const serveFromCache = async (): Promise<void> => {
    if (home === undefined) return
    const cache = await readCache(home)
    const routes = declaredRoutes()
    const cached = new Map<string, ResolvedPiAiProviderProfile>()
    for (const [routeName, entry] of Object.entries(cache.routes)) {
      const route = routes[routeName]
      if (route === undefined) continue
      try {
        cached.set(routeName, assembleProfile(routeName, route, entry.models.map(model => toModel(routeName, route, model, modalitiesOf(model.id)))))
      } catch {
        // A stale cache entry that no longer assembles is dropped, not fatal.
      }
    }
    if (cached.size > 0) serve(cached)
  }

  /** Probe every declared route and swap in the freshly discovered profiles. */
  const reprobe = async (): Promise<void> => {
    const routes = declaredRoutes()
    const outcome = await discoverDynamicProviders(ctx, routes, config, { signal: undefined }, {
      inputModalitiesOf: modalitiesOf,
      factsOf: (modelId) => facts.get(normalizeModelName(modelId)),
    })
    // The probe may outlive the plugin: a disposed fiber's registration is
    // gone, so swapping routes now would throw REGISTRATION_DISPOSED. FiberState
    // is a const enum (no runtime binding); DISPOSED is its fifth member.
    if ((ctx.fiber.state as number) === 4) return
    for (const { route, message } of outcome.failed) {
      ctx.logger.warn(`dynamic provider "${route}" probe failed: ${message}`)
    }
    // A route removed from the namespace must leave the registry; a route
    // whose probe now fails keeps its last served profile (it may be live).
    const next = new Map<string, ResolvedPiAiProviderProfile>()
    for (const [name, profile] of current) {
      if (name in routes && !outcome.discovered.has(name)) next.set(name, profile)
    }
    for (const [name, profile] of outcome.discovered) next.set(name, profile)
    serve(next)
    if (home !== undefined && outcome.discovered.size > 0) {
      await writeCache(home, outcome.discovered).catch((error: unknown) => {
        ctx.logger.warn('llm-dynamic-provider: failed to persist the model cache')
        ctx.logger.warn(error)
      })
    }
  }

  // Hot-edit: adding or editing a route in the settings namespace reprobes
  // without a restart; removing one withdraws its route on the same pass. The
  // directory re-syncs so the namespace's exposure and the Models page follow.
  ctx.on('settings/updated', (ns) => {
    if (ns !== DYNAMIC_NS) return
    syncDirectory()
    void reprobe()
  })
  // Publish the namespace's exposure first (the directory is what admits it
  // to the proxy's exposed set), then cold-boot: serve the cache immediately
  // and let the live probe replace it.
  syncDirectory()
  void serveFromCache().then(() => reprobe())
}
