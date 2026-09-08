import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

const modelRowSchema = z.object({
  displayName: z.string().optional(),
  levels: z.array(z.string()).optional(),
  inputModalities: z.array(z.string()).optional(),
  outputModalities: z.array(z.string()).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
})

/** One catalog row as stored, keyed by bare model name. */
export type ModelRow = z.infer<typeof modelRowSchema>

/** The fetch validators that make the refresh incremental. */
const catalogMetaSchema = z.object({
  /** The ETag models.dev last answered with, sent back as If-None-Match. */
  etag: z.string().optional(),
  /** Fetch timestamp (ms) of the last successful refresh. */
  fetchedAt: z.number().int().nonnegative().optional(),
})

export type CatalogMeta = z.infer<typeof catalogMetaSchema>

/** Version 0: no compatibility promise before the first tagged release. */
export const modelCatalogDomainSpec = defineDomain({
  name: 'llm_dynamic_provider_models',
  version: 0,
  tables: {
    models: domainTable<string, ModelRow>(modelRowSchema),
  },
  global: {
    schema: catalogMetaSchema,
    initial: {},
  },
})
