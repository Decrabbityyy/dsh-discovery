import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = 'dsh-llm-discovery'

export const name = 'llm-discovery-invariant'
export const inject = ['invariants']

/** No runtime invariant: this plugin owns no cross-plugin mutable relation. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion, returning its disposer. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
