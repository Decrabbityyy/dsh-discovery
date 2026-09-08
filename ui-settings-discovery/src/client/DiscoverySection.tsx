/**
 * The 模型发现 settings section: probe a preset or custom endpoint through the
 * host's `llm.discoverModels` offer and adopt a selection into a new pi-ai
 * provider profile.
 *
 * Adoption writes through the same public wire the Models page uses, with two
 * ordering constraints: a typed key is stored FIRST through `credentials.set`
 * under the derived `<ROUTE>_API_KEY` reference and the profile records
 * `apiKeyEnv` only when a key was entered, and a selection of nothing writes no
 * `models` key at all, which serves the route's whole catalog.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-api-remotes/client'
import clsx from 'clsx'
import {
  deriveKeyRef, DISCOVERY_NS, DISCOVERY_PLUGIN, DYNAMIC_PLUGIN, isActivePlugin,
  messageOf, normalizeModelName, PI_AI_NS, ROUTE_PATTERN,
} from './discovery.ts'
import type { DiscoveryApi, DiscoveryResponse } from './discovery.ts'
import { DynamicRoutes } from './DynamicRoutes.tsx'
import { CUSTOM_PRESET, ENGINE_PRESETS, PROTOCOLS, reasoningEffortsOf } from './presets.ts'
import type { EnginePreset } from './presets.ts'
import styles from './DiscoverySection.module.css'

/** Injected dependencies of {@link DiscoverySection} (slot `inject`). */
export interface DiscoverySectionInjected {
  api: DiscoveryApi
}

/**
 * Props delivered by the slot outlet: the inject face spread flat (the renderer
 * erases the share boundary at the render call).
 */
export type DiscoverySectionProps = Partial<DiscoverySectionInjected>

/** A compact modality marker: 文 for text, 图 for image, joined. */
function modalityLabel(input: readonly string[] | undefined): string {
  if (input === undefined || input.length === 0) return '—'
  return input.map(value => (value === 'image' ? '图' : '文')).join('·')
}

/** Renders the section, or null while the shell has not injected yet. */
export function DiscoverySection(props: DiscoverySectionProps): ReactNode {
  const { api } = props
  if (api === undefined) return null
  return <Loaded api={api} />
}

