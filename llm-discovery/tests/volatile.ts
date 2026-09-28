/**
 * volatile 配置引用的写入协议。
 *
 * Loader 就地点更配置时走的就是这一条：`updateVolatile(ref, source)` 等价于
 * `ref[write](source.get())`，随后只在 owner fiber 上派发 `loader/volatile-update`。
 * 测试照着做，就不必为了一个写入符号去依赖 cosmokit——写入符号是 `Symbol.for`
 * 注册的，跨 ESM/CJS 副本一致。
 *
 * @module tests/volatile
 */

/** 一个 volatile 配置引用：稳定对象，`get()` 读当前快照。 */
export interface VolatileRef<T> {
  get(): T
}

/** cosmokit 的写入协议符号。 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/** 把新值点进引用，与 Loader 提交 volatile 配置的做法一致。 */
export function commitVolatile<T>(ref: VolatileRef<T>, value: T): void {
  const write = (ref as unknown as Record<symbol, ((next: T) => void) | undefined>)[VOLATILE_WRITE]
  if (write === undefined) throw new Error('the config field is not a volatile reference')
  write(value)
}

/** 造一个引用，顶替 schema 解析出来的那一份：手写的 Config 要交给 `apply`/`resolveDiscoveryConfig` 时用得上。 */
export function volatileRef<T>(value: T): VolatileRef<T> {
  let current = value
  const ref = { get: () => current } as VolatileRef<T> & Record<symbol, (next: T) => void>
  ref[VOLATILE_WRITE] = (next: T) => { current = next }
  return ref
}
