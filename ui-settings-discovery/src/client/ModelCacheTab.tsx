/**
 * The 模型缓存 tab of 设置 → 插件: what `dsh-llm-dynamic-provider` currently
 * serves from, and one button that re-reads the models.dev snapshot and
 * re-probes every declared route without restarting the harness.
 *
 * A tab rather than a card in 插件配置: that tab's `settings.plugin.item` cards
 * edit a settings namespace (staged drafts, save/discard, reset), and the plugin
 * that serves the namespace owns its card — this one edits nothing and borrows
 * another plugin's namespace. The section's own extension point for a feature's
 * page is this root list slot, which is also how the read-only 插件列表 tab
 * arrives.
 *
 * Everything shown comes from that plugin's own cache endpoint; nothing is
 * written to settings.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { DYNAMIC_CACHE_PATH, messageOf } from './discovery.ts'
import type { DynamicCacheStatus, RouteProbe } from './discovery.ts'
import styles from './DiscoveryStyles.module.css'

/** A cache timestamp as the page shows it; one it never saw reads as a dash. */
function clockOf(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : new Date(value).toLocaleString()
}

/** What the facts were last loaded from, in the page's own words. */
function sourceLabel(source: DynamicCacheStatus['modelsDev']['source']): string {
  if (source === 'storage') return '本地存储域（按 ETag 增量刷新）'
  if (source === 'models.dev') return '内存（本次启动从网络拉取）'
  return '未知来源'
}

export function ModelCacheTab(): ReactNode {
  const [status, setStatus] = useState<DynamicCacheStatus | undefined>(undefined)
  const [probes, setProbes] = useState<readonly RouteProbe[] | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  // One status read on mount; a refusal leaves the error line and the button,
  // because the refresh is what the user came for. A 404 is the one refusal the
  // page can explain: nobody serves the endpoint, i.e. that plugin is not
  // composed here.
  useEffect(() => {
    let cancelled = false
    void fetch(DYNAMIC_CACHE_PATH)
      .then(async (response) => {
        if (response.status === 404) throw new Error('未安装 dsh-llm-dynamic-provider，本页没有可显示的缓存')
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return await response.json() as DynamicCacheStatus
      })
      .then((body) => {
        if (!cancelled) setStatus(body)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageOf(cause))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const refresh = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    setProbes(undefined)
    try {
      const response = await fetch(DYNAMIC_CACHE_PATH, { method: 'POST' })
      const body = await response.json() as DynamicCacheStatus & { readonly error?: string }
      if (!response.ok) {
        setError(body.error ?? `HTTP ${response.status}`)
        return
      }
      setStatus(body)
      setProbes(body.probes ?? [])
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  const facts = status?.modelsDev
  return (
    <div className={styles['cacheSection']}>
      <p className={styles['cacheIntro']}>
        models.dev 目录给模型补别名与上下文长度：组合里挂了存储域时它落在本地存储域、按 ETag 增量刷新，
        没有存储域时每次启动都从网络重新拉取，只留在内存里——上面的「来源」标出这次走的是哪条路。
      </p>
      <p className={styles['cacheIntro']}>
        「路由缓存文件」是另一份东西：只有组合开启 cache 时，上一次探测到的模型清单才会写进它，
        冷启动可以先按它注册路由、再到后台重新探测。
        这里可以不等重启就重新读取目录、重新探测全部声明路由，并按结果重写缓存。
      </p>
      <dl className={styles['cacheFacts']}>
        <div>
          <dt>声明路由</dt>
          <dd>{status === undefined ? '—' : `${String(status.routes)} 条`}</dd>
        </div>
        <div>
          <dt>models.dev 目录</dt>
          <dd>
            {facts === undefined
              ? '—'
              : `${String(facts.entries)} 条 · ${clockOf(facts.refreshedAt)} 刷新 · 来源 ${sourceLabel(facts.source)}`}
          </dd>
        </div>
        <div>
          <dt>路由缓存文件</dt>
          <dd>
            {status?.cacheFile === undefined
              ? '未启用：组合没有开启 cache，每次启动都重新探测'
              : `${status.cacheFile.path} · ${String(status.cacheFile.routes)} 条路由 · 写入于 ${clockOf(status.cacheFile.writtenAt)}`}
          </dd>
        </div>
      </dl>
      <div className={styles['actions']}>
        <button
          type="button"
          className={styles['primaryButton']}
          disabled={busy}
          onClick={() => { void refresh() }}
        >
          {busy ? '刷新中…' : '刷新缓存'}
        </button>
      </div>
      {facts?.storageError === undefined
        ? null
        : <p className={styles['cacheNote']}>models.dev 目录没有落在本地存储域：{facts.storageError}</p>}
      {facts?.error === undefined ? null : <p className={styles['cacheError']}>上次读取目录失败：{facts.error}</p>}
      {error === undefined ? null : <p className={styles['cacheError']}>{error}</p>}
      {probes === undefined
        ? null
        : probes.length === 0
          ? <p className={styles['cacheNote']}>没有声明任何路由。</p>
          : (
            <>
              <p className={styles['cacheSaved']} role="status" aria-live="polite">
                已刷新 {probes.length} 条路由。
              </p>
              <dl className={styles['cacheFacts']}>
                {probes.map(probe => (
                  <div key={probe.route}>
                    <dt>{probe.route}</dt>
                    <dd className={probe.error === undefined ? undefined : styles['cacheError']}>
                      {probe.error === undefined ? `${String(probe.models ?? 0)} 个模型` : probe.error}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}
    </div>
  )
}
