import type { Context } from '@deepseek-ai/cordis'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-llm'
// Type-only: pulls the Context augmentation carrying `settings`.
import type {} from '@deepseek-ai/dsh-settings/types'
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

  // 部署配置是组成层，页面上的改动落在用户层；注册后按生效值排定时器，改设置时重排。
  const serveSettings = (scope: Context): void => {
    scope.settings.register(DISCOVERY_SETTINGS_NS, DiscoverySettings, {
      base: { catalogRefreshIntervalMinutes: resolved.catalogRefreshIntervalMinutes },
    })
    const schedule = (): void => {
      const section = scope.settings.get(DISCOVERY_SETTINGS_NS) as DiscoverySettingsSection | undefined
      const minutes = section?.catalogRefreshIntervalMinutes ?? resolved.catalogRefreshIntervalMinutes
      catalog.setRefreshIntervalMs(minutes * 60_000)
    }
    schedule()
    scope.on('settings/updated', (ns) => {
      if (ns === DISCOVERY_SETTINGS_NS) schedule()
    })
  }
  // settings 是可选依赖：挂上了才注册命名空间，没挂时只用部署配置。`ctx.inject`
  // 起一个子插件，服务已经在了就立刻跑，晚挂载就等它——两种情况都不需要重启。
  ctx.inject(['settings'], serveSettings)
  ctx.llm.registerModelDiscovery(DISCOVERY_NAMESPACE, async (request) => {
    const [raw] = await Promise.all([discoverEndpoint(request, resolved), catalog.ready()])
    const bundled = resolved.enrichment ? enrichModels(raw) : [...raw]
    return resolved.enrichment ? enrichModelsFromCatalog(bundled, catalog) : bundled
  })
}
