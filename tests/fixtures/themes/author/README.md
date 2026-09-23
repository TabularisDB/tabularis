# Author-generated archive fixtures

These four archives were produced by the real bundled author CLI and the shared
VS Code converter/package exporter, using
`pnpm --filter @tabularis/create-plugin build` followed by
`pnpm --filter @tabularis/create-plugin smoke:theme`.

- `original-v1.zip`: scaffolded light/dark package, edited SQL/palette declaration.
- `original-v2.zip`: updated palette, same package and variant identities.
- `imported-v1.zip`: local invented VS Code JSONC fixture, disclosed SQL scope
  approximation, personal palette edit, shared package exporter.
- `imported-v2.zip`: another edit, same package/variant identity, new version.

The native author-journey tests consume these exact archives through structural
validation, local storage, fake-HTTP tracked installation/update and the combined
catalog. Fixtures are not releases or third-party theme redistributions. The
`0.24.0` minimum is solely for the development test binary; it is **not** an
assigned first supporting public release. Licenses/README say fixture/unlicensed.

The smoke creates a private temporary directory and removes it by default. Set
`THEME_SMOKE_PARENT` and `THEME_SMOKE_KEEP=1` to retain reproducible artifacts and
SHA-256 evidence. Generated release commands are exercised locally; no GitHub
release, public registry entry or real profile is modified. This is automated
integration evidence, not platform GUI or account/publication acceptance.
