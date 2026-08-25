# Web UI automated E2E matrix

WEB-100 runs the built browser application against the real headless Rust server. The suite captures the one-time local bootstrap URL through a fake browser opener, exchanges it for the production HttpOnly session cookie, and uses the same authenticated HTTP RPC and plugin asset paths as the UI.

## Required matrix

| Fixture | Browser workflow | Chromium | Firefox | WebKit |
|---|---|---:|---:|---:|
| SQLite | Save and test a real file connection, identify the engine, create/write/read a table | Required | Required | Required |
| PostgreSQL 16 | Save and test a real TCP connection, identify the database, create/write/read a table | Required | Required | Required |
| MySQL 8.4 | Save and test a real TCP connection, identify the database, create/write/read a table | Required | Required | Required |
| External driver plugin | Start a JSON-RPC subprocess, register its manifest, test its connection, execute a query | Required | Required | Required |
| UI extension plugin | Serve an authenticated allowlisted bundle and render its sidebar slot contribution | Required | Required | Required |

The workflows in this matrix do not depend on browser-specific clipboard, notification, or filesystem permission APIs, so all three engines run equivalent assertions. Chromium is the focused local and pull-request entry point; the CI parity gate runs all projects.

SSH and Kubernetes tunnel fixtures remain optional because they require deployment-specific credentials and infrastructure. Their tunnel services and event paths retain focused Rust and frontend coverage; they are not silently simulated in this real-database gate.

## Commands

Run the required local Chromium gate. The script starts isolated PostgreSQL and MySQL containers, builds the shared UI and Rust binary, and removes the containers and volumes when done:

```bash
pnpm test:web-e2e
```

Install Playwright's browser binaries, then run the full release-browser gate:

```bash
pnpm exec playwright install chromium firefox webkit
pnpm test:web-e2e:browsers
```

CI provides database service containers and sets `TABULARIS_E2E_MANAGED_DATABASES=1`. External fixtures can use the `TABULARIS_E2E_POSTGRES_*`, `TABULARIS_E2E_MYSQL_*`, `TABULARIS_E2E_DATABASE_PASSWORD`, and `TABULARIS_E2E_SQLITE_PATH` environment variables.

## Isolation and artifacts

- Runtime configuration, connection persistence, the SQLite database, cookies, traces, screenshots, videos, and HTML reports live under ignored `web-ui-project/.runtime/e2e`.
- Fixture credentials are local disposable values and are never used outside the isolated databases.
- Driver and UI-extension fixtures are copied into the isolated application data directory before the server starts.
- The suite uses one worker so the local session, plugin process, and deterministic database rows cannot race each other.
