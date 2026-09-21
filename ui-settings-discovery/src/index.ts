/** Host loader entry for the browser implementation exported from `./client`. */

import type { Context } from '@deepseek-ai/cordis'
import { CATALOG_SERVICE, UI_CATALOG_PATH, UI_CATALOG_STATUS_PATH } from 'dsh-llm-discovery/vocabulary'
import type { SharedCatalog } from 'dsh-llm-discovery/vocabulary'

export const inject = [CATALOG_SERVICE]

/** The minimal webServer face this plugin reads: named exact-path route registration. */
interface WebServerFace {
  register(route: {
    kind: 'exact'
    path: string
    handler: (req: unknown, res: { statusCode: number; setHeader(name: string, value: string): void; end(body: string): void }) => void | Promise<void>
  }): () => void
}

export function apply(ctx: Context): void {
  const catalog = ctx.get(CATALOG_SERVICE) as SharedCatalog
  const send = (res: { setHeader(name: string, value: string): void; end(body: string): void }, body: unknown): void => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(body))
  }
  const serve = (scope: Context): void => {
    const webServer = scope.get('webServer') as WebServerFace | undefined
    if (webServer === undefined) return
    scope.effect(() => webServer.register({
      kind: 'exact',
      path: UI_CATALOG_PATH,
      handler: (_req, res) => {
        send(res, catalog.envelope())
      },
    }), 'ui-settings-discovery: catalog endpoint')
    scope.effect(() => webServer.register({
      kind: 'exact',
      path: UI_CATALOG_STATUS_PATH,
      handler: async (req, res) => {
        const method = (req as { method?: string }).method ?? 'GET'
        if (method === 'POST') await catalog.refresh()
        else if (method !== 'GET') {
          res.statusCode = 405
          send(res, { error: 'method not allowed' })
          return
        }
        send(res, catalog.status())
      },
    }), 'ui-settings-discovery: catalog status endpoint')
  }
  // The web server may mount after this plugin; the inject waits for it.
  if (ctx.get('webServer') === undefined) ctx.inject(['webServer'], serve)
  else serve(ctx)
}
