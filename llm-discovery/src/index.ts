import type { Context } from '@deepseek-ai/cordis'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-llm'
// Type-only: pulls the Context augmentation carrying `settings`.
import type {} from '@deepseek-ai/dsh-settings/types'
import { configValue, legacySettings, onSettingsCommit, onVolatileUpdate } from './compat.ts'
import { DISCOVERY_NAMESPACE, discoverEndpoint, enrichModels, resolveDiscoveryConfig } from './engine.ts'
import type { Config } from './engine.ts'
import { provideModelCatalog } from './catalog/service.ts'
import { DISCOVERY_SETTINGS_NS, DiscoverySettings } from './settings.ts'
import type { DiscoverySettingsSection, SharedCatalog } from './vocabulary.ts'

export { Config, resolveDiscoveryConfig } from './engine.ts'
export type { EngineSwitches, ResolvedDiscoveryConfig } from './engine.ts'
export { DISCOVERY_NAMESPACE, discoverEndpoint, enrichModels } from './engine.ts'
export { DISCOVERY_SETTINGS_NS, DiscoverySettings } from './settings.ts'
export type { DiscoverySettingsSection } from './settings.ts'

export const name = 'llm-discovery'
/** 探测 offer 注册在 llm 注册表上。 */
export const inject = ['llm']

/** 用目录补端点没披露的显示名称与容量：端点报的值优先，`x-ai/grok-4.6` 解析到自己那条， 而不是被裸名条目顶掉。 */
export function enrichModelsFromCatalog(
  models: readonly LlmDiscoveredModel[],
  catalog: Pick<SharedCatalog, 'factsOf'>,
): LlmDiscoveredModel[] {
  return models.map((model) => {
    const fact = catalog.factsOf(model.id)
    if (fact === undefined) return { ...model }
    return {
      ...model,
      ...model.name === undefined && fact.displayName !== undefined ? { name: fact.displayName } : {},
      ...model.contextWindow === undefined && fact.contextWindow !== undefined ? { contextWindow: fact.contextWindow } : {},
      ...model.maxTokens === undefined && fact.maxTokens !== undefined ? { maxTokens: fact.maxTokens } : {},
    }
  })
}

export function apply(ctx: Context, config?: Config): void {
  const resolved = resolveDiscoveryConfig(config)
  // 目录是另外两个插件的硬依赖，所以这个开关只管本插件：关掉时只用本地已有的目录、不联网刷新、也不补全探测回复。
  const catalog = provideModelCatalog(ctx, {
    offline: !resolved.enrichment,
    refreshIntervalMs: resolved.catalogRefreshIntervalMinutes * 60_000,
  })

  // 刷新间隔是用户可改的设置。0.1.7 上它是 Config 里标了 `.volatile()` 的那一格：
  // 页面把新值写进 profile，Loader 就地点进交下来的引用并通知本插件，不重启。
  // 0.1.5 兼容：那时用户层在 settings 命名空间里，注册后从这里读（`legacyRead`）。
  let legacyRead: (() => number | undefined) | undefined
  const effectiveMinutes = (): number =>
    legacyRead?.() ?? configValue(config?.catalogRefreshIntervalMinutes) ?? resolved.catalogRefreshIntervalMinutes
  const schedule = (): void => { catalog.setRefreshIntervalMs(effectiveMinutes() * 60_000) }

  // settings 是可选依赖：0.1.5 上命名空间得自己注册，0.1.7 上命名空间就是本插件的
  // Loader entry，不用注册（也不该往 settings 上挂东西）。`ctx.inject` 起一个子插件，
  // 服务已经在了就立刻跑，晚挂载就等它——两种情况都不需要重启。
  ctx.inject(['settings'], (scope) => {
    const legacy = legacySettings(scope)
    if (legacy === undefined) return
    legacy.register(DISCOVERY_SETTINGS_NS, DiscoverySettings, {
      base: { catalogRefreshIntervalMinutes: resolved.catalogRefreshIntervalMinutes },
    })
    legacyRead = () => (legacy.get(DISCOVERY_SETTINGS_NS) as DiscoverySettingsSection | undefined)?.catalogRefreshIntervalMinutes
    schedule()
    // 页面改完设置后重排定时器；0.1.7 上这个事件不会来。
    onSettingsCommit(scope, DISCOVERY_SETTINGS_NS, schedule)
  })
  // 0.1.7 上改设置的通知走 Loader（只发给 owner fiber），0.1.5 上没有这个事件。
  onVolatileUpdate(ctx, schedule)
  schedule()

  ctx.llm.registerModelDiscovery(DISCOVERY_NAMESPACE, async (request) => {
    const [raw] = await Promise.all([discoverEndpoint(request, resolved), catalog.ready()])
    const bundled = resolved.enrichment ? enrichModels(raw) : [...raw]
    return resolved.enrichment ? enrichModelsFromCatalog(bundled, catalog) : bundled
  })
}
