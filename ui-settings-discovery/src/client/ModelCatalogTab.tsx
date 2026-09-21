/**
 * 设置 → 插件的「模型目录」页：这个部署的 models.dev 目录与声明路由，以及一次不用重启的刷新。
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { UI_CATALOG_STATUS_PATH } from 'dsh-llm-discovery/vocabulary'
import { DYNAMIC_PROBE_PATH, messageOf } from './discovery.ts'
import type { CatalogStatus, RouteProbe, RouteStatus } from './discovery.ts'
import styles from './styles.module.css'

/** A refresh timestamp as the page shows it; one it never saw reads as a dash. */
function clockOf(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : new Date(value).toLocaleString()
}

/** 目录这份数据这次是怎么来的，用页面的话说。 */
function sourceLabel(source: CatalogStatus['source']): string {
  if (source === 'storage') return '本地缓存'
  if (source === 'models.dev') return '本次启动联网获取'
  return '未知'
}

/** 读一个 JSON 端点；404 说明这个组合里没有那个插件。 */
async function readJson(path: string, missing: string): Promise<unknown> {
  const response = await fetch(path)
  if (response.status === 404) throw new Error(missing)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return await response.json() as unknown
}

export function ModelCatalogTab(): ReactNode {
  const [routes, setRoutes] = useState<RouteStatus | undefined>(undefined)
  const [facts, setFacts] = useState<CatalogStatus | undefined>(undefined)
  const [probes, setProbes] = useState<readonly RouteProbe[] | undefined>(undefined)
  const [catalogError, setCatalogError] = useState<string | undefined>(undefined)
  const [routeError, setRouteError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  // 打开页面各读一次：目录来自本插件宿主半边，路由来自动态路由插件。
  useEffect(() => {
    let cancelled = false
    void Promise.allSettled([
      readJson(UI_CATALOG_STATUS_PATH, '目录端点不可用'),
      readJson(DYNAMIC_PROBE_PATH, '未安装 dsh-llm-dynamic-provider'),
    ]).then(([catalog, dynamic]) => {
      if (cancelled) return
      if (catalog.status === 'fulfilled') setFacts(catalog.value as CatalogStatus)
      else setCatalogError(messageOf(catalog.reason))
      if (dynamic.status === 'fulfilled') setRoutes(dynamic.value as RouteStatus)
      else setRouteError(messageOf(dynamic.reason))
    })
    return () => {
      cancelled = true
    }
  }, [])

  const refresh = async (): Promise<void> => {
    setBusy(true)
    setCatalogError(undefined)
    setRouteError(undefined)
    setProbes(undefined)
    const [catalog, dynamic] = await Promise.allSettled([
      fetch(UI_CATALOG_STATUS_PATH, { method: 'POST' }).then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return await response.json() as CatalogStatus
      }),
      fetch(DYNAMIC_PROBE_PATH, { method: 'POST' }).then(async (response) => {
        if (response.status === 404) throw new Error('未安装 dsh-llm-dynamic-provider')
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return await response.json() as RouteStatus
      }),
    ])
    if (catalog.status === 'fulfilled') setFacts(catalog.value)
    else setCatalogError(messageOf(catalog.reason))
    if (dynamic.status === 'fulfilled') {
      setRoutes(dynamic.value)
      setProbes(dynamic.value.probes ?? [])
    } else {
      setRouteError(messageOf(dynamic.reason))
    }
    setBusy(false)
  }

  return (
    <div className={styles['cacheSection']}>
      <dl className={styles['cacheFacts']}>
        <div>
          <dt>声明路由</dt>
          <dd>{routes === undefined ? '—' : `${String(routes.routes)} 条`}</dd>
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
      {catalogError === undefined ? null : <p className={styles['cacheError']}>{catalogError}</p>}
      {routeError === undefined ? null : <p className={styles['cacheError']}>{routeError}</p>}
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
