# SQLx SQLite 0.8.6: newer bundled SQLite

This is the `sqlx-sqlite` 0.8.6 crates.io source, retaining its MIT/Apache-2.0
licenses. The source under `src/` is unchanged. The application's Cargo patch
replaces only this crate; the SQLx API and other database drivers remain on 0.8.6.

Local change relative to the published crate:

- `Cargo.toml`: the `libsqlite3-sys` requirement is widened from `0.30.1`
  (`^0.30.1`) to `>=0.30.1, <0.36.0`. Features are unchanged, so the `sqlite`
  feature still compiles SQLite into the binary (`libsqlite3-sys/bundled`).

`Cargo.lock` pins `libsqlite3-sys` 0.35.0, which bundles SQLite 3.50.2. Upstream
0.8.6 only allows 0.30.x, which bundles SQLite 3.46.0. That version lacks the
`if()` spelling and the two-argument form of `iif()` (added in SQLite 3.48.0),
and `iif()`/`if()` with more than three arguments (added in 3.49.0), so queries
such as `SELECT if(1, 1, 0, 1, 0)` fail with `no such function: if` (#1567).
See [SQLite's core function documentation](https://sqlite.org/lang_corefunc.html#iif).

SQLx itself uses the same range: `sqlx-sqlite` 0.9.0-alpha.1 accepts
`>=0.30.0, <0.36.0` and 0.9.0 accepts `>=0.30.1, <0.38.0`.

Regression coverage is in `src/drivers/sqlite/tests.rs`
(`bundled_sqlite_is_at_least_3_49`, `if_function_accepts_multiple_branches`).

Remove this patch when SQLx is upgraded to a release whose `libsqlite3-sys`
range includes the pinned version (0.9.0 already does) and those tests pass.
