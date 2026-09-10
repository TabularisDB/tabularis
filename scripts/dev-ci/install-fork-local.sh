#!/usr/bin/env bash
# Copy the template into .github/workflows/ (gitignored; force-add on the fork).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

SRC="scripts/dev-ci/windows-x64.yml"
DEST=".github/workflows/dev-windows-x64.yml"

if [[ ! -f "$SRC" ]]; then
  echo "error: missing template $SRC" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST")"
cp "$SRC" "$DEST"
echo "Wrote $DEST (gitignored — force-add on your fork):"
echo "  git add -f $DEST"
echo "  git commit -m \"chore: enable fork-local Windows CI\""
echo "  git push <your-fork> HEAD"
