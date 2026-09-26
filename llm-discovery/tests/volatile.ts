/**
 * 0.1.7 的 volatile 配置引用协议。
 *
 * Loader 就地点更配置时走的就是这一条：`updateVolatile(ref, source)` 等价于
 * `ref[write](source.get())`，随后只在 owner fiber 上派发 `loader/volatile-update`。
 * 测试照着做，就不必为一条 0.1.5 宿主上根本不存在的 API 去依赖 cosmokit——
 * 写入符号是 `Symbol.for` 注册的，跨 ESM/CJS 副本一致。
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
