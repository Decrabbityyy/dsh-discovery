import { LlmError } from '@deepseek-ai/dsh-llm'
import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-llm'
import type { ResolvedDiscoveryConfig } from './config.ts'
import { fetchJson } from './http.ts'
import type { JsonFetchFailure } from './http.ts'

/**
 * The engines of the discovery ladder, in probe order: the endpoint-specific
 * ones run before the generic listing floor, because an endpoint that answers
 * both would otherwise be read through the poorer listing.
 */

/** One engine rung's verdict. */
export type EngineVerdict =
  | { readonly kind: 'models'; readonly models: readonly LlmDiscoveredModel[] }
  | { readonly kind: 'skip' }
  | { readonly kind: 'fail'; readonly error: LlmError }

/** Everything an engine needs for one probe. */
export interface ProbeFacts {
  readonly baseURL: string
  /** Validated probe credential, absent when the caller probed unauthenticated. */
  readonly apiKey: string | undefined
  /** Selects the listing dialect. */
  readonly api: string | undefined
  readonly signal: AbortSignal | undefined
  readonly config: ResolvedDiscoveryConfig
}

/** One discovery engine: probe one endpoint and classify the answer. */
export type DiscoveryEngine = (facts: ProbeFacts) => Promise<EngineVerdict>

/** A positive-integer field among candidates, or `undefined`. */
function capacity(...candidates: readonly unknown[]): number | undefined {
  return candidates.find((value): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value > 0)
}

/** A non-empty string field among candidates, or `undefined`. */
function label(...candidates: readonly unknown[]): string | undefined {
  return candidates.find((value): value is string => typeof value === 'string' && value.length > 0)
}

/** An object field among candidates when it is a plain record, or `undefined`. */
function record(...candidates: readonly unknown[]): Record<string, unknown> | undefined {
  return candidates.find((value): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value))
}

/** `skip` or `fail` for a non-`ok` fetch of an engine-specific endpoint. */
function miss(url: string, result: JsonFetchFailure): EngineVerdict {
  switch (result.kind) {
    case 'aborted':
      return { kind: 'fail', error: new LlmError('llm-discovery: model discovery aborted by caller', 'ABORTED') }
    case 'timeout':
      return { kind: 'fail', error: new LlmError(`llm-discovery: ${url} did not answer in time`, 'DISCOVERY_FAILED') }
    case 'http':
      // Auth refusals are worth reporting: the endpoint exists but rejected the
      // probe key. Every other status means the endpoint is not this engine's.
      if (result.status === 401 || result.status === 403) {
        return {
          kind: 'fail',
          error: new LlmError(`llm-discovery: ${url} answered ${result.status}; check the API key`, 'DISCOVERY_FAILED'),
        }
      }
      return { kind: 'skip' }
    default:
      return { kind: 'skip' }
  }
}

/** Drop a trailing `/v1` (and trailing slashes) so native API paths join a bare host. */
function bareHost(baseURL: string): string {
  return baseURL.replace(/\/+$/, '').replace(/\/v1$/i, '')
}

/**
 * Ollama native discovery: `GET /api/tags` for the model list, then one
 * `POST /api/show` per model for its `*.context_length`, since the listing
 * carries no capacities. A model whose show metadata has no context length
 * reports the configured engine default.
 */
async function probeOllama(facts: ProbeFacts): Promise<EngineVerdict> {
  const base = bareHost(facts.baseURL)
  const tags = await fetchJson({
    url: `${base}/api/tags`,
    apiKey: facts.apiKey,
    timeoutMs: facts.config.timeoutMs,
    maxBytes: facts.config.maxResponseBytes,
    signal: facts.signal,
  })
  if (tags.kind !== 'ok') return miss(`${base}/api/tags`, tags)
  const entries = record(tags.body)?.['models']
  if (!Array.isArray(entries)) return { kind: 'skip' }
  const models: LlmDiscoveredModel[] = []
  for (const entry of entries) {
    const row = record(entry)
    const id = row && label(row['name'], row['model'])
    if (!id) continue
    if (facts.signal?.aborted) {
      return { kind: 'fail', error: new LlmError('llm-discovery: model discovery aborted by caller', 'ABORTED') }
    }
    const contextWindow = await ollamaContextLength(base, id, facts)
    models.push({ id, contextWindow: contextWindow ?? facts.config.ollamaDefaultContextWindow })
  }
  return { kind: 'models', models }
}

