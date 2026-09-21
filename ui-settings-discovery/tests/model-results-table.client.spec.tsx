// @vitest-environment jsdom
/** The shared results table's catalog matching: a row that resolves on its own, the picker that pins the rows that cannot, and what a pinned row then shows. */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-api-remotes/client'
import { ModelResultsTable } from '../src/client/ModelResultsTable.tsx'

afterEach(cleanup)

/** The catalog tables one snapshot serves, as the table takes them. */
interface Tables {
  readonly catalog: Readonly<Record<string, readonly string[]>>
  readonly modalities: Readonly<Record<string, { readonly input?: readonly string[] }>>
  readonly facts: Readonly<Record<string, { readonly name?: string; readonly contextWindow?: number; readonly maxTokens?: number }>>
  readonly sources: Readonly<Record<string, readonly string[]>>
}

/** GLM-5.2 under its own key, recorded by two providers, and nothing else. */
const TABLES: Tables = {
  catalog: { 'glm-5.2': ['high', 'max'] },
  modalities: { 'glm-5.2': { input: ['text', 'image'] } },
  facts: { 'glm-5.2': { name: 'GLM-5.2', contextWindow: 200000, maxTokens: 128000 } },
  sources: { 'glm-5.2': ['zai-org', 'fireworks'] },
}

const MODELS: readonly LlmDiscoveredModel[] = [
  { id: 'glm-5.2-fast-preview/cc' },
  { id: 'glm-5.2' },
  { id: 'never-heard-of-it' },
]

const noop = (): void => {}

/** The table with the binding state its callers own. */
function Harness({ bindings: initial = {}, tables = TABLES }: {
  readonly bindings?: Readonly<Record<string, string>>
  readonly tables?: Tables
}): ReactNode {
  const [bindings, setBindings] = useState<Readonly<Record<string, string>>>(initial)
  return (
    <ModelResultsTable
      title="发现的模型"
      ariaLabel="发现的模型"
      emptyText="未发现任何模型"
      models={MODELS}
      picked={new Set(MODELS.map(model => model.id))}
      onToggle={noop}
      onSelectAll={noop}
      onSelectNone={noop}
      onInvert={noop}
      disabled={false}
      catalog={tables.catalog}
      levels={{}}
      onToggleLevel={noop}
      levelsDisabled={false}
      facts={tables.facts}
      modalities={tables.modalities}
      sources={tables.sources}
      bindings={bindings}
      onBind={(id, key) => {
        setBindings((current) => {
          const next = { ...current }
          if (key === undefined) delete next[id]
          else next[id] = key
          return next
        })
      }}
      resetToken={0}
    />
  )
}

const matchButton = (id: string): HTMLButtonElement =>
  screen.getByRole('button', { name: `${id} 的目录条目` }) as HTMLButtonElement

const rowOf = (id: string): HTMLElement => {
  const row = matchButton(id).closest('tr')
  if (row === null) throw new Error(`row of ${id} is missing`)
  return row
}

