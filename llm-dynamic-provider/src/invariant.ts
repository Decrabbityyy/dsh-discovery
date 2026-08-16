/**
 * Package-owned invariant companion for `dsh-llm-dynamic-provider`.
 * @module dsh-llm-dynamic-provider/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = 'dsh-llm-dynamic-provider'

/** Cordis companion plugin name. */
export const name = 'llm-dynamic-provider-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the plugin's only mutation channel is the llm seam's
 * own atomic `registerAdapter`/`replace` (validated before any route moves),
 * and the probe/assemble path is exercised by the test suite; no independent
 * event stream or mutable relation exists for a companion to cross-check.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
