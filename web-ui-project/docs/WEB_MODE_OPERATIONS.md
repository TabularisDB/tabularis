# Tabularis Web operator guide

This guide covers day-to-day use and operation of the browser UI started by `tabularis web`. Running `tabularis` without the `web` subcommand still starts the desktop application.

## CLI options

Start an interactive loopback server with the secure defaults:

```bash
tabularis web
# Tabularis Web is available at http://127.0.0.1:8080
```

The Web-specific options are:

| Option | Purpose and constraints |
|---|---|
| `web` | Start the HTTP and WebSocket server without creating a desktop window. It conflicts with `--mcp` and `--explain`. |
| `--host` | Bind address. The default is `127.0.0.1`. A non-loopback address is rejected unless remote authentication is fully configured. |
| `--port` | Bind port. The default is `8080`; there is no automatic port fallback, so choose another port if it is occupied. |
| `--no-open` | Do not launch a browser. Use this for services, remote deployments, and liveness-only automation. For an interactive local session, let Tabularis open the one-time bootstrap URL. |
| `--web-root` | Development or test override for a directory containing a built `index.html`. Packaged installations locate their matching Web UI resources automatically. |
| `--auth` | Remote authentication mode: `password` or `proxy`. It requires `--public-url` and at least one `--allowed-origin`. |
| `--public-url` | Public HTTPS origin seen by browsers, for example `https://tabularis.example.com`. It must not contain a path, query, fragment, or credentials. |
| `--allowed-origin` | Allowed HTTPS browser origin. Repeat the option for additional origins; the public URL must be included. |
| `--allow-high-risk` | Give remote sessions `local-admin` authority. Without it, remote sessions are restricted to database operations. Do not enable it for shared deployments. |

`--debug` enables additional logging, including SQLx query logging, in desktop and Web modes. Treat debug output as sensitive and disable it after diagnosis. Use `tabularis --help` for the complete process-mode CLI.

Development example:

```bash
pnpm --filter @tabularis/web-ui build
tabularis web --port 8081 --web-root packages/web-ui/dist
```

`--web-root` must point to assets from the same source revision as the server. Do not combine a server binary and UI bundle from different releases.

## Local security behavior

Local mode is authenticated even though it listens only on loopback:

1. Tabularis binds to `127.0.0.1` by default and refuses a non-loopback bind without remote authentication.
2. Startup creates a high-entropy, single-use bootstrap token that expires after 60 seconds.
3. The default browser opens the bootstrap URL. The server exchanges the token for an opaque eight-hour `HttpOnly`, `SameSite=Strict` session cookie and removes the token from normal navigation.
4. The server validates the request `Host` and `Origin`. State-changing requests also require the session CSRF token.
5. Bootstrap tokens, session credentials, request bodies, SQL text, and result payloads are not written to Web audit records. `/healthz` reports liveness only.

The local cookie is sent over loopback HTTP and is not marked `Secure`; remote cookies are always `Secure` because their public origin must be HTTPS. Closing a browser tab does not stop the server. Stop the foreground process with `Ctrl+C`, or stop its service unit. Sessions, active jobs, pools, tunnels, and temporary transfer state are cleaned up on logout, expiry, disconnect where applicable, or process shutdown.

`--no-open` intentionally does not print the secret bootstrap URL. It is therefore unsuitable for creating a new interactive loopback session by hand. If browser launch fails, configure a working system browser opener and restart `tabularis web` to obtain a fresh one-time bootstrap.

## Remote deployment and reverse proxy

Tabularis does not terminate TLS. A remote deployment must place the plain-HTTP listener behind a trusted TLS reverse proxy, prevent clients from reaching the listener directly, preserve the public `Host`, and proxy WebSocket upgrades.

Choose one authentication mode:

- Password mode reads a password of at least 12 characters from `TABULARIS_WEB_PASSWORD`.
- Trusted-proxy mode reads a shared secret of at least 32 characters from `TABULARIS_WEB_PROXY_SECRET`. After authenticating the user, the proxy must replace the `X-Tabularis-User` and `X-Tabularis-Proxy-Secret` headers.

Minimal password-mode service command:

```bash
export TABULARIS_WEB_PASSWORD='replace-with-a-long-unique-password'

tabularis web \
  --host 127.0.0.1 \
  --port 8080 \
  --no-open \
  --auth password \
  --public-url https://tabularis.example.com \
  --allowed-origin https://tabularis.example.com
```

Minimal trusted-proxy command:

```bash
export TABULARIS_WEB_PROXY_SECRET="$(openssl rand -base64 48)"

tabularis web \
  --host 127.0.0.1 \
  --port 8080 \
  --no-open \
  --auth proxy \
  --public-url https://tabularis.example.com \
  --allowed-origin https://tabularis.example.com
```

