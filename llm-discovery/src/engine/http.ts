import { attributionHeaders, errorChain } from '@deepseek-ai/dsh-llm'

export type JsonFetch =
  | { readonly kind: 'ok'; readonly body: unknown }
  | { readonly kind: 'http'; readonly status: number }
  | { readonly kind: 'unreachable'; readonly detail: string }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'bad-json' }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'timeout' }

export type JsonFetchFailure = Exclude<JsonFetch, { readonly kind: 'ok' }>

export interface FetchJsonOptions {
  readonly url: string
  /** Defaults to GET. */
  readonly method?: 'GET' | 'POST'
  /** JSON body, sent only for POST. */
  readonly body?: unknown
  /** Already validated; sent as a Bearer header. */
  readonly apiKey: string | undefined
  /** Merged after the auth header — a dialect's own auth/version pair. */
  readonly extraHeaders?: Record<string, string>
  /** Budget for the whole request, including the body read. */
  readonly timeoutMs: number
  /** Reply-size ceiling; a reply past it is refused, never truncated. */
  readonly maxBytes: number
  /** Caller cancellation, fused with the timeout. */
  readonly signal: AbortSignal | undefined
}

/**
 * Read a reply body under a hard byte ceiling: refuse before transfer when a
 * declared content-length exceeds it, and cap accumulated bytes during the
 * read as well, because endpoints lie about length.
 * @returns the body text, or `undefined` when the ceiling was exceeded.
 */
async function readBounded(response: Response, maxBytes: number): Promise<string | undefined> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    /* v8 ignore next -- cancel() rejects only on an already-errored stream, whose real error the caller's fetch already answered with */
    await response.body?.cancel().catch(() => {})
    return undefined
  }
  // A 204 reply carries no body stream; it parses below as the bad-json arm.
  const body = response.body
  if (body === null) return ''
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      /* v8 ignore next -- cancel() rejects only on an already-errored stream; the bytes just read prove this one is live */
      await reader.cancel().catch(() => {})
      return undefined
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

/**
 * Caller cancellation outranks this request's own timeout.
 * @returns the typed failure.
 */
function classifyFailure(error: unknown, caller: AbortSignal | undefined, timeout: AbortSignal): JsonFetchFailure {
  if (caller?.aborted) return { kind: 'aborted' }
  if (timeout.aborted) return { kind: 'timeout' }
  return { kind: 'unreachable', detail: errorChain(error) }
}

/**
 * Fetch one URL and parse its reply as JSON, with timeout, caller
 * cancellation, Bearer auth, and a reply-size ceiling. Never throws.
 */
export async function fetchJson(options: FetchJsonOptions): Promise<JsonFetch> {
  const timeout = AbortSignal.timeout(options.timeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...attributionHeaders(),
  }
  if (options.apiKey !== undefined) headers['authorization'] = `Bearer ${options.apiKey}`
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  Object.assign(headers, options.extraHeaders)
  let response: Response
  try {
    const init: RequestInit = { method: options.method ?? 'GET', headers, signal }
    if (options.body !== undefined) init.body = JSON.stringify(options.body)
    response = await fetch(options.url, init)
  } catch (error) {
    return classifyFailure(error, options.signal, timeout)
  }
  if (!response.ok) return { kind: 'http', status: response.status }
  let text: string | undefined
  try {
    text = await readBounded(response, options.maxBytes)
  } catch (error) {
    return classifyFailure(error, options.signal, timeout)
  }
  if (text === undefined) return { kind: 'too-large' }
  try {
    return { kind: 'ok', body: JSON.parse(text) }
  } catch {
    return { kind: 'bad-json' }
  }
}
