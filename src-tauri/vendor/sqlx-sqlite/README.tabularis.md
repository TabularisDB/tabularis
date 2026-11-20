# SQLx SQLite 0.8.6: newer bundled SQLite

This is the `sqlx-sqlite` 0.8.6 crates.io source, retaining its MIT/Apache-2.0
licenses. The source under `src/` is unchanged. The application's Cargo patch
replaces only this crate; the SQLx API and other database drivers remain on 0.8.6.

Local change relative to the published crate:

- `Cargo.toml`: the `libsqlite3-sys` requirement is widened from `0.30.1`
  (`^0.30.1`) to `>=0.39.1, <0.40.0`. Features are unchanged, so the `sqlite`
  feature still compiles SQLite into the binary (`libsqlite3-sys/bundled`).

`Cargo.lock` pins `libsqlite3-sys` 0.39.1, which bundles SQLite 3.54.1. Upstream
0.8.6 only allows 0.30.x, which bundles SQLite 3.46.0. That version lacks the
`if()` spelling and the two-argument form of `iif()` (added in SQLite 3.48.0),
and `iif()`/`if()` with more than three arguments (added in 3.49.0), so queries
such as `SELECT if(1, 1, 0, 1, 0)` fail with `no such function: if` (#1567).
See [SQLite's core function documentation](https://sqlite.org/lang_corefunc.html#iif).

SQLite 3.50.2 (`libsqlite3-sys` 0.35.0, the previous pin) still lacks the
`end of` date modifier, added in 3.54.0. `SELECT date('2026-06-15', 'end of year')`
returns NULL there and `2026-12-31` on 3.54.1 (#1599). See
[SQLite's date function documentation](https://sqlite.org/lang_datefunc.html).

SQLx's own ranges stop short of this pin: `sqlx-sqlite` 0.9.0-alpha.1 accepts
`>=0.30.0, <0.36.0` and 0.9.0 accepts `>=0.30.1, <0.38.0`. `libsqlite3-sys`
0.38.2 bundles SQLite 3.53.2, which is still too old for `end of`.

Regression coverage is in `src/drivers/sqlite/tests.rs`
(`bundled_sqlite_is_at_least_3_54`, `if_function_accepts_multiple_branches`,
`date_end_of_modifier`).

Remove this patch when SQLx is upgraded to a release whose `libsqlite3-sys`
range includes 0.39.1 and those tests pass. 0.9.0 does not.
