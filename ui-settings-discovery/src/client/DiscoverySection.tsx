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

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-api-remotes/client'
import clsx from 'clsx'
import {
  catalogIndexOf, CREDENTIAL_REF_PATTERN, deriveKeyRef, DISCOVERY_NS, DISCOVERY_PLUGIN, DYNAMIC_PLUGIN, isActivePlugin,
  matchCatalogEntry, mergeCatalogEnvelopes, messageOf, modelDeclaration, PI_AI_NS, ROUTE_PATTERN, UI_CATALOG_PATH,
} from './discovery.ts'
import type { DiscoveryApi, DiscoveryResponse } from './discovery.ts'
import { DynamicRoutes } from './DynamicRoutes.tsx'
import { ModelResultsTable } from './ModelResultsTable.tsx'
import { CUSTOM_PRESET, ENGINE_PRESETS, PROTOCOLS } from './presets.ts'
import type { EnginePreset } from './presets.ts'
import styles from './DiscoveryStyles.module.css'

/** Injected dependencies of {@link DiscoverySection} (slot `inject`). */
export interface DiscoverySectionInjected {
  api: DiscoveryApi
}

/**
 * Props delivered by the slot outlet: the inject face spread flat (the renderer
 * erases the share boundary at the render call).
 */
export type DiscoverySectionProps = Partial<DiscoverySectionInjected>

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
  // Bumped on every probe so the results table drops a stale filter.
  const [probeToken, setProbeToken] = useState(0)
  const [route, setRoute] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [adopting, setAdopting] = useState(false)
  const [adoptError, setAdoptError] = useState<string | undefined>(undefined)
  const [adoptedRoute, setAdoptedRoute] = useState<string | undefined>(undefined)
  // Thinking levels picked per adopted model id. A model absent from the map
  // carries no reasoningEfforts, which lets a catalog route inherit while a
  // hand-declared route stays non-reasoning.
  const [modelLevels, setModelLevels] = useState<Readonly<Record<string, ReadonlySet<string>>>>({})
  // The three tables this section's own host half serves; empty while unfetched
  // or when that endpoint answered nothing.
  const [catalog, setCatalog] = useState<Readonly<Record<string, readonly string[]>>>({})
  const [modalities, setModalities] = useState<Readonly<Record<string, { input?: readonly string[]; output?: readonly string[] }>>>({})
  // The bare-name facts beside them. The host discovery seam enriches from the
  // bundled pi-ai catalog only, so these fill in a model it has not catalogued
  // yet, and the modalities decide what an adopted model may accept.
  const [facts, setFacts] = useState<Readonly<Record<string, { name?: string; contextWindow?: number; maxTokens?: number }>>>({})
  // Which providers record each key: the picker labels an entry with them.
  const [sources, setSources] = useState<Readonly<Record<string, readonly string[]>>>({})
  // Catalog keys the user pinned per row for ids the tables cannot resolve on
  // their own; the table and the adoption read them through the same lookup.
  const [bindings, setBindings] = useState<Readonly<Record<string, string>>>({})
  // One index per catalog snapshot: every row lookup, the picker's list, and
  // the write path share it.
  const catalogIndex = useMemo(
    () => catalogIndexOf({ catalog, modalities, facts, sources }),
    [catalog, modalities, facts, sources],
  )
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

  // The section's own host half serves the models.dev snapshot this page reads
  // for thinking levels, modalities, and undisclosed capacities. One request on
  // mount: a failed or malformed answer leaves the tables empty rather than
  // blocking the page, and the pickers then offer no defaults.
  useEffect(() => {
    let cancelled = false
    void fetch(UI_CATALOG_PATH)
      .then(response => response.json() as Promise<unknown>)
      .catch(() => undefined)
      .then((body) => {
        if (cancelled) return
        const merged = mergeCatalogEnvelopes([body])
        setCatalog(merged.catalog)
        setModalities(merged.modalities)
        setFacts(merged.facts)
        setSources(merged.sources ?? {})
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Backfills defaults for models the probe initialized empty once the catalog
  // lands or a row is pinned; a model with any pick already keeps it.
  const probedIds = candidates === undefined ? undefined : candidates.map(model => model.id).join('\0')
  useEffect(() => {
    if (probedIds === undefined) return
    setModelLevels(current => {
      const next: Record<string, ReadonlySet<string>> = { ...current }
      let changed = false
      for (const id of probedIds.split('\0')) {
        const recorded = matchCatalogEntry(id, catalogIndex, bindings)?.entry.levels ?? []
        if ((next[id]?.size ?? 0) === 0 && recorded.length > 0) {
          next[id] = new Set(recorded)
          changed = true
        }
      }
      return changed ? next : current
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- probedIds captures the candidate set identity.
  }, [catalogIndex, bindings, probedIds])

  const keyValue = apiKey.trim()
  const routeId = route.trim()
  const keyRef = deriveKeyRef(routeId)
  const routeInvalid = routeId.length > 0 && !ROUTE_PATTERN.test(routeId)
  // The credential namespace brands a reference as an environment-variable
  // name, so a route id starting with a digit can carry no stored key.
  const keyRefProblem = keyValue.length === 0 || CREDENTIAL_REF_PATTERN.test(keyRef)
    ? undefined
    : `路由 ID「${routeId}」的凭证引用「${keyRef}」不是合法的环境变量名（必须以字母或下划线开头）；请改用字母开头的路由 ID，或清空 API 密钥。`
  const probeReady = baseURL.trim().length > 0 && !probing
  const adoptReady = !adopting && candidates !== undefined && candidates.length > 0
    && routeId.length > 0 && !routeInvalid && keyRefProblem === undefined

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

  /**
   * Pin one row to a catalog entry, seeding its thinking levels from that entry
   * when it has none picked yet: a row the user already tuned keeps its picks.
   * The pins live as long as the page does, so a re-probe of the same ids keeps
   * them.
   */
  const bindModel = (id: string, key: string | undefined): void => {
    setBindings((current) => {
      const next = { ...current }
      if (key === undefined) delete next[id]
      else next[id] = key
      return next
    })
    if (key === undefined) return
    const entry = catalogIndex.entryOf(key)
    if (entry === undefined) return
    setModelLevels(current => (current[id]?.size ?? 0) === 0
      ? { ...current, [id]: new Set(entry.levels) }
      : current)
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
      setProbeToken(token => token + 1)
      // Everything found starts checked.
      setPicked(new Set(found.map(model => model.id)))
      // Each model starts at the levels the entry it resolves to records; an
      // unresolved id gets no default, and the row's picker is where the user
      // names its entry.
      setModelLevels(Object.fromEntries(found.map(model => [
        model.id,
        new Set(matchCatalogEntry(model.id, catalogIndex, bindings)?.entry.levels ?? []),
      ])))
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
    /* v8 ignore next -- the adopt button is disabled while the derived reference is illegal */
    if (keyRefProblem !== undefined) return keyRefProblem
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
    const storesKey = keyValue.length > 0
    if (storesKey) {
      const stored = await api.credentials.set(keyRef, keyValue)
      if (!stored.ok) return stored.error.message
    }
    /* v8 ignore next -- the adopt button only renders above a non-empty candidate list */
    const selected = candidates === undefined ? [] : candidates.filter(model => picked.has(model.id))
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
            models: selected.map((model) => {
              // A catalog route inherits the installed catalog's reasoning and
              // modalities; a hand-declared route needs the per-model
              // declaration written here, because nothing below it but the
              // route-wide text-only default would answer.
              if (isCatalogRoute) return { ...model }
              return modelDeclaration(
                model,
                modelLevels[model.id] ?? new Set(),
                matchCatalogEntry(model.id, catalogIndex, bindings)?.entry,
              )
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
      {keyRefProblem !== undefined ? <p className={styles['error']}>{keyRefProblem}</p> : null}
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
          <>
            <ModelResultsTable
              title="发现的模型"
              ariaLabel="发现的模型"
              emptyText="未发现任何模型"
              models={candidates}
              picked={picked}
              onToggle={toggle}
              onSelectAll={selectAll}
              onSelectNone={selectNone}
              onInvert={invertSelection}
              disabled={adopting}
              catalog={catalog}
              levels={modelLevels}
              onToggleLevel={toggleModelLevel}
              levelsDisabled={isCatalogRoute}
              facts={facts}
              modalities={modalities}
              sources={sources}
              bindings={bindings}
              onBind={bindModel}
              resetToken={probeToken}
            />
            {/* Nothing found means nothing to adopt, so the card stays away. */}
            {candidates.length > 0
              ? (
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
              )
              : null}
          </>
        )
        : null}
          </>
        )
        : null}

      {dynamicLoaded ? <DynamicRoutes api={api} /> : null}
    </div>
  )
}
