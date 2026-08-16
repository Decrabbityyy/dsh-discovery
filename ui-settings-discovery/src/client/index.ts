/**
 * Model-discovery settings section plugin, browser half. It registers the
 * 模型发现 section into the settings panel and consumes the public
 * settings/credentials/llm wire faces; the host discovery offer (namespace
 * `llm-discovery`) is a separate plugin this package never mounts. Export
 * discipline: packages/client/AGENTS.md.
 */
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { DiscoverySection } from './DiscoverySection.tsx'
import type { DiscoverySectionInjected } from './DiscoverySection.tsx'

export type { DiscoverySectionInjected, DiscoverySectionProps } from './DiscoverySection.tsx'
export type { DiscoveryApi } from './discovery.ts'

/** Settings nav id of this section (drives `only` filtering). */
export const SECTION_ID = 'model-discovery'

/** Settings nav label; static Chinese product copy, so no locale lookup. */
const SECTION_LABEL = '模型发现'

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on each slot through `slots.inject()`.
 */
export const inject = ['slots', 'connection']

/**
 * Register the discovery section once the `settings.section` declaration is
 * on the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const injected = (): DiscoverySectionInjected => ({ api: connection.api })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: SECTION_ID,
    // After the Models page (order 10): discovery feeds it.
    order: 20,
    label: () => SECTION_LABEL,
    inject: injected,
  }, DiscoverySection))
}
