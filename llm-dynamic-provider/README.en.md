# dsh-llm-dynamic-provider

[中文](README.md) | English

Runtime model discovery for the [LLM capability](../../../packages/llm/llm/README.md), in the shape of OMP's discoverable providers. It exists for **API gateways and aggregators**: services that front dozens of models from many providers behind one OpenAI-compatible endpoint. Hand-declaring such a route means spelling out every model entry in configuration and redoing it each time the gateway refreshes its lineup — a dynamic route declares the endpoint once, and its catalog follows the gateway: models appear, disappear, and change capacities upstream, and the next boot picks it up with no manual re-adopt.

A route declared for this plugin is **reprobed against its endpoint at every startup and registered straight into the in-memory LLM registry** — the discovered catalog is never written to `settings.yaml`, and no other plugin's configuration is touched.

Routes are declared in the plugin's own `llm-dynamic-provider` settings namespace: the cordis.yml entry config's `routes` is the composition base, and a configuration surface (the sibling settings panel, or a hand edit of the namespace in `settings.yaml`) can add, edit, and remove routes live — a hot edit reprobes without a restart.

The plugin hosts its **own** `PiAiAdapter` (the class is a published entry-point export) and serves four wire protocols — `openai-completions`, `openai-responses`, `anthropic-messages`, and `google-generative-ai` — through pi-ai's public per-protocol factories, so streaming, retries, the idle watchdog, and image handling are pi-ai's own, not a reimplementation.

## What a reprobe registers

For every declared route, the pass probes the endpoint, then assembles a resolved pi-ai profile from three sources in a fixed precedence:

| Field | Source |
|---|---|
| `id` | the endpoint's listing (the only required fact) |
| `contextWindow` / `maxTokens` | the endpoint when it discloses them, else the bundled pi-ai catalog by exact id, else the route's `defaultContextWindow` / `defaultMaxTokens` |
| `name` | the bundled catalog by exact id, else the id itself |
| `reasoning` / thinking levels | the bundled catalog's `thinkingLevelMap` translated through `getSupportedThinkingLevels` — only for ids the catalog records as reasoning-capable |

Endpoint-reported values always win; nothing is inferred from id patterns. A catalog-known id arrives selector-ready (display name, capacities, thinking levels); an id neither the endpoint nor the catalog can describe keeps only what the route's defaults supply.

## Lifecycle semantics

- **In-memory catalogs, rebuilt each boot.** Registration goes through `ctx.llm.registerAdapter`, so the routes appear in the selector the moment the probe answers and vanish when the plugin unloads. What a settings document carries is only the route declarations; the discovered model lists live in the registry alone.
- **A failed or empty probe contributes no route.** An unreachable, unauthenticated, or empty answering endpoint is reported under `failed` and simply not registered — never a model-less route the selector would choke on. With `cache` on, a previously discovered catalog keeps the route serving while the endpoint is down.
- **Optional cache.** With `cache: true` the discovered catalog persists to `$DSH_HOME/llm-dynamic-provider-cache.json`. A cold boot registers from the cache immediately, then the live probe refreshes the registration (`replace`, atomically) once the endpoint answers — OMP's model-cache posture. Default is off: every boot probes synchronously.
- **Four protocols.** The route's `api` selects both the discovery dialect and the streaming implementation: OpenAI-compatible listings for the two OpenAI protocols, Anthropic's `?limit=1000` listing for `anthropic-messages`, and the Google listing for `google-generative-ai`.

## Config

Routes live in the `llm-dynamic-provider` settings namespace, whose composition base is the cordis.yml entry config (the namespace persists route *declarations*; the discovered catalogs are runtime state, never a persisted document):

```yaml
- id: llm-dynamic-provider
  name: 'dsh-llm-dynamic-provider'
  config:
    routes:
      upstream:
        baseURL: https://gateway.internal/v1
        api: openai-completions      # openai-responses | anthropic-messages | google-generative-ai
        apiKeyEnv: UPSTREAM_API_KEY  # resolved via the credential seam, then the environment
        displayName: Upstream
        defaultContextWindow: 262144 # fallback for undisclosed models
        defaultMaxTokens: 32768
      local-gemini:
        baseURL: http://127.0.0.1:8000
        api: google-generative-ai
    cache: true                      # persist the catalog under $DSH_HOME
    timeoutMs: 10000                 # per-request probe ceiling
    maxResponseBytes: 4194304        # replies past this are refused
    enrichment: true                 # bundled-catalog fill of undisclosed fields
```

