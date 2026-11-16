# Plugin UI extension trust model

Plugin UI extensions are installed third-party JavaScript. Tabularis executes an enabled extension in the shared React page so it can reuse `@tabularis/plugin-api`, themes, translations, and all supported slots in both desktop and web modes.

## Trust boundary

- An enabled UI bundle is **trusted application code**, not sandboxed content. It runs in the Tabularis page and can use the browser capabilities available to that page plus the host API injected as `__TABULARIS_API__`.
- The Content Security Policy on the asset response protects direct navigation and embedding of the asset. It does not sandbox code after the host deliberately evaluates the installed IIFE bundle.
- Users and administrators must install UI extensions only from publishers they trust. Registry verification and release hashes establish provenance and integrity; they do not make arbitrary JavaScript safe.
- Plugin authors must bundle all extension code locally. Loading executable code from remote origins is unsupported.

## Asset exposure

Desktop and web use the same asset authorization service. It exposes only:

- JavaScript modules listed in the installed plugin manifest's `ui_extensions` array;
- locale JSON files under `locales/<language>.json`.

Paths are relative, canonicalized, size-limited, and checked against the installed plugin directory. Symlink escapes, traversal, undeclared files, and non-JavaScript UI modules are rejected.

The web endpoint is covered by the normal session, host, and origin checks. Responses use `nosniff`, same-origin resource policy, no-referrer, no-store, and a restrictive `default-src 'none'` CSP.

## API compatibility

Each new UI extension entry declares the `@tabularis/plugin-api` version used to build it:

```json
{
  "slot": "data-grid.toolbar.actions",
  "module": "ui/dist/index.js",
  "api_version": "0.1.1"
}
```

The host skips malformed, newer, or incompatible declarations before evaluating their bundle. During the unstable `0.x` line, minor versions are compatibility boundaries and patch versions are backward-compatible. Entries without `api_version` remain supported for legacy plugins.
