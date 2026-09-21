/**
 * The 模型与选项 entry on a provider card, and the dialog it opens.
 *
 * The entry only shows while the Models page has that card open: the collapsed
 * row already carries 编辑 and 删除, and the page hands an extension cell no
 * editing flag, so the cell reads the card it was dropped into instead (see
 * {@link useProviderCardEditor}).
 *
 * The Models page's own editor is a schema form; this dialog reuses the
 * discovery flow the 模型发现 page already offers — probe the endpoint, pick
 * models, tick their thinking levels — against a provider that already exists.
 * The route id and its credential are therefore never re-entered: the dialog
 * reads the stored profile for its endpoint and protocol and writes back to
 * the same settings path.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-api-remotes/client'
import type { ProviderDirectoryEntry } from '@deepseek-ai/dsh-client-ui-settings-models/client'
import {
  matchCatalogEntry, messageOf, modelDeclaration, PI_AI_NS, providerProfileOf,
} from './discovery.ts'
import { useCatalog } from './catalogStore.ts'
import type { DiscoveryApi, ProfileModel, ProviderProfileDraft } from './discovery.ts'
import { ModelResultsTable } from './ModelResultsTable.tsx'
import styles from './styles.module.css'
import dialogStyles from './ProviderModelsDialog.module.css'

/** Injected dependencies of the provider-card extension (slot `inject`). */
export interface ProviderModelsCardInjected {
  api: DiscoveryApi
}

/**
 * Props of one provider-card occurrence: the Models page's owner share (the
 * card's directory row and whether a profile configures it) plus the injected
 * wire face.
 */
export type ProviderModelsCardProps = Partial<ProviderModelsCardInjected> & {
  readonly provider?: ProviderDirectoryEntry
  readonly configured?: boolean
}

/** The card's model editor entry; renders nothing without a configured row. */
export function ProviderModelsCard(props: ProviderModelsCardProps): ReactNode {
  const { api, provider, configured } = props
  // The guard runs before any hook so an unconfigured card — and the draft card
  // the Models page dispatches before a route exists — mounts nothing at all.
  if (api === undefined || provider === undefined || configured !== true) return null
  return <ConfiguredProviderCard api={api} provider={provider} />
}

/** The slot anchor the Models page wraps every provider-card cell in. */
const CARD_SLOT = 'settings.models.provider-card'

function ConfiguredProviderCard({ api, provider }: {
  readonly api: DiscoveryApi
  readonly provider: ProviderDirectoryEntry
}): ReactNode {
  const [open, setOpen] = useState(false)
  const card = useProviderCardEditor()
  return (
    <>
      <span ref={card.attach} className={dialogStyles['entryAnchor']} />
      {card.editorOpen
        ? (
          <button
            type="button"
            className={dialogStyles['cardAction']}
            onClick={() => { setOpen(true) }}
          >
            模型与选项
          </button>
        )
        : null}
      {/* A card the user collapses mid-edit does not close the dialog: it is
          modal, and its draft would be lost either way. */}
      {open
        ? (
          <ProviderModelsDialog
            api={api}
            provider={provider}
            onClose={() => { setOpen(false) }}
          />
        )
        : null}
    </>
  )
}

/**
 * Whether the Models page has this card's editor on screen, read off the card
 * the entry was dropped into.
 *
 * The page renders the extension cell as a sibling of the row head and of the
 * editor it opens on 编辑, and passes the cell no editing flag. So the editor is
 * the sibling that carries a form control — the row head holds buttons only.
 * A cell mounted without the page's slot anchor (a bare render, or a host that
 * seats the cell inside the editor) counts as open: nothing there says the card
 * is closed, and a hidden entry could not be reached at all.
 *
 * @returns the marker the cell attaches inside itself, and whether the editor is up.
 */
