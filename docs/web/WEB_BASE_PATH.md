# Hosting the Web UI under a custom path

The default frontend supports a runtime public path through `--base-path`; see
[Runtime public path](#runtime-public-path-single-frontend-build) below. The default
remains `/`. The older **build-time** `TABULARIS_BASE_PATH` option remains supported
for existing deployments, as described in this first section.

```bash
TABULARIS_BASE_PATH=/tools/database/ pnpm build
```

For a complete custom Docker image:

```bash
docker build -f docker/Dockerfile \
  --build-arg TABULARIS_BASE_PATH=/tools/database/ \
  -t tabularis:custom-path .
```

The router, static assets, HTTP API, WebSocket events, transfers, connection icons
and secondary browser windows use the same prefix. Paths must start with `/`;
origins, query strings, fragments, dot segments and empty segments are rejected.
A trailing slash is optional in the setting and is normalized during the build.

## Reverse proxy contract

The Rust server continues to serve its routes at `/`. Configure the reverse proxy
to strip the external prefix, preserve the public `Host`, forward WebSocket
upgrades and scope session cookies to the external path. Keep
`TABULARIS_PUBLIC_URL=https://db.example.com` as an **origin without a path**.

Use `TABULARIS_AUTH=proxy` with authentication at the reverse proxy. Set
`X-Tabularis-User` and `X-Tabularis-Proxy-Secret` after authenticating the user,
replacing any client-supplied values. Keep the upstream port bound to loopback.
See [remote access security](WEB_REMOTE_SECURITY.md) for the complete boundary.

For example, inside an Apache HTTPS virtual host with `mod_proxy_http`,
`mod_headers`, `mod_rewrite` and `mod_auth_basic` enabled:

```apache
ProxyPreserveHost On
RewriteEngine On
RewriteRule ^/?tools/database$ /tools/database/ [R=308,L]

<Location /tools/database/>
    AuthType Basic
    AuthName "Tabularis"
    AuthUserFile /etc/apache2/tabularis.htpasswd
    Require valid-user
    RequestHeader set X-Tabularis-User "expr=%{REMOTE_USER}"
    # Keep this directive in a root-readable configuration file.
    RequestHeader set X-Tabularis-Proxy-Secret "replace-with-the-server-proxy-secret"
</Location>

ProxyPass /tools/database/ http://127.0.0.1:8080/ upgrade=websocket
ProxyPassReverse /tools/database/ http://127.0.0.1:8080/
ProxyPassReverseCookiePath / /tools/database/
```

Put these proxy rules **before** a catch-all proxy rule. If the virtual host
redirects unrelated root paths to another application, exclude the custom mount
path from that redirect too. Canonicalize the mount URL with a trailing slash so
relative asset resolution and direct navigation agree.

On older servers without `--base-path`, this frontend setting does not add a
backend mount-path option. In particular,
the backend's built-in password login page still emits root-relative form actions
and redirects; password-mode subpath deployments therefore require additional
proxy adaptation (see below) or backend support. The example above uses proxy
authentication and does not rewrite HTML or JavaScript responses. Desktop builds
should keep the default `/`.

## Using the built-in password page with Apache

The built-in page asks for the server password, without a username. To use it
instead of Apache Basic authentication, set `TABULARIS_AUTH=password` and supply
`TABULARIS_WEB_PASSWORD` through a protected environment/secret file. Keep the
public URL as an origin without a path.

Older servers without `--base-path` emit root-relative login actions and redirects. Apache can
adapt these at the proxy boundary while the frontend uses its build-time prefix.
Replace the proxy-authentication `<Location>` block above with the following;
keep the `ProxyPass` and `ProxyPassReverse` rules that strip the prefix:

```apache
<Location /tools/database/>
    RequestHeader unset X-Tabularis-User
    RequestHeader unset X-Tabularis-Proxy-Secret
    RequestHeader unset Authorization
    ProxyPassReverseCookiePath / /tools/database/
    Header edit Location "^/(?!tools/database(?:/|$))(.*)$" "/tools/database/$1"
</Location>
<LocationMatch "^/tools/database/(?:login|api/v1/auth/login)$">
    RequestHeader unset Accept-Encoding
    SetEnv filter-errordocs 1
    AddOutputFilterByType SUBSTITUTE text/html
    Substitute "s|/api/v1/auth/login|/tools/database/api/v1/auth/login|n"
</LocationMatch>
```

This additionally requires `mod_substitute`, `mod_filter` and `mod_env`.
The body filter is restricted to the two server-rendered login endpoints and
changes only the form action; it does not rewrite the app bundle or the inline
stylesheet protected by the login page's CSP hash. `filter-errordocs` is necessary
for invalid-password and rate-limit responses too: by default, Apache's smart
filters only run on HTTP 200 responses. See [Apache's response-status filtering
documentation](https://httpd.apache.org/docs/2.4/mod/mod_filter.html#filtering).

Keep the native origin and CSRF checks enabled. Configure
`TABULARIS_TRUSTED_PROXIES` with the actual proxy source address and forward client
addresses so password rate limiting distinguishes clients. Never trust arbitrary
client networks. Verify successful login, an invalid password followed by a valid
retry, return links, expired sessions, cookie path and WebSocket reconnection.

## Runtime public path (single frontend build)

A frontend built with the default `TABULARIS_BASE_PATH=/` now supports startup
configuration without rebuilding:

```sh
tabularis web --no-open --auth password \
  --public-url https://db.example.com --allowed-origin https://db.example.com \
  --base-path /workspaces/customer-a/ --web-root /opt/tabularis/web-ui
```

Configure `TABULARIS_WEB_PASSWORD` in protected service configuration. For proxy
authentication, use the existing `--auth proxy` contract instead. The base path
is not an origin: keep `--public-url` and allowed origins path-free. Startup
normalizes a missing trailing slash and rejects origins, empty/dot segments,
backslashes, percent encodings, query strings, fragments and non-ASCII paths.
No request header, query parameter or forwarded prefix can override it.

The backend still serves at `/`; the gateway **must strip the public prefix**
and preserve public Host and Origin, including WebSocket upgrades. Canonicalize
`/workspaces/customer-a` to `/workspaces/customer-a/` at the gateway. The backend
now scopes session and logout cookies, login form actions, error-page retries,
bootstrap/password redirects, SPA assets and router URLs to the configured path.
Remove the old `Location` rewriting, login HTML substitution and cookie-path
rewriting rules above when switching to `--base-path`; applying them twice would
produce incorrect paths. For Apache, retain `ProxyPreserveHost On` and:

```apache
ProxyPass /workspaces/customer-a/ http://127.0.0.1:8080/ upgrade=websocket
ProxyPassReverse /workspaces/customer-a/ http://127.0.0.1:8080/
```

An operator can reuse the exact same `dist` directory for `/`, `/workspaces/a/`
and `/workspaces/b/`. The server injects a trusted base/meta tag into the SPA
shell; executable bundles remain unchanged. HTTP RPC, WebSockets, file and blob
transfers, plugin assets, sandbox tickets/guest frames, connection icons and
secondary windows use that same runtime base. Shells and login responses are
`no-store`, preventing one workspace's base configuration from being cached for
another. Desktop retains its existing hash-router behavior and default `/`.

### Build-time compatibility and upgrade

`TABULARIS_BASE_PATH` remains supported. A newly built legacy-prefixed artifact
records its build prefix; omitting `--base-path` uses it automatically, and an
explicit different runtime prefix fails at startup. A default-root build can
use any valid runtime prefix. Old artifacts without the build marker retain
existing default behavior but cannot opt into a non-root runtime path; rebuild
once with this version before enabling the option. Do not mix server and
frontend versions when rolling out runtime prefix support.

### Automated production-artifact check

```sh
# Start the disposable PostgreSQL/MariaDB containers from WEB_PROVISIONING.md first.
pnpm build
cargo build --manifest-path src-tauri/Cargo.toml --no-default-features
pnpm exec playwright install chromium
TABULARIS_TEST_BINARY="$PWD/src-tauri/target/debug/tabularis" node scripts/web/test-runtime-base-path.mjs
```

This test uses temporary isolated data directories and an actual prefix-stripping
HTTP/WebSocket proxy. It runs the same production assets at three prefixes and
provisions real PostgreSQL/MariaDB connections and checks password retry, valid
editor links/refresh, asset requests, API sessions,
WebSockets, blob upload/download, plugin sandbox guest access and cookie scope.