describe('catalog matching', () => {
  it('resolves one row on its own and leaves the variant to the picker', () => {
    render(<Harness />)
    expect(matchButton('glm-5.2').textContent).toBe('目录')
    expect(matchButton('glm-5.2').title).toBe('自动匹配：glm-5.2')
    expect(matchButton('glm-5.2-fast-preview/cc').textContent).toBe('匹配目录')
    expect(matchButton('glm-5.2-fast-preview/cc').title).toBe('尚未匹配目录条目')
    // A resolved row shows the entry's name, capacities, inputs, and levels.
    const resolved = within(rowOf('glm-5.2'))
    expect(resolved.getByText('GLM-5.2')).toBeDefined()
    expect(resolved.getByText('200000')).toBeDefined()
    expect(resolved.getByText('128000')).toBeDefined()
    expect(resolved.getByText('文·图')).toBeDefined()
    expect(resolved.getByLabelText('glm-5.2 档位 high')).toBeDefined()
    // The variant shows nothing until the user names its entry.
    expect(within(rowOf('glm-5.2-fast-preview/cc')).queryByText('文·图')).toBeNull()
  })

  it('opens the picker on the longest recorded prefix and pins the chosen entry', () => {
    render(<Harness />)
    fireEvent.click(matchButton('glm-5.2-fast-preview/cc'))
    const search = screen.getByLabelText<HTMLInputElement>('搜索目录条目：glm-5.2-fast-preview/cc')
    expect(search.value).toBe('glm-5.2')
    expect(screen.getByText('共 1 条')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: '把 glm-5.2-fast-preview/cc 匹配到 glm-5.2' }))
    expect(screen.queryByLabelText('搜索目录条目：glm-5.2-fast-preview/cc')).toBeNull()
    expect(matchButton('glm-5.2-fast-preview/cc').title).toBe('手动匹配：glm-5.2')
    const pinned = within(rowOf('glm-5.2-fast-preview/cc'))
    expect(pinned.getByText('GLM-5.2')).toBeDefined()
    expect(pinned.getByText('文·图')).toBeDefined()
    expect(pinned.getByLabelText('glm-5.2-fast-preview/cc 档位 max')).toBeDefined()
  })

  it('unpins a row the user had pinned', () => {
    render(<Harness bindings={{ 'glm-5.2-fast-preview/cc': 'glm-5.2' }} />)
    expect(matchButton('glm-5.2-fast-preview/cc').title).toBe('手动匹配：glm-5.2')
    fireEvent.click(matchButton('glm-5.2-fast-preview/cc'))
    fireEvent.click(screen.getByRole('button', { name: '清除匹配' }))
    expect(matchButton('glm-5.2-fast-preview/cc').title).toBe('尚未匹配目录条目')
    expect(within(rowOf('glm-5.2-fast-preview/cc')).queryByText('GLM-5.2')).toBeNull()
  })

  it('searches nothing and offers every entry for an id the catalog never heard of', () => {
    render(<Harness />)
    fireEvent.click(matchButton('never-heard-of-it'))
    expect(screen.getByLabelText<HTMLInputElement>('搜索目录条目：never-heard-of-it').value).toBe('')
    expect(screen.getByRole('button', { name: '把 never-heard-of-it 匹配到 glm-5.2' })).toBeDefined()
  })

  it('labels an entry with the providers behind it and searches them by name', () => {
    render(<Harness />)
    fireEvent.click(matchButton('glm-5.2-fast-preview/cc'))
    // Two providers record glm-5.2; the label names the first and counts the rest.
    expect(screen.getByText('zai-org 等 2 家')).toBeDefined()
    fireEvent.change(screen.getByLabelText('搜索目录条目：glm-5.2-fast-preview/cc'), { target: { value: 'fireworks' } })
    expect(screen.getByRole('button', { name: '把 glm-5.2-fast-preview/cc 匹配到 glm-5.2' })).toBeDefined()
    fireEvent.change(screen.getByLabelText('搜索目录条目：glm-5.2-fast-preview/cc'), { target: { value: 'openrouter' } })
    expect(screen.getByText('目录里没有匹配「openrouter」的条目')).toBeDefined()
  })

  it('closes the picker on Escape and leaves the row as it was', () => {
    render(<Harness />)
    fireEvent.click(matchButton('glm-5.2-fast-preview/cc'))
    fireEvent.keyDown(screen.getByLabelText('搜索目录条目：glm-5.2-fast-preview/cc'), { key: 'Escape' })
    expect(screen.queryByLabelText('搜索目录条目：glm-5.2-fast-preview/cc')).toBeNull()
    expect(matchButton('glm-5.2-fast-preview/cc').title).toBe('尚未匹配目录条目')
  })

  it('offers no matching control while the catalog is empty', () => {
    render(<Harness tables={{ catalog: {}, modalities: {}, facts: {}, sources: {} }} />)
    expect(screen.queryByRole('button', { name: /的目录条目$/ })).toBeNull()
  })
})
