import type { Context } from '@deepseek-ai/cordis'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { MODELS_DEV_URL, parseModelFacts } from './models-dev.ts'
import type { ModelFacts } from './models-dev.ts'
import type { modelCatalogDomainSpec } from './spec.ts'
import type { CatalogMeta, ModelRow } from './spec.ts'
import { catalogInputModalities } from '../engine/catalog.ts'
import { CATALOG_SERVICE, catalogEnvelope, catalogKeyIndexOf, resolveCatalogKey } from '../vocabulary.ts'
import type {
  CatalogEnvelope, CatalogKeyIndex, CatalogStatus, ModelModality, SharedCatalog,
} from '../vocabulary.ts'

/** 这个模块只读存储域的这一面。 */
interface StorageDomainFace {
  open(spec: typeof modelCatalogDomainSpec): Promise<Domain<typeof modelCatalogDomainSpec>>
}

export interface CatalogOptions {
  /** 注入的 fetch，测试用；默认全局 fetch。 */
  readonly fetchFn?: typeof fetch
  /** 单次请求超时，默认 15 秒。 */
  readonly timeoutMs?: number
  /** 只读本地已有的目录，不联网刷新（发现插件的 `enrichment: false`）。 */
  readonly offline?: boolean
  /** 定时刷新间隔；0（默认）表示只在挂载时刷一次。offline 时不排定时器。 */
  readonly refreshIntervalMs?: number
  readonly now?: () => number
}

/** 整份目录在那张表里的键。 */
const CATALOG_RECORD = 'models'

/** 目录服务交给本插件 owner 的那一面；其他插件读到的只是 {@link SharedCatalog}。 */
export interface ModelCatalogHandle extends SharedCatalog {
  /** 重排定时刷新，单位毫秒；`0` 或 offline 时停掉定时器。间隔没变就什么都不做。 */
  setRefreshIntervalMs(intervalMs: number): void
}

