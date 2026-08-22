# ADR-0004: Make local authenticated access the secure default

- **Status:** Accepted
- **Date:** 2026-08-21

## Context

Tabularis can administer databases, credentials, tunnels, plugins, files, AI providers, and local processes. Starting a web server therefore creates a security boundary even when the intended user is local. Binding broadly or relying only on network location could expose privileged operations unexpectedly.

## Decision

`tabularis web` binds to `127.0.0.1` by default and still requires an authenticated browser session. Startup generates high-entropy ephemeral credentials and opens a URL containing a single-use, short-lived bootstrap token. The server exchanges it for an `HttpOnly`, `SameSite=Strict` session cookie and removes the token from subsequent URLs.

The local server rejects unexpected origins and hosts, redacts credentials and bootstrap URLs from logs, and exposes no sensitive data from its liveness endpoint. Session and request IDs may be logged, but secrets and full SQL result payloads may not.

Non-loopback binding is a separate remote mode. It requires an explicit host option, configured authentication, explicit allowed origins, and TLS either directly or through a documented trusted reverse proxy. Authorization scopes, rate limiting, secure cookies, and auditing are required before remote mode is released.

## Consequences

- Local web mode is not an unauthenticated administration endpoint.
- Copying an ordinary post-bootstrap URL does not transfer the bootstrap secret.
- Session lifecycle, CSRF defenses, origin checks, token expiry, and log redaction require security tests.
- Remote mode is deferred until local parity and its additional controls are complete.

## Rejected alternatives

### Bind to all interfaces by default

Rejected because it can expose database administration to the local network without informed consent.

### Trust loopback without authentication

Rejected because local malware, malicious pages, DNS rebinding, shared machines, and browser-origin attacks can still target local services.

### Keep a bearer token in the URL

Rejected because URLs leak through history, screenshots, referrers, logs, and copy-and-paste. Only a short-lived single-use bootstrap token may appear in the initial URL.

### Store the session token in browser storage

Rejected because JavaScript-readable storage increases the impact of script injection. An `HttpOnly` cookie is the default session credential.

### Ship remote mode with local mode

Rejected because remote exposure requires a broader authorization, TLS, deployment, and audit design that should not delay or weaken the local architecture proof.
