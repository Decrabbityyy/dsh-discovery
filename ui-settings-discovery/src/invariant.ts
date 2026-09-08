/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = 'dsh-client-ui-settings-discovery'

export const name = 'client-ui-settings-discovery-invariant'
export const inject = ['invariants']

/** No runtime invariant: this plugin owns no cross-plugin mutable relation. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion, returning its disposer. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
