import type { Context } from '@deepseek-ai/cordis'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-llm'
import { DISCOVERY_NAMESPACE, discoverEndpoint, enrichModels, resolveDiscoveryConfig } from './engine.ts'
import type { Config } from './engine.ts'
import { provideModelCatalog } from './catalog/service.ts'
import { onVolatileUpdate } from './loader-config.ts'
import type { SharedCatalog } from './vocabulary.ts'

export { Config, resolveDiscoveryConfig } from './engine.ts'
export type { EngineSwitches, ResolvedDiscoveryConfig } from './engine.ts'
export { DISCOVERY_NAMESPACE, discoverEndpoint, enrichModels } from './engine.ts'
export type { DiscoverySettingsSection } from './vocabulary.ts'

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

  // 刷新间隔是本插件 Config 里标了 `.volatile()` 的那一格：设置页把新值写进 profile，
  // Loader 就地点进交下来的引用、只通知 owner fiber，这里重排定时器即可，不用重启。
  const schedule = (): void => {
    const minutes = config?.catalogRefreshIntervalMinutes?.get() ?? resolved.catalogRefreshIntervalMinutes
    catalog.setRefreshIntervalMs(minutes * 60_000)
  }
  onVolatileUpdate(ctx, schedule)
  schedule()

  ctx.llm.registerModelDiscovery(DISCOVERY_NAMESPACE, async (request) => {
    const [raw] = await Promise.all([discoverEndpoint(request, resolved), catalog.ready()])
    const bundled = resolved.enrichment ? enrichModels(raw) : [...raw]
    return resolved.enrichment ? enrichModelsFromCatalog(bundled, catalog) : bundled
  })
}
