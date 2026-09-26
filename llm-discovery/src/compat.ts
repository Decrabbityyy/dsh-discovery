/**
 * 0.1.5 ↔ 0.1.7 的宿主兼容面（临时件）。
 *
 * 0.1.7 把插件设置从「插件自己 `register` 的命名空间 + settings 文档」换成了
 * 「Loader entry 的 Config + 标了 `.volatile()` 的字段」，同一条设置在两条线上
 * 有三个差别：
 *
 * | | 0.1.5 | 0.1.7 |
 * |---|---|---|
 * | 生效值 | `ctx.settings.get(ns)` | `config.<field>.get()` |
 * | 变更通知 | `settings/updated` | `loader/volatile-update`（只发给 owner fiber） |
 * | 写入目标 | 命名空间 id | Loader entry id |
 *
 * 这个模块是仓库里唯一知道两套写法的地方：插件源码只调下面这几个函数，各自
 * 在调用点上标了「0.1.5 兼容」。等 next 升上 latest、决定丢掉 0.1.5 时，删掉
 * `legacySettings` / `onSettingsCommit` / `loaderEntryId`，把 `configValue()` 换成
 * 直接 `.get()`、`volatileField()` 换成 `.volatile()`，再清掉那些分支即可。
 *
 * @module dsh-llm-discovery/compat
 */

import type { Context } from '@deepseek-ai/cordis'

// 0.1.7 由 Loader 派发的 `loader/volatile-update` 上游声明在
// `@deepseek-ai/cordis-plugin-loader` 里。这里自己声明一份，免得为了一个事件类型
// 多带一个 peer；签名与上游一致，两边同时在场也只是重复声明同一个成员。
declare module '@deepseek-ai/cordis' {
  interface Events {
    /** 本插件的 volatile 配置被就地点更后派发；Loader 只发给 owner fiber。 */
    'loader/volatile-update'(paths: readonly (readonly string[])[]): void
  }
}

/** 0.1.7 把标了 `.volatile()` 的配置字段解析成的引用：稳定、可读当前快照。 */
export interface VolatileRef<T> {
  get(): T
}

/**
 * 这个值是不是 0.1.7 的 volatile 引用。
 *
 * 按成员判断而不是按模块身份：宿主可能以 ESM/CJS 两种副本提供这份实现，鸭子类型
 * 在两个副本之间都成立。配置值本身经过 schema 校验，不会是函数。
 */
export function isVolatileRef(value: unknown): value is VolatileRef<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { get?: unknown }).get === 'function'
}

/**
 * 一个配置字段的生效值。
 *
 * 0.1.7 传下来的是 volatile 引用，0.1.5 传下来的是普通值，这里一起收口，调用方
 * 按普通值用。字段缺席时两条线都是 `undefined`。
 */
export function configValue<T>(value: T): T {
  return isVolatileRef(value) ? value.get() as T : value
}

/**
 * 给一个 schema 字段标上 0.1.7 的 `.volatile()`：只有标了的字段才进设置页、才能
 * 被页面改写。
 *
 * 0.1.5 那条线的 schemastery 还没有这个方法，原样返回——字段就只是部署配置，
 * 用户层由 `legacySettings()` 注册的命名空间承担。返回类型仍是普通 schema，所以
 * `z<Config>` 的断言在两条线上都成立，运行时的引用由 `configValue()` 拆。
 */
export function volatileField<S extends object>(schema: S): S {
  const holder = schema as unknown as { volatile?: () => S }
  return typeof holder.volatile === 'function' ? holder.volatile() : schema
}

/** 0.1.5 的 settings 服务上，本仓库用到的成员。 */
interface LegacySettingsService {
  /** 注册命名空间 schema，`base` 是组成层。 */
  register(ns: string, schema: unknown, options: { base: unknown }): unknown
  /** 读一个已注册命名空间的生效值。 */
  get(ns: string): unknown
}

/**
 * 0.1.5 的 settings 面，0.1.7 上返回 `undefined`。
 *
 * 判据是 `register`：0.1.7 的 `ctx.settings` 换成了 `SettingsForms`，只有
 * `describe`/`update`/`replace`/`mutate`，没有按命名空间注册这回事。
 */
export function legacySettings(ctx: Context): LegacySettingsService | undefined {
  const service = ctx.get('settings') as Partial<LegacySettingsService> | undefined
  if (service === undefined || typeof service.register !== 'function' || typeof service.get !== 'function') return undefined
  return service as LegacySettingsService
}

/**
 * 0.1.5 上命名空间被提交后调 `notify`。
 *
 * 0.1.7 的 d.ts 里没有 `settings/updated`（改名成 `settings/document-updated` 了），
 * 但事件名在运行时就是字符串：这条线不派发它，注册了也不会响。
 */
export function onSettingsCommit(ctx: Context, ns: string, notify: () => void): void {
  const on = ctx.on as unknown as (name: string, listener: (ns: string) => void) => unknown
  on('settings/updated', (changed) => {
    if (changed === ns) notify()
  })
}

/**
 * 0.1.7 上本插件的 volatile 配置被就地点更后调 `notify`。
 *
 * Loader 把新值点进引用之后才派发，且只发给 owner fiber，所以回调里直接重读
 * `configValue()` 就是最新值。0.1.5 上没有这个事件，注册了也不会响。
 */
export function onVolatileUpdate(ctx: Context, notify: () => void): void {
  ctx.on('loader/volatile-update', () => { notify() })
}

/**
 * 0.1.7 上写设置的目标：命名空间就是 Loader entry id。
 *
 * 组合里没有 Loader 时（测试直接 `new Context()`）退回插件自己的名字；0.1.5 那条线
 * 不该调这个函数——它的写入目标是注册用的命名空间常量。
 */
export function loaderEntryId(ctx: Context, fallback: string): string {
  const fiber = ctx.fiber as unknown as { entry?: { options?: { id?: string } } }
  return fiber.entry?.options?.id ?? fallback
}