/** One model's context length from `POST /api/show`, or `undefined` when undisclosed. */
async function ollamaContextLength(base: string, id: string, facts: ProbeFacts): Promise<number | undefined> {
  const show = await fetchJson({
    url: `${base}/api/show`,
    method: 'POST',
    body: { model: id },
    apiKey: facts.apiKey,
    timeoutMs: facts.config.timeoutMs,
    maxBytes: facts.config.maxResponseBytes,
    signal: facts.signal,
  })
  if (show.kind !== 'ok') return undefined
  const info = record(record(show.body)?.['model_info'])
  if (!info) return undefined
  for (const key of Object.keys(info)) {
    if (key.endsWith('.context_length')) {
      const value = capacity(info[key])
      if (value !== undefined) return value
    }
  }
  return undefined
}

/** LiteLLM management metadata routes, richest first; a 404 names an absent route. */
const LITELLM_METADATA_ROUTES = ['/model_group/info', '/v2/model/info', '/model/info', '/v1/model/info'] as const

/**
 * LiteLLM discovery: the management metadata endpoints carry per-model
 * capacities the OpenAI listing does not. Routes are probed in order and the
 * first parseable answer wins; when every route is absent the rung skips, so
 * the generic listing floor still runs.
 */
async function probeLitellm(facts: ProbeFacts): Promise<EngineVerdict> {
  const base = bareHost(facts.baseURL)
  let refusal: EngineVerdict | undefined
  for (const route of LITELLM_METADATA_ROUTES) {
    const url = `${base}${route}`
    const result = await fetchJson({
      url,
      apiKey: facts.apiKey,
      timeoutMs: facts.config.timeoutMs,
      maxBytes: facts.config.maxResponseBytes,
      signal: facts.signal,
    })
    if (result.kind !== 'ok') {
      const verdict = miss(url, result)
      // Caller cancellation stops the ladder; other failures only record the
      // most reportable refusal while cheaper routes are still tried.
      if (verdict.kind === 'fail' && verdict.error.code === 'ABORTED') return verdict
      refusal ??= verdict.kind === 'fail' ? verdict : undefined
      continue
    }
    const entries = record(result.body)?.['data']
    if (!Array.isArray(entries)) continue
    const models: LlmDiscoveredModel[] = []
    for (const entry of entries) {
      const row = record(entry)
      if (!row) continue
      const id = label(row['model_group'], row['model_name'], row['id'])
      if (!id) continue
      const info = record(row['model_info'])
      const contextWindow = capacity(row['max_input_tokens'], row['context_window'], info?.['max_input_tokens'], info?.['context_window'])
      const maxTokens = capacity(row['max_output_tokens'], row['max_tokens'], info?.['max_output_tokens'])
      models.push({
        id,
        ...(contextWindow === undefined ? {} : { contextWindow }),
        ...(maxTokens === undefined ? {} : { maxTokens }),
      })
    }
    return { kind: 'models', models }
  }
  return refusal ?? { kind: 'skip' }
}

/**
 * Anthropic's Models API is the same `data`-array listing in its own dialect:
 * the key travels as `x-api-key`, `anthropic-version` is required, and pages
 * default to 20 entries, so `limit=1000` keeps one request enough.
 */
const ANTHROPIC_LISTING_HEADERS = { 'anthropic-version': '2023-06-01' } as const

/** Convert a final listing request failure into the public discovery error. */
function listingFailure(url: string, result: JsonFetchFailure): EngineVerdict {
  switch (result.kind) {
    case 'http':
      return {
        kind: 'fail',
        error: new LlmError(
          result.status === 401 || result.status === 403
            ? `llm-discovery: ${url} answered ${result.status}; check the API key`
            : `llm-discovery: ${url} answered ${result.status}`,
          'DISCOVERY_FAILED',
        ),
      }
    case 'too-large':
      return { kind: 'fail', error: new LlmError(`llm-discovery: ${url} answered with a listing larger than the configured ceiling`, 'DISCOVERY_FAILED') }
    case 'bad-json':
      return { kind: 'fail', error: new LlmError(`llm-discovery: ${url} did not answer with JSON`, 'DISCOVERY_FAILED') }
    case 'timeout':
      return { kind: 'fail', error: new LlmError(`llm-discovery: ${url} did not answer in time`, 'DISCOVERY_FAILED') }
    case 'aborted':
      return { kind: 'fail', error: new LlmError('llm-discovery: model discovery aborted by caller', 'ABORTED') }
    default:
      return { kind: 'fail', error: new LlmError(`llm-discovery: could not reach ${url} (${result.detail})`, 'DISCOVERY_FAILED') }
  }
}

/**
 * Google Generative Language discovery: list the native `models` collection,
 * authenticate with `x-goog-api-key`, and retain models that can generate
 * content. The documented 1,000-item page ceiling keeps the probe bounded.
 * @param facts - the probe facts.
 * @returns the verdict for the Google listing dialect.
 */
