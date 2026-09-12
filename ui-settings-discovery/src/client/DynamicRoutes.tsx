/**
 * The 动态路由 block: manage the routes declared in the `llm-dynamic-provider`
 * namespace. Writes land in the namespace the host plugin watches, so a hot
 * edit reprobes without a restart. The block renders only when the Host Loader
 * inventory reports that plugin active.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { CREDENTIAL_REF_PATTERN, deriveKeyRef, messageOf, ROUTE_PATTERN } from './discovery.ts'
import type { DiscoveryApi, DynamicRoute } from './discovery.ts'
import styles from './DiscoverySection.module.css'

const DYNAMIC_PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'] as const

/** One route's editable draft; the route id is edited separately. */
interface RouteDraft {
  id: string
  baseURL: string
  api: string
  apiKey: string
  displayName: string
}

const EMPTY_DRAFT: RouteDraft = { id: '', baseURL: '', api: 'openai-completions', apiKey: '', displayName: '' }

export function DynamicRoutes({ api }: { api: DiscoveryApi }): ReactNode {
  const [routes, setRoutes] = useState<Record<string, DynamicRoute> | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | undefined>(undefined)
  const [draft, setDraft] = useState<RouteDraft>(EMPTY_DRAFT)
  const [editing, setEditing] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  /** Re-read the routes, bypassing the settings RPC the host exposes only once a route exists. */
  const reload = async (): Promise<void> => {
    try {
      const response = await fetch('/llm-dynamic-provider/routes')
      if (!response.ok) {
        setLoadError(`读取动态路由失败:HTTP ${response.status}`)
        return
      }
      const body = await response.json() as { routes?: Record<string, DynamicRoute> }
      setRoutes(body.routes ?? {})
      setLoadError(undefined)
    } catch (cause) {
      setLoadError(messageOf(cause))
    }
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one read on mount; writes re-read.
  }, [])

  /** Write one route set/unset through the same endpoint, then re-read. */
  const write = async (op: 'set' | 'unset', routeId: string, route?: DynamicRoute): Promise<string | undefined> => {
    try {
      const response = await fetch('/llm-dynamic-provider/routes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op, routeId, ...route === undefined ? {} : { route } }),
      })
      const body = await response.json() as { routes?: Record<string, DynamicRoute>; error?: string }
      if (!response.ok) return body.error ?? `HTTP ${response.status}`
      setRoutes(body.routes ?? {})
      setLoadError(undefined)
      return undefined
    } catch (cause) {
      return messageOf(cause)
    }
  }

  /** Store the typed key, then set the route. Returns a failure message or undefined. */
  const save = async (): Promise<string | undefined> => {
    /* v8 ignore next -- the save button is disabled while the derived reference is illegal */
    if (keyRefProblem !== undefined) return keyRefProblem
    let apiKeyEnv: string | undefined
    if (keyValue.length > 0) {
      apiKeyEnv = keyRef
      const stored = await api.credentials.set(apiKeyEnv, keyValue)
      if (!stored.ok) return stored.error.message
    }
    const route: DynamicRoute = {
      baseURL: draft.baseURL.trim(),
      api: draft.api,
      ...apiKeyEnv === undefined ? {} : { apiKeyEnv },
      ...draft.displayName.trim().length === 0 ? {} : { displayName: draft.displayName.trim() },
    }
    return write('set', routeId, route)
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      const outcome = await save()
      if (outcome !== undefined) {
        setError(outcome)
        return
      }
      setDraft(EMPTY_DRAFT)
      setEditing(undefined)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (routeId: string): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      const outcome = await write('unset', routeId)
      if (outcome !== undefined) setError(outcome)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  const beginEdit = (routeId: string, route: DynamicRoute): void => {
    setEditing(routeId)
    setDraft({
      id: routeId,
      baseURL: route.baseURL,
      api: route.api,
      apiKey: '',
      displayName: route.displayName ?? '',
    })
  }

  const routeId = draft.id.trim()
  const keyValue = draft.apiKey.trim()
  const keyRef = deriveKeyRef(routeId)
  const idInvalid = routeId.length > 0 && !ROUTE_PATTERN.test(routeId)
  const editingExisting = editing !== undefined
  // The credential namespace brands a reference as an environment-variable
  // name, so a route id starting with a digit can carry no stored key.
  const keyRefProblem = keyValue.length === 0 || CREDENTIAL_REF_PATTERN.test(keyRef)
    ? undefined
    : `路由 ID「${routeId}」的凭证引用「${keyRef}」不是合法的环境变量名（必须以字母或下划线开头）；请改用字母开头的路由 ID，或清空 API 密钥。`
  const canSubmit = !busy && routeId.length > 0 && !idInvalid && draft.baseURL.trim().length > 0
    && keyRefProblem === undefined
  const entries = Object.entries(routes ?? {})

  return (
    <section className={styles['resultsArea']} aria-label="动态路由">
      <span className={styles['resultsTitle']}>动态路由</span>
      <p className={styles['intro']}>
        动态路由在每次启动时重新探测其端点并把发现的模型注册进模型注册表，无需手动采纳。
      </p>
      {loadError !== undefined ? <p className={styles['error']}>{loadError}</p> : null}

      {entries.length > 0
        ? (
          <table className={styles['results']}>
            <thead>
              <tr>
                <th className={styles['resultHead']}>路由 ID</th>
                <th className={styles['resultHead']}>协议</th>
                <th className={styles['resultHead']}>端点地址</th>
                <th className={styles['resultHead']}>名称</th>
                <th className={styles['resultHead']}><span className={styles['visuallyHidden']}>操作</span></th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([id, route]) => (
                <tr key={id} className={styles['resultRow']}>
                  <td className={`${styles['resultCell']} ${styles['resultId']}`}>{id}</td>
                  <td className={styles['resultCell']}>{route.api}</td>
                  <td className={styles['resultCell']}>{route.baseURL}</td>
                  <td className={styles['resultCell']}>{route.displayName ?? '—'}</td>
                  <td className={styles['resultCell']}>
                    <button type="button" className={styles['primaryButton']} disabled={busy} onClick={() => { beginEdit(id, route) }}>
                      编辑
                    </button>
                    <button type="button" className={styles['primaryButton']} disabled={busy} onClick={() => { void remove(id) }}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
        : <p className={styles['empty']}>尚无动态路由。</p>}

      <div className={styles['adoptCard']}>
        <span className={styles['adoptTitle']}>{editingExisting ? `编辑路由「${editing}」` : '新增动态路由'}</span>
        <div className={styles['field']}>
          <span className={styles['fieldLabel']}>路由 ID</span>
          <input
            className={styles['input']}
            type="text"
            value={draft.id}
            placeholder="local-engine"
            aria-label="路由 ID"
            disabled={busy || editingExisting}
            onChange={(event) => { setDraft({ ...draft, id: event.target.value }) }}
          />
        </div>
        {idInvalid ? <p className={styles['error']}>路由 ID 只能包含小写字母、数字和连字符。</p> : null}
        <div className={styles['field']}>
          <span className={styles['fieldLabel']}>协议</span>
          <select
            className={clsx(styles['input'], styles['selectInput'])}
            value={draft.api}
            aria-label="协议"
            disabled={busy}
            onChange={(event) => { setDraft({ ...draft, api: event.target.value }) }}
          >
            {DYNAMIC_PROTOCOLS.map(choice => <option key={choice} value={choice}>{choice}</option>)}
          </select>
        </div>
        <div className={styles['field']}>
          <span className={styles['fieldLabel']}>端点地址</span>
          <input
            className={styles['input']}
            type="text"
            value={draft.baseURL}
            placeholder="http://127.0.0.1:11434"
            aria-label="端点地址"
            disabled={busy}
            onChange={(event) => { setDraft({ ...draft, baseURL: event.target.value }) }}
          />
        </div>
        <div className={styles['field']}>
          <span className={styles['fieldLabel']}>显示名称（可选）</span>
          <input
            className={styles['input']}
            type="text"
            value={draft.displayName}
            placeholder={routeId}
            aria-label="显示名称（可选）"
            disabled={busy}
            onChange={(event) => { setDraft({ ...draft, displayName: event.target.value }) }}
          />
        </div>
        <div className={styles['field']}>
          <span className={styles['fieldLabel']}>API 密钥（可选）</span>
          <input
            className={styles['input']}
            type="password"
            autoComplete="off"
            value={draft.apiKey}
            placeholder={editingExisting ? '留空保持不变' : 'sk-…'}
            aria-label="API 密钥（可选）"
            disabled={busy}
            onChange={(event) => { setDraft({ ...draft, apiKey: event.target.value }) }}
          />
        </div>
        {keyRefProblem !== undefined ? <p className={styles['error']}>{keyRefProblem}</p> : null}
        <div className={styles['actions']}>
          <button type="button" className={styles['primaryButton']} disabled={!canSubmit} onClick={() => { void submit() }}>
            {busy ? '保存中…' : editingExisting ? '保存路由' : '添加路由'}
          </button>
          {editingExisting
            ? (
              <button type="button" className={styles['primaryButton']} disabled={busy} onClick={() => { setEditing(undefined); setDraft(EMPTY_DRAFT) }}>
                取消
              </button>
            )
            : null}
        </div>
        {error !== undefined ? <p className={styles['error']}>{error}</p> : null}
      </div>
    </section>
  )
}
