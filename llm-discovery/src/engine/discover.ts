import { INVALID_CREDENTIAL_CODE, LlmError, normalizeApiKey } from '@deepseek-ai/dsh-llm'
import type { LlmDiscoveredModel, LlmModelDiscoveryOperation } from '@deepseek-ai/dsh-llm'
import type { ResolvedDiscoveryConfig } from './config.ts'
import { discoveryEngines } from './engines.ts'
import { enrichModels } from './enrich.ts'

/** The namespace this plugin registers. It owns no settings section and no routes. */
export const DISCOVERY_NAMESPACE = 'llm-discovery'

/** Validate the draft credential before any header is built from it. */
function probeKey(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const check = normalizeApiKey(raw)
  if (check.ok) return check.value
  throw new LlmError(
    check.reason === 'empty'
      ? 'llm-discovery: the draft API key is blank — enter the key or clear the field to probe unauthenticated'
      : 'llm-discovery: the draft API key carries characters an HTTP header cannot hold',
    INVALID_CREDENTIAL_CODE,
  )
}

/** Interrogate one draft endpoint through the engine ladder and enrich the answer. */
export async function discoverEndpoint(
  request: LlmModelDiscoveryOperation,
  config: ResolvedDiscoveryConfig,
): Promise<LlmDiscoveredModel[]> {
  const baseURL = request.baseURL?.trim()
  if (!baseURL) {
    throw new LlmError(
      'llm-discovery: a baseURL is required — this namespace interrogates endpoints and keeps no catalog of its own',
      'DISCOVERY_FAILED',
    )
  }
  const apiKey = probeKey(request.apiKey)
  const engines = discoveryEngines(config)
  if (engines.length === 0) {
    throw new LlmError('llm-discovery: every discovery engine is disabled in the deployment configuration', 'DISCOVERY_FAILED')
  }
  const failures: LlmError[] = []
  for (const engine of engines) {
    if (request.signal?.aborted) {
      throw new LlmError('llm-discovery: model discovery aborted by caller', 'ABORTED')
    }
    const verdict = await engine.probe({ baseURL, apiKey, api: request.api, signal: request.signal, config })
    if (verdict.kind === 'models') {
      return config.enrichment ? enrichModels(verdict.models) : [...verdict.models]
    }
    if (verdict.kind === 'fail') {
      if (verdict.error.code === 'ABORTED') throw verdict.error
      failures.push(verdict.error)
    }
  }
  const firstFailure = failures[0]
  if (firstFailure !== undefined) throw firstFailure
  throw new LlmError(
    `llm-discovery: no discovery engine could read a model listing from ${baseURL} (tried: ${engines.map(engine => engine.id).join(', ')})`,
    'DISCOVERY_FAILED',
  )
}
