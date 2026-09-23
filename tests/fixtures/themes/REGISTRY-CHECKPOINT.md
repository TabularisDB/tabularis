# Approved registry UI correction checkpoint

This is a separately scoped part of #791 / Tabularis PR #793, explicitly
approved by the maintainer after the read-only baseline assessment. It does
not enable theme packages, change API schemas, modify counters, administer a
registry or establish full feature acceptance.

## Isolation and changes

- Sibling baseline: `f92f0fd7b5b27dc9b05e401e23721151bd42faf8`.
- Local branch: `fix/theme-download-counts` in the isolated
  `tabularium-pr793-counts` worktree. Original sibling checkout is untouched.
- Shared `PluginCard.svelte` displays package downloads, including zero,
  compact locale-aware large counts and an unavailable marker. Accessible
  labels/tooltips retain exact counts instead of only rounded abbreviations.
- Plugin detail uses the same count formatter. Per-version statistics have
  separate loading, unavailable, empty-success and populated states.
- Slug changes restart the read-only statistics request; disposed/older requests
  cannot replace the current page's statistics. API failures and malformed
  responses no longer become the successful-empty message.
- One new message is translated in all six existing locales. No driver-only or
  theme-only branch was added to shared catalog rendering.
- The only request remains the existing `GET /api/plugins/{slug}/downloads`
  statistics endpoint. No call to tracked `latest`/`releases/{version}` routes
  and no client-side increment, retry, telemetry or API response-shape change.

## Actual local evidence

Bun **1.3.12**, in a disposable local container, with a frozen lockfile install.
The host was not modified to install Bun. Inlang's declared CDN compiler plugins
needed a one-time network bootstrap; after caching them, checks, tests and
builds ran with container networking disabled. No production registry was
contacted.

| Check | Result |
| --- | --- |
| Unchanged frontend Svelte check | PASS: 0 errors / 0 warnings. |
| Unchanged frontend production build | PASS. |
| New frontend `bun test tests` | PASS: 35 tests, 59 assertions; zero/missing/large counts, locale formatting, malformed data, failed requests, no automatic retry and no local counter mutation. |
| Final Svelte check | PASS: 0 errors / 0 warnings. |
| Final frontend production build | PASS: static output in `apps/frontend/dist`. |
| Biome on the new helper and test | PASS. |
| Prettier on the two changed Svelte components | PASS. |
| Browser rendering, accessibility and request-race integration | NOT RUN; source guards are present but the unit suite is not browser evidence. |
| Whole-registry backend tests/lint/build and live API integration | NOT RUN in this UI-only checkpoint. No database started or migrated. |
| `graphify update .` | UNAVAILABLE: command not installed; the sibling had no existing graphify graph. |

GitNexus was used for exploration and upstream impact. It could not resolve the
component-local Svelte function and reported UNKNOWN for the shared component;
manual call-site review found the card on home, category and plugin catalog
pages. The new TypeScript parser/count helpers have LOW/UNKNOWN graph results.
An absent Svelte edge was not treated as evidence of no impact. Final
`detect-changes --scope all` reports 11 files / 24 symbols, two affected
processes and MEDIUM risk; manual review confirms no API/backend changes.

No blanket formatting cleanup was performed. Formatting was limited to new
files and the directly edited Svelte section. No commit, push, companion PR,
release or workflow dispatch was performed at this checkpoint.

## Remaining manual replay

Use an isolated/fake registry, never production tracked endpoints:

| Input / action | Expected behavior |
| --- | --- |
| Card/detail package `downloads: 0` | Visible `0`, not an unavailable marker. |
| `downloads: 1234567`, English locale | Compact `1.2M`; card tooltip/label includes exact `1,234,567`. |
| Missing/invalid aggregate count | `—`, never `0`. |
| Delayed `/downloads` response | Loading text, not the no-downloads message. |
| HTTP/network failure or malformed response | Translated unavailable message, not empty-success. |
| `{ total: 0, versions: [] }` | Existing no-downloads message after success. |
| Valid universal/platform rows | Counts and chart remain visible; no extra increment request. |
| Navigate A → B while A's request is pending | A's late response cannot replace B's statistics. |
| Unmount while request is pending | No subsequent state update. |

These are pending manual inputs/expectations, not claimed executed journeys.
The core theme author/install/activate/update flow still requires implementation
and fake-asset integration coverage.
