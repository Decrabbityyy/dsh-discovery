/**
 * 设置 → 插件的「模型目录」页：这个部署的 models.dev 目录与声明路由，以及一次不用重启的刷新。
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { UI_CATALOG_STATUS_PATH } from 'dsh-llm-discovery/vocabulary'
import { DYNAMIC_PROBE_PATH, messageOf } from './discovery.ts'
import type { CatalogStatus, DiscoverySettingsSection, RouteProbe, RouteStatus } from './discovery.ts'
import styles from './styles.module.css'

/** 刷新间隔那个设置字段。 */
const INTERVAL_FIELD = 'catalogRefreshIntervalMinutes'

/** 到点后再留的余量：宿主的定时器与这次回答之间总有毫秒级差。 */
const READ_SLACK_MS = 1_500

/** 最短重读间隔，免得宿主报了个已经过去的时刻把页面变成连问。 */
const MIN_READ_DELAY_MS = 5_000

/** Props delivered by the slot outlet: the bound settings scope this page also edits. */
export type ModelCatalogTabProps = Partial<{
  readonly scope: SettingsScope<DiscoverySettingsSection>
}>

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

export function ModelCatalogTab(props: ModelCatalogTabProps = {}): ReactNode {
  const { scope } = props
  const [routes, setRoutes] = useState<RouteStatus | undefined>(undefined)
  const [facts, setFacts] = useState<CatalogStatus | undefined>(undefined)
  const [probes, setProbes] = useState<readonly RouteProbe[] | undefined>(undefined)
  const [catalogError, setCatalogError] = useState<string | undefined>(undefined)
  const [routeError, setRouteError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  // 保存刷新间隔后立刻重读一次状态：宿主刚换了定时器，页面手上的 nextRefreshAt 已经过期。
  const [reloadToken, setReloadToken] = useState(0)

  /** 读一次两个来源；首次挂载、定时到点与改完设置共用，成功时把上一次的错误清掉。 */
  const read = async (stopped: () => boolean): Promise<CatalogStatus | undefined> => {
    const [catalog, dynamic] = await Promise.allSettled([
      readJson(UI_CATALOG_STATUS_PATH, '目录端点不可用'),
      readJson(DYNAMIC_PROBE_PATH, '未安装 dsh-llm-dynamic-provider'),
    ])
    if (stopped()) return undefined
    let fresh: CatalogStatus | undefined
    if (catalog.status === 'fulfilled') {
      fresh = catalog.value as CatalogStatus
      setFacts(fresh)
      setCatalogError(undefined)
    } else {
      setCatalogError(messageOf(catalog.reason))
    }
    if (dynamic.status === 'fulfilled') {
      setRoutes(dynamic.value as RouteStatus)
      setRouteError(undefined)
    } else {
      setRouteError(messageOf(dynamic.reason))
    }
    return fresh
  }

  // 打开页面读一次；宿主排了定时器就只在它下一次刷新的时刻之后再读一次，没排（默认 0）就没有
  // 下一次——页面不会再发请求。这条链路上没有给插件用的推送（浏览器只能 `$on` 宿主转发白名单
  // 里的事件），所以到点自己问。探测结果只在手动刷新时才有，这里不动 probes。
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const step = async (): Promise<void> => {
      const fresh = await read(() => stopped)
      if (stopped || fresh?.nextRefreshAt == null) return
      const delay = Math.max(fresh.nextRefreshAt - Date.now() + READ_SLACK_MS, MIN_READ_DELAY_MS)
      timer = setTimeout(() => { void step() }, delay)
    }
    void step()
    return () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one read loop for the page's lifetime; reloadToken restarts it.
  }, [reloadToken])

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
      {scope === undefined ? null : <RefreshIntervalField scope={scope} onChanged={() => { setReloadToken(token => token + 1) }} />}
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

/**
 * 目录自动刷新间隔：写设置命名空间的用户层，宿主半边收到 `settings/updated` 就重排定时器，
 * 所以保存后立即生效，不用重启。留空保存等于清掉用户层，回到部署配置的值。
 * 保存成功后告诉这一页重读一次状态，好让它按新的刷新时刻安排下一次。
 */
function RefreshIntervalField({ scope, onChanged }: {
  scope: SettingsScope<DiscoverySettingsSection>
  onChanged: () => void
}): ReactNode {
  const [snapshot, setSnapshot] = useState(() => scope.getSnapshot())
  useEffect(() => scope.subscribe(() => { setSnapshot(scope.getSnapshot()) }), [scope])
  const [draft, setDraft] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState(false)

  const minutes = snapshot.value?.[INTERVAL_FIELD] ?? 0
  const user = snapshot.user as Record<string, unknown> | undefined
  const overridden = user !== undefined && user !== null && INTERVAL_FIELD in user
  const text = draft ?? String(minutes)
  const trimmed = text.trim()
  const parsed = trimmed === '' ? undefined : Number(trimmed)
  const invalid = parsed !== undefined && (!Number.isInteger(parsed) || parsed < 0)
  const canSave = snapshot.writable && !invalid && !busy && trimmed !== String(minutes)

  const write = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    setSaved(false)
    try {
      if (trimmed === '') await scope.unset(INTERVAL_FIELD)
      else if (parsed !== undefined) await scope.set(INTERVAL_FIELD, parsed)
      setDraft(undefined)
      setSaved(true)
      onChanged()
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  const clear = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    setSaved(false)
    try {
      await scope.unset(INTERVAL_FIELD)
      setDraft(undefined)
      setSaved(true)
      onChanged()
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>目录自动刷新间隔（分钟）</span>
        <input
          className={styles['input']}
          type="number"
          min={0}
          step={1}
          value={text}
          placeholder={String(minutes)}
          aria-label="目录自动刷新间隔（分钟）"
          disabled={busy || !snapshot.writable}
          onChange={(event) => {
            setSaved(false)
            setDraft(event.target.value)
          }}
        />
      </div>
      <p className={styles['cacheNote']}>
        0 表示只在插件挂载时刷一次，之后可以在这里手动刷；留空保存则回到部署配置的值。
        {snapshot.status === 'ready'
          ? ` 当前生效：${minutes === 0 ? '只在挂载时刷一次' : `每 ${String(minutes)} 分钟`}。`
          : ' 正在读取当前设置…'}
      </p>
      {invalid ? <p className={styles['cacheError']}>请填 0 或正整数分钟数。</p> : null}
      {snapshot.writable ? null : <p className={styles['cacheNote']}>当前部署的设置文档不可写，这个值只能由配置文件提供。</p>}
      <div className={styles['actions']}>
        <button type="button" className={styles['secondaryButton']} disabled={!canSave} onClick={() => { void write() }}>
          {busy ? '保存中…' : '保存刷新间隔'}
        </button>
        <button
          type="button"
          className={styles['secondaryButton']}
          disabled={busy || !snapshot.writable || !overridden}
          onClick={() => { void clear() }}
        >
          恢复部署配置
        </button>
      </div>
      {error === undefined ? null : <p className={styles['cacheError']}>{error}</p>}
      {saved ? <p className={styles['cacheSaved']} role="status" aria-live="polite">已保存，立即生效。</p> : null}
    </>
  )
}
