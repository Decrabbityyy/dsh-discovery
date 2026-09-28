/**
 * 宿主配置面：Loader 拥有的插件 Config。
 *
 * 0.1.7 起，标了 `.volatile()` 的配置字段由 Loader 就地点更，这一层有三件事：
 *
 * - **生效值**：`config.<field>.get()`——交到插件手上的是稳定引用，不是普通值；
 * - **变更通知**：`loader/volatile-update`，Loader 只发给 owner fiber；
 * - **写入目标**：本插件的 Loader entry id。
 *
 * 后两件收在这里，`dsh-llm-dynamic-provider` 也从这条子路径取。
 *
 * @module dsh-llm-discovery/loader-config
 */

import type { Context } from '@deepseek-ai/cordis'

// `loader/volatile-update` 由 Loader 派发，上游声明在 `@deepseek-ai/cordis-plugin-loader`
// 里。这里自己声明一份，免得为了一个事件类型多带一个 peer；签名与上游一致，两边同时
// 在场也只是重复声明同一个成员。
declare module '@deepseek-ai/cordis' {
  interface Events {
    /** 本插件的 volatile 配置被就地点更后派发；Loader 只发给 owner fiber。 */
    'loader/volatile-update'(paths: readonly (readonly string[])[]): void
  }
}

/**
 * 本插件的 volatile 配置被就地点更后调 `notify`。
 *
 * Loader 把新值点进引用之后才派发，且只发给 owner fiber，所以回调里直接重读
 * `config.<field>.get()` 就是最新值。
 */
export function onVolatileUpdate(ctx: Context, notify: () => void): void {
  ctx.on('loader/volatile-update', () => { notify() })
}

/**
 * 写设置的命名空间：0.1.7 上就是本插件的 Loader entry id。
 *
 * 与 Loader 自己的 `locate()` 同一套走法：先看本 fiber，再沿父 fiber 往上找——插件
 * 在 `ctx.inject()` 起的子 fiber 里读到的是子上下文，而 entry 挂在起它的那一层。
 * 组合里没有 Loader 时（测试直接 `new Context()`）退回插件自己的名字。
 */
export function loaderEntryId(ctx: Context, fallback: string): string {
  type EntryFiber = { entry?: { options?: { id?: string } }; parent?: { fiber?: EntryFiber } }
  let fiber = ctx.fiber as unknown as EntryFiber | undefined
  while (fiber !== undefined) {
    const id = fiber.entry?.options?.id
    if (id !== undefined) return id
    const parent = fiber.parent?.fiber
    if (parent === undefined || parent === fiber) break
    fiber = parent
  }
  return fallback
}