Remote login attempts are rate-limited. Remote sessions receive database-only authorization by default; SSH, Kubernetes, AI secrets and approvals, imports and exports, backups and dumps, plugin lifecycle, host logs and tasks, global settings, and other local-administrator operations remain denied unless `--allow-high-risk` is explicitly accepted. MCP host operations remain unavailable remotely even with that opt-in.

See [Remote Web UI security and reverse-proxy deployment](./WEB_REMOTE_SECURITY.md) for Nginx, systemd, container, firewall, origin, audit, rate-limit, and verification examples. That guide is the normative remote threat model.

## Data, configuration, and credential locations

Desktop and Web modes use the same runtime paths. The process account and its home/XDG environment determine the locations:

| Platform | Configuration directory | Data directory |
|---|---|---|
| Linux | `${XDG_CONFIG_HOME:-~/.config}/tabularis`, normally `~/.config/tabularis` | `${XDG_DATA_HOME:-~/.local/share}/tabularis`, normally `~/.local/share/tabularis` |
| macOS | `~/Library/Application Support/tabularis` | `~/Library/Application Support/tabularis` |
| Windows | `%APPDATA%\tabularis` | `%APPDATA%\tabularis` |

Important configuration content includes:

- `config.json`: settings, UI preferences, registry configuration, and non-secret backup settings;
- `connections.json`: connection metadata; debug builds may prefer an existing `connections.dev.json`;
- `ssh_connections.json` and `k8s_connections.json`: tunnel profile metadata;
- `notebooks/`, `saved_queries/`, `query_history/`, and `themes/`: user-created content;
- `ai_activity.jsonl` and rotated files: AI and MCP activity records when enabled.

Important data content includes `plugins/`, `connection-icons/`, and session-owned Web transfer/job directories. `web-file-transfers/`, `web-uploads/`, and export/import job directories are temporary operational state, not durable backup inputs.

Passwords, connection URIs, SSH passphrases, AI provider keys, backup encryption passwords, and backup-target credentials are stored under the `tabularis` service in the OS credential store. They are not recoverable by copying `config.json` or `connections.json`, and the browser never receives raw stored credentials. A headless service must run as the same dedicated account on every start and must have a functioning keyring backend. Container keyring integration is deployment-specific.

For backup or migration:

1. Stop Tabularis so the configuration and data trees are consistent.
2. Back up both directories with owner-only permissions.
3. Handle OS credential-store migration separately, or use Tabularis encrypted connection export and backup workflows.
4. Restore to the same service account and verify keyring access before enabling scheduled or unattended operation.

Do not edit persisted JSON while Tabularis is running. Files can contain hostnames, usernames, paths, SQL history, plugin settings, and other operationally sensitive metadata even when passwords are absent.

## Browser limitations and adaptations

The browser uses the same React UI and Rust services as desktop, but native operating-system workflows are adapted:

- File import uses authenticated, purpose-bound uploads. Export and BLOB workflows use expiring, usually single-use downloads. A browser-supplied path is never treated as a server path.
- Clipboard reads and notifications depend on browser permission and secure-context policy. Denial produces an explicit fallback rather than silently invoking a desktop API.
- Save dialogs become browser downloads. File placement and overwrite behavior are controlled by the browser.
- Secondary result, diagram, explain, task, and connection windows become routes or browser tabs. Popup blockers can prevent opening a new tab.
- External links are validated before opening and may still be blocked by browser popup policy.
- Deep-link plugin installation becomes a validated `/install-plugin` route with explicit confirmation.
- The desktop updater, native restart, window attention, title-bar controls, and native DevTools lifecycle do not apply. The Info page reports server build data and directs the user to an administrator for upgrades.
- MCP configuration is a local-host operation and is unavailable to remote browser sessions.
- A Web query page is capped at 10,000 rows and a serialized query response at 16 MiB. Paginate or export large results. Uploads and event queues also have explicit limits.
- Refreshing reconnects event subscriptions, but an abandoned in-flight request can be cancelled and cleaned up. In-memory sessions and jobs do not survive a server restart.

Use a current Chromium, Firefox, or WebKit-based browser with cookies, JavaScript, Fetch, and WebSocket enabled. For resource and recovery details, see the [Web UI performance and resilience contract](./WEB_PERFORMANCE_RESILIENCE.md). The [manual parity audit](./WEB_MANUAL_PARITY_AUDIT.md) records every intentional desktop-to-browser adaptation.

## Plugin compatibility

