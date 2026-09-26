/**
 * 0.1.5 ↔ 0.1.7 的浏览器侧设置表单兼容面（临时件）。
 *
 * 两条线提供的是同一份东西，服务名与取法不同：
 *
 * | | 0.1.5 | 0.1.7 |
 * |---|---|---|
 * | 服务 | `ctx.settingsScope` | `ctx.configForms` |
 * | 取一份 | `bind({ namespace })` | `get(entryId)` |
 *
 * 快照与 `set`/`unset` 的形状两条线一致（`ConfigForm` 就是 `SettingsScope` 改名而来），
 * 所以这里只声明一份自己的接口，两边都往里塞。等 next 升上 latest、决定丢掉 0.1.5 时，
 * 删掉 `FORM_SERVICES` 里的那一项与 `bind` 分支即可。
 *
 * @module dsh-client-ui-settings-discovery/client/settings-form
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'

/** 一份设置表单现在的样子；两条线的快照字段相同。 */
export interface SettingsFormSnapshot<T> {
  /** `unavailable` 表示这个命名空间没有暴露给当前客户端（没装拥有它的插件）。 */
  status: 'loading' | 'ready' | 'unavailable'
  /** 最近一次被接受的、按 schema 解析过的值。 */
  value: T | undefined
  /** 值下面的组成层：清掉一个字段就回到它。 */
  base: unknown
  /** 存着的那份用户层；一个字段「在不在」这里才表示它有没有被覆盖。 */
  user: unknown
  /** 下一次写入要带上的 revision。 */
  revision: number | undefined
  /** 宿主文档收不收写入。 */
  writable: boolean
  /** `host` 与宿主文档同步；`memory` 是远端浏览器进程内的临时一份。 */
  mode: 'host' | 'memory'
}

/**
 * 一份设置表单：读快照、订阅变化、写一个字段。
 *
 * `set`/`unset` 的返回是「宿主收没收下」：0.1.7 用 `false` 表示拒收（这个字段不是
 * volatile、或连接是 memory 模式），0.1.5 拒收会直接 reject，正常返回没有值。
 */
export interface SettingsForm<T> {
  getSnapshot(): SettingsFormSnapshot<T>
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<unknown>
  unset(field: string): Promise<unknown>
}

/** 承载这份表单的服务名，按宿主线从新到旧；同一个组合里只有一个会在。 */
export const FORM_SERVICES = ['configForms', 'settingsScope'] as const

/** 0.1.7 的 `configForms` 上用到的那一面。 */
interface ConfigFormsFace {
  get<T>(entryId: string): SettingsForm<T>
}

/** 0.1.5 的 `settingsScope` 上用到的那一面。 */
interface SettingsScopeBinderFace {
  bind<T>(spec: { namespace: string }): SettingsForm<T>
}

/**
 * 按服务名取一份命名空间的设置表单。
 *
 * 两个服务都按「命名空间 id」取：0.1.5 的命名空间是插件注册时用的名字，0.1.7 的
 * 命名空间就是该插件的 Loader entry id；本仓库的 cordis.patch.yml 把两者都钉成插件名。
 *
 * @param ctx - 已经注入了该服务的上下文。
 * @param service - `FORM_SERVICES` 里的一项。
 * @param namespace - 拥有这份设置的插件命名空间。
 * @returns 绑好的表单；服务不在或不认识时 undefined。
 */
export function bindSettingsForm<T>(ctx: ClientContext, service: string, namespace: string): SettingsForm<T> | undefined {
  // `get` 只按 cordis 的按键重载暴露服务，服务名在运行时是字符串。
  const find = (ctx as unknown as { get(name: string): unknown }).get.bind(ctx)
  const found = find(service) as Partial<ConfigFormsFace & SettingsScopeBinderFace> | undefined
  if (found === undefined) return undefined
  if (typeof found.get === 'function') return found.get<T>(namespace)
  if (typeof found.bind === 'function') return found.bind<T>({ namespace })
  return undefined
}
