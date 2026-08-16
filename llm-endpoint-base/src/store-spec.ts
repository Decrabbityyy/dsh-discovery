/**
 * Durable storage-domain declaration for the models.dev model catalog: one
 * row per unique bare model name (provider prefixes collapsed at parse time),
 * carrying the thinking levels, modalities, and capacities the discovery and
 * enrichment paths read. Persisted so a cold boot skips the network fetch and
 * enrichment stays complete for models the bundled pi-ai catalog has not
 * caught up with yet.
 * @module dsh-llm-endpoint-base/store-spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** Runtime schema for one catalog row: the facts one model carries. */
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

/** The catalog metadata singleton: the fetch validators for incremental refresh. */
const catalogMetaSchema = z.object({
  /** The HTTP ETag models.dev last answered with, sent back as If-None-Match. */
  etag: z.string().optional(),
  /** Fetch timestamp (ms) of the last successful refresh. */
  fetchedAt: z.number().int().nonnegative().optional(),
})

/** The catalog metadata singleton value. */
export type CatalogMeta = z.infer<typeof catalogMetaSchema>

/**
 * The model-catalog domain: one `models` table (bare name → facts) plus a
 * global singleton holding the fetch validators. Version 0: no compatibility
 * promise before the first tagged release.
 */
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
