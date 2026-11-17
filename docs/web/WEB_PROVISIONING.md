# Machine provisioning API

This API manages one instance's connection set, not per-user grants. Run an
isolated instance per Plesk workspace. Every authenticated browser user shares
its managed connections. MySQL/MariaDB and PostgreSQL use the same contract;
installed plugin drivers use their registered driver ID and `ConnectionParams`.

## Enable and authenticate

Start `tabularis web --no-open --auth proxy --public-url https://db.example.com
--allowed-origin https://db.example.com --connection-mode managed-only` with
`TABULARIS_WEB_PROXY_SECRET` and either `TABULARIS_PROVISIONING_TOKEN` or
`TABULARIS_PROVISIONING_TOKEN_FILE` in protected service configuration. Never set
both token sources. File contents may have a final newline. Tokens need at least
32 non-whitespace bytes; generate a random token, not a memorable password.
Provisioning is disabled when neither is set. Rotate or revoke by restarting
with a replacement token or removing both settings. Branding and organization
write overrides are incompatible with provisioning.

Only `Authorization: Bearer <token>` authorizes provisioning. Cookies, CSRF
tokens and trusted proxy user headers do not. Requests carrying `Origin` are
rejected, even with the token. Preserve the configured public Host when calling
the private upstream; do not expose the machine token to browser JavaScript or
place it in a URL. The machine token does not authenticate browser RPC. Restrict
machine endpoints at the gateway as well.

## Resource contract

- `PUT /api/v1/provisioning/connections/{external_ref}`: create or replace settings.
- `GET /api/v1/provisioning/connections`: list machine-provisioned metadata.
- `GET /api/v1/provisioning/connections/{external_ref}`: read metadata.
- `DELETE /api/v1/provisioning/connections/{external_ref}`: remove; retries return 204.

References are case-sensitive, 1–128 ASCII letters, digits, underscores or
hyphens. IDs are deterministically `provisioned-<external_ref>`, reserved for the
machine service, so retries and restarts cannot create duplicates. Concurrent
machine writes are serialized. Use separate references for separate databases.

```json
{
  "name": "Plesk database",
  "params": {
    "driver": "postgres",
    "host": "postgres.internal",
    "port": 5432,
    "database": "example",
    "username": "example_user",
    "password": "supplied-through-private-request-body",
    "read_only": false
  },
  "plugin_secret_changes": {"access_token": "optional-plugin-secret"}
}
```

Use `driver: "mysql"`, port 3306 for MySQL or MariaDB. A successful PUT or GET
returns 200 with `{id, external_ref, name, driver, managed: true}`; the collection
returns an array of these objects. Parameters and credentials are never returned.
PUT does not test network connectivity; use normal managed browser connection
opening to test the configured database account.

PUT replaces non-secret settings. Omitted/null database and SSH passwords keep
the stored value; empty database passwords explicitly clear it. Omitted/empty
SSH passphrases keep the previous value. Disabling SSH removes its keychain
credentials. Connection URIs require `save_in_keychain: true`; omission keeps a
stored URI while driver and keychain storage remain unchanged; explicitly set
`connection_uri_in_keychain: false` to clear it. Omitted plugin secret keys are
preserved, null values clear them, and strings replace them. Changing driver
clears old driver-specific plugin secrets. Use `plugin_secret_changes`, not
`params.extra`, for secrets. Proxy passwords are not accepted by the existing
ConnectionParams contract. Nonempty credentials shorter than four bytes are
rejected, as required for managed event redaction.

Persistence uses existing application secret handling. DB passwords can fall
back to the protected connections file when the OS keychain is unavailable;
plugin secrets require working secret storage. Restrict the data directory to
the service account and protect its backups.

Errors use `{"error":{"code":"..."}}`: 400 `invalid_external_ref`,
`invalid_name`, `unknown_driver`, `unsupported_read_only`, `credential_too_short`
or `invalid_connection`; 401 `invalid_provisioning_token`; 403
`machine_request_required`; 404 `not_found`; 500 `provisioning_failed`.
Internal persistence/driver messages and submitted values are not echoed.
Bodies are limited to 1 MiB (413 from the HTTP body limit).
Invalid URI storage settings and plugin-secret field names return 400
`invalid_connection` before persistence; secret-store and filesystem failures
remain 500. Streamed/chunked bodies also preserve the 413 status.

## Runtime lifecycle

Updates and deletes invalidate saved-connection and credential caches, close
connection pools, release tab sessions, remove active ownership, and invalidate
plugin metadata. Deleted IDs cannot be resolved for new operations. Operations
already admitted before the write may finish; deletion is not a database-side
query kill or a transaction rollback guarantee. For urgent revocation, revoke
the database account too. Old and new secrets remain in the event redactor until
restart, protecting delayed events after rotation. No process restart is needed
for normal CRUD. Machine writes persist the managed marker atomically with the
connection and use the shared application secret/persistence services.

Connection commands and machine operations currently share one lifecycle lock,
including saved-connection opening. A slow database/tunnel handshake can delay
other connection commands and provisioning until it finishes or is cancelled.
This deliberately keeps opening with stored credentials ordered with rotation
and deletion: releasing the lock around network work alone would allow stale
opening side effects after revocation. Per-connection lifecycle coordination is
a separate optimization; callers should use bounded connection/request timeouts.

## Linux lab build

From the top of the PR stack, run `pnpm install --frozen-lockfile`, `pnpm build`,
then `cargo build --manifest-path src-tauri/Cargo.toml --no-default-features`.
Run `src-tauri/target/debug/tabularis web --web-root packages/web-ui/dist` with the
flags and protected environment above. Install/register any required external
driver before provisioning it. The built-in `mysql` and `postgres` drivers work
without an external plugin. The runtime base-path PR documents how the gateway
strips `/workspaces/<opaque-id>/` while preserving public Host and Origin.

### Reproduce database integration tests

```sh
docker run -d --name tabularis-core-provision-pg -e POSTGRES_PASSWORD=lab-provision-secret -e POSTGRES_DB=example -p 127.0.0.1:25432:5432 postgres:16-alpine
docker run -d --name tabularis-core-provision-mysql -e MARIADB_ROOT_PASSWORD=lab-provision-secret -e MARIADB_DATABASE=example -p 127.0.0.1:23306:3306 mariadb:10.11
# Once both databases are ready:
TABULARIS_PROVISIONING_LIVE_TEST=1 cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --lib provisioning
# Cleanup only these disposable containers:
docker rm -f tabularis-core-provision-pg tabularis-core-provision-mysql
```

The lab disables database TLS on loopback; production deployments should use
TLS appropriate to their network. The test opens each saved connection through
the application service and verifies a deleted connection can no longer open.
