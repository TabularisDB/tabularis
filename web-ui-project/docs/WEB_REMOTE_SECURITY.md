# Remote Web UI security and reverse-proxy deployment

Remote Tabularis Web access exposes database administration, credentials, tunnels, plugins, AI providers, imports, exports, and host operations. It is therefore disabled unless an authentication mode, a public HTTPS origin, and an explicit origin allowlist are configured.

## Supported deployment boundary

Tabularis currently serves plain HTTP. Remote deployments must terminate TLS at a trusted reverse proxy and keep the Tabularis listener unreachable from untrusted networks. Direct TLS termination in the Tabularis process is not supported.

Use a dedicated service account, restrict the data directory, and place firewall rules between clients and the Tabularis listener. The reverse proxy must preserve the public `Host` header and must support WebSocket upgrades.

## Password mode

Set the password through the process environment rather than the command line so it is not exposed in process listings:

```bash
export TABULARIS_WEB_PASSWORD='replace-with-a-long-unique-password'

tabularis --web \
  --host 127.0.0.1 \
  --port 8080 \
  --no-open \
  --auth password \
  --public-url https://tabularis.example.com \
  --allowed-origin https://tabularis.example.com
```

Passwords must contain at least 12 characters. The server provides a minimal, same-origin `/login` form, stores only a SHA-256 verifier in runtime memory, and exchanges valid credentials for an `HttpOnly`, `SameSite=Strict`, `Secure` session cookie. Five failed attempts within one minute trigger a five-minute process-wide login lockout.

## Authenticated reverse-proxy mode

Proxy mode trusts an authenticated identity only when the proxy also supplies a deployment secret. Generate a random secret of at least 32 characters and provide the same value to Tabularis and the proxy:

```bash
export TABULARIS_WEB_PROXY_SECRET="$(openssl rand -base64 48)"

tabularis --web \
  --host 127.0.0.1 \
  --port 8080 \
  --no-open \
  --auth proxy \
  --public-url https://tabularis.example.com \
  --allowed-origin https://tabularis.example.com
```

After authenticating the user, the proxy must replace—not append—the following request headers:

- `X-Tabularis-User`: the authenticated, non-empty user identifier;
- `X-Tabularis-Proxy-Secret`: the shared deployment secret.

Tabularis removes both headers before dispatching application requests. Missing or invalid proxy credentials are rejected and failed secret checks use the same rate limiter as password logins.

Example Nginx location after the deployment's own `auth_request`, OIDC, or basic-auth configuration:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;

    proxy_set_header Host $http_host;
    proxy_set_header X-Tabularis-User $remote_user;
    proxy_set_header X-Tabularis-Proxy-Secret "replace-with-the-environment-secret";

    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

Store the proxy secret in the reverse proxy's protected secret store rather than directly in a world-readable configuration file. Never expose the upstream listener directly: a client that can bypass the trusted proxy can submit proxy headers itself.

## Origin and cookie policy

`--public-url` and every repeated `--allowed-origin` value must be an HTTPS origin with no path, query, fragment, or embedded credentials. The public URL must also appear in the allowlist. Requests with an unexpected `Host` or `Origin` are rejected. State-changing requests additionally require the session's CSRF token.

Examples with an additional explicitly trusted administration origin:

```bash
--public-url https://tabularis.example.com \
--allowed-origin https://tabularis.example.com \
--allowed-origin https://admin.example.com
```

Only add origins that are controlled by the same deployment owner. Browser session cookies are always marked `Secure` in remote mode.

## High-risk capability policy

Remote sessions are restricted to the `database` authorization level by default. This permits core connection, metadata, query, data-editing, and notebook workflows while denying commands classified as `sensitive` or `local-admin`. Denied operations return HTTP 403 with the shared RPC error envelope.

The following groups require an explicit high-risk opt-in because they can disclose secrets, modify the host, start tunnels or subprocesses, install code, or alter server-wide state:

- SSH and Kubernetes tunnel lifecycle and askpass responses;
- AI provider keys, generation, approvals, and activity exports;
- connection credential import/export, backups, dumps, and sensitive file operations;
- plugin registry, installation, lifecycle, and process control;
- logs, process/task management, global configuration, and host filesystem actions;
- MCP host configuration, which remains disabled for all remote sessions.

A trusted single-administrator deployment may grant the complete `local-admin` policy explicitly:

```bash
--allow-high-risk
```

The negotiated session contract reports `remote`, `authorizationLevel`, and `highRiskCapabilities`. Do not enable high-risk capabilities for shared or weakly authenticated deployments.

## Audit events and secret handling

Security events are emitted through the existing logger with target `tabularis::web_audit`. Authentication success, denial, rate limiting, CSRF or host rejection, RPC completion, and logout events include a request ID and, when a session exists, an opaque session ID. RPC audit records include command names and response status only. They never include passwords, proxy secrets, bootstrap tokens, request bodies, SQL text, or result payloads.

Protect and retain logs according to the deployment's incident-response policy. Debug logging does not relax audit redaction.

## Threat model

| Threat | Security objective | Control | Residual deployment responsibility |
|---|---|---|---|
| Accidental LAN or internet exposure | Remote binding is intentional | Non-loopback binds fail without configured remote authentication | Firewall the upstream listener |
| Credential theft in transit | Credentials and cookies remain confidential | HTTPS public origins and `Secure` cookies | Configure valid TLS and secure proxy-to-client ciphers |
| Password guessing | Bound online attempts | Five-failure window and timed lockout | Use a unique password and monitor audit events |
| Proxy-header spoofing | Only the trusted proxy can assert identity | Shared proxy secret and stripped headers | Prevent direct access and protect the proxy secret |
| Cross-site request forgery | State changes originate from an allowed UI | Strict SameSite cookie, explicit origins, CSRF token | Keep the allowlist minimal |
| DNS rebinding or Host confusion | Requests reach only configured virtual hosts | Explicit host allowlist | Preserve the original public Host header |
| Session theft | Limit credential exposure and lifetime | Opaque eight-hour in-memory sessions, HttpOnly cookies, logout invalidation | Protect administrator browsers and TLS endpoints |
| Excessive authenticated authority | Compromise has a bounded blast radius | Database-only default and explicit high-risk opt-in | Do not enable `--allow-high-risk` unnecessarily |
| Secret or SQL leakage through logs | Audit data is safe to retain | Structured identifiers and command/status metadata only | Restrict log access and retention |
| Malicious plugin or imported file | Untrusted content cannot silently gain host authority | Existing plugin trust, CSP, opaque upload/download tokens, authorization levels | Install only trusted plugins and validate backups/imports |
| Denial of service | Authentication and request resources are bounded | Login lockout, body limits, event queues, session expiry | Add proxy connection and request-rate limits |

## Verification checklist

1. Confirm the upstream port is unreachable from a client network.
2. Confirm HTTP redirects to HTTPS at the proxy and the browser receives a `Secure` session cookie.
3. Confirm an unlisted `Origin` and incorrect `Host` receive HTTP 403.
4. Confirm invalid credentials eventually receive HTTP 429.
5. Confirm a default remote session receives HTTP 403 for a local-administrator RPC.
6. Confirm WebSocket events reconnect through the proxy.
7. Confirm audit logs contain request and opaque session IDs but no configured secrets or SQL payloads.
