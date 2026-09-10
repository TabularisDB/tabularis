# Fork-local CI helpers
#
# The Windows x64 dev workflow is **not** meant for pull requests to
# `TabularisDB/tabularis`. The runnable file under `.github/workflows/` is
# gitignored; only the template under this directory is tracked.
#
# ## Enable on your fork (required for Actions to see the workflow)
#
#     bash scripts/dev-ci/install-fork-local.sh
#     git add -f .github/workflows/dev-windows-x64.yml
#     git commit -m "chore: enable fork-local Windows CI"
#     git push <your-fork> HEAD
#
# Triggers: push to `feat/**` / `fix/**`, or `workflow_dispatch`.
# Artifact name: `tabularis-dev-windows-x64` (MSI + portable exe, unsigned).
#
# ## Strip before an upstream PR
#
#     bash scripts/dev-ci/strip-fork-local.sh
#     git commit -m "chore: drop fork-local CI before upstream PR"
#
# The job also no-ops when `github.repository_owner == TabularisDB`, so an
# accidental merge upstream will not schedule builds.
#
# Note: push to `TabularisDB/tabularis` will not run this workflow (owner
# guard). Use your own fork remote for dev builds.
