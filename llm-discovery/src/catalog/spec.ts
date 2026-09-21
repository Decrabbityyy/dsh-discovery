import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

const modelRowSchema = z.object({
  displayName: z.string().optional(),
  levels: z.array(z.string()).optional(),
  inputModalities: z.array(z.string()).optional(),
  outputModalities: z.array(z.string()).optional(),
  // models.dev 用 0 表示「不知道」，早期解析器把这个 0 存了进来：读回「未声明」，而不是让整条记录读不过去。
  contextWindow: z.number().int().positive().optional().catch(undefined),
  maxTokens: z.number().int().positive().optional().catch(undefined),
})

export type ModelRow = z.infer<typeof modelRowSchema>

/** 整份目录存成一条记录：json 后端的 single 布局每次写入都重发整个单元，逐模型存行会让一次刷新变成上万次整文件重写。 */
const catalogRowSchema = z.object({ entries: z.record(z.string(), modelRowSchema) })

export type CatalogRow = z.infer<typeof catalogRowSchema>

/** 让刷新增量化的两个值。 */
const catalogMetaSchema = z.object({
  etag: z.string().optional(),
  fetchedAt: z.number().int().nonnegative().optional(),
})

export type CatalogMeta = z.infer<typeof catalogMetaSchema>

/** version 0：首个带标签的版本之前不做兼容承诺。 */
export const modelCatalogDomainSpec = defineDomain({
  name: 'llm_models_dev_catalog',
  version: 0,
  // 读不过去的记录能在 per-record 与 SQLite 后端挪走；single 布局没有备份，仍会拒绝。
  invalidRecords: 'backup-and-skip',
  tables: {
    catalog: domainTable<string, CatalogRow>(catalogRowSchema),
  },
  global: {
    schema: catalogMetaSchema,
    initial: {},
  },
})