async function probeGoogleModels(facts: ProbeFacts): Promise<EngineVerdict> {
  const url = `${facts.baseURL.replace(/\/+$/, '')}/models?pageSize=1000`
  const result = await fetchJson({
    url,
    apiKey: undefined,
    ...(facts.apiKey === undefined ? {} : { extraHeaders: { 'x-goog-api-key': facts.apiKey } }),
    timeoutMs: facts.config.timeoutMs,
    maxBytes: facts.config.maxResponseBytes,
    signal: facts.signal,
  })
  if (result.kind !== 'ok') return listingFailure(url, result)
  const entries = record(result.body)?.['models']
  if (!Array.isArray(entries)) {
    return {
      kind: 'fail',
      error: new LlmError(`llm-discovery: ${url} has no "models" array; enter this provider's models by hand`, 'DISCOVERY_FAILED'),
    }
  }
  const models: LlmDiscoveredModel[] = []
  for (const entry of entries) {
    const row = record(entry)
    if (!row) continue
    const methods = row['supportedGenerationMethods']
    if (Array.isArray(methods) && !methods.includes('generateContent')) continue
    const resourceName = label(row['name'])
    const id = label(row['baseModelId'], resourceName?.replace(/^models\//, ''))
    if (!id) continue
    const name = label(row['displayName'])
    const contextWindow = capacity(row['inputTokenLimit'])
    const maxTokens = capacity(row['outputTokenLimit'])
    models.push({
      id,
      ...(name === undefined ? {} : { name }),
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
    })
  }
  return { kind: 'models', models }
}

/**
 * The generic protocol-listing floor. OpenAI-compatible routes use
 * `GET {baseURL}/models`; `anthropic-messages` switches to Anthropic's
 * listing dialect, and `google-generative-ai` switches to the native Google
 * listing above. OpenAI replies may disclose stock `context_window` /
 * `context_length` fields or vLLM's `max_model_len`.
 * @param facts - the probe facts.
 * @returns the verdict for this rung.
 */
async function probeOpenAiModels(facts: ProbeFacts): Promise<EngineVerdict> {
  if (facts.api === 'google-generative-ai') return probeGoogleModels(facts)
  const anthropic = facts.api === 'anthropic-messages'
  const url = anthropic
    ? `${facts.baseURL.replace(/\/+$/, '')}/models?limit=1000`
    : `${facts.baseURL.replace(/\/+$/, '')}/models`
  const result = await fetchJson({
    url,
    // Anthropic API keys belong in x-api-key; a Bearer header there is only
    // for OAuth tokens and reads as an auth refusal.
    apiKey: anthropic ? undefined : facts.apiKey,
    ...(anthropic
      ? { extraHeaders: { ...ANTHROPIC_LISTING_HEADERS, ...(facts.apiKey === undefined ? {} : { 'x-api-key': facts.apiKey }) } }
      : {}),
    timeoutMs: facts.config.timeoutMs,
    maxBytes: facts.config.maxResponseBytes,
    signal: facts.signal,
  })
  if (result.kind !== 'ok') return listingFailure(url, result)
  const entries = record(result.body)?.['data']
  if (!Array.isArray(entries)) {
    return {
      kind: 'fail',
      error: new LlmError(`llm-discovery: ${url} has no "data" array; enter this provider's models by hand`, 'DISCOVERY_FAILED'),
    }
  }
  const models: LlmDiscoveredModel[] = []
  for (const entry of entries) {
    const row = record(entry)
    if (!row) continue
    const id = label(row['id'])
    if (!id) continue
    const name = label(row['name'], row['display_name'])
    const contextWindow = anthropic
      ? capacity(row['max_input_tokens'])
      : capacity(row['context_window'], row['context_length'], row['max_model_len'])
    const maxTokens = capacity(row['max_output_tokens'], row['max_tokens'])
    models.push({
      id,
      ...(name === undefined ? {} : { name }),
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
    })
  }
  return { kind: 'models', models }
}

/**
 * The engine ladder in probe order, filtered by the deployment's switches.
 * @param config - the resolved configuration.
 * @returns the enabled engines in ladder order.
 */
export function discoveryEngines(config: ResolvedDiscoveryConfig): readonly { readonly id: string; readonly probe: DiscoveryEngine }[] {
  const ladder = [
    { id: 'ollama', probe: probeOllama, enabled: config.engines.ollama },
    { id: 'litellm', probe: probeLitellm, enabled: config.engines.litellm },
    { id: 'openai-models', probe: probeOpenAiModels, enabled: config.engines.openaiModels },
  ]
  return ladder.filter(engine => engine.enabled).map(({ id, probe }) => ({ id, probe }))
}
