/**
 * Model-discovery settings section plugin, browser half: registers the
 * 模型发现 section into the settings panel and drives it through the public
 * settings, credentials, llm, and pluginInventory Remote faces.
 */
// The browser half is an ordinary cordis plugin: its context type is cordis's
// own (0.1.5 deleted the dsh-client-runtime facade that used to alias it).
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the renderer's Context augmentation carrying `slots`.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Context augmentation carrying `remote` and the
// re-exported wire vocabulary (LlmDiscoveredModel, RpcResponse, …).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { DiscoverySection } from './DiscoverySection.tsx'
import type { DiscoverySectionInjected } from './DiscoverySection.tsx'
import type { DiscoveryApi } from './discovery.ts'

export type { DiscoverySectionInjected, DiscoverySectionProps } from './DiscoverySection.tsx'
export type { DiscoveryApi } from './discovery.ts'

/** Settings nav id of this section; it drives `only` filtering. */
export const SECTION_ID = 'model-discovery'

/** Static Chinese product copy, so no locale lookup. */
const SECTION_LABEL = '模型发现'

/**
 * Required services. `remote` and its generated faces are the typed Remote
 * clients this page calls; `locale` and `settingsScope` are runtime ordering
 * requirements only, since the section renders static copy and no scoped value.
 * The target slot is injected through `slots.inject()`, so the activation order
 * against the ui-settings plugin is not constrained.
 */
export const inject = [
  'slots',
  'locale',
  'connection',
  'remote',
  'remote.llm',
  'remote.settings',
  'remote.credentials',
  'remote.pluginInventory',
  'settingsScope',
]

/**
 * Register the discovery section once the `settings.section` declaration is on
 * the ledger.
 */
export function apply(ctx: ClientContext): void {
  // The published ClientRemote interface carries only the stream/host seats;
  // the generated Typert domains are the runtime contract, so cast to the
  // structural face this section declares.
  const api = ctx.remote as unknown as DiscoveryApi
  const injected = (): DiscoverySectionInjected => ({ api })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: SECTION_ID,
    // After the Models page (order 10): discovery feeds it.
    order: 20,
    label: () => SECTION_LABEL,
    inject: injected,
  }, DiscoverySection))
}
