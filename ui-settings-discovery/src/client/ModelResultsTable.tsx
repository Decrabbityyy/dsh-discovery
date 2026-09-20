/**
 * The model results table both editing surfaces render: filter box, bulk
 * selection, and one row per model with its capacities, modalities, and
 * thinking levels. Kept in one place so the 模型发现 page and the provider
 * card's dialog cannot drift into two different tables.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-api-remotes/client'
import { normalizeModelName } from './discovery.ts'
import styles from './DiscoveryStyles.module.css'

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
  /** Bumped by the caller on every fresh probe; a new value clears the filter. */
  readonly resetToken: number
}

/** A compact modality marker: 文 for text, 图 for image, joined. */
export function modalityLabel(input: readonly string[] | undefined): string {
  if (input === undefined || input.length === 0) return '—'
  return input.map(value => (value === 'image' ? '图' : '文')).join('·')
}

export function ModelResultsTable(props: ModelResultsTableProps): ReactNode {
  const {
    title, ariaLabel, emptyText, models, picked, onToggle, onSelectAll, onSelectNone, onInvert,
    disabled, catalog, extraLevels, levels, onToggleLevel, levelsDisabled, facts, modalities, resetToken,
  } = props
  const [query, setQuery] = useState('')

  // A probe replaces the table's contents; a stale filter over new rows reads
  // as "nothing found" and hides what just arrived.
  useEffect(() => {
    setQuery('')
  }, [resetToken])

  const needle = query.trim().toLowerCase()
  const visible = needle.length === 0
    ? models
    : models.filter(model =>
      model.id.toLowerCase().includes(needle)
      || (model.name ?? facts[normalizeModelName(model.id)]?.name ?? '').toLowerCase().includes(needle))

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
                      // Both indexes key models by bare name, so a
                      // provider-prefixed id resolves to the same entry.
                      const bare = normalizeModelName(model.id)
                      // Recorded levels join the catalog's: a model the catalog
                      // has never heard of still shows what the profile declares.
                      const available = [...new Set([...(catalog[bare] ?? []), ...(extraLevels?.[model.id] ?? [])])]
                      const chosen = levels[model.id] ?? new Set<string>()
                      // The models.dev facts fill what the host's bundled catalog left undisclosed.
                      const fact = facts[bare]
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
                              onChange={() => { onToggle(model.id) }}
                            />
                          </td>
                          <td className={`${styles['resultCell']} ${styles['resultId']}`}>{model.id}</td>
                          <td className={styles['resultCell']}>{displayName ?? '—'}</td>
                          <td className={styles['resultCell']}>{contextWindow ?? '—'}</td>
                          <td className={styles['resultCell']}>{maxTokens ?? '—'}</td>
                          <td className={styles['resultCell']}>{modalityLabel(modalities[bare]?.input)}</td>
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
