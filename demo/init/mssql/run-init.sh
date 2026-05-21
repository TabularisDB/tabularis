#!/bin/bash
# Wait for SQL Server, then run all *.sql files in /init in alphabetical order.
# Idempotent: scripts use IF NOT EXISTS / IF NOT EXISTS-style guards.

set -e

SQLCMD=/opt/mssql-tools/bin/sqlcmd
HOST="${MSSQL_HOST:-mssql}"
USER="${MSSQL_USER:-sa}"
PASS="${MSSQL_PASSWORD}"

if [[ -z "$PASS" ]]; then
    echo "ERROR: MSSQL_PASSWORD is not set" >&2
    exit 1
fi

echo "Waiting for SQL Server at ${HOST}..."
for i in {1..60}; do
    if "$SQLCMD" -S "$HOST" -U "$USER" -P "$PASS" -l 5 -Q "SELECT 1" >/dev/null 2>&1; then
        echo "SQL Server is ready."
        break
    fi
    echo "  ...not ready yet (${i}/60)"
    sleep 2
done

if ! "$SQLCMD" -S "$HOST" -U "$USER" -P "$PASS" -l 5 -Q "SELECT 1" >/dev/null 2>&1; then
    echo "ERROR: SQL Server did not become ready in time" >&2
    exit 1
fi

shopt -s nullglob
for f in /init/*.sql; do
    echo "Running ${f}"
    "$SQLCMD" -S "$HOST" -U "$USER" -P "$PASS" -b -i "$f"
done

echo "SQL Server init complete."
