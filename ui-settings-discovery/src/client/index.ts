/** 模型发现 settings section plugin, browser half: registers the 模型发现 section into the settings panel plus the model editor its provider cards open. */
// The browser half is an ordinary cordis plugin: its context type is cordis's own.
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the renderer's Context augmentation carrying `slots`.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Context augmentation carrying `remote` and the
// re-exported wire vocabulary (LlmDiscoveredModel, RpcResponse, …).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry)
// and the Context augmentation carrying `configForms`.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the Models page's SlotMap merge (the provider-card seat)
// and the directory row its owner share carries.
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { DiscoverySection } from './DiscoverySection.tsx'
import type { DiscoverySectionInjected } from './DiscoverySection.tsx'
import { ProviderModelsCard } from './ProviderModelsDialog.tsx'
import type { ProviderModelsCardInjected } from './ProviderModelsDialog.tsx'
import type { DiscoveryApi, DiscoverySettingsSection } from './discovery.ts'
import { DISCOVERY_NS, PI_AI_NS } from './discovery.ts'

export type { DiscoverySectionInjected, DiscoverySectionProps } from './DiscoverySection.tsx'
export type { ProviderModelsCardInjected, ProviderModelsCardProps } from './ProviderModelsDialog.tsx'
export type { ModelCatalogPanelProps } from './ModelCatalogPanel.tsx'
export type { DiscoveryApi } from './discovery.ts'

/** Settings nav id of this section; it drives `only` filtering. */
export const SECTION_ID = 'model-discovery'

/** Static Chinese product copy, so no locale lookup. */
const SECTION_LABEL = '模型发现'

/** Required services. `configForms` is the settings domain's form service, keyed by Host plugin entry id: the 模型目录 block inside the section edits the
 * discovery plugin's entry through it. `remote` and its generated faces are the typed Remote clients this page calls; `locale` is runtime ordering for the
 * section's copy. */
export const inject = [
  'slots',
  'locale',
  'connection',
  'configForms',
  'remote',
  'remote.llm',
  'remote.settings',
  'remote.credentials',
  'remote.pluginInventory',
]

/** Register the discovery section and the provider-card editor once their slot declarations are on the ledger. */
export function apply(ctx: ClientContext): void {
  // The published ClientRemote interface carries only the stream/host seats;
  // the generated Typert domains are the runtime contract, so cast to the
  // structural face this plugin declares.
  const api = ctx.remote as unknown as DiscoveryApi
  // 目录刷新间隔长在「模型目录」区块里，它读写的表单属于 dsh-llm-discovery 那一条 Host
  // entry（命名空间与探测 offer 同名）；条目不在组合里时表单自报 `unavailable`，那一栏
  // 就不出现。表单在这里取一次，随 section 的 inject 交给页面。
  const scope = ctx.configForms.get<DiscoverySettingsSection>(DISCOVERY_NS)
  const injected = (): DiscoverySectionInjected => ({ api, scope })
  const cardInjected = (): ProviderModelsCardInjected => ({ api })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: SECTION_ID,
    // After the Models page (order 10): discovery feeds it.
    order: 20,
    label: () => SECTION_LABEL,
    inject: injected,
  }, DiscoverySection))
  // Keyed by the owning settings namespace: every llm-pi-ai provider card
  // dispatches this cell, while the card's own row decides whether a profile
  // exists to edit.
  ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
    name: 'settings.models.provider-card',
    key: PI_AI_NS,
    inject: cardInjected,
  }, ProviderModelsCard))
}
