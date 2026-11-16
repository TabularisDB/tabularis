#!/usr/bin/env bash
# E2E adversarial fixture seed: same-named tables with deliberately different
# shapes/data across the two databases, so cross-DB leakage is detectable.
# Run AFTER seed_postgres.sh. Only used by the e2e-macos workflow (not the
# Rust integration tests, to avoid golden-file mismatches).
set -euo pipefail

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-54320}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-password}"
export PGHOST PGPORT PGUSER PGPASSWORD

echo "==> Seeding E2E adversarial fixtures..."
psql -d testdb -f "$(dirname "$0")/postgres_seed_e2e.sql"
psql -d tabularis_test_secondary -f "$(dirname "$0")/postgres_seed_e2e_secondary.sql"

echo "==> E2E adversarial fixtures complete."
