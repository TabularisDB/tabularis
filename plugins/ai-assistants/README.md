# Declarative AI assistant plugins

AI providers are independent `ai-assistant` packages installed from Tabularium.
The host owns HTTP, credentials, proxies, prompt construction and timeouts. A
package contains JSON definitions, with no executable, interpreter or UI code.
ChatGPT account login remains built into Tabularis for now.

## Package contract

Each package contains a `.tabularium` manifest validated against
[`manifest.schema.json`](manifest.schema.json). The provider's stable `id` is
also its settings and keychain identity. Existing provider IDs must not change.

The `ai_assistant` contract declares API version 1 and:

- Authentication: API key or none, optional key support, environment variable,
  header name and prefix. Keys remain in the host keychain and are attached by
  the host; templates cannot reference credentials.
- Generation: an ordered list of HTTP requests and a response selector.
  Additional requests provide regional fallback, as in MiniMax.
- Model discovery: ordered GET sources, JSON Pointer paths, filters and cache
  duration. Preferred models precede discovered models; duplicates are removed.
- Settings: typed user fields, such as an endpoint URL or local port. These are
  rendered by the host instead of adding a provider-specific settings component.

A generation request's `body` is a JSON object. Exact string references
`{{model}}`, `{{prompt}}`, `{{system_prompt}}` and `{{settings.field}}` substitute
the corresponding JSON value. Substitution does not parse user input as JSON or
evaluate expressions. URL templates accept only settings references.
`append_path` appends an endpoint unless the URL already ends with that endpoint.

Responses use JSON Pointer paths such as `/choices/0/message/content`. For
block-based responses, `select` finds the first matching array item and
`value_path` extracts its text. Anthropic selects a `type: text` block, so a
preceding thinking block does not break generation.

Model filters combine `equals`, array `contains`, string `starts_with` and
`missing_matches`. The examples cover Runcrate's text output filter and Opper's
pooled LLM filter, based on [PR 1336](https://github.com/TabularisDB/tabularis/pull/1336)
and [PR 1265](https://github.com/TabularisDB/tabularis/pull/1265).

Generation requests use POST; model discovery uses GET. Static headers support
provider attribution and API versions. HTTP failures do not return response
bodies or request URLs to the UI, and redirects are disabled so credentials
cannot move to another endpoint. TLS verification remains enabled. Local
providers can explicitly request direct routing; other providers retain the
global and per-provider proxy policy.

## Building and publishing

Build the universal ZIP archives independently of the application:

```sh
python3 plugins/ai-assistants/package.py --output /tmp/tabularis-ai-packages
```

Each provider is a separate publishable package under `packages/`. Publish its
ZIP and its standalone `.tabularium` manifest in that provider's release
repository, with the release tag matching `version`. Register the ZIP as the
`universal` asset. No platform binaries or native builds are needed.

Before releasing the application change, publish the seven replacement packages
with their existing IDs: `openai`, `anthropic`, `ollama`, `openrouter`, `requesty`,
`minimax`, and `custom-openai`. Opper and Runcrate are additional examples and
are not migration targets.

The registry operator creates `ai-assistant` using
[`tabularium-kind.json`](tabularium-kind.json), including its extension schema
and public catalogue page. The same preset is available in the Tabularium
repository under `deploy/tabularis/ai-assistant-kind.json`. This uses the
existing operator-defined kind system; generic Tabularium installations do not
acquire an application-specific kind automatically.

## Upgrade migration

On startup the host snapshots previously configured legacy providers into
`ai-assistant-migration-v1.json`. A selected provider, stored or environment API
key, custom model list, custom endpoint or nondefault Ollama port can identify
an existing configuration. ChatGPT is excluded.

Downloads run in the background. Successful providers retain their IDs, API
keys, selected and custom models, and proxy settings. Legacy endpoint and port
settings are copied to plugin settings without replacing existing values.
Failed downloads remain pending and retry on startup or through AI settings.
Completed entries prevent an intentional uninstall from being reversed later.

AI settings show pending downloads and unavailable saved selections. The Plugin
Center lists installed packages even when the remote registry is unavailable.
Installing a provider makes it selectable without changing the active provider.
Removing it retains credentials and configuration for a later reinstall.
