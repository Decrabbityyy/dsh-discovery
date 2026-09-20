import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle, LlmDiscoveredModel } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { authContextFrom, credentialStoreFrom } from './auth.ts'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-settings/types'
import type { LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import type { DirectoryRegistrationHandle } from '@deepseek-ai/dsh-llm'
import type { Config, DynamicSection } from './config.ts'
import { NamespaceConfig } from './config.ts'
import { assembleProfile, discoverDynamicProviders, toModel } from './provider.ts'
import type { DynamicProviderProfile } from './provider.ts'
import { catalogEntries, factsOfRow, openModelCatalog, refreshModelCatalog } from 'dsh-llm-endpoint-base/store'
import type { OpenedCatalog } from 'dsh-llm-endpoint-base/store'
import {
  catalogInputModalities, catalogKeyIndexOf, catalogReasoningEfforts, discoverEndpoint, DYNAMIC_CACHE_PATH,
  enrichModels, MODELS_DEV_URL, parseModelFacts, resolveCatalogKey, resolveDiscoveryConfig,
} from 'dsh-llm-endpoint-base'
import type { ModelFacts } from 'dsh-llm-endpoint-base'

export { Config, NamespaceConfig } from './config.ts'
export type { DynamicSection, RouteProfile } from './config.ts'
export { catalogReasoningEfforts } from 'dsh-llm-endpoint-base'
export type { ReasoningEfforts } from 'dsh-llm-endpoint-base'
export { assembleProfile, discoverDynamicProviders, toModel } from './provider.ts'
export type { DiscoveryDeps, DiscoveryOutcome, DynamicProviderProfile } from './provider.ts'

/** The minimal webServer face this plugin reads: named exact-path route registration. */
interface WebServerFace {
  register(route: {
    kind: 'exact'
    path: string
    handler: (req: unknown, res: { statusCode: number; setHeader(name: string, value: string): void; end(body: string): void }) => void | Promise<void>
  }): () => void
}

export const name = 'llm-dynamic-provider'
/** The llm seam owns the registry; the settings seam owns the route namespace. */
export const inject = ['llm', 'settings']

/** This plugin's settings namespace, holding the route declarations. */
// alpha.4 dropped the settingsNamespace() factory; a namespace is a branded
// string validated by SettingsNamespaceInput at registration time.
export const DYNAMIC_NS = 'llm-dynamic-provider' as SettingsNamespace

/** The cache file name under the harness home. */
const CACHE_FILE = 'llm-dynamic-provider-cache.json'

/** The on-disk cache: the discovered model facts per route, keyed by route name. */
interface DynamicCache {
  readonly routes: Record<string, { readonly models: readonly LlmDiscoveredModel[] }>
  /** When this file was last written; absent in a cache written before this field existed. */
  readonly writtenAt?: number
}

/** What the models.dev facts were last loaded from, and when. */
interface ModelsDevStatus {
  readonly entries: number
  readonly refreshedAt: number | null
  readonly source?: 'storage' | 'models.dev'
  /**
   * Why they are not coming from the storage domain, when they are not: the
   * seam is absent, or opening it failed. The facts still load over the network,
   * but the fallback is reported rather than looking like a deliberate choice.
   */
  readonly storageError?: string
  /** Why the last load failed; the facts of the previous one stay in place. */
  readonly error?: string
}

/** One route's outcome in a refresh report. */
interface RouteProbeReport {
  readonly route: string
  /** Models the route now serves; absent when the probe failed. */
  readonly models?: number
  readonly error?: string
}

/** What the cache endpoint reports: the 模型缓存 tab renders exactly this. */
export interface DynamicCacheStatus {
  /** Declared routes, whether or not their probe succeeded. */
  readonly routes: number
  readonly modelsDev: ModelsDevStatus
  /** The catalog cache file, present only where the deployment caches. */
  readonly cacheFile?: {
    readonly path: string
    readonly writtenAt: number | null
    readonly routes: number
  }
}

/** Read the persisted cache; absence and corruption both read as empty. */
async function readCache(home: string): Promise<DynamicCache> {
  try {
    const raw = JSON.parse(await readFile(join(home, CACHE_FILE), 'utf8')) as DynamicCache
    return typeof raw === 'object' && raw !== null && typeof raw.routes === 'object' ? raw : { routes: {} }
  } catch {
    return { routes: {} }
  }
}

/**
 * Persist the discovered model facts behind the resolved profiles.
 * @returns the write timestamp the cache status reports.
 */
async function writeCache(home: string, profiles: ReadonlyMap<string, DynamicProviderProfile>): Promise<number> {
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
  const writtenAt = Date.now()
  await mkdir(home, { recursive: true })
  await writeFile(join(home, CACHE_FILE), JSON.stringify({ routes, writtenAt }, null, 2), 'utf8')
  return writtenAt
}

/**
 * Mount the dynamic-provider adapter. Declared routes register on first
 * successful probe; with `cache` on, a cold boot registers from the persisted
 * catalog synchronously and lets the live probe refresh the registration.
 */
export function apply(ctx: Context, config?: Config): void {
  ctx.settings.register(DYNAMIC_NS, NamespaceConfig, { base: { routes: config?.routes ?? {} } })
  const home = config?.cache === true ? resolveDshHome() : undefined

  // models.dev facts by catalog key: the synchronous read path for enrichment
  // and modality lookups, backed by the storage domain when the composition
  // mounts it and by a plain fetch otherwise. The key index is rebuilt with the
  // map so every lookup resolves an id the same way the settings page does.
  let facts = new Map<string, ModelFacts>()
  let factKeys = catalogKeyIndexOf([])
  // What the last load of those facts landed, for the cache tab's status.
  let factsStatus: ModelsDevStatus = { entries: 0, refreshedAt: null }
  let storageCatalog: OpenedCatalog | undefined
  // Why the facts are not storage-backed, when they are not. Recomputed on every
  // load rather than latched: the storage domain can be provided after this
  // plugin's own apply, and a later refresh is then the one that finds it.
  let storageError: string | undefined
  let storageFailureLogged = false
  const refillFacts = (entries: Iterable<readonly [string, ModelFacts]>): void => {
    facts = new Map(entries)
    factKeys = catalogKeyIndexOf(facts.keys())
  }
  /** Open the storage-backed catalog, recording (and once, logging) why not. */
  const openStorageCatalog = async (): Promise<void> => {
    try {
      storageCatalog = await openModelCatalog(ctx)
      storageError = storageCatalog === undefined ? 'no storage domain is mounted in this composition' : undefined
    } catch (error) {
      storageError = error instanceof Error ? error.message : String(error)
      if (!storageFailureLogged) {
        storageFailureLogged = true
        ctx.logger.warn('llm-dynamic-provider: the stored models.dev catalog is unavailable, loading it over the network instead')
        ctx.logger.warn(error)
      }
    }
  }
  /** The stored catalog as facts. */
  const storedFacts = (opened: OpenedCatalog): [string, ModelFacts][] =>
    Object.entries(catalogEntries(opened)).map(([name, row]) => [name, factsOfRow(row)])
  const factsOf = (modelId: string): ModelFacts | undefined => {
    const key = resolveCatalogKey(modelId, factKeys)
    return key === undefined ? undefined : facts.get(key)
  }
  const modalitiesOf = (modelId: string): readonly string[] | undefined => {
    const fact = factsOf(modelId)
    if (fact?.inputModalities !== undefined && fact.inputModalities.length > 0) return fact.inputModalities
    return catalogInputModalities(modelId)
  }

  /**
   * Reload the models.dev facts once: the storage-backed catalog refreshes
   * incrementally by ETag, and a deployment without that seam re-reads the file
   * over the network. Never throws — a failure is reported in the status the
   * cache tab reads.
   */
  const refreshFacts = async (): Promise<ModelsDevStatus> => {
    if (storageCatalog === undefined) await openStorageCatalog()
    try {
      if (storageCatalog !== undefined) {
        refillFacts(storedFacts(storageCatalog))
        await refreshModelCatalog(storageCatalog)
        refillFacts(storedFacts(storageCatalog))
        factsStatus = { entries: facts.size, refreshedAt: Date.now(), source: 'storage' }
      } else {
        const response = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(15_000) })
        if (!response.ok) throw new Error(`models.dev answered ${response.status}`)
        refillFacts(parseModelFacts(await response.json()))
        factsStatus = {
          entries: facts.size,
          refreshedAt: Date.now(),
          source: 'models.dev',
          ...storageError === undefined ? {} : { storageError },
        }
      }
    } catch (error) {
      factsStatus = {
        ...factsStatus,
        error: error instanceof Error ? error.message : String(error),
        ...storageError === undefined ? {} : { storageError },
      }
    }
    return factsStatus
  }
  void refreshFacts()
  const webServer = ctx.get('webServer') as WebServerFace | undefined

  // The route read/write endpoint. The settings RPC refuses this namespace
  // until the configurable-provider directory names it, and the directory needs
  // at least one route, so the write that adds the first route can never pass
  // through the proxy. The panel therefore talks to this endpoint, which writes
  // through the settings seam directly. Served only where a web server is mounted.
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
  // probes: it answers only while this plugin is mounted. The reply carries the
  // catalog's reasoning levels, which the panel preselects.
  const discovery = resolveDiscoveryConfig(config)
  ctx.llm.registerModelDiscovery(DYNAMIC_NS, async (request) => {
    const raw = await discoverEndpoint(request, discovery)
    const enriched = discovery.enrichment ? enrichModels(raw) : [...raw]
    return enriched.map((model) => {
      const fact = factsOf(model.id)
      return {
        ...model,
        ...model.name === undefined && fact?.displayName !== undefined ? { name: fact.displayName } : {},
        ...model.contextWindow === undefined && fact?.contextWindow !== undefined ? { contextWindow: fact.contextWindow } : {},
        ...model.maxTokens === undefined && fact?.maxTokens !== undefined ? { maxTokens: fact.maxTokens } : {},
        reasoningEfforts: catalogReasoningEfforts(model.id),
      }
    })
  })

  // Live profiles the adapter reads per request; rebuilt on each reprobe, and
  // seeded from the cache when enabled.
  let current = new Map<string, DynamicProviderProfile>()
  let registration: AdapterRegistrationHandle | undefined
  // The on-disk cache as this process last saw it, for the cache tab's status.
  let cacheWrittenAt: number | null = null
  let cacheRoutes = 0

  const adapter = new PiAiAdapter({
    auth: { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) },
    profiles: () => current,
    resolveApiKey: async (provider, profile) => {
      const ref = profile.apiKeyEnv
      // A route naming no credential is an unauthenticated endpoint. pi-ai's
      // dialects require some apiKey string to build their client, so an inert
      // placeholder satisfies the check and the profile's empty Authorization
      // header keeps the value off the wire.
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

  /** Swap the served profile set: register on first use, replace after that. */
  const serve = (next: Map<string, DynamicProviderProfile>): void => {
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
   * Registration is what places the namespace inside the host proxy's exposed
   * set, so the Web settings client can read and edit the routes. The directory
   * follows the declared routes rather than only the successfully probed ones,
   * so the namespace stays editable while every endpoint is down.
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
    cacheWrittenAt = cache.writtenAt ?? null
    cacheRoutes = Object.keys(cache.routes).length
    const routes = declaredRoutes()
    const cached = new Map<string, DynamicProviderProfile>()
    for (const [routeName, entry] of Object.entries(cache.routes)) {
      const route = routes[routeName]
      if (route === undefined) continue
      try {
        cached.set(routeName, assembleProfile(routeName, route, entry.models.map(model => toModel(routeName, route, model, modalitiesOf(model.id)))))
      } catch {
        // A stale cache entry that no longer assembles is dropped.
      }
    }
    if (cached.size > 0) serve(cached)
  }

  /**
   * Probe every declared route and swap in the freshly discovered profiles.
   * @returns one report per declared route, for the refresh the cache tab asks
   * for; the settings-update path ignores it.
   */
  const reprobe = async (): Promise<readonly RouteProbeReport[]> => {
    const routes = declaredRoutes()
    const outcome = await discoverDynamicProviders(ctx, routes, config, { signal: undefined }, {
      inputModalitiesOf: modalitiesOf,
      factsOf,
    })
    // The probe may outlive the plugin: a disposed fiber's registration is
    // gone, so swapping routes now would throw REGISTRATION_DISPOSED. FiberState
    // is a const enum (no runtime binding); DISPOSED is its fifth member.
    if ((ctx.fiber.state as number) === 4) return []
    for (const { route, message } of outcome.failed) {
      ctx.logger.warn(`dynamic provider "${route}" probe failed: ${message}`)
    }
    // A route removed from the namespace leaves the registry; a route whose
    // probe now fails keeps its last served profile.
    const next = new Map<string, DynamicProviderProfile>()
    for (const [name, profile] of current) {
      if (name in routes && !outcome.discovered.has(name)) next.set(name, profile)
    }
    for (const [name, profile] of outcome.discovered) next.set(name, profile)
    serve(next)
    if (home !== undefined && outcome.discovered.size > 0) {
      const writtenAt = await writeCache(home, outcome.discovered).catch((error: unknown) => {
        ctx.logger.warn('llm-dynamic-provider: failed to persist the model cache')
        ctx.logger.warn(error)
        return undefined
      })
      if (writtenAt !== undefined) {
        cacheWrittenAt = writtenAt
        cacheRoutes = outcome.discovered.size
      }
    }
    return [
      ...[...outcome.discovered].map(([route, profile]) => ({ route, models: profile.piProvider.getModels().length })),
      ...outcome.failed.map(({ route, message }) => ({ route, error: message })),
    ]
  }

  // The cache endpoint behind the 模型缓存 tab: GET is the status, POST
  // re-reads the models.dev facts and re-probes every route — the two inputs the
  // served profiles and the on-disk catalog are built from. Everything else the
  // plugin keeps (the directory, the adapter registration) follows those two.
  const cacheStatus = (): DynamicCacheStatus => ({
    routes: Object.keys(declaredRoutes()).length,
    modelsDev: factsStatus,
    ...home === undefined
      ? {}
      : { cacheFile: { path: join(home, CACHE_FILE), writtenAt: cacheWrittenAt, routes: cacheRoutes } },
  })
  if (webServer !== undefined) {
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: DYNAMIC_CACHE_PATH,
      handler: async (req, res) => {
        const method = (req as { method?: string }).method ?? 'GET'
        if (method === 'GET') {
          sendJson(res, 200, cacheStatus())
          return
        }
        if (method !== 'POST') {
          sendJson(res, 405, { error: 'method not allowed' })
          return
        }
        const modelsDev = await refreshFacts()
        const probes = await reprobe()
        sendJson(res, 200, { ...cacheStatus(), modelsDev, probes })
      },
    }), 'llm-dynamic-provider: cache endpoint')
  }

  // Hot-edit: adding or editing a route reprobes without a restart, and removing
  // one withdraws its route on the same pass. The directory re-syncs with it.
  ctx.on('settings/updated', (ns) => {
    if (ns !== DYNAMIC_NS) return
    syncDirectory()
    void reprobe()
  })
  // Publish the namespace's exposure before serving: the directory is what
  // admits it to the proxy's exposed set.
  syncDirectory()
  void serveFromCache().then(() => reprobe())
}
