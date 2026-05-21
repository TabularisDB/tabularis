# Tabularis Demo Stack

A self-contained Docker Compose stack that spins up **MySQL**, **PostgreSQL**, and
**SQL Server**, each pre-loaded with English seed data so you can explore
Tabularis features end to end.

## What's inside

| Engine        | Port  | Databases                        | Theme                        |
| ------------- | ----- | -------------------------------- | ---------------------------- |
| MySQL 8.4     | 3306  | `tabularis_demo`, `blog_demo`    | HR/e-commerce + blog CMS     |
| PostgreSQL 16 | 5432  | `tabularis_demo`, `analytics_demo` | HR/e-commerce + web analytics (JSONB) |
| SQL Server 2022 | 1433 | `tabularis_demo`, `finance_demo` | HR/e-commerce + accounting   |

`tabularis_demo` is the **same logical schema** on all three engines (departments,
employees, products, customers, orders, order_items) — useful for testing the
showcase notebook against any driver. The second database per engine highlights
features specific to that ecosystem.

## Prerequisites

- Docker Desktop or Docker Engine 24+ with the Compose plugin
- ~2 GB free disk space for the three image layers and volumes
- On Apple Silicon: Rosetta 2 enabled (SQL Server runs under `linux/amd64`)

## Quick start

```bash
cd demo
docker compose up -d
```

First boot takes ~60 seconds — the SQL Server sidecar (`tabularis-mssql-init`)
waits for the server, then runs the init scripts via `sqlcmd`. MySQL and
PostgreSQL run their init scripts automatically on first launch.

Check everything is healthy:

```bash
docker compose ps
docker compose logs -f mssql-init   # confirm SQL Server seeding succeeded
```

Tear down (preserve volumes):

```bash
docker compose down
```

Wipe all data and start fresh:

```bash
docker compose down -v
```

## Credentials

All three servers share the same password for simplicity:

| Engine     | Host        | Port  | User       | Password               |
| ---------- | ----------- | ----- | ---------- | ---------------------- |
| MySQL      | 127.0.0.1   | 3306  | `root`     | `Tabularis_Demo_2026!` |
| PostgreSQL | 127.0.0.1   | 5432  | `postgres` | `Tabularis_Demo_2026!` |
| SQL Server | 127.0.0.1   | 1433  | `sa`       | `Tabularis_Demo_2026!` |

> The password meets SQL Server's complexity requirements; do not weaken it
> without updating `docker-compose.yml` accordingly.

## Importing the connections into Tabularis

Open Tabularis → **Connections** → **Import** and pick `connections.json`.

This adds a **Tabularis Demo (Docker)** group with two pre-configured
connections:

- **Demo · MySQL** — exposes `tabularis_demo` and `blog_demo`
- **Demo · PostgreSQL** — exposes `tabularis_demo` and `analytics_demo`

> **SQL Server is not in `connections.json`.** Tabularis core currently ships
> drivers for MySQL, PostgreSQL, and SQLite only; the official plugin registry
> does not yet include a SQL Server plugin. The MSSQL instance is still useful
> for connecting external clients (Azure Data Studio, DBeaver, `sqlcmd`) and
> for testing future plugin work.

## Running the showcase notebook

Once `Demo · MySQL` is connected and selected on `tabularis_demo`, import
`notebook-showcase.tabularis-notebook` from the Notebooks panel and press
`Cmd/Ctrl + Shift + Enter` to run all cells.

## Folder layout

```
demo/
├── docker-compose.yml
├── connections.json                # Importable into Tabularis
├── notebook-showcase.tabularis-notebook
├── init/
│   ├── mysql/
│   │   ├── 01-tabularis-demo.sql
│   │   └── 02-blog-demo.sql
│   ├── postgres/
│   │   ├── 01-tabularis-demo.sql
│   │   └── 02-analytics-demo.sql
│   └── mssql/
│       ├── run-init.sh             # Sidecar entrypoint
│       ├── 01-tabularis-demo.sql   # Idempotent
│       └── 02-finance-demo.sql     # Idempotent
└── README.md
```

## Troubleshooting

**SQL Server fails to start on Apple Silicon.** Ensure Rosetta is enabled in
Docker Desktop → Settings → General → "Use Rosetta for x86_64/amd64 emulation".
The `platform: linux/amd64` line in `docker-compose.yml` forces amd64.

**Port already in use.** Stop any local MySQL/PostgreSQL/MSSQL instance, or
edit the `ports:` mapping in `docker-compose.yml` (left side is the host port).

**Need to re-run SQL Server init.** The sidecar (`mssql-init`) only runs on
`up`. If you change the SQL scripts, run `docker compose up -d mssql-init`
again — the scripts are idempotent and safe to re-execute.

**Connection import does nothing.** Tabularis merges connections by `id`; if
you previously imported the file and want to reset, delete the existing
"Demo ·" connections in Tabularis first, then re-import.
