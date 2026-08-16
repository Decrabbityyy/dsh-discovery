/**
 * Package-owned invariant companion for `dsh-llm-discovery`.
 * @module dsh-llm-discovery/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = 'dsh-llm-discovery'

/** Cordis companion plugin name. */
export const name = 'llm-discovery-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the plugin owns one fiber-scoped discovery-offer
 * registration whose presence the registry itself enforces, and stateless
 * probe helpers; there is no owned event stream or mutable relation a
 * companion could compare against an authoritative source.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
