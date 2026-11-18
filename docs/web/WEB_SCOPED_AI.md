# Operator-scoped SQL AI in managed Web instances

Scoped SQL AI is disabled by default. It enables only Generate SQL and Explain
SQL for database sessions in an isolated, managed-only proxy instance. It does
not grant general AI chat, tools, streaming, global settings, provider management,
SSH, plugins, or administrator capabilities. Desktop behavior is unchanged. The scoped UI is available in the SQL Editor;
notebook AI remains governed by its existing settings and permissions.

## Operator configuration

Set `TABULARIS_WEB_AI_CONFIG_FILE` to an absolute path to a private JSON file.
`tabularis web --help` mentions this variable, so installers can reject older
binaries. Launch with `--auth proxy --connection-mode managed-only` and without
`--allow-high-risk`. All normal proxy identity, secret, Origin, CSRF and cookie
checks still apply to every request and WebSocket upgrade.

```json
{
  "provider": "openrouter",
  "model": "openai/gpt-5.4-mini",
  "api_key_file": "/run/tabularis/private/openrouter.key",
  "connections": [
    {
      "id": "provisioned-plesk-db-123",
      "database": "shop",
      "schemas": ["public"]
    }
  ]
}
```

For MySQL/MariaDB use the database name as the schema, e.g. `"schemas":["shop"]`.
Core enforces that equality even if the operator file contains a different schema.
This opt-in contract supports saved driver IDs `mysql` and `postgres` only.
Additional/plugin database drivers do not see the scoped action and are rejected
by the server, even if they advertise the same SQL dialect. Their existing
administrator/desktop AI behavior is unchanged. This intentional authorization
boundary can be extended separately after validating additional engines.
The extension must derive this allowlist from the intersection of its operator
configuration and the signed, authorized Plesk database catalogue. IDs are the
stable provisioning IDs, not connection display names. There are no wildcard
entries. Every request must match one connection/database/schema tuple and the
currently saved, managed MySQL/PostgreSQL connection. This is additional scope
restriction inside one instance, not multi-tenant authorization: use a separate
instance and private XDG directories for each workspace.

The config and optional key file are read once at startup. Unix permissions must
exclude group write/execute and all access by others (0600 or 0640); use private
parent directories and operator ownership. The config is limited to 64 KiB and
the key to 16 KiB. Unknown fields fail startup. An API-key provider requires the
key file unless its manifest explicitly makes authentication optional. Missing
optional keys never fall back to ambient credentials. Rotate keys/configuration
by stopping and restarting the workspace runtime; active sessions must be
recreated. Files may preexist before provisioning: startup checks structure and
provider availability, and resolves saved connection existence only on requests.

On Linux, with `XDG_CONFIG_HOME=/workspace/config` and
`XDG_DATA_HOME=/workspace/data`, paths are:

- `/workspace/config/tabularis/config.json`: operator settings, including
  `plugins[provider].settings` for providers with configurable endpoints.
- `/workspace/config/tabularis/connections.json`: machine-provisioned connections.
- `/workspace/data/tabularis/plugins/ai-assistant/<provider>/.tabularium`: the JSON
  manifest **file** for an installed additional provider.

This stack embeds OpenRouter and the other built-in provider manifests. A
same-ID installed ZIP cannot override a built-in manifest. OpenRouter uses
`https://openrouter.ai/api/v1/chat/completions` with `model`, system/user
`messages`, and `temperature: 0`; no extra settings are required. Additional
provider packages and endpoint settings are operator-controlled, never supplied
by browser requests. Restart after changing settings/packages, and protect the
whole XDG directory against browser-side or other untrusted writers.

## Browser contract and data sent

`GET /api/v1/session` adds only `scopedAi: {provider, model}` when enabled. It
contains no endpoint, credentials, package configuration or allowlist. The UI
shows this destination and uses these typed RPCs:

- `POST /api/v1/rpc/scoped_ai_generate` with
  `{connectionId, database, schema, prompt}`.
- `POST /api/v1/rpc/scoped_ai_explain` with
  `{connectionId, database, schema, query, language}`.

Responses use the normal RPC envelope with a string result. Unknown arguments,
including provider/model/endpoint/key/settings/schemaContext/rows overrides, are
rejected. Both methods need a live database session and valid proxy credentials.
Disabled or unauthorized scope returns 403; malformed/oversized text returns 400;
provider failures, timeout or capacity exhaustion return a generic 503 without
upstream response bodies. Session revocation during a request returns 401.

Generation retrieves the explicitly allowed schema through shared application
metadata services. It sends schema metadata and the user's prompt, without
sampling rows or transmitting result grids or database credentials. Explanation
sends only the SQL supplied by the user and the language instruction; it checks
the same scope but does not query metadata. SQL can itself contain sensitive
literals, so users should review what they submit. Generated SQL is inserted
into the editor for review and is never automatically executed in this mode.

Each instance allows two in-flight requests, each with a 30-second total deadline.
Prompt/query text is limited to 16 KiB, generated schema context and returned text
to 64 KiB each. The shared provider HTTP runtime rejects redirects and limits its
response body to 16 MiB. No AI result is published to the event bus or persisted
in shared AI history. Known credentials are redacted from returned text. Logout
cancels session requests; expired sessions and deleted/rotated connection
definitions cannot receive pending results. The gateway must continue enforcing
Plesk permissions on every request and active stream.

## Validation

The scoped AI Rust tests cover default-off HTTP behavior, Database-only access,
strict arguments, scope rejection, secret redaction, concurrency, cancellation,
connection removal, and no event emissions. Set `TABULARIS_SCOPED_AI_LIVE_TEST=1`
to also run generation against disposable PostgreSQL on localhost:25432 and
MariaDB on localhost:23306, database `app`, users `postgres`/`root`, password
`lab-scoped-test`, TLS disabled explicitly for these loopback fixtures. Seed table
`ai_fixture(id integer, label text)` with `private-row-data`; tests verify schema
inclusion and row/credential exclusion using a local mock OpenRouter recipe.
