/**
 * Model-discovery settings section plugin, browser half. It registers the
 * 模型发现 section into the settings panel and consumes the public
 * settings/credentials/llm Remote faces through `ctx.remote`; the host
 * discovery offer (namespace `llm-discovery`) is a separate plugin this
 * package never mounts. Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the cordis Context augmentation carrying `remote` and the
// re-exported wire vocabulary (LlmDiscoveredModel, RpcResponse, …).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { DiscoverySection } from './DiscoverySection.tsx'
import type { DiscoverySectionInjected } from './DiscoverySection.tsx'
import type { DiscoveryApi } from './discovery.ts'

export type { DiscoverySectionInjected, DiscoverySectionProps } from './DiscoverySection.tsx'
export type { DiscoveryApi } from './discovery.ts'

/** Settings nav id of this section (drives `only` filtering). */
export const SECTION_ID = 'model-discovery'

/** Settings nav label; static Chinese product copy, so no locale lookup. */
const SECTION_LABEL = '模型发现'

/**
 * Required services (cordis fiber inject), matching the alpha.4 settings
 * sections: `remote` is the typed Remote client this page calls, while
 * `locale`/`settingsScope` are runtime ordering requirements only (this
 * section renders static copy and no scoped value, so it never reads them).
 * The target slot is declared by ui-settings' apply, whose activation order
 * relative to this one is NOT constrained; registration depends on each slot
 * through `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

/**
 * Register the discovery section once the `settings.section` declaration is
 * on the ledger.
 * @param ctx - client root context.
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