Every route field but `baseURL` and `api` is optional, as is every probe knob. The plugin composes beside the LLM and settings capabilities (`inject: ['llm', 'settings']`); the credential capability is optional — a named `apiKeyEnv` resolves through it when mounted, falling back to the process environment otherwise. A route naming no `apiKeyEnv` probes and streams **unauthenticated**: on the `openai-completions` protocol the request carries no credential at all, which is what free-tier and local-engine endpoints expect (a malformed bearer would be refused outright).

## Installation

The package is a [bundle](../../../docs/user/develop/basic/publish.md): its own `cordis.patch.yml` inserts the `llm-dynamic-provider` row when a profile installs it. The discovery engine is bundled in (`tsdown` `alwaysBundle`), so the tarball is self-contained apart from the harness peers (`@deepseek-ai/*`, `@earendil-works/pi-ai`) a profile already carries.

With an **installed** `dsh` CLI, install the packed tarball:

```sh
pnpm -C third-plugin/llm-dynamic-provider pack
dsh plugin --profile <name> add ./third-plugin/llm-dynamic-provider/dsh-llm-dynamic-provider-0.1.0.tgz
dsh --profile <name> --dump-config   # verify the layer appears
```

With a **source checkout** (`pnpm dsh …`), a plain path add works because the tsx launcher resolves harness imports through the repository's tsconfig paths:

```sh
pnpm dsh plugin --profile <name> add ./third-plugin/llm-dynamic-provider
```

## Package dependencies and division of labor

The four packages in this repo form one discovery system, with a one-way dependency direction:

```
dsh-llm-endpoint-base (pure library; never installed alone, inlined into each tarball)
  ├── dsh-llm-dynamic-provider   this package: autonomous runtime management
  ├── dsh-llm-discovery          read-only probe offer
  └── dsh-client-ui-settings-discovery  the settings panel
        ├── discovery block → the llm-discovery probe RPC
        └── dynamic-routes block → this plugin's /llm-dynamic-provider/routes endpoint
```

- **`dsh-llm-endpoint-base`** (internal library): the engine ladder (Ollama / LiteLLM / OpenAI-compatible), bounded probe HTTP, models.dev catalog parsing and persistence, and the shared vocabulary (protocols, namespaces, route-id rules). It is **inlined** into this package's tarball (`tsdown` `alwaysBundle`), so installing this package never requires installing it separately; the same holds for `llm-discovery` and the panel.
- **`dsh-llm-discovery`**: the read-only prober a configuration surface drives on demand (its result is an offer a user *adopts* into a settings-backed route), sharing endpoint-base's engines and enrichment with this package; they differ only in where the answer lands — a persisted pi-ai route the user owns, versus an in-memory registration this plugin owns.
- **`dsh-client-ui-settings-discovery`**: that surface. Its dynamic-routes block edits this plugin's namespace live through this package's own HTTP endpoint (`/llm-dynamic-provider/routes`, which bypasses the settings proxy's exposure gate); its discovery block goes through `llm-discovery`'s probe RPC. The panel is **optional** for this package: without it, declarations in cordis.yml work unchanged.

This package is the autonomous, runtime complement: a route is opted into management once by declaring it, and every boot keeps its catalog current in the registry without a confirmation step; only the declaration persists, never the discovered catalog.

Harness dependencies (`@deepseek-ai/*`, `@earendil-works/pi-ai`) are all peer dependencies, resolved at runtime from the installation's dependency closure: the `llm` and `settings` capabilities are **required** (declared in `inject`); `credentials`, `storageDomain`, and `webServer` are all **optional** — without credentials the environment answers, without storageDomain the models.dev catalog lives in memory only, and without webServer the HTTP endpoints are skipped (and the panel with them).
