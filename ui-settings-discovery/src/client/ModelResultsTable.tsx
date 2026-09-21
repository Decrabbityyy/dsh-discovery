/**
 * The model results table both editing surfaces render: filter box, bulk
 * selection, and one row per model with its capacities, modalities, and
 * thinking levels. Kept in one place so the 模型发现 page and the provider
 * card's dialog cannot drift into two different tables.
 *
 * Every row reads the catalog through {@link matchCatalogEntry}: an id the
 * tables record under a variant spelling resolves on its own, and one they do
 * not — a `-max`/`-highspeed`/`vendor/x` id whose base they do record — is what
 * the row's 匹配目录 control is for.
 */

import { Fragment, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-api-remotes/client'
import clsx from 'clsx'
import { catalogIndexOf, catalogSearchSeed, matchCatalogEntry } from './discovery.ts'
import type { CatalogEntry, CatalogIndex, CatalogMatch } from './discovery.ts'
import styles from './styles.module.css'

/** The facts column sources, keyed by bare model name. */
export interface ModelTableFacts {
  readonly name?: string
  readonly contextWindow?: number
  readonly maxTokens?: number
}

/** One model's accepted input modalities, by bare model name. */
export interface ModelTableModalities {
  readonly input?: readonly string[]
}

/** How many picker rows render at once; the rest stay behind the search box. */
const PICKER_LIMIT = 60

export interface ModelResultsTableProps {
  /** Heading of the results area. */
  readonly title: string
  /** Accessible name of the results area. */
  readonly ariaLabel: string
  /** Shown when there is nothing to list at all. */
  readonly emptyText: string
  /** Rows to render, in display order. */
  readonly models: readonly LlmDiscoveredModel[]
  /** Ids whose checkbox is checked. */
  readonly picked: ReadonlySet<string>
  readonly onToggle: (id: string) => void
  readonly onSelectAll: () => void
  readonly onSelectNone: () => void
  readonly onInvert: () => void
  /** Disables every control while a write is outstanding. */
  readonly disabled: boolean
  /** Thinking levels the catalog records, by bare model name. */
  readonly catalog: Readonly<Record<string, readonly string[]>>
  /** Levels that exist only in the edited profile, by model id. */
  readonly extraLevels?: Readonly<Record<string, readonly string[]>>
  /** Picked levels per model id. */
  readonly levels: Readonly<Record<string, ReadonlySet<string>>>
  readonly onToggleLevel: (id: string, level: string) => void
  /** Whether the level checkboxes are read-only (a catalog route inherits). */
  readonly levelsDisabled: boolean
  /** Bare-name facts filling what the endpoint left undisclosed. */
  readonly facts: Readonly<Record<string, ModelTableFacts>>
  /** Bare-name modalities for the 模态 column. */
  readonly modalities: Readonly<Record<string, ModelTableModalities>>
  /** Which providers record each catalog key, for the picker's own label. */
  readonly sources: Readonly<Record<string, readonly string[]>>
  /** Catalog key the user pinned per model id, overriding candidate resolution. */
  readonly bindings: Readonly<Record<string, string>>
  /** 调用方共用的目录索引；不传就按上面几张表自己建一份。 */
  readonly index?: CatalogIndex
  /** Pin one row to a catalog key, or unpin it with `undefined`. */
  readonly onBind: (id: string, key: string | undefined) => void
  /** Bumped by the caller on every fresh probe; a new value clears the filter. */
  readonly resetToken: number
}

/** A compact modality marker: 文 for text, 图 for image, joined. */
export function modalityLabel(input: readonly string[] | undefined): string {
  if (input === undefined || input.length === 0) return '—'
  return input.map(value => (value === 'image' ? '图' : '文')).join('·')
}

/** What the picker shows beside one entry: its capacities, inputs, and levels. */
function pickerMeta(entry: CatalogEntry): string {
  return [
    entry.contextWindow === undefined ? undefined : String(entry.contextWindow),
    entry.input.length === 0 ? undefined : modalityLabel(entry.input),
    entry.levels.length === 0 ? undefined : `档位 ${entry.levels.join('/')}`,
  ].filter(part => part !== undefined).join(' · ')
}

/**
 * Whose numbers one picker entry carries. Several providers serve the same
 * model under different ids and disagree about its capacities, so the label
 * names the first provider and counts the rest.
 */
function pickerSource(entry: CatalogEntry): string {
  const [first, ...rest] = entry.sources
  if (first === undefined) return ''
  return rest.length === 0 ? first : `${first} 等 ${entry.sources.length} 家`
}

/** The 名称 cell: the name it resolved plus the control that pins an entry. */
function MatchCell(props: {
  readonly id: string
  readonly name: string | undefined
  readonly match: CatalogMatch | undefined
  readonly bound: boolean
  readonly disabled: boolean
  readonly expanded: boolean
  readonly onToggle: () => void
}): ReactNode {
  const { id, name, match, bound, disabled, expanded, onToggle } = props
  return (
    <div className={styles['nameCell']}>
      <span>{name ?? '—'}</span>
      <button
        type="button"
        className={clsx(styles['matchButton'], bound && styles['matchButtonBound'])}
        aria-label={`${id} 的目录条目`}
        aria-expanded={expanded}
        title={match === undefined
          ? '尚未匹配目录条目'
          : `${bound ? '手动匹配' : '自动匹配'}：${match.key}`}
        disabled={disabled}
        onClick={onToggle}
      >
        {match === undefined ? '匹配目录' : '目录'}
      </button>
    </div>
  )
}

export function ModelResultsTable(props: ModelResultsTableProps): ReactNode {
  const {
    title, ariaLabel, emptyText, models, picked, onToggle, onSelectAll, onSelectNone, onInvert,
    disabled, catalog, extraLevels, levels, onToggleLevel, levelsDisabled, facts, modalities,
    sources, bindings, onBind, resetToken,
  } = props
  const [query, setQuery] = useState('')
  // The row whose catalog picker is open, and what it is searching for.
  const [pickerFor, setPickerFor] = useState<string | undefined>(undefined)
  const [pickerQuery, setPickerQuery] = useState('')

  const ownIndex = useMemo(
    () => catalogIndexOf({ catalog, modalities, facts, sources }),
    [catalog, modalities, facts, sources],
  )
  const index = props.index ?? ownIndex
  // One lookup per row per change, so the row body, the picker, and the write
  // path in the caller all read the same entry.
  const matches = useMemo(() => {
    const found = new Map<string, CatalogMatch>()
    for (const model of models) {
      const match = matchCatalogEntry(model.id, index, bindings)
      if (match !== undefined) found.set(model.id, match)
    }
    return found
  }, [models, index, bindings])

  // A probe replaces the table's contents; a stale filter over new rows reads
  // as "nothing found" and hides what just arrived.
  useEffect(() => {
    setQuery('')
    setPickerFor(undefined)
  }, [resetToken])

  const needle = query.trim().toLowerCase()
  const visible = needle.length === 0
    ? models
    : models.filter(model =>
      model.id.toLowerCase().includes(needle)
      || (model.name ?? matches.get(model.id)?.entry.name ?? '').toLowerCase().includes(needle))

  // The whole catalog, resolved once per snapshot: the picker filters this
  // list rather than re-reading every key on each keystroke.
  const catalogEntries = useMemo(
    () => index.keys
      .map(key => index.entryOf(key))
      .filter((entry): entry is CatalogEntry => entry !== undefined),
    [index],
  )
  const pickerOptions = useMemo(() => {
    if (pickerFor === undefined) return []
    const search = pickerQuery.trim().toLowerCase()
    if (search.length === 0) return catalogEntries
    return catalogEntries.filter(entry =>
      entry.key.toLowerCase().includes(search)
      || (entry.name ?? '').toLowerCase().includes(search)
      || entry.sources.some(source => source.toLowerCase().includes(search)))
  }, [catalogEntries, pickerFor, pickerQuery])
  const pickerRanked = useMemo(() => {
    const search = pickerQuery.trim().toLowerCase()
    return [...pickerOptions]
      .sort((left, right) => {
        const rank = Number(!left.key.toLowerCase().startsWith(search))
          - Number(!right.key.toLowerCase().startsWith(search))
        return rank === 0 ? left.key.localeCompare(right.key) : rank
      })
      .slice(0, PICKER_LIMIT)
  }, [pickerOptions, pickerQuery])

  const closePicker = (): void => { setPickerFor(undefined) }
  const openPicker = (id: string): void => {
    setPickerQuery(catalogSearchSeed(id, index))
    setPickerFor(current => (current === id ? undefined : id))
  }

  return (
    <section className={styles['resultsArea']} aria-label={ariaLabel}>
      <div className={styles['resultsHeader']}>
        <span className={styles['resultsTitle']}>{title}</span>
        {models.length > 0
          ? <span className={styles['resultsCount']}>已选 {picked.size} / 共 {models.length}</span>
          : null}
      </div>
      {models.length === 0
        ? <p className={styles['empty']}>{emptyText}</p>
        : (
          <>
            <div className={styles['toolbar']}>
              <input
                className={`${styles['input']} ${styles['searchInput']}`}
                type="search"
                value={query}
                placeholder="搜索模型 ID 或名称…"
                aria-label="搜索模型"
                disabled={disabled}
                onChange={(event) => { setQuery(event.target.value) }}
              />
              <button type="button" className={styles['toolButton']} disabled={disabled} onClick={onSelectAll}>
                全选
              </button>
              <button type="button" className={styles['toolButton']} disabled={disabled} onClick={onSelectNone}>
                全不选
              </button>
              <button type="button" className={styles['toolButton']} disabled={disabled} onClick={onInvert}>
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
                      const match = matches.get(model.id)
                      const entry = match?.entry
                      // The endpoint's own disclosure wins over the catalog's.
                      const displayName = model.name ?? entry?.name
                      const contextWindow = model.contextWindow ?? entry?.contextWindow
                      const maxTokens = model.maxTokens ?? entry?.maxTokens
                      // Recorded levels join the matched entry's: a model the
                      // catalog has never heard of still shows what the profile
                      // declares.
                      const available = [...new Set([...(entry?.levels ?? []), ...(extraLevels?.[model.id] ?? [])])]
                      const chosen = levels[model.id] ?? new Set<string>()
                      return (
                        <Fragment key={model.id}>
                          <tr className={styles['resultRow']}>
                            <td className={styles['resultCell']}>
                              <input
                                type="checkbox"
                                checked={picked.has(model.id)}
                                aria-label={`选择 ${model.id}`}
                                onChange={() => { onToggle(model.id) }}
                              />
                            </td>
                            <td className={`${styles['resultCell']} ${styles['resultId']}`}>{model.id}</td>
                            <td className={styles['resultCell']}>
                              {/* Without a catalog there is nothing to match
                                  a row to, so the cell stays a plain name. */}
                              {index.keys.length === 0
                                ? displayName ?? '—'
                                : (
                                  <MatchCell
                                    id={model.id}
                                    name={displayName}
                                    match={match}
                                    bound={bindings[model.id] !== undefined}
                                    disabled={disabled}
                                    expanded={pickerFor === model.id}
                                    onToggle={() => { openPicker(model.id) }}
                                  />
                                )}
                            </td>
                            <td className={styles['resultCell']}>{contextWindow ?? '—'}</td>
                            <td className={styles['resultCell']}>{maxTokens ?? '—'}</td>
                            <td className={styles['resultCell']}>{modalityLabel(entry?.input)}</td>
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
                                          disabled={disabled || levelsDisabled}
                                          onChange={() => { onToggleLevel(model.id, level) }}
                                        />
                                        {level}
                                      </label>
                                    ))}
                                  </div>
                                )}
                            </td>
                          </tr>
                          {pickerFor === model.id
                            ? (
                              <tr>
                                <td className={styles['pickerCell']} colSpan={7}>
                                  <div className={styles['pickerPanel']}>
                                    <input
                                      className={`${styles['input']} ${styles['searchInput']}`}
                                      type="search"
                                      value={pickerQuery}
                                      placeholder="搜索目录条目 ID 或名称…"
                                      aria-label={`搜索目录条目：${model.id}`}
                                      autoFocus
                                      onChange={(event) => { setPickerQuery(event.target.value) }}
                                      // Escape belongs to the picker while it is
                                      // open: the enclosing dialog keeps it
                                      // otherwise, and closing the whole editor
                                      // to dismiss a list would lose the draft.
                                      onKeyDown={(event) => {
                                        if (event.key !== 'Escape') return
                                        event.stopPropagation()
                                        closePicker()
                                      }}
                                    />
                                    {pickerRanked.length === 0
                                      ? <p className={styles['empty']}>目录里没有匹配「{pickerQuery.trim()}」的条目</p>
                                      : (
                                        <ul className={styles['pickerList']}>
                                          {pickerRanked.map(option => (
                                            <li key={option.key}>
                                              <button
                                                type="button"
                                                className={styles['pickerItem']}
                                                aria-label={`把 ${model.id} 匹配到 ${option.key}`}
                                                onClick={() => { onBind(model.id, option.key); closePicker() }}
                                              >
                                                <span className={styles['pickerKey']}>{option.key}</span>
                                                <span className={styles['pickerName']}>{option.name ?? '—'}</span>
                                                <span className={styles['pickerSource']}>{pickerSource(option)}</span>
                                                <span className={styles['pickerMeta']}>{pickerMeta(option)}</span>
                                              </button>
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    <div className={styles['pickerFoot']}>
                                      <span className={styles['pickerCount']}>
                                        共 {pickerOptions.length} 条
                                        {pickerOptions.length > pickerRanked.length
                                          ? `，显示前 ${pickerRanked.length} 条`
                                          : ''}
                                      </span>
                                      {bindings[model.id] !== undefined
                                        ? (
                                          <button
                                            type="button"
                                            className={styles['toolButton']}
                                            onClick={() => { onBind(model.id, undefined); closePicker() }}
                                          >
                                            清除匹配
                                          </button>
                                        )
                                        : null}
                                      <button type="button" className={styles['toolButton']} onClick={closePicker}>
                                        取消
                                      </button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )
                            : null}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              )}
          </>
        )}
    </section>
  )
}
