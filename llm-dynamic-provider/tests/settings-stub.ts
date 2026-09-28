/**
 * `SettingsForms` 的替身：写入照着 Loader 的做法落到插件 Config 的 volatile 引用上，
 * 再派发 `loader/volatile-update`。只实现本仓库用到的那一面。
 */

import type { Fiber } from '@deepseek-ai/cordis'
import type { RouteProfile } from '../src/config.ts'
import { commitVolatile } from './volatile.ts'
import type { VolatileRef } from './volatile.ts'

type Routes = Record<string, RouteProfile>
type Ops = readonly { op: 'set' | 'unset'; path: readonly string[]; value?: unknown }[]

/**
 * `SettingsForms` 面的替身。
 *
 * `attach` 要在插件挂载后调用：替身需要拿到插件 fiber 上的 volatile 引用才能照着
 * Loader 的做法落值（点更引用 + 只对该 fiber 派发 `loader/volatile-update`）。
 */
export function formsStub(): { service: unknown; attach(fiber: Fiber): void } {
  let fiber: Fiber | undefined
  let routes: VolatileRef<Routes> | undefined
  return {
    attach(next: Fiber): void {
      fiber = next
      routes = (next.config as { routes: VolatileRef<Routes> }).routes
    },
    service: {
      mutate(_ns: string, ops: Ops): Promise<void> {
        const next = { ...routes!.get() }
        for (const op of ops) {
          const key = op.path[1]!
          if (op.op === 'set') next[key] = op.value as RouteProfile
          else delete next[key]
        }
        commitVolatile(routes!, next)
        fiber!.ctx.emit('loader/volatile-update', ops.map(op => op.path))
        return Promise.resolve()
      },
    },
  }
}
