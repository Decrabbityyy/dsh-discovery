/**
 * 两条宿主线的 settings 替身。
 *
 * 0.1.5 的 `ctx.settings` 是按命名空间注册的 provider：`register`/`get`/`mutate`，
 * 改完派发 `settings/updated`。0.1.7 换成了 `SettingsForms`：没有 register/get，只有
 * `mutate`，写入经 Loader 落到插件 Config 的 volatile 引用上，再派发
 * `loader/volatile-update`。两个替身都只实现本仓库用到的那一面。
 */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { RouteProfile } from '../src/config.ts'
import { commitVolatile } from './volatile.ts'
import type { VolatileRef } from './volatile.ts'

type Routes = Record<string, RouteProfile>
type Ops = readonly { op: 'set' | 'unset'; path: readonly string[]; value?: unknown }[]

/** 0.1.5 settings 面的替身：组成层 ∪ 用户层，按路径改用户层后提交。 */
export function legacySettingsStub(ctx: Context): unknown {
  const doc: Record<string, Record<string, unknown>> = {}
  const bases = new Map<string, Record<string, unknown>>()
  const read = (ns: string): unknown => {
    const base = bases.get(ns)
    if (base === undefined) return undefined
    return { ...base, ...doc[ns] }
  }
  return {
    register(ns: string, _schema: unknown, options?: { base?: Record<string, unknown> }): unknown {
      bases.set(ns, structuredClone(options?.base ?? {}))
      return { get: () => read(ns) }
    },
    get: read,
    mutate(ns: string, ops: Ops): Promise<void> {
      const section = structuredClone(doc[ns] ?? {})
      for (const op of ops) {
        // 这个命名空间只有 `routes` 一格，路径恒为 ['routes', <routeId>]。
        const [field, key] = op.path
        if (field !== 'routes' || key === undefined) continue
        const routes = { ...section['routes'] as Routes | undefined }
        if (op.op === 'set') routes[key] = op.value as RouteProfile
        else delete routes[key]
        section['routes'] = routes
      }
      doc[ns] = section
      ;(ctx.emit as unknown as (name: string, ns: string) => void)('settings/updated', ns)
      return Promise.resolve()
    },
  }
}

/**
 * 0.1.7 `SettingsForms` 面的替身。
 *
 * `attach` 要在插件挂载后调用：替身需要拿到插件 fiber 上的 volatile 引用才能照着
 * Loader 的做法落值（`updateVolatile` + 只对该 fiber 派发 `loader/volatile-update`）。
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
