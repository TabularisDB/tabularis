# PostgreSQL Driver

The built-in PostgreSQL driver has been removed from Tabularis core.

PostgreSQL connections are now handled exclusively by the standalone
[`tabularis-postgresql-plugin`](https://github.com/TabularisDB/tabularis-postgresql-plugin).

Changes to the PostgreSQL driver implementation, and the tests that cover it,
belong in that plugin repository, not here. Tabularis core still owns the
host-side integration with plugin drivers, including the force-migration of
saved `postgres` connections to `postgresql`, the host-to-plugin contract
tests (for example `src-tauri/tests/socket_integration.rs`) and the PostgreSQL
server fixtures they use.

If you are looking for the driver implementation that used to live in this
directory, see the git history
(`git log --all -- src-tauri/src/drivers/postgres/`) or the plugin repo above.
