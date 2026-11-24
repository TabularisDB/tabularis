# PostgreSQL Driver

The built-in PostgreSQL driver has been removed from Tabularis core.

PostgreSQL connections are now handled exclusively by the standalone
[`tabularis-postgresql-plugin`](https://github.com/TabularisDB/tabularis-postgresql-plugin).

All PostgreSQL driver changes, tests, and feature work belong in that
plugin repository — not here. If you're looking for the driver
implementation that used to live in this directory, see the git history
(`git log --all -- src-tauri/src/drivers/postgres/`) or the plugin repo
above.
