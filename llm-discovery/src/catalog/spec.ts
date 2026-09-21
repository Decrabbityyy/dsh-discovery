import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

const modelRowSchema = z.object({
  displayName: z.string().optional(),
  levels: z.array(z.string()).optional(),
  inputModalities: z.array(z.string()).optional(),
  outputModalities: z.array(z.string()).optional(),
  // `.catch(undefined)` carries rows whose capacity models.dev never stated:
  // it says "unknown" as 0, and an earlier version of the parser stored that 0
  // verbatim. Rejecting such a value would fail the record — and with the whole
  // catalog in one record, one bad field would cost the entire catalog, which
  // the plugin reads as "no local catalog" and works around by re-fetching every
  // model over the network. Anything that is not a positive integer therefore
  // reads back as unstated.
  contextWindow: z.number().int().positive().optional().catch(undefined),
  maxTokens: z.number().int().positive().optional().catch(undefined),
})

/** One model's facts as stored, keyed by the id models.dev records. */
export type ModelRow = z.infer<typeof modelRowSchema>

/**
 * The whole catalog as one record. models.dev hands over a complete snapshot per
 * fetch, and the json backend's `single` layout republishes the entire unit on
 * every write: a row-per-model table would therefore cost one whole-file write
 * per model (measured at ~46 ms each, i.e. seven minutes for a full refresh, and
 * the unit only grows). Kept as one record, a refresh is one write whatever the
 * catalog's size.
 */
const catalogRowSchema = z.object({
  /** Catalog key → the facts stored under it, exactly as parsed. */
  entries: z.record(z.string(), modelRowSchema),
})

export type CatalogRow = z.infer<typeof catalogRowSchema>

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
  // Insurance for drift this schema cannot foresee, on backends that can move a
  // record aside (per-record and SQLite do; the json `single` layout has no
  // backup, so there the domain still refuses rather than guessing).
  invalidRecords: 'backup-and-skip',
  tables: {
    catalog: domainTable<string, CatalogRow>(catalogRowSchema),
  },
  global: {
    schema: catalogMetaSchema,
    initial: {},
  },
})
