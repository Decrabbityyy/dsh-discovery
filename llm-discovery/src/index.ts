/**
 * OMP-style endpoint model discovery for the DeepSeek Harness LLM seam: one
 * plugin registering the `llm-discovery` discovery offer on `ctx.llm`. The
 * engine ladder, enrichment, and every shared constant live in
 * `dsh-llm-endpoint-base`; this plugin is the thin Cordis shell that mounts
 * that engine as the `llm-discovery` offer. Configuration surfaces reach it
 * through the existing `llm.discoverModels` RPC with
 * `settingsNs: 'llm-discovery'`; no adapter or gateway changes are involved.
 * Named exports preserve loader injection metadata.
 * @module dsh-llm-discovery
 */

import type { Context } from '@deepseek-ai/cordis'
import { DISCOVERY_NAMESPACE, discoverEndpoint, resolveDiscoveryConfig } from 'dsh-llm-endpoint-base'
import type { Config } from 'dsh-llm-endpoint-base'

export { Config, resolveDiscoveryConfig } from 'dsh-llm-endpoint-base'
export type { EngineSwitches, ResolvedDiscoveryConfig } from 'dsh-llm-endpoint-base'
export { DISCOVERY_NAMESPACE, discoverEndpoint, enrichModels } from 'dsh-llm-endpoint-base'

/** Cordis plugin name. */
export const name = 'llm-discovery'
/** Service dependency: the LLM registry the discovery offer registers on. */
export const inject = ['llm']

/**
 * Register the `llm-discovery` model-discovery offer. The registration is
 * scoped to the plugin fiber, so an HMR reload or unload withdraws the offer
 * with the plugin.
 * @param ctx - registrant context carrying the LLM registry.
 * @param config - deployment tunables; all fields optional with documented
 *   defaults.
 */
export function apply(ctx: Context, config?: Config): void {
  const resolved = resolveDiscoveryConfig(config)
  ctx.llm.registerModelDiscovery(DISCOVERY_NAMESPACE, request => discoverEndpoint(request, resolved))
}
