// @vitest-environment jsdom
/**
 * 页面会话内的目录缓存：两个消费者共用一次抓取与一份索引。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { UI_CATALOG_PATH } from 'dsh-llm-discovery/vocabulary'
import { loadCatalog, resetCatalogCache } from '../src/client/catalogStore.ts'

const ENVELOPE = {
  catalog: { 'glm-5.2': ['high', 'max'] },
  modalities: { 'glm-5.2': { input: ['text'], output: ['text'] } },
  facts: { 'glm-5.2': { name: 'GLM 5.2', contextWindow: 200_000 } },
}

function stub(body: unknown = ENVELOPE): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetCatalogCache()
})

describe('catalog store', () => {
  it('fetches once and hands both consumers the same index', async () => {
    const fetchMock = stub()
    const [first, second] = await Promise.all([loadCatalog(), loadCatalog()])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(UI_CATALOG_PATH)
    expect(first.index).toBe(second.index)
    expect(first.tables.catalog).toEqual({ 'glm-5.2': ['high', 'max'] })
    expect(first.index.keyOf('GLM-5.2')).toBe('glm-5.2')

    // 缓存命中之后不再发请求。
    await loadCatalog()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports a refused fetch instead of caching an empty catalog', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadCatalog()).rejects.toThrow('HTTP 500')
    await expect(loadCatalog()).rejects.toThrow('HTTP 500')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('accepts a body without the optional sources table', async () => {
    stub({ catalog: {}, modalities: {}, facts: {} })
    const { tables } = await loadCatalog()
    expect(tables).toEqual({ catalog: {}, modalities: {}, facts: {} })
  })
})
