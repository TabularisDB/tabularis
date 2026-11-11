# Hosting the Web UI under a custom path

The frontend can be built for an absolute mount path such as `/tabularis/` or
`/tools/database/`. The default remains `/`. This is a **build-time** setting:
changing it requires rebuilding the frontend, not just restarting the server.

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

This frontend setting does not add a backend mount-path option. In particular,
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

The backend still emits root-relative login actions and redirects. Apache can
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