function useProviderCardEditor(): {
  readonly attach: (node: HTMLSpanElement | null) => void
  readonly editorOpen: boolean
} {
  const anchor = useRef<HTMLSpanElement | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const attach = useCallback((node: HTMLSpanElement | null) => { anchor.current = node }, [])
  useEffect(() => {
    const cell = anchor.current
    if (cell === null) return
    const slot = cell.closest(`[data-slot="${CARD_SLOT}"]`)
    const card = slot?.parentElement ?? null
    if (slot === null || card === null) {
      setEditorOpen(true)
      return
    }
    const update = (): void => {
      setEditorOpen(Array.from(card.children).some(
        sibling => sibling !== slot && sibling.querySelector('input, select, textarea') !== null,
      ))
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(card, { childList: true, subtree: true })
    return () => { observer.disconnect() }
  }, [])
  return { attach, editorOpen }
}

interface ProviderModelsDialogProps {
  readonly api: DiscoveryApi
  readonly provider: ProviderDirectoryEntry
  readonly onClose: () => void
}

function ProviderModelsDialog({ api, provider, onClose }: ProviderModelsDialogProps): ReactNode {
  const [loadError, setLoadError] = useState<string | undefined>(undefined)
  const [ready, setReady] = useState(false)
  const [revision, setRevision] = useState<number | undefined>(undefined)
  const [profile, setProfile] = useState<ProviderProfileDraft>({ models: [] })
  // The rows to write: the stored models plus whatever a probe added.
  const [rows, setRows] = useState<readonly ProfileModel[]>([])
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [levels, setLevels] = useState<Readonly<Record<string, ReadonlySet<string>>>>({})
  // 目录与发现页共用同一份快照，只提供默认值。
  const { tables, index } = useCatalog()
  const { catalog, facts, modalities, sources = {} } = tables
  // Catalog keys the user pinned per row; the table and the write path read
  // them through the same lookup, so what a row shows is what it saves.
  const [bindings, setBindings] = useState<Readonly<Record<string, string>>>({})
  const [probeToken, setProbeToken] = useState(0)
  const [probing, setProbing] = useState(false)
  const [probeError, setProbeError] = useState<string | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState(false)
  const panel = useRef<HTMLDivElement>(null)

  // The stored profile lands before the editor is usable.
  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => api.settings.describe()).then((described) => {
      if (cancelled) return
      if (!described.ok) {
        setLoadError(described.error.message)
        return
      }
      const namespace = described.value.namespaces.find(candidate => candidate.ns === PI_AI_NS)
      if (namespace === undefined) {
        setLoadError(`缺少 ${PI_AI_NS} 设置命名空间，无法读取该提供方的模型配置`)
        return
      }
      const draft = providerProfileOf(namespace.value, provider.provider)
      setProfile(draft)
      setRows(draft.models)
      setPicked(new Set(draft.models.map(model => model.id)))
      setLevels(Object.fromEntries(draft.models.map(model => [
        model.id,
        new Set(Object.keys(model.reasoningEfforts ?? {})),
      ])))
      setRevision(namespace.revision)
      setReady(true)
    }).catch((error: unknown) => {
      if (!cancelled) setLoadError(messageOf(error))
    })
    return () => {
      cancelled = true
    }
  }, [api, provider.provider])

  useEffect(() => {
    panel.current?.focus()
  }, [])

  const close = (): void => { onClose() }

  const onKeyDown = (event: { key: string }): void => {
    if (event.key === 'Escape') close()
  }

  /**
   * Pin one row to a catalog entry, seeding its thinking levels from that entry
   * when the profile declared none: the picks are the user's, so a row that
   * already carries some keeps them.
   */
  const bind = (id: string, key: string | undefined): void => {
    setBindings((current) => {
      const next = { ...current }
      if (key === undefined) delete next[id]
      else next[id] = key
      return next
    })
    if (key === undefined) return
    const entry = index.entryOf(key)
    if (entry === undefined) return
    setLevels(current => (current[id]?.size ?? 0) === 0
      ? { ...current, [id]: new Set(entry.levels) }
      : current)
  }

  /** Ask the provider's own endpoint, through the host, for its model listing. */
  const probe = async (): Promise<void> => {
    setProbing(true)
    setProbeError(undefined)
    setSaved(false)
    try {
      const response = await api.llm.discoverModels(PI_AI_NS, {
        provider: provider.provider,
        ...profile.baseURL === undefined ? {} : { baseURL: profile.baseURL },
        ...profile.api === undefined ? {} : { api: profile.api },
      })
      if (!response.ok) {
        setProbeError(response.error.message)
        return
      }
      const known = new Set(rows.map(row => row.id))
      // An advertised model the profile does not list is not configured yet,
      // so it arrives unchecked: the user picks what to add.
      const added: readonly LlmDiscoveredModel[] = response.value.filter(model => !known.has(model.id))
      setRows(current => [...current, ...added])
      setLevels(current => ({
        ...current,
        ...Object.fromEntries(added.map(model => [
          model.id,
          new Set(matchCatalogEntry(model.id, index, bindings)?.entry.levels ?? []),
        ])),
      }))
      setProbeToken(token => token + 1)
    } catch (error) {
      setProbeError(messageOf(error))
    } finally {
      setProbing(false)
    }
  }

  const toggle = (id: string): void => {
    setPicked((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  const toggleLevel = (id: string, level: string): void => {
    setLevels((current) => {
      const next = new Set(current[id] ?? [])
      if (!next.delete(level)) next.add(level)
      return { ...current, [id]: next }
    })
  }

  /** Write the picked models back into the profile the card belongs to. */
  const save = async (): Promise<void> => {
    if (revision === undefined) return
    const models = rows
      .filter(row => picked.has(row.id))
      .map(row => modelDeclaration(
        row,
        levels[row.id] ?? new Set(),
        matchCatalogEntry(row.id, index, bindings)?.entry,
      ))
    if (models.length === 0) {
      setSaveError('至少选择一个模型：空列表会让该路由解析不出任何模型。')
      return
    }
    setSaving(true)
    setSaveError(undefined)
    setSaved(false)
    try {
      const response = await api.settings.mutate(
        PI_AI_NS,
        [{ op: 'set', path: [...provider.settingsPath, 'models'], value: models }],
        // Read when the dialog opened; a concurrent edit makes the host refuse.
        revision,
      )
      if (!response.ok) {
        setSaveError(response.error.message)
        return
      }
      setProfile(current => ({ ...current, models }))
      setSaved(true)
    } catch (error) {
      setSaveError(messageOf(error))
    } finally {
      setSaving(false)
    }
  }

  const busy = probing || saving

  return (
    <div
      className={dialogStyles['backdrop']}
      role="presentation"
      onClick={(event) => { if (event.target === event.currentTarget) close() }}
    >
      <div
        ref={panel}
        className={dialogStyles['panel']}
        role="dialog"
        aria-modal="true"
        aria-label={`${provider.displayName} 的模型与选项`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className={dialogStyles['header']}>
          <div className={dialogStyles['heading']}>
            <span className={dialogStyles['title']}>{provider.displayName}</span>
            <span className={dialogStyles['route']}>{provider.provider}</span>
          </div>
          <button type="button" className={dialogStyles['close']} aria-label="关闭" onClick={close}>
            ✕
          </button>
        </div>

        {loadError !== undefined
          ? <p className={styles['error']}>{loadError}</p>
          : null}

        {ready
          ? (
            <>
              <p className={styles['hint']}>
                端点、协议与 API 密钥沿用该提供方已有的配置；这里只编辑模型清单与每个模型的选项。
                {profile.baseURL === undefined ? '' : ` 端点：${profile.baseURL}`}
              </p>
              <div className={styles['actions']}>
                <button
                  type="button"
                  className={styles['secondaryButton']}
                  disabled={busy}
                  onClick={() => { void probe() }}
                >
                  {probing ? '探测中…' : '探测端点'}
                </button>
                <button
                  type="button"
                  className={styles['primaryButton']}
                  disabled={busy || picked.size === 0}
                  onClick={() => { void save() }}
                >
                  {saving ? '保存中…' : '保存'}
                </button>
              </div>
              {probeError !== undefined ? <p className={styles['error']}>{probeError}</p> : null}
              {saveError !== undefined ? <p className={styles['error']}>{saveError}</p> : null}
              {saved
                ? <p className={styles['savedNotice']} role="status" aria-live="polite">已保存该提供方的模型配置。</p>
                : null}

              <ModelResultsTable
                title="该提供方的模型"
                ariaLabel={`${provider.displayName} 的模型`}
                emptyText="该提供方未显式列出模型；探测端点后勾选要写入的条目。"
                models={rows}
                picked={picked}
                onToggle={toggle}
                onSelectAll={() => { setPicked(new Set(rows.map(row => row.id))) }}
                onSelectNone={() => { setPicked(new Set()) }}
                onInvert={() => {
                  setPicked((current) => {
                    const next = new Set<string>()
                    for (const row of rows) if (!current.has(row.id)) next.add(row.id)
                    return next
                  })
                }}
                disabled={busy}
                catalog={catalog}
                extraLevels={Object.fromEntries(rows.map(row => [row.id, Object.keys(row.reasoningEfforts ?? {})]))}
                levels={levels}
                onToggleLevel={toggleLevel}
                levelsDisabled={false}
                facts={facts}
                modalities={modalities}
                sources={sources}
                bindings={bindings}
                index={index}
                onBind={bind}
                resetToken={probeToken}
              />
              <p className={styles['hint']}>
                勾选的思考档位写入该模型的 reasoningEfforts；一个档位都不勾选时保留配置里已有的值。
                模态声明按 models.dev 的记录写入。
              </p>
            </>
          )
          : loadError === undefined
            ? <p className={styles['hint']}>正在读取提供方配置…</p>
            : null}
      </div>
    </div>
  )
}
