# Declarative AI assistants

OpenAI, Anthropic, OpenRouter, Requesty, MiniMax, Ollama, OpenAI Compatible and API Route
are **built into Tabularis**. Their definitions and icons are embedded in the
application binary; they remain available without a registry or an initial
download. ChatGPT account login remains built in as well.

API Route and OpenAI Compatible require an explicitly selected or saved model.
Their definitions set `require_explicit_model: true`; discovery alone never picks
the first account model on the backend.

Additional providers are independent `ai-assistant` packages. **Gemini** is the
first external example, maintained in
[tabularis-gemini-plugin](https://github.com/TabularisDB/tabularis-gemini-plugin).
Opper and Runcrate remain example definitions.

## Install from AI settings

Open **Settings → AI** to select a built-in or previously installed provider.
The same screen lists available external providers with their icons and an
**Install and use** action. It uses the Plugin Center registry and installer,
checks release/platform compatibility, selects the provider after a successful
install and opens its settings. A failed download leaves the saved provider
unchanged and offers retry. Installed providers remain usable when the registry
is offline. The Plugin Center still manages external updates and removal.

Built-ins cannot be installed over, removed, or shadowed by an external package
using a reserved ID. Existing files from a development build are ignored for
those IDs; application updates own their definitions.

## Add a provider without application changes

1. Copy `packages/gemini/.tabularium` or an existing definition.
2. Choose a unique ID, name, version, description and icon URL. Keep the ID
   stable: it is also the credentials and settings identity.
3. Declare authentication, generation requests and response selection. Add
   model discovery and optional typed user settings.
4. Validate against `manifest.schema.json`, build a universal ZIP, and publish
   the ZIP plus standalone manifest in the provider repository.
5. Register the repository and its `universal` asset in Tabularium. Once listed,
   the provider appears in Settings → AI without a new frontend or Rust branch.

The host owns HTTP, credentials, proxies, prompts and timeouts. Packages contain
JSON, optional `icon.svg`, README and license files; no plugin code executes.
Bundled definitions can embed their icons as base64 SVG data URIs. External
packages can use an HTTPS icon URL, as Gemini does with its repository asset.

## API version 1 contract

- Authentication: API key or none, optional keys, environment variable, custom
  header and prefix. Keys stay in the host secret store and cannot be referenced
  by templates.
- Generation: up to four ordered POST recipes, allowing regional fallback.
- Discovery: up to eight GET sources, JSON Pointer selectors, filters and cache
  duration. Preferred models precede discovered models; duplicates are removed.
- Settings: typed string, number, boolean and select fields rendered by the host.

Body references `{{model}}`, `{{prompt}}`, `{{system_prompt}}` and
`{{settings.field}}` replace an exact JSON string while preserving JSON types.
They never parse user text as JSON or execute expressions. URL templates accept
settings references and `{{model}}` as a resource path after an absolute endpoint
prefix ending in `/`. Model segments are URL encoded; empty segments and `.` or
`..` are rejected. A model cannot replace the origin, insert a query, or expose
credentials. `append_path` avoids appending an already-present endpoint.

Responses use JSON Pointers, such as `/choices/0/message/content`. A `select`
filter chooses the first matching block and `value_path` extracts its text.
Anthropic skips thinking blocks by selecting `type: text`. Gemini skips parts
with `thought: true`, and discovers only models supporting `generateContent`.
Filters support `equals`, array `contains`, string `starts_with`, prefix lists
and `missing_matches`.

The Gemini example exercises a model in the URL, nested request bodies, a
provider-specific key header, native resource IDs, model filtering and block
selection. Existing examples cover OpenAI-compatible APIs, local/no-key APIs,
optional credentials, regional fallback and configurable endpoints.

This contract targets nonstreaming text APIs with static/API-key authentication.
OAuth, request signing, streaming, pagination, multipart uploads, multimodal
inputs, tool execution and arbitrary response transformations require an explicit
future contract extension. They must not be emulated with executable templates.
Redirects are disabled; TLS verification and global/per-provider proxy policy
remain host-owned. HTTP errors do not expose response bodies or credential URLs.

## Build and publish

```sh
python3 plugins/ai-assistants/package.py --output /tmp/tabularis-ai-packages
```

The packager skips the eight built-in definitions. External ZIPs include their
manifest, license and optional icon. The release tag matches manifest `version`;
register the ZIP as `universal`. No platform binary is needed.

The registry operator applies `tabularium-kind.json`, including the extension
schema and public catalogue page, as described in
[Tabularium #35](https://github.com/TabularisDB/tabularium/pull/35).
Set the **actual first supporting runtime version** before a production listing;
a development version is not evidence of old-client compatibility. There is no
requirement to publish replacement packages for the eight built-in providers.

## Existing settings

Startup migration preserves IDs, API keys, saved/custom models, proxies, custom
endpoints and the Ollama port. It copies legacy endpoint/port values to provider
settings without replacing existing plugin values. Built-in definitions satisfy
migration locally, including when an earlier development build left a pending
provider download. No registry download is needed for these providers.
