#!/usr/bin/env bash
# Remove fork-local CI from the index/worktree so an upstream PR stays clean.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

FILES=(
  .github/workflows/dev-windows-x64.yml
)

removed=0
for f in "${FILES[@]}"; do
  if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    git rm -f "$f"
    echo "untracked from git: $f"
    removed=1
  elif [[ -e "$f" ]]; then
    rm -f "$f"
    echo "deleted local copy: $f"
    removed=1
  else
    echo "skip (missing): $f"
  fi
done

if [[ "$removed" -eq 0 ]]; then
  echo "Nothing to strip."
  exit 0
fi

echo
echo "Commit before opening the upstream PR, e.g.:"
echo "  git commit -m \"chore: drop fork-local CI before upstream PR\""