Database driver plugins still run as backend subprocesses over the existing JSON-RPC protocol. The browser does not load driver binaries or database credentials. Existing drivers remain compatible when their manifest and executable support the server's operating system and architecture and the service account can execute them.

Plugin installation and lifecycle run on the Tabularis server. In remote mode they require the explicit high-risk authorization policy. Install only trusted, correctly signed releases and inspect startup errors after moving an installation between platforms.

UI extensions use the same slots and `@tabularis/plugin-api` host API in desktop and Web modes. Each extension should declare the API version used to build it. Incompatible or newer declarations are skipped; legacy entries without a declaration remain supported. Extension JavaScript and locale files must be declared in the installed manifest and bundled locally rather than fetched as remote executable code.

An enabled UI extension is trusted application code running in the shared page, not a sandbox. Authenticated, allowlisted asset delivery and CSP headers constrain asset exposure but do not make evaluated third-party JavaScript safe. Read the [Plugin UI extension trust model](../../docs/security/plugin-ui-extensions.md) and the [`@tabularis/plugin-api` compatibility guide](../../packages/plugin-api/README.md) before deployment.

## Troubleshooting

### Server does not start

- **Address already in use:** choose an unused explicit port, for example `--port 8081`. Tabularis does not scan for a free port.
- **Web UI assets were not found:** reinstall the complete package. Developers must build `@tabularis/web-ui` or pass a valid `--web-root` containing `index.html`.
- **Non-loopback bind rejected:** configure `--auth`, `--public-url`, and `--allowed-origin`; do not bypass the remote security boundary.
- **Password or proxy secret rejected:** set the required environment variable in the service account's environment and satisfy the minimum length. Do not pass secrets on the command line.

### Browser cannot establish or keep a session

- **Local 401 after launch:** the bootstrap token is expired or was already consumed. Restart the process and let it open a fresh URL; do not bookmark bootstrap URLs.
- **Remote 401:** verify the password or that the trusted proxy replaces both required identity headers.
- **HTTP 403:** check the public `Host`, exact HTTPS origin allowlist, proxy header handling, CSRF/session state, and the command's authorization level.
- **HTTP 429:** the process-wide remote login lockout is active after repeated failures. Wait for the five-minute lockout and correct the credentials before retrying.
- **WebSocket disconnects or missing progress:** enable HTTP/1.1 WebSocket upgrades and suitable idle timeouts on the reverse proxy. Confirm the public origin and session cookie are preserved.
- **Browser did not open locally:** `--no-open` suppresses bootstrap launch. Otherwise configure the OS default-browser opener and restart the process.

### Features fail after login

- **Saved credentials are missing:** verify that the process uses the expected home directory and service account and can unlock the OS credential store. Copying configuration files does not copy secrets.
- **Import, export, dump, or BLOB transfer expired:** retry from the UI. Transfer tokens are session-owned, purpose-bound, size-limited, and short-lived; downloads can be single-use.
- **Large query fails or truncates:** paginate below the row and response-size limits, select fewer columns, or use a streamed export.
- **Plugin will not start:** check server OS/architecture compatibility, executable permissions and interpreter settings, the installed manifest, plugin startup errors, and server logs.
- **Clipboard, notification, new tab, or external link is blocked:** grant the relevant browser permission or allow the popup. The UI reports unsupported or denied capabilities.
- **Remote command receives 403:** the database-only policy is working. Reassess the threat model before restarting with `--allow-high-risk`; MCP remains remote-disabled.

`/healthz` is suitable for process liveness but does not prove authentication, database connectivity, plugin health, or WebSocket operation. Runtime and Web audit logs are written to stderr and retained in a bounded in-memory UI buffer; under systemd, inspect the service journal. Web audit entries use the `tabularis::web_audit` target and omit secrets, SQL text, request bodies, and result payloads.

## Upgrade and rollback

The browser cannot replace or restart its server. Upgrade with the same package manager, release artifact, container image, or service deployment method that installed Tabularis:

1. Record the current server/build information and launch configuration.
2. Back up the configuration and data directories and account for the separate OS credential store.
3. Stop the Web process, install the complete target release, and restart it with the same account, environment, paths, and arguments.
4. Verify the reported server build, authentication, one connection, a read-only query, WebSocket progress, and any required plugins before restoring access.

The server ships its matching browser assets; never deploy only a new UI bundle. If verification fails, stop the service, restore the previous complete installation and deployment files, restore data only when required by the release notes, and restart with the original configuration. Preserve failed-version logs for diagnosis.

See [Upgrading a Tabularis Web server](./WEB_MODE_UPGRADES.md) for the release checklist, rollback sequence, and build identifier behavior. Release-specific migration or rollback constraints take precedence over this general guide.
