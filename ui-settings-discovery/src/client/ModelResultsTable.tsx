/** The model results table both editing surfaces render: filter box, bulk selection, and one row per model with its capacities, modalities, and */

import { Fragment, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-api-remotes/client'
import clsx from 'clsx'
import {
  catalogIndexOf, catalogSearchSeed, entryId, matchCatalogEntry, matchesPickerQuery, parsePickerQuery,
} from './discovery.ts'
import type { CatalogEntry, CatalogIndex, CatalogMatch } from './discovery.ts'
import { formatCapacity, formatCapacityPair, levelMarks, orderedLevels } from './format.ts'
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
  /** Bare-name facts filling what the endpoint left undisclosed. */
  readonly facts: Readonly<Record<string, ModelTableFacts>>
  /** 模态列用的裸名模态表。 */
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

/** 紧凑的模态标记：文＝文本、图＝图片，多个用 · 连接。 */
export function modalityLabel(input: readonly string[] | undefined): string {
  if (input === undefined || input.length === 0) return '—'
  return input.map(value => (value === 'image' ? '图' : '文')).join('·')
}

/** 选择器一行里的紧凑摘要：容量、模态、六个档位方块。 */
function PickerMeta({ entry }: { readonly entry: CatalogEntry }): ReactNode {
  return (
    <span className={styles['pickerMeta']} title={pickerTitle(entry)}>
      <span className={styles['pickerCapacity']}>{formatCapacityPair(entry.contextWindow, entry.maxTokens)}</span>
      <span className={styles['pickerModality']}>{entry.input.length === 0 ? '' : modalityLabel(entry.input)}</span>
      <span className={styles['levelMarks']} title={levelsTitle(entry.levels)}>
        {levelMarks(entry.levels).map((on, index) => (
          // 每块等宽居中：■ 与 □ 的字形宽度不同，靠固定盒子把它们对在同一列上。
          <span key={index} className={styles['levelMark']} aria-hidden="true">{on ? '■' : '□'}</span>
        ))}
      </span>
    </span>
  )
}

/** 悬停说明：精确容量与这一条记录的档位。 */
function pickerTitle(entry: CatalogEntry): string {
  return [
    entry.contextWindow === undefined ? undefined : `上下文窗口 ${entry.contextWindow}`,
    entry.maxTokens === undefined ? undefined : `最大输出 ${entry.maxTokens}`,
    entry.levels.length === 0 ? '未记录思考档位' : `思考档位 ${orderedLevels(entry.levels).join('/')}`,
  ].filter(part => part !== undefined).join(' · ')
}

/** Whose numbers one picker entry carries. */
function pickerSource(entry: CatalogEntry): string {
  const [first, ...rest] = entry.sources
  if (first === undefined) return ''
  return rest.length === 0 ? first : `${first} 等 ${entry.sources.length} 家`
}

/** 悬停那一格时把收录它的 provider 全列出来（格子里只写「首家 等 N 家」）。 */
function sourceTitle(entry: CatalogEntry): string | undefined {
  return entry.sources.length === 0 ? undefined : `收录它的 provider：${entry.sources.join('、')}`
}

/** 悬停说明：这条记录的全部思考档位。 */
function levelsTitle(levels: readonly string[]): string | undefined {
  return levels.length === 0 ? undefined : `思考档位 ${orderedLevels(levels).join('/')}`
}

/** 行上不给 id，悬停时补上：真正对应的那个，加内部键（不一样时才写）。 */
function pickerIds(entry: CatalogEntry): string {
  const id = entryId(entry)
  return id === entry.key ? `id：${id}` : `id：${id}（目录键 ${entry.key}）`
}

/** 名称格：这一行解析到的名字，以及指定目录条目的那个按钮。 */
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
    disabled, catalog, extraLevels, facts, modalities, sources, bindings, onBind, resetToken,
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
  const pickerQueryParsed = useMemo(() => parsePickerQuery(pickerQuery), [pickerQuery])
  const pickerOptions = useMemo(() => {
    if (pickerFor === undefined) return []
    return catalogEntries.filter(entry => matchesPickerQuery(entry, pickerQueryParsed))
  }, [catalogEntries, pickerFor, pickerQueryParsed])
  const pickerRanked = useMemo(() => {
    const search = pickerQuery.trim().toLowerCase()
    const idOf = (entry: CatalogEntry): string => entryId(entry).toLowerCase()
    return [...pickerOptions]
      .sort((left, right) => {
        // 按 id 排名（搜索框里的种子就是 id），同名之间按名字排——行上只有名字。
        const rank = Number(!idOf(left).startsWith(search)) - Number(!idOf(right).startsWith(search))
        if (rank !== 0) return rank
        const byName = (left.name ?? '').localeCompare(right.name ?? '')
        return byName === 0 ? idOf(left).localeCompare(idOf(right)) : byName
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
                      <th className={styles['resultHead']} title="匹配到的条目记录的全部档位，保存时一并写入">思考档位</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((model) => {
                      const match = matches.get(model.id)
                      const entry = match?.entry
                      // 手动指定的条目连名称与容量一起作数；自动解析的只在行没披露时补。
                      const pinned = match?.bound === true
                      const displayName = pinned ? entry?.name ?? model.name : model.name ?? entry?.name
                      const contextWindow = pinned ? entry?.contextWindow ?? model.contextWindow : model.contextWindow ?? entry?.contextWindow
                      const maxTokens = pinned ? entry?.maxTokens ?? model.maxTokens : model.maxTokens ?? entry?.maxTokens
                      // 目录记录的档位与 profile 已声明的一起算「支持的档位」：
                      // 它只用来标注，写入时全量带上，不由用户逐档挑；显示按词表顺序。
                      const available = orderedLevels([...(entry?.levels ?? []), ...(extraLevels?.[model.id] ?? [])])
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
                            <td className={styles['resultCell']} title={contextWindow === undefined ? undefined : String(contextWindow)}>{formatCapacity(contextWindow) ?? '—'}</td>
                            <td className={styles['resultCell']} title={maxTokens === undefined ? undefined : String(maxTokens)}>{formatCapacity(maxTokens) ?? '—'}</td>
                            <td className={styles['resultCell']}>{modalityLabel(entry?.input)}</td>
                            {/* 这一列给文字：表格有位置，方块留给空间紧张的选择器。 */}
                            <td className={styles['resultCell']}>
                              {available.length === 0 ? '—' : available.join('/')}
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
                                      placeholder="搜索 ID/名称，或用 @供应商 筛选…"
                                      aria-label={`搜索目录条目：${model.id}`}
                                      autoFocus
                                      onChange={(event) => { setPickerQuery(event.target.value) }}
                                      // Escape belongs to the picker while it is open: the enclosing dialog keeps it
                                      onKeyDown={(event) => {
                                        if (event.key !== 'Escape') return
                                        event.stopPropagation()
                                        closePicker()
                                      }}
                                    />
                                    {pickerRanked.length === 0
                                      ? (
                                        <p className={styles['empty']}>
                                          {pickerQueryParsed.providers.length === 0
                                            ? `目录里没有匹配「${pickerQuery.trim()}」的条目`
                                            : `目录里没有 ${pickerQueryParsed.providers.map(name => `@${name}`).join(' 或 ')} 收录的条目`}
                                        </p>
                                      )
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
                                                {/* 行上只给名字：id 留给搜索与悬停——有些键是内部替身，摆出来反而误导。 */}
                                                <span className={styles['pickerName']} title={pickerIds(option)}>{option.name ?? '—'}</span>
                                                <span className={styles['pickerSource']} title={sourceTitle(option)}>{pickerSource(option)}</span>
                                                <PickerMeta entry={option} />
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
