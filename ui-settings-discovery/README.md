# dsh-client-ui-settings-discovery

English | [中文](README.zh.md)

Model discovery settings plugin. It registers one settings section, 模型发现, whose single flow is: pick a local-engine preset or enter a custom endpoint, probe it through the host's `llm.discoverModels` offer, inspect the advertised metadata, and adopt a selection into a NEW pi-ai provider profile. The host half — the `llm-discovery` namespace whose registered offer answers the probe with engine-type auto-detection (Ollama native, LiteLLM management, generic OpenAI, Anthropic, and native Google listings) — is a separate plugin; this page consumes only its public RPC and never mounts it. The section depends on that offer: a probe whose namespace has no registered discovery answers with a business error the page shows verbatim.

## Installation

Both halves are bundles — each package's own `cordis.patch.yml` inserts its row when a profile installs it. With an installed `dsh` CLI, pack first: `dsh plugin add` of a local directory link-installs, and the host package's harness imports then resolve from the checkout's real path, which has no `@deepseek-ai/*` packages above it. Under `pnpm dsh` (source launch) a path add is fine and preferred for development.

```sh
pnpm -C third-plugin/llm-discovery pack && pnpm -C third-plugin/ui-settings-discovery pack
dsh plugin --profile web add ./third-plugin/llm-discovery/dsh-llm-discovery-0.1.0.tgz
dsh plugin --profile web add ./third-plugin/ui-settings-discovery/dsh-client-ui-settings-discovery-0.1.0.tgz
dsh --profile web --dump-config   # verify the two layers appear
```

No install-time build scripts exist (prepack builds the tarball), so no `allowBuilds` entry is needed. Users can override the host plugin's config in the profile's own `cordis.patch.yml` — a patch on the `llm-discovery` row replaces its whole `config` value.

**Preset cards** prefill the probe form for the common local engines — Ollama (`http://127.0.0.1:11434/v1`), LM Studio (`http://127.0.0.1:1234/v1`), llama.cpp (`http://127.0.0.1:8080`) — and a 自定义端点 card for anything else. Prefill only: every field stays editable, and the route id of the adoption follows the chosen card only until the user edits it. The page notes that local engines usually need no key.

**探测** sends `llm.discoverModels({ settingsNs: 'llm-discovery', baseURL, api, apiKey? })` for the form as it currently shows, including a key typed but not yet stored. The reply renders as a table of discovered models — id / name / contextWindow / maxTokens, with `—` for absent metadata — every row starting checked. A `model-discovery-failed` rejection (or any transport failure) renders as an error line with the message verbatim, and an empty reply renders its own row-less state.

**采纳为 Provider** performs ONE `settings.mutate` on `llm-pi-ai`, writing the whole profile at `providers.<route>`: optional `displayName`, the wire protocol, `baseURL`, the selected models, and — only when a key was typed — `apiKeyEnv` under the same `<ROUTE>_API_KEY` derivation the Models page uses. The 思考档位（可选） group writes the picked levels as each adopted model's `reasoningEfforts` (`off` carries the empty wire spelling, per the adapter contract); nothing picked writes nothing — catalog routes keep their catalog inheritance, and only hand-declared routes need the explicit levels. When the route id names an installed-catalog pi-ai provider (e.g. `anthropic`), the picker disables itself and any picked levels are ignored: catalog entries carry reasoning already. A route id that already has a profile is refused with a pointer to the Models page — a `set` at `providers.<route>` would otherwise replace that profile wholesale. For fully automatic catalog-derived levels on hand-declared routes, install the sibling [`dsh-llm-catalog-sync`](../../llm-catalog-sync/README.md) plugin and leave the picker empty. The typed key is stored FIRST through `credentials.set` under that reference, so the profile only commits once its credential exists; an orphaned ref (the profile write then refused) is harmless. When the user selected nothing, `models` is omitted entirely — an absent list serves the route's whole catalog. The route id must match `[a-z0-9-]+`. The write carries the `llm-pi-ai` revision read from `settings.describe({})` just before it, exactly like the Models page: a concurrent change is refused as `settings-conflict` and the page shows that message rather than retrying. Success is a plain text line pointing the user at the 模型 settings page — no navigation machinery. The API key is write-only: it never renders back and only travels inside probe payloads and the credential write.

All probe and adoption state is component-local; the section declares no store, subscribes to no invalidation events, and re-reads the wire on every action.

## Model Experience

None, as the section renders a browser configuration UI; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The page is inert without the host discovery offer** — the probe answers with a business error unless a plugin registers a discovery for the `llm-discovery` namespace, and nothing in this package declares, verifies, or fallbacks that offer; the section renders as-is and reports whatever the wire answers.
- **No pushed-invalidation subscription** — unlike the Models page, this section subscribes to no forwarded settings/credentials events, so a profile another surface writes is only seen at the next probe/adopt; the adopt's `expectedRevision` still refuses a stale overwrite.
- **Static protocol list** — the protocol select is a fixed constant (`openai-completions`, `openai-responses`, `anthropic-messages`, `google-generative-ai`), not a schema read; if the pi-ai schema's union grows, this page's choices drift until updated.
- **Thinking levels are user-declared, not discovered** — `LlmDiscoveredModel` carries no reasoning field, so endpoints that disclose capability metadata (Anthropic's `capabilities.effort`) cannot return it through the seam; hand-declared routes need the picker's explicit levels.
- **Relaxed route-id pattern** — the adopt flow accepts `[a-z0-9-]+`, so a digit-leading id passes here but derives a credential reference that is not a POSIX shell identifier; hardening to the Models page's leading-letter pattern is deferred.
- **Adoption is write-only from this page** — a profile created here is reviewed and edited on the 模型 settings page; this section has no edit surface of its own.