/** 建目录、启动首次加载、把服务注册进组合；名字被占用时由 cordis 原样报错。 */
export function provideModelCatalog(ctx: Context, options: CatalogOptions = {}): ModelCatalogHandle {
  const fetchFn = options.fetchFn ?? fetch
  const now = options.now ?? Date.now
  const timeoutMs = options.timeoutMs ?? 15_000
  const offline = options.offline === true
  const refreshIntervalMs = options.refreshIntervalMs ?? 0

  let domain: Domain<typeof modelCatalogDomainSpec> | undefined
  /** 没有存储域时的快照；有存储域时直接读那条记录，不再复制一份。 */
  let memory: ReadonlyMap<string, ModelFacts> | undefined
  let keys: readonly string[] = []
  let byKey: (key: string) => ModelFacts | undefined = () => undefined
  let index: CatalogKeyIndex = catalogKeyIndexOf([])
  let envelope: CatalogEnvelope | undefined
  let storageError: string | undefined
  let status: CatalogStatus = { entries: 0, refreshedAt: null, source: 'models.dev' }
  const ready = Promise.withResolvers<void>()

  const stored = (): Record<string, ModelRow> => domain?.table('catalog').get(CATALOG_RECORD)?.entries ?? {}

  /** 换一份快照：键、查找函数、键索引与 envelope 缓存一起换。 */
  const adopt = (): void => {
    if (domain !== undefined) {
      const entries = stored()
      keys = Object.keys(entries)
      byKey = key => entries[key] as ModelFacts | undefined
    } else {
      const facts = memory ?? new Map<string, ModelFacts>()
      keys = [...facts.keys()]
      byKey = key => facts.get(key)
    }
    index = catalogKeyIndexOf(keys)
    envelope = undefined
  }

  const report = (extra: Partial<CatalogStatus> = {}): CatalogStatus => {
    status = {
      entries: keys.length,
      refreshedAt: status.refreshedAt,
      source: domain === undefined ? 'models.dev' : 'storage',
      ...storageError === undefined ? {} : { storageError },
      ...extra,
    }
    return status
  }

  const openDomain = async (): Promise<void> => {
    if (domain !== undefined) return
    const storageDomain = ctx.get('storageDomain') as StorageDomainFace | undefined
    if (storageDomain === undefined) {
      storageError = 'no storage domain is mounted in this composition'
      return
    }
    try {
      const { modelCatalogDomainSpec } = await import('./spec.ts')
      const opened = await storageDomain.open(modelCatalogDomainSpec)
      domain = opened
      ctx.effect(() => () => opened.close(), 'llm-discovery: model catalog close')
      storageError = undefined
    } catch (error) {
      storageError = error instanceof Error ? error.message : String(error)
      ctx.logger.warn('models-dev-catalog: the stored catalog is unavailable, loading it over the network instead')
      ctx.logger.warn(error)
    }
  }

  const runRefresh = async (): Promise<CatalogStatus> => {
    await openDomain()
    if (offline) {
      adopt()
      return report({ refreshedAt: now() })
    }
    try {
      let changed = true
      if (domain !== undefined) {
        const meta: CatalogMeta = { ...domain.global.get() }
        // ETag 只在目录里真有行时发出去，否则一个 304 会让空目录一直空着。
        const headers = meta.etag === undefined || Object.keys(stored()).length === 0 ? {} : { 'if-none-match': meta.etag }
        const response = await fetchFn(MODELS_DEV_URL, { signal: AbortSignal.timeout(timeoutMs), headers })
        changed = response.status !== 304
        if (changed) {
          if (!response.ok) throw new Error(`models.dev answered ${response.status}`)
          const entries: Record<string, ModelRow> = {}
          for (const [name, fact] of parseModelFacts(await response.json())) entries[name] = fact as ModelRow
          await domain.table('catalog').put(CATALOG_RECORD, { entries })
          const etag = response.headers.get('etag')
          await domain.global.set({ ...etag === null ? {} : { etag }, fetchedAt: now() })
        }
      } else {
        const response = await fetchFn(MODELS_DEV_URL, { signal: AbortSignal.timeout(timeoutMs) })
        if (!response.ok) throw new Error(`models.dev answered ${response.status}`)
        memory = parseModelFacts(await response.json())
      }
      if (changed) adopt()
      return report({ refreshedAt: now() })
    } catch (error) {
      adopt()
      return report({ error: error instanceof Error ? error.message : String(error) })
    }
  }

  /** 一次只跑一轮：定时器与调用方同时问也只发一轮请求。 */
  let running: Promise<CatalogStatus> | undefined
  const refresh = (): Promise<CatalogStatus> => {
    running ??= runRefresh().finally(() => {
      running = undefined
    })
    return running
  }

  /** 排或重排定时刷新：旧定时器先停，同样的间隔不重排，改间隔与插件卸载都不会留下两套。 */
  let stopTimer: (() => void) | undefined
  let armedMs = -1
  /** 下一次定时刷新的时刻；没有定时器时为 null。读状态的页面据此决定什么时候再来问。 */
  let nextAt: number | null = null
  const schedule = (intervalMs: number): void => {
    const next = offline || intervalMs <= 0 ? 0 : intervalMs
    if (next === armedMs) return
    stopTimer?.()
    stopTimer = undefined
    armedMs = next
    if (next === 0) {
      nextAt = null
      return
    }
    // 刻意不 unref：unref 过的定时器在事件循环没有别的事时会放进程提前退出，
    // 在 vitest 的 worker 里表现为随机的 "Worker exited unexpectedly"。
    const timer = setInterval(() => {
      nextAt = now() + next
      void refresh()
    }, next)
    nextAt = now() + next
    stopTimer = () => { clearInterval(timer) }
  }
  ctx.effect(() => () => {
    stopTimer?.()
    stopTimer = undefined
    armedMs = -1
    nextAt = null
  }, 'llm-discovery: catalog refresh timer')

  const init = async (): Promise<void> => {
    await openDomain()
    if (domain !== undefined && Object.keys(stored()).length > 0) {
      const meta: CatalogMeta = { ...domain.global.get() }
      adopt()
      report({ refreshedAt: meta.fetchedAt ?? null })
      ready.resolve()
      if (!offline) void refresh()
      return
    }
    if (offline) {
      adopt()
      ready.resolve()
      return
    }
    // 空存储或没有存储域：先联网拿第一份，冷启动第一刻就有目录。
    await refresh()
    ready.resolve()
  }

  const catalog: ModelCatalogHandle = {
    factsOf: (modelId) => {
      const key = resolveCatalogKey(modelId, index)
      return key === undefined ? undefined : byKey(key)
    },
    inputModalitiesOf: (modelId) => {
      const listed = catalog.factsOf(modelId)?.inputModalities
      if (listed !== undefined && listed.length > 0) return listed as readonly ModelModality[]
      return catalogInputModalities(modelId)
    },
    envelope: () => (envelope ??= catalogEnvelope(keys.map(key => [key, byKey(key) as ModelFacts]))),
    status: () => ({
      ...status,
      refreshIntervalMs: armedMs > 0 ? armedMs : 0,
      nextRefreshAt: nextAt,
    }),
    refresh,
    ready: () => ready.promise,
    setRefreshIntervalMs: schedule,
  }
  ctx.provide(CATALOG_SERVICE, catalog)
  void init()
  schedule(refreshIntervalMs)
  return catalog
}