function Loaded({ api }: { api: DiscoveryApi }): ReactNode {
  const [presetKey, setPresetKey] = useState<string | undefined>(undefined)
  const [baseURL, setBaseURL] = useState('')
  const [protocol, setProtocol] = useState<string>(PROTOCOLS[0])
  // Write-only draft: it never renders back.
  const [apiKey, setApiKey] = useState('')
  const [probing, setProbing] = useState(false)
  const [probeError, setProbeError] = useState<string | undefined>(undefined)
  const [candidates, setCandidates] = useState<readonly LlmDiscoveredModel[] | undefined>(undefined)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  // Case-insensitive id/name filter over the results table; hidden rows keep
  // their picks.
  const [query, setQuery] = useState('')
  const [route, setRoute] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [adopting, setAdopting] = useState(false)
  const [adoptError, setAdoptError] = useState<string | undefined>(undefined)
  const [adoptedRoute, setAdoptedRoute] = useState<string | undefined>(undefined)
  // Thinking levels picked per adopted model id. A model absent from the map
  // carries no reasoningEfforts, which lets a catalog route inherit while a
  // hand-declared route stays non-reasoning.
  const [modelLevels, setModelLevels] = useState<Readonly<Record<string, ReadonlySet<string>>>>({})
  // Served by the dynamic provider's own HTTP route; empty while unfetched or
  // when that plugin is absent.
  const [catalog, setCatalog] = useState<Readonly<Record<string, readonly string[]>>>({})
  const [modalities, setModalities] = useState<Readonly<Record<string, { input?: readonly string[]; output?: readonly string[] }>>>({})
  // The bare-name facts from that same endpoint. The host discovery seam
  // enriches from the bundled pi-ai catalog only, so these fill in a model it
  // has not catalogued yet.
  const [facts, setFacts] = useState<Readonly<Record<string, { name?: string; contextWindow?: number; maxTokens?: number }>>>({})
  // Whether the route id names an installed-catalog pi-ai provider; such a
  // route inherits each known model's reasoning, so the picker disables itself.
  const [isCatalogRoute, setIsCatalogRoute] = useState(false)
  // A host plugin is usable only once its root fiber is active; pending and
  // failed entries stay hidden.
  const [dynamicLoaded, setDynamicLoaded] = useState(false)
  const [discoveryLoaded, setDiscoveryLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => api.pluginInventory.list()).then((response) => {
      if (cancelled) return
      if (!response.ok) {
        setDynamicLoaded(false)
        setDiscoveryLoaded(false)
        return
      }
      setDynamicLoaded(isActivePlugin(response.value, DYNAMIC_PLUGIN))
      setDiscoveryLoaded(isActivePlugin(response.value, DISCOVERY_PLUGIN))
    }).catch(() => {
      if (cancelled) return
      // A transport failure must not leave a previous snapshot's visibility behind.
      setDynamicLoaded(false)
      setDiscoveryLoaded(false)
    })
    return () => {
      cancelled = true
    }
  }, [api])

  // Fetched only after inventory confirms the dynamic provider is active; this
  // is optional feature data, not a plugin-presence probe.
  useEffect(() => {
    let cancelled = false
    if (!dynamicLoaded) {
      setCatalog({})
      setModalities({})
      setFacts({})
      return () => {
        cancelled = true
      }
    }
    void fetch('/llm-dynamic-provider/catalog').then(response => response.json()).then((body: {
      catalog?: Record<string, readonly string[]>
      modalities?: Record<string, { input?: readonly string[]; output?: readonly string[] }>
      facts?: Record<string, { name?: string; contextWindow?: number; maxTokens?: number }>
    }) => {
      if (cancelled) return
      setCatalog(body.catalog ?? {})
      setModalities(body.modalities ?? {})
      setFacts(body.facts ?? {})
    }).catch(() => {
      // No catalog: the pickers simply offer no defaults.
    })
    return () => {
      cancelled = true
    }
  }, [dynamicLoaded])

  // Backfills defaults for models the probe initialized empty once the catalog
  // lands; a model with any pick already keeps it.
  const probedIds = candidates === undefined ? undefined : candidates.map(model => model.id).join('\0')
  useEffect(() => {
    if (probedIds === undefined) return
    setModelLevels(current => {
      const next: Record<string, ReadonlySet<string>> = { ...current }
      let changed = false
      for (const id of probedIds.split('\0')) {
        if ((next[id]?.size ?? 0) === 0 && (catalog[id]?.length ?? 0) > 0) {
          next[id] = new Set(catalog[id])
          changed = true
        }
      }
      return changed ? next : current
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- probedIds captures the candidate set identity.
  }, [catalog, probedIds])

  const keyValue = apiKey.trim()
  const routeId = route.trim()
  const routeInvalid = routeId.length > 0 && !ROUTE_PATTERN.test(routeId)
  const probeReady = baseURL.trim().length > 0 && !probing
  const adoptReady = !adopting && candidates !== undefined && candidates.length > 0
    && routeId.length > 0 && !routeInvalid

  // The rows the table shows: candidates matching the filter by id or disclosed name.
  const needle = query.trim().toLowerCase()
  const visible = candidates === undefined
    ? []
    : needle.length === 0
      ? [...candidates]
      : candidates.filter(model =>
        model.id.toLowerCase().includes(needle)
        || (model.name ?? facts[normalizeModelName(model.id)]?.name ?? '').toLowerCase().includes(needle))

  /** Whether the route id names an installed-catalog pi-ai provider. */
  const checkCatalogRoute = async (candidate: string): Promise<void> => {
    if (!ROUTE_PATTERN.test(candidate)) {
      setIsCatalogRoute(false)
      return
    }
    setIsCatalogRoute((await catalogRoutes()).has(candidate))
  }

  /** The installed-catalog pi-ai provider routes, empty on a wire failure. */
  const catalogRoutes = async (): Promise<ReadonlySet<string>> => {
    try {
      const llm = api.llm as DiscoveryApi['llm'] & {
        providers?: () => Promise<DiscoveryResponse<{ readonly providers: readonly { readonly provider: string; readonly settingsNs: string; readonly declared?: boolean }[] }>>
      }
      if (typeof llm.listConfigurableProviders === 'function') {
        const listed = await llm.listConfigurableProviders()
        if (!listed.ok) return new Set()
        // The host answers a bare array; tolerate a legacy `{ providers }` envelope.
        const entries = Array.isArray(listed.value)
          ? listed.value
          : (listed.value as unknown as { providers?: readonly { readonly provider: string; readonly settingsNs: string; readonly declared?: boolean }[] }).providers ?? []
        return new Set(
          entries
            .filter(entry => entry.settingsNs === PI_AI_NS && entry.declared === false)
            .map(entry => entry.provider),
        )
      }
      // Legacy fallback: very old hosts exposed `llm.providers()` with the same envelope.
      if (typeof llm.providers === 'function') {
        const listed = await llm.providers()
        if (!listed.ok) return new Set()
        return new Set(
          listed.value.providers
            .filter(entry => entry.settingsNs === PI_AI_NS && entry.declared === false)
            .map(entry => entry.provider),
        )
      }
      return new Set()
    } catch {
      return new Set()
    }
  }

  /** Prefill every editable field from one card. */
  const choosePreset = (preset: EnginePreset): void => {
    setPresetKey(preset.key)
    setBaseURL(preset.baseURL)
    setProtocol(preset.api)
    const nextRoute = route === '' || route === presetKey || route === CUSTOM_PRESET.key ? preset.key : route
    setRoute(nextRoute)
    void checkCatalogRoute(nextRoute.trim())
  }

  const toggle = (id: string): void => {
    setPicked((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  /** Replace the selection with every discovered model. */
  const selectAll = (): void => {
    setPicked(new Set((candidates ?? []).map(model => model.id)))
  }

  /** Clear the selection; adoption then serves the route's whole catalog. */
  const selectNone = (): void => {
    setPicked(new Set())
  }

  /** Select every candidate that is not picked yet; ids outside the candidate set drop out. */
  const invertSelection = (): void => {
    setPicked((current) => {
      const next = new Set<string>()
      for (const model of candidates ?? []) {
        if (!current.has(model.id)) next.add(model.id)
      }
      return next
    })
  }

  /** Toggle one thinking level on one model. */
  const toggleModelLevel = (id: string, level: string): void => {
    setModelLevels((current) => {
      const next = new Set(current[id] ?? [])
      if (!next.delete(level)) next.add(level)
      return { ...current, [id]: next }
    })
  }

  /** Probe the endpoint the form currently shows, then select every found model. */
  const probe = async (): Promise<void> => {
    setProbing(true)
    setProbeError(undefined)
    setAdoptedRoute(undefined)
    try {
      const response = await api.llm.discoverModels(DISCOVERY_NS, {
        baseURL: baseURL.trim(),
        api: protocol,
        ...keyValue.length === 0 ? {} : { apiKey: keyValue },
      })
      if (!response.ok) {
        setProbeError(response.error.message)
        return
      }
      const found = response.value
      setCandidates(found)
      setQuery('')
      // Everything found starts checked.
      setPicked(new Set(found.map(model => model.id)))
      // Each model starts at the levels the catalog records for it; an unknown
      // id gets no default.
      setModelLevels(Object.fromEntries(found.map(model => [model.id, new Set(catalog[model.id] ?? [])])))
    } catch (error) {
      // The transport rejected instead of answering.
      setProbeError(messageOf(error))
    } finally {
      setProbing(false)
    }
  }

  /**
   * Perform the adoption, returning a failure message or undefined. The key
   * is stored first so the profile only commits once its credential exists;
   * an orphaned ref (mutate refused) is harmless.
   */
  const adoptOnce = async (): Promise<string | undefined> => {
    const described = await api.settings.describe()
    if (!described.ok) return described.error.message
    const namespace = described.value.namespaces.find(candidate => candidate.ns === PI_AI_NS)
    if (namespace === undefined) return '缺少 llm-pi-ai 设置命名空间，无法写入提供方配置'
    // A set at providers.<route> replaces that profile wholesale, so an existing
    // route belongs to the Models page's editor; refuse the clobber.
    const existing = (namespace.value as { providers?: Record<string, unknown> }).providers ?? {}
    if (Object.keys(existing).includes(routeId)) {
      return `路由「${routeId}」已存在，请到「模型」设置页编辑该提供方`
    }
    const isCatalogRoute = (await catalogRoutes()).has(routeId)
    const keyRef = deriveKeyRef(routeId)
    const storesKey = keyValue.length > 0
    if (storesKey) {
      const stored = await api.credentials.set(keyRef, keyValue)
      if (!stored.ok) return stored.error.message
    }
    /* v8 ignore next -- the adopt button only renders above a non-empty candidate list */
    const selected = candidates === undefined ? [] : candidates.filter(model => picked.has(model.id))
    // A catalog route inherits reasoning from the catalog, so its models write none.
    const profile = {
      ...displayName.trim().length === 0 ? {} : { displayName: displayName.trim() },
      ...storesKey ? { apiKeyEnv: keyRef } : {},
      api: protocol,
      baseURL: baseURL.trim(),
      // An absent models list serves the route's whole catalog, so a cleared
      // selection writes no key at all.
      ...selected.length === 0
        ? {}
        : {
            models: selected.map(model => {
              const efforts = isCatalogRoute ? undefined : reasoningEffortsOf(modelLevels[model.id] ?? new Set())
              return {
                ...model,
                ...efforts === undefined ? {} : { reasoningEfforts: efforts },
              }
            }),
          },
    }
    const response = await api.settings.mutate(
      PI_AI_NS,
      [{ op: 'set', path: ['providers', routeId], value: profile }],
      // Judged against the revision just read; a concurrent change makes the host
      // refuse with `settings-conflict`, and retry is the user's call.
      namespace.revision,
    )
    if (!response.ok) return response.error.message
    return undefined
  }

  const adopt = async (): Promise<void> => {
    setAdopting(true)
    setAdoptError(undefined)
    try {
      const outcome = await adoptOnce()
      if (outcome !== undefined) {
        setAdoptError(outcome)
        return
      }
      setAdoptedRoute(routeId)
    } catch (error) {
      setAdoptError(messageOf(error))
    } finally {
      setAdopting(false)
    }
  }

  return (
    <div className={styles['section']}>
      <h2 className={styles['title']}>模型发现</h2>
      <p className={styles['intro']}>
        探测本地推理引擎或自定义端点公开的模型清单，并把选中的模型纳入一个新的模型提供方配置。
      </p>

      {discoveryLoaded
        ? (
          <>
      <div className={styles['presets']}>
        {ENGINE_PRESETS.map(preset => (
          <button
            key={preset.key}
            type="button"
            className={clsx(styles['presetCard'], preset.key === presetKey && styles['presetCardActive'])}
            onClick={() => { choosePreset(preset) }}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          className={clsx(styles['presetCard'], presetKey === CUSTOM_PRESET.key && styles['presetCardActive'])}
          onClick={() => { choosePreset(CUSTOM_PRESET) }}
        >
          {CUSTOM_PRESET.label}
        </button>
      </div>
      <p className={styles['hint']}>本地引擎通常无需密钥。</p>

      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>端点地址</span>
        <input
          className={styles['input']}
          type="text"
          value={baseURL}
          placeholder="http://127.0.0.1:11434"
          aria-label="端点地址"
          disabled={probing}
          onChange={(event) => { setBaseURL(event.target.value) }}
        />
      </div>
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>协议</span>
        <select
          className={`${styles['input']} ${styles['selectInput']}`}
          value={protocol}
          aria-label="协议"
          disabled={probing}
          onChange={(event) => { setProtocol(event.target.value) }}
        >
          {PROTOCOLS.map(choice => <option key={choice} value={choice}>{choice}</option>)}
        </select>
      </div>
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>API 密钥（可选）</span>
        <input
          className={styles['input']}
          type="password"
          autoComplete="off"
          value={apiKey}
          placeholder="sk-…"
          aria-label="API 密钥（可选）"
          disabled={probing}
          onChange={(event) => { setApiKey(event.target.value) }}
        />
      </div>
      <div className={styles['actions']}>
        <button
          type="button"
          className={styles['primaryButton']}
          disabled={!probeReady}
          onClick={() => { void probe() }}
        >
          {probing ? '探测中…' : '探测'}
        </button>
      </div>
      {probeError !== undefined ? <p className={styles['error']}>{probeError}</p> : null}

      {candidates !== undefined
        ? (
          <section className={styles['resultsArea']} aria-label="发现的模型">
            <div className={styles['resultsHeader']}>
              <span className={styles['resultsTitle']}>发现的模型</span>
              {candidates.length > 0
                ? <span className={styles['resultsCount']}>已选 {picked.size} / 共 {candidates.length}</span>
                : null}
            </div>
            {candidates.length === 0
              ? <p className={styles['empty']}>未发现任何模型</p>
              : (
                <>
                  <div className={styles['toolbar']}>
                    <input
                      className={`${styles['input']} ${styles['searchInput']}`}
                      type="search"
                      value={query}
                      placeholder="搜索模型 ID 或名称…"
                      aria-label="搜索模型"
                      disabled={adopting}
                      onChange={(event) => { setQuery(event.target.value) }}
                    />
                    <button type="button" className={styles['toolButton']} disabled={adopting} onClick={selectAll}>
                      全选
                    </button>
                    <button type="button" className={styles['toolButton']} disabled={adopting} onClick={selectNone}>
                      全不选
                    </button>
                    <button type="button" className={styles['toolButton']} disabled={adopting} onClick={invertSelection}>
                      反选
                    </button>
                  </div>
                  {visible.length === 0
                    ? <p className={styles['empty']}>没有匹配「{query.trim()}」的模型</p>
                    : (
                  <table className={styles['results']}>
                    <thead>
                      <tr>
                        <th className={styles['resultHead']}><span className={styles['visuallyHidden']}>选择</span></th>
                        <th className={styles['resultHead']}>模型 ID</th>
                        <th className={styles['resultHead']}>名称</th>
                        <th className={styles['resultHead']}>上下文窗口</th>
                        <th className={styles['resultHead']}>最大输出</th>
                        <th className={styles['resultHead']}>模态</th>
                        <th className={styles['resultHead']}>思考档位</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((model) => {
                        // An unknown id offers no levels.
                        const available = catalog[model.id] ?? []
                        const chosen = modelLevels[model.id] ?? new Set<string>()
                        // The models.dev facts fill what the host's bundled catalog left undisclosed.
                        const fact = facts[normalizeModelName(model.id)]
                        const displayName = model.name ?? fact?.name
                        const contextWindow = model.contextWindow ?? fact?.contextWindow
                        const maxTokens = model.maxTokens ?? fact?.maxTokens
                        return (
                        <tr key={model.id} className={styles['resultRow']}>
                          <td className={styles['resultCell']}>
                            <input
                              type="checkbox"
                              checked={picked.has(model.id)}
                              aria-label={`选择 ${model.id}`}
                              onChange={() => { toggle(model.id) }}
                            />
                          </td>
                          <td className={`${styles['resultCell']} ${styles['resultId']}`}>{model.id}</td>
                          <td className={styles['resultCell']}>{displayName ?? '—'}</td>
                          <td className={styles['resultCell']}>{contextWindow ?? '—'}</td>
                          <td className={styles['resultCell']}>{maxTokens ?? '—'}</td>
                          <td className={styles['resultCell']}>{modalityLabel(modalities[model.id]?.input)}</td>
                          <td className={styles['resultCell']}>
                            {available.length === 0
                              ? '—'
                              : (
                                <div className={styles['levels']} role="group" aria-label={`${model.id} 思考档位`}>
                                  {available.map(level => (
                                    <label key={level} className={styles['levelItem']}>
                                      <input
                                        type="checkbox"
                                        checked={chosen.has(level)}
                                        aria-label={`${model.id} 档位 ${level}`}
                                        disabled={adopting || isCatalogRoute}
                                        onChange={() => { toggleModelLevel(model.id, level) }}
                                      />
                                      {level}
                                    </label>
                                  ))}
                                </div>
                              )}
                          </td>
                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                    )}

                  <div className={styles['adoptCard']}>
                    <span className={styles['adoptTitle']}>采纳为 Provider</span>
                    <div className={styles['field']}>
                      <span className={styles['fieldLabel']}>路由 ID</span>
                      <input
                        className={styles['input']}
                        type="text"
                        value={route}
                        placeholder="local-engine"
                        aria-label="路由 ID"
                        disabled={adopting}
                        onChange={(event) => {
                          setRoute(event.target.value)
                          void checkCatalogRoute(event.target.value.trim())
                        }}
                      />
                    </div>
                    {routeInvalid
                      ? <p className={styles['error']}>路由 ID 只能包含小写字母、数字和连字符。</p>
                      : null}
                    <div className={styles['field']}>
                      <span className={styles['fieldLabel']}>显示名称</span>
                      <input
                        className={styles['input']}
                        type="text"
                        value={displayName}
                        placeholder={routeId}
                        aria-label="显示名称"
                        disabled={adopting}
                        onChange={(event) => { setDisplayName(event.target.value) }}
                      />
                    </div>
                    <p className={styles['hint']}>
                      {isCatalogRoute
                        ? '该路由是 catalog 提供方：已知模型的思考能力自动继承，无需勾选。'
                        : '每个模型的思考档位已在表格中按目录默认勾选；勾选的写入该模型的 reasoningEfforts。'}
                    </p>
                    <div className={styles['actions']}>
                      <button
                        type="button"
                        className={styles['primaryButton']}
                        disabled={!adoptReady}
                        onClick={() => { void adopt() }}
                      >
                        {adopting ? '采纳中…' : '采纳为 Provider'}
                      </button>
                    </div>
                    {adoptError !== undefined ? <p className={styles['error']}>{adoptError}</p> : null}
                    {adoptedRoute !== undefined
                      ? (
                        <p className={styles['savedNotice']} role="status" aria-live="polite">
                          已采纳「{adoptedRoute}」，请在「模型」设置页查看该提供方。
                        </p>
                      )
                      : null}
                  </div>
                </>
              )}
          </section>
        )
        : null}
          </>
        )
        : null}

      {dynamicLoaded ? <DynamicRoutes api={api} /> : null}
    </div>
  )
}
