import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { authContextFrom, credentialStoreFrom } from './auth.ts'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-settings/types'
import type { LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import type { DirectoryRegistrationHandle } from '@deepseek-ai/dsh-llm'
import type { Config, DynamicSection } from './config.ts'
import { NamespaceConfig } from './config.ts'
import { discoverDynamicProviders } from './provider.ts'
import type { DynamicProviderProfile } from './provider.ts'
import { catalogReasoningEfforts, discoverEndpoint, enrichModels, resolveDiscoveryConfig } from 'dsh-llm-discovery/engine'
import { CATALOG_SERVICE, DYNAMIC_PROBE_PATH, DYNAMIC_ROUTES_PATH } from 'dsh-llm-discovery/vocabulary'
import type { CatalogStatus, SharedCatalog } from 'dsh-llm-discovery/vocabulary'

export { Config, NamespaceConfig } from './config.ts'
export type { DynamicSection, RouteProfile } from './config.ts'
export { catalogReasoningEfforts } from 'dsh-llm-discovery/engine'
export type { ReasoningEfforts } from 'dsh-llm-discovery/engine'
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
/** llm 注册表、设置命名空间，以及 dsh-llm-discovery 提供的 models.dev 目录。 */
export const inject = ['llm', 'settings', CATALOG_SERVICE]

/** This plugin's settings namespace, holding the route declarations. */
// alpha.4 dropped the settingsNamespace() factory; a namespace is a branded
// string validated by SettingsNamespaceInput at registration time.
export const DYNAMIC_NS = 'llm-dynamic-provider' as SettingsNamespace

/** 设置页「模型目录」读的状态：声明的路由数与 models.dev 目录状态。 */
export interface DynamicRouteStatus {
  readonly routes: number
  readonly modelsDev: CatalogStatus
}

/** One route's outcome in a refresh report. */
interface RouteProbeReport {
  readonly route: string
  /** Models the route now serves; absent when the probe failed. */
  readonly models?: number
  readonly error?: string
}

/** 设置页「模型目录」读的状态：声明的路由数与 models.dev 目录状态。 */
export interface DynamicRouteStatus {
  readonly routes: number
  readonly modelsDev: CatalogStatus
}

/** Mount the dynamic-provider adapter: declared routes register on first successful probe. */
export function apply(ctx: Context, config?: Config): void {
  ctx.settings.register(DYNAMIC_NS, NamespaceConfig, { base: { routes: config?.routes ?? {} } })

  // 目录由 dsh-llm-discovery 提供（`inject` 保证它在）：facts 查询、模态与状态都读它。
  const catalog = ctx.get(CATALOG_SERVICE) as SharedCatalog
  const webServer = ctx.get('webServer') as WebServerFace | undefined

  // The route read/write endpoint.
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
      path: DYNAMIC_ROUTES_PATH,
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
      const fact = catalog.factsOf(model.id)
      return {
        ...model,
        ...model.name === undefined && fact?.displayName !== undefined ? { name: fact.displayName } : {},
        ...model.contextWindow === undefined && fact?.contextWindow !== undefined ? { contextWindow: fact.contextWindow } : {},
        ...model.maxTokens === undefined && fact?.maxTokens !== undefined ? { maxTokens: fact.maxTokens } : {},
        reasoningEfforts: catalogReasoningEfforts(model.id),
      }
    })
  })

  // Live profiles the adapter reads per request; rebuilt on each reprobe.
  let current = new Map<string, DynamicProviderProfile>()
  let registration: AdapterRegistrationHandle | undefined

  const adapter = new PiAiAdapter({
    auth: { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) },
    profiles: () => current,
    resolveApiKey: async (provider, profile) => {
      const ref = profile.apiKeyEnv
      // A route naming no credential is an unauthenticated endpoint.
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

  /** Mirror the declared routes into the LLM configurable-provider directory. */
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

  /** Probe every declared route and swap in the freshly discovered profiles. */
  const reprobe = async (): Promise<readonly RouteProbeReport[]> => {
    const routes = declaredRoutes()
    const outcome = await discoverDynamicProviders(ctx, routes, config, { signal: undefined }, {
      inputModalitiesOf: catalog.inputModalitiesOf,
      factsOf: catalog.factsOf,
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
    return [
      ...[...outcome.discovered].map(([route, profile]) => ({ route, models: profile.piProvider.getModels().length })),
      ...outcome.failed.map(({ route, message }) => ({ route, error: message })),
    ]
  }

  // 设置页「模型目录」读的端点：GET 报状态，POST 重读目录并重新探测所有路由。
  const routeStatus = (): DynamicRouteStatus => ({
    routes: Object.keys(declaredRoutes()).length,
    modelsDev: catalog.status(),
  })
  if (webServer !== undefined) {
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: DYNAMIC_PROBE_PATH,
      handler: async (req, res) => {
        const method = (req as { method?: string }).method ?? 'GET'
        if (method === 'GET') {
          sendJson(res, 200, routeStatus())
          return
        }
        if (method !== 'POST') {
          sendJson(res, 405, { error: 'method not allowed' })
          return
        }
        const modelsDev = await catalog.refresh()
        const probes = await reprobe()
        sendJson(res, 200, { ...routeStatus(), modelsDev, probes })
      },
    }), 'llm-dynamic-provider: probe endpoint')
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
  // 目录先落到内存，再按它注册路由并实时探测：否则首次注册会缺名称与容量。
  void catalog.ready().then(() => reprobe())
}
