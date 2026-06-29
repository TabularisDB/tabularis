---
name: tabularis-pr-review
description: "Use when reviewing a Tabularis pull request locally — checking code quality against the repo's own rules, verifying the PR's claims, running its tests on the correct branch, and preparing real test data plus a manual test plan for the human. Use when the user says 'review PR #N', 'lass uns PR reviewen', 'check this PR', or wants to test a PR with real data before merging."
---

# Tabularis Local PR Review

## Overview

A read-everything-then-verify review for Tabularis PRs. Goes beyond a diff skim: judges the diff against the repo's **own** `.rules/`, confirms the PR's stated claims are true, runs the PR's tests **on the PR branch**, and stages **real data** so the human can manually exercise the change. The deliverable is a review **plus** a copy-paste test plan, not just opinions.

**Core principle:** Don't trust the PR description — verify every claim against the code, then prove the behavior with real data.

## Workflow

Work top to bottom. Each step feeds the next.

### 1. Pull the PR
```bash
gh pr view <N> --json title,body,author,baseRefName,headRefName,state,additions,deletions,changedFiles,labels
gh pr diff <N> --name-only      # scope
gh pr diff <N>                  # full diff
```

### 2. Load the rules you'll judge against
Read `.rules/*.md` for every changed file's domain before forming opinions. The common offenders:
- **`react.md` #2** — `setState` called *synchronously* in `useEffect` (async-after-`await` is fine). Very common in modal/form PRs.
- **`react.md` #1** — exhaustive `useEffect`/`useMemo`/`useCallback` deps.
- **`typescript.md`** — no `any`.
- **`rust.md`** — pure helpers extracted + unit-tested; `mod.rs` stays orchestration-only; public APIs re-exported on refactor.
- **`general.md`** — English-only comments; new user-facing strings need i18n keys in `src/i18n/locales/*`.

### 3. Verify the PR's claims — don't take them on faith
For each factual assertion in the description, prove it:
- "Uses `common.search` / `common.noResults` i18n keys" → `grep '"search"\|"noResults"' src/i18n/locales/en.json`.
- "Removing `searchable={false}` enables search" → read the component default (`grep searchable src/components/ui/Select.tsx`).
- "Reads `default_port` from the manifest" → check the type (`src/types/plugins.ts`) — is it nullable? What's the fallback?
- New Tauri command → confirm it's registered in `src-tauri/src/lib.rs` `invoke_handler`.

### 4. Impact analysis (per CLAUDE.md)
For each non-trivial symbol the PR touches, run `gitnexus_impact({target, direction: "upstream"})` and note blast radius / risk. Flag HIGH/CRITICAL.

### 5. Check out the PR branch — this is mandatory before running tests
Your local checkout is almost never the PR branch, so its tests **silently don't exist** (`cargo test <name>` → "0 filtered out", `vitest` count looks normal but is missing the new cases). Always:
```bash
git branch --show-current        # confirm you are NOT on the PR branch
gh pr checkout <N>               # handles forks; working tree must be clean
```
Tell the user which branch they were on so they can return (`git checkout <their-branch>`).

### 6. Run the PR's tests on that branch
```bash
pnpm vitest run <changed test files>          # e.g. tests/utils/k8s.test.ts
cd src-tauri && cargo test --lib <module>::<test_mod>   # full path; partial names filter to 0
```
Report real pass counts, not "looks fine."

### 7. Prepare REAL test data + a manual test plan
This is the highest-value step and the reason to review locally. Decide what real inputs the feature consumes, **stage them**, and verify the change's core command/logic against them directly before handing off. Pattern:

1. Identify the external input (a K8s cluster, a DB, a file, an API).
2. Stand it up reproducibly — write a manifest/seed to `/tmp/pr<N>-*.{yaml,sql}` covering **every code path**: the happy path, the path that must NOT trigger, and the rejected/edge path.
3. Run the change's actual command against it to prove the backend logic (e.g. run the exact `kubectl ... -o jsonpath=...` the PR added and confirm output).
4. Hand the user a table: input → expected behavior, one row per test case, plus a cleanup command.

Example (K8s dialog PR): minikube + manifest with a single-port service (auto-prefill *should* fire), a multi-port service (must *not* fire), and a pod (skipped).

### 8. Verdict
Concise: what's solid, numbered non-blocker notes (rule + practical impact), blockers separately, and an approve / approve-with-nits / request-changes call.

## Gotchas

| Symptom | Cause |
|---|---|
| `cargo test` → "0 passed, N filtered out" | Wrong branch (PR code absent) **or** partial test name — use the full `module::test_mod` path. |
| Tests "pass" but new cases missing | Reviewing on your own branch, not the PR branch. Do step 5. |
| `Number(v)` on a cleared input → `0` | Empty form field coerces to 0; watch for it silently disabling defaults/guards. |
| Hardcoded fallback survives a "remove hardcoding" PR | Grep the magic value in the diff's neighborhood — a `?? 3306` often lingers. |

## Common Mistakes
- Reviewing the diff without reading `.rules/` → missing the project's own conventions.
- Trusting the PR description's claims instead of grepping for proof.
- Running tests on the wrong branch and reporting false green.
- Handing the user "test it manually" with no data staged — defeats the point of a local review.
