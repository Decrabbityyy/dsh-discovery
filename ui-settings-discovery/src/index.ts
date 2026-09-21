/**
 * Host loader entry for the browser implementation exported from `./client`.
 *
 * A discovered model is adopted into a pi-ai profile, where the per-model
 * `input` modalities are what let that model accept an image at all. Only this
 * browser half consumes that data, so this package owns the endpoint that
 * serves it: the models.dev snapshot is parsed here through the shared
 * `dsh-llm-discovery/catalog/models-dev` entry (no pi-ai dependency) and answered
 * on {@link UI_CATALOG_PATH}. Mounting the plugin without a web server — or
 * with the section never opened — costs one background fetch and no route.
 */

import type { Context } from '@deepseek-ai/cordis'
import { MODELS_DEV_URL, parseModelFacts } from 'dsh-llm-discovery/catalog/models-dev'
import type { ModelFacts } from 'dsh-llm-discovery/catalog/models-dev'
import { catalogEnvelope, UI_CATALOG_PATH } from 'dsh-llm-discovery/vocabulary'
import type { CatalogEnvelope } from 'dsh-llm-discovery/vocabulary'

/** How long the mount-time models.dev snapshot may take before it reads as empty. */
const MODELS_DEV_TIMEOUT_MS = 15_000

/** The minimal webServer face this plugin reads: named exact-path route registration. */
interface WebServerFace {
  register(route: {
    kind: 'exact'
    path: string
    handler: (req: unknown, res: { statusCode: number; setHeader(name: string, value: string): void; end(body: string): void }) => void | Promise<void>
  }): () => void
}

/**
 * Fetch the models.dev fact index once per mount. A failure or timeout yields
 * an empty index rather than a rejection: the section then renders without
 * catalog defaults instead of failing to load.
 */
async function loadOnlineFacts(): Promise<ReadonlyMap<string, ModelFacts>> {
  try {
    const response = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(MODELS_DEV_TIMEOUT_MS) })
    if (!response.ok) return new Map()
    return parseModelFacts(await response.json())
  } catch {
    return new Map()
  }
}

/** Serve one already-filled snapshot on the section's own catalog path. */
function registerCatalogEndpoint(ctx: Context, envelope: () => CatalogEnvelope): void {
  const serve = (scope: Context): void => {
    const webServer = scope.get('webServer') as WebServerFace | undefined
    if (webServer === undefined) return
    scope.effect(() => webServer.register({
      kind: 'exact',
      path: UI_CATALOG_PATH,
      handler: (_req, res) => {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(envelope()))
      },
    }), 'ui-settings-discovery: catalog endpoint')
  }
  // The web server may mount after this plugin; the inject waits for it.
  if (ctx.get('webServer') === undefined) ctx.inject(['webServer'], serve)
  else serve(ctx)
}

export function apply(ctx: Context): void {
  // Filled in place so a request never waits on (or repeats) the fetch.
  const facts = new Map<string, ModelFacts>()
  void loadOnlineFacts().then((loaded) => {
    facts.clear()
    for (const [name, fact] of loaded) facts.set(name, fact)
  })
  registerCatalogEndpoint(ctx, () => catalogEnvelope(facts))
}
