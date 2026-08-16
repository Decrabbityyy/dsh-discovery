# dsh-llm-discovery

English | [中文](README.zh.md)

Engine-detecting endpoint model discovery for the [LLM seam](../llm/README.md). The plugin registers the `llm-discovery` offer on `ctx.llm.registerModelDiscovery`, so any configuration surface can interrogate a draft endpoint through the existing `llm.discoverModels` RPC with `settingsNs: 'llm-discovery'` — no adapter, gateway, or other plugin is modified. The discovery vocabulary (request draft, candidate model shape) belongs to the seam; this package owns the engine ladder and the enrichment step.

## The ladder

A probe walks engine rungs in order and the first engine that recognizes the endpoint wins:

| Rung | Endpoints | Capacities it reads |
|---|---|---|
| `ollama` | `GET /api/tags`, then one `POST /api/show` per model | `model_info`'s `*.context_length`; a model without one reports `ollamaDefaultContextWindow` |
| `litellm` | `GET /model_group/info`, `/v2/model/info`, `/model/info`, `/v1/model/info` in order | `max_input_tokens`/`context_window` and `max_output_tokens`/`max_tokens`, including each entry's nested `model_info` |
| `openai-models` | `GET {baseURL}/models` | `context_window`/`context_length`/vLLM `max_model_len`, and `max_output_tokens`/`max_tokens` |

The generic rung switches dialect when the draft names `api: 'anthropic-messages'`: Anthropic's [Models API](https://platform.claude.com/docs/en/api/models/list) is the same `data`-array listing but authenticates with `x-api-key` plus a required `anthropic-version` header (Bearer is for OAuth tokens), reads `max_input_tokens` as the context window, and is probed with `?limit=1000` (the documented page ceiling; `has_more` cursors are not followed).

The specific rungs come first because an Ollama host also answers an OpenAI-compatible listing without capacities, and a LiteLLM proxy's `/models` is bare where its management endpoints are rich. A rung that gets a 404, an unreachable host, an unparseable answer, or an answer without its expected payload shape skips to the next; a 401/403 is remembered as the most reportable failure and thrown when no rung produces a listing. Caller cancellation stops the ladder at once with `ABORTED`. Native-API rungs strip a trailing `/v1` from the base before joining their paths, so an OpenAI-style base URL still reaches `/api/tags`.

## Enrichment

When `enrichment` is on, fields an endpoint leaves undisclosed are filled from the bundled pi-ai model catalog by exact model id: a proxy listing `claude-haiku-4-5` with no capacities still yields a fully described candidate. Endpoint-reported values always win, and an id the catalog does not know stays honestly undisclosed — the [`LlmDiscoveredModel`](../llm/README.md) contract makes every field but `id` optional for exactly this reason. Nothing is ever inferred from id patterns.

## Draft contract

The request is the seam's `LlmModelDiscoveryRequest`: `baseURL` is required (this namespace owns no routes and no catalog of its own, so there is nothing to short-circuit with); `apiKey`, when supplied, is validated with the shared `normalizeApiKey` before any header is built and is never stored; `signal` aborts promptly. The reply is candidate metadata a surface may offer for adoption — nothing here writes settings or credentials.

## Config

```yaml
- id: llm-discovery
  name: 'dsh-llm-discovery'
  config:
    timeoutMs: 10000                  # per-request probe ceiling
    maxResponseBytes: 4194304         # replies past this are refused, not truncated
    enrichment: true                  # bundled-catalog fill of undisclosed fields
    ollamaDefaultContextWindow: 128000
    engines: { ollama: true, litellm: true, openaiModels: true }
```

Every field is optional with the defaults shown. The package is a [bundle](../../../../docs/user/develop/basic/publish.md): its own `cordis.patch.yml` inserts the `llm-discovery` row when a profile installs it.

## Installation

The package is a [bundle](../../../../docs/user/develop/basic/publish.md): its own `cordis.patch.yml` inserts the `llm-discovery` row when a profile installs it.

With an **installed** `dsh` CLI, install the packed tarball — a `dsh plugin add ./path` link install leaves Node resolving the plugin's harness imports from the checkout's real location, which has no `@deepseek-ai/*` packages on its parent walk:

```sh
pnpm -C third-plugin/llm-discovery pack
dsh plugin --profile <name> add ./third-plugin/llm-discovery/dsh-llm-discovery-0.1.0.tgz
dsh --profile <name> --dump-config   # verify the layer appears
```

With a **source checkout** (`pnpm dsh …`), a plain path add works because the tsx launcher resolves harness imports through the repository's tsconfig paths — use it for development iteration:

```sh
pnpm dsh plugin --profile <name> add ./third-plugin/llm-discovery
```

All harness imports (`@deepseek-ai/*` and the pi-ai catalog library) are peer dependencies, resolved at runtime from the installation's dependency closure; no npm fetch happens at install. A user patch on the `llm-discovery` row replaces its whole `config` value rather than deep-merging keys.

## Model Experience

None, as discovery candidates are configuration-time facts offered to a human and never enter a prompt, message, schema, or tool result.

#### KV Cache effect

None; the plugin never participates in a model request, so it cannot touch a request prefix.

## Known Limitations and Deferred Work

- **Per-model wire protocol is not reportable** — `LlmDiscoveredModel` carries no `api` field, so a dual-wire proxy's per-model `supported_endpoint_types` (the OMP `proxy` discovery type) cannot be expressed; the adopting profile keeps its single draft `api`.
- **The Ollama engine default outranks enrichment** — when `/api/show` discloses no context length the configured `ollamaDefaultContextWindow` fills the field before the catalog step runs, so a catalog-known id keeps the engine default rather than its catalog capacity; local Ollama variants are the common case and are not the catalog's model.
- **Nothing persists the engine an answer came from** — detection re-runs on every probe; a saved route profile carries no discovery field because that schema belongs to the adapter package.
- **Anthropic listings beyond 1,000 models are truncated** — the `limit=1000` page ceiling is requested and `has_more` cursors are not followed; no real deployment is near it.
- **No discovery for `deepseek-official`** — that adapter answers from its own configured catalog under the `llm-deepseek` directory entry; this namespace interrogates endpoints only.
