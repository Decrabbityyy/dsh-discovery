/**
 * Programmable local HTTP server fixture for the discovery specs. Routes are a
 * plain path→reply table; the fixture records requests and supports delayed,
 * dripped, and unanswered replies for timeout and abort coverage.
 */

import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/** One scripted reply: a status/body pair, optionally delayed, or a drip that
 * answers the head and one chunk and then holds the socket open. */
export interface Reply {
  /** HTTP status; defaults to 200. */
  readonly status?: number
  /** Extra response headers. */
  readonly headers?: Record<string, string>
  /** Full response body, sent at once. */
  readonly body?: string
  /** Artificial latency before any response byte. */
  readonly delayMs?: number
  /** Answer headers plus this one chunk, then hold the connection open. */
  readonly drip?: string
  /** Send the body as chunked transfer-encoding pieces (no content-length). */
  readonly chunked?: readonly string[]
}

/** Route table keyed by request path; a function handler inspects the request body (method-agnostic). */
export type RouteTable = Record<string, Reply | ((requestBody: string) => Reply)>

/** One observed request. */
export interface ObservedRequest {
  /** Request method. */
  readonly method: string
  /** Request path. */
  readonly path: string
  /** Authorization header, when sent. */
  readonly authorization: string | undefined
  /** All request headers as received. */
  readonly headers: Record<string, string | string[] | undefined>
  /** Collected request body. */
  readonly body: string
}

/** A running probe server. */
export interface ProbeServer {
  /** Base URL including the ephemeral port. */
  readonly url: string
  /** Every request the server has answered or is holding, in arrival order. */
  readonly requests: readonly ObservedRequest[]
  /** Stop the server, dropping held connections. */
  close(): Promise<void>
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<undefined>()
  setTimeout(() => {
    resolve(undefined)
  }, ms)
  return promise
}

/**
 * Start a probe server on an ephemeral loopback port. A path absent from the
 * table answers 404; a reply's `drip` chunk holds the socket open until the
 * client goes away.
 * @param routes - the path→reply table.
 * @returns the running server handle.
 */
export async function startProbeServer(routes: RouteTable): Promise<ProbeServer> {
  const requests: ObservedRequest[] = []
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk as Buffer))
    req.on('end', () => {
      const path = req.url ?? ''
      const observedBody = Buffer.concat(chunks).toString('utf8')
      requests.push({
        method: req.method ?? 'GET',
        path,
        authorization: typeof req.headers['authorization'] === 'string' ? req.headers['authorization'] : undefined,
        headers: req.headers,
        body: observedBody,
      })
      const route = routes[path]
      const reply = typeof route === 'function' ? route(observedBody) : route
      void (async () => {
        if (reply?.delayMs !== undefined) await sleep(reply.delayMs)
        // The client may already be gone after a delay or during a held drip;
        // writes to a dead socket are noise this fixture deliberately swallows.
        res.on('error', () => {})
        if (reply === undefined) {
          res.writeHead(404).end()
          return
        }
        if (reply.drip !== undefined) {
          res.writeHead(reply.status ?? 200, { 'content-type': 'application/json', ...reply.headers })
          res.write(reply.drip, () => {})
          return
        }
        if (reply.chunked !== undefined) {
          res.writeHead(reply.status ?? 200, { 'content-type': 'application/json', ...reply.headers })
          for (const piece of reply.chunked) res.write(piece, () => {})
          res.end()
          return
        }
        res.writeHead(reply.status ?? 200, { 'content-type': 'application/json', ...reply.headers })
        res.end(reply.body ?? '')
      })()
    })
  })
  const listening = Promise.withResolvers<undefined>()
  server.listen(0, '127.0.0.1', () => {
    listening.resolve(undefined)
  })
  await listening.promise
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    get requests() {
      return requests
    },
    close: () => {
      server.closeAllConnections()
      const { promise, resolve, reject } = Promise.withResolvers<undefined>()
      server.close((error) => {
        if (error === undefined) resolve(undefined)
        else reject(error)
      })
      return promise
    },
  }
}
