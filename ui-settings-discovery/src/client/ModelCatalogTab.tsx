/**
 * 设置 → 插件的「模型目录」页：这个部署的 models.dev 目录与声明路由，以及一次不用重启的刷新。
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { DYNAMIC_PROBE_PATH, messageOf } from './discovery.ts'
import type { RouteProbe, RouteStatus } from './discovery.ts'
import styles from './DiscoveryStyles.module.css'

/** A refresh timestamp as the page shows it; one it never saw reads as a dash. */
function clockOf(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : new Date(value).toLocaleString()
}

/** 目录这份数据这次是怎么来的，用页面的话说。 */
function sourceLabel(source: RouteStatus['modelsDev']['source']): string {
  if (source === 'storage') return '本地缓存'
  if (source === 'models.dev') return '本次启动联网获取'
  return '未知'
}

export function ModelCatalogTab(): ReactNode {
  const [status, setStatus] = useState<RouteStatus | undefined>(undefined)
  const [probes, setProbes] = useState<readonly RouteProbe[] | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  // 打开页面读一次状态；404 说明这个组合里没有动态路由插件。
  useEffect(() => {
    let cancelled = false
    void fetch(DYNAMIC_PROBE_PATH)
      .then(async (response) => {
        if (response.status === 404) throw new Error('未安装 dsh-llm-dynamic-provider')
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return await response.json() as RouteStatus
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
      const response = await fetch(DYNAMIC_PROBE_PATH, { method: 'POST' })
      const body = await response.json() as RouteStatus & { readonly error?: string }
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
      </dl>
      <div className={styles['actions']}>
        <button
          type="button"
          className={styles['primaryButton']}
          disabled={busy}
          onClick={() => { void refresh() }}
        >
          {busy ? '刷新中…' : '刷新目录与路由'}
        </button>
      </div>
      {facts?.error === undefined ? null : <p className={styles['cacheError']}>上次读取目录失败：{facts.error}</p>}
      {error === undefined ? null : <p className={styles['cacheError']}>{error}</p>}
      {probes === undefined
        ? null
        : probes.length === 0
          ? <p className={styles['cacheNote']}>没有声明任何路由。</p>
          : (
            <>
              <p className={styles['cacheSaved']} role="status" aria-live="polite">
                已重新探测 {probes.length} 条路由。
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
