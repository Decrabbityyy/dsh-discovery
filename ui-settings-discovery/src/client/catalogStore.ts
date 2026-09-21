/**
 * 页面上目录只有一份：发现页与「模型与选项」弹窗共用一次抓取、一次合并、一份索引。
 */

import { useEffect, useState } from 'react'
import { UI_CATALOG_PATH } from 'dsh-llm-discovery/vocabulary'
import { catalogIndexOf, mergeCatalogEnvelopes } from './discovery.ts'
import type { CatalogIndex, CatalogTables } from './discovery.ts'

const EMPTY: CatalogTables = { catalog: {}, modalities: {}, facts: {} }

export interface CatalogSnapshot {
  readonly tables: CatalogTables
  readonly index: CatalogIndex
}

let snapshot: CatalogSnapshot | undefined
let pending: Promise<CatalogSnapshot> | undefined

/** 抓一次目录并建索引；同一页面会话内共用同一份。 */
export function loadCatalog(): Promise<CatalogSnapshot> {
  if (snapshot !== undefined) return Promise.resolve(snapshot)
  pending ??= fetch(UI_CATALOG_PATH)
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const envelope = mergeCatalogEnvelopes([await response.json() as unknown])
      const tables: CatalogTables = {
        catalog: envelope.catalog,
        modalities: envelope.modalities,
        facts: envelope.facts,
        ...envelope.sources === undefined ? {} : { sources: envelope.sources },
      }
      snapshot = { tables, index: catalogIndexOf(tables) }
      return snapshot
    })
    .finally(() => {
      pending = undefined
    })
  return pending
}

/** 测试用：丢掉缓存，下一次调用重新抓。 */
export function resetCatalogCache(): void {
  snapshot = undefined
  pending = undefined
}

/** 组件用的读法：挂载时加载一次；失败就留空目录，页面照常渲染。 */
export function useCatalog(): CatalogSnapshot {
  const [loaded, setLoaded] = useState<CatalogSnapshot>(() => snapshot ?? { tables: EMPTY, index: catalogIndexOf(EMPTY) })
  useEffect(() => {
    let cancelled = false
    void loadCatalog().then((next) => {
      if (!cancelled) setLoaded(next)
    }).catch(() => {
      // 目录只提供默认值：拿不到就让两列空着。
    })
    return () => {
      cancelled = true
    }
  }, [])
  return loaded
}
