# AGENTS.md

> [!IMPORTANT]
> **The backend layout changed (October 2026).** All Tauri code now lives in `src-tauri/src/transport/desktop/`, and desktop commands are thin wrappers over `src-tauri/src/application/`. Read [Backend layout](#backend-layout-desktop-and-web-transports) before you start, rebase, or review a PR that touches `src-tauri/`.

## Directives
Adhere to the rules defined in the [rules directory](./.rules/):
- [General Rules](./.rules/general.md) (Logging & Language)
- [Rust Rules](./.rules/rust.md) (Backend module structure and Rust testing)
- [TypeScript Rules](./.rules/typescript.md)
- [React Rules](./.rules/react.md)
- [Modal Styling Rules](./.rules/modals.md) (Modal component structure and styling)
- [Testing Conventions](./.rules/testing.md) (Test file organization and structure)
- [Design Token Rules](./.rules/design.md) (Theme tokens for colors, radii and fonts; see also [DESIGN.md](./docs/DESIGN.md))
- [Accessibility Rules](./.rules/accessibility.md) (jsx-a11y lint, keyboard access, dialogs, focus)
- [Plugin Driver Rules](./.rules/plugins.md) (capabilities over driver ids, dialect-aware SQL, plugin contract)

When reviewing pull requests, follow [REVIEW.md](./REVIEW.md).

## Creating feature issues

- Write issues in English and follow [the Feature Proposal template](./.github/ISSUE_TEMPLATE/feature_request.yml), including when creating issues through an API or CLI.
- Use the `[Feat]: ` title prefix and the existing `feature request` label. Check existing issues for duplicates and inspect available labels before adding other labels.
- Include Prerequisites, Feature Proposal, Motivation, Example, Acceptance criteria, and the Contributor notes footer. Add Where to start when concrete implementation pointers have been verified; do not invent file paths or claim unverified bugs.
- Keep each issue focused on one capability, with explicit scope and testable acceptance criteria. Link related issues when useful.
- Always retain the Contributor notes footer with links to the repository rules and [Discord](https://discord.com/invite/K2hmhfHRSt). Adapt implementation and validation notes to the issue and current repository layout.
- Assign `good first issue` only to bounded work with a clear implementation path that does not require architectural decisions or security-sensitive authorization changes. Do not apply it just because a UI change looks small.

## Backend layout: desktop and web transports

The Rust backend serves two transports over the same React frontend:

- **Tauri desktop app:** `src-tauri/src/transport/desktop/`
- **`tabularis web` server:** `src-tauri/src/transport/web/`

Shared logic lives in `src-tauri/src/application/` (and plain modules), so the app and the web behave the same.

- **Tauri code goes in `transport/desktop/` only.** That covers `#[tauri::command]`, `tauri_plugin_*`, and anything taking an `AppHandle`, `Window` or Tauri `State`. It is the only module behind the `desktop` cargo feature; `cargo build --no-default-features` builds the server without Tauri.
- **A desktop command is a thin wrapper over `application/`.** Implement the behaviour there, call it from the desktop command, and give the web RPC (`transport/web/rpc.rs`) a route to the same function.
- **The desktop command registry is in `transport/desktop/mod.rs`** (`run()` and `generate_handler!`), not in `lib.rs`.
- **CI enforces the boundary:** `cargo check --no-default-features` must pass, and a grep fails the build when `tauri::` or `tauri_plugin` appears outside `transport/desktop/`. See rule 7 in [Rust Rules](./.rules/rust.md).

**Branches and PRs started before this layout:**
- Rebase onto it.
- Move new or changed Tauri commands from `commands.rs`, `config.rs` and the like into the mirrored file under `transport/desktop/`.
- Drop `#[cfg(feature = "desktop")]` and `#[cfg_attr(feature = "desktop", tauri::command)]` from shared modules.
- Register commands in `transport/desktop/mod.rs`.
- Check for these commands, which had no frontend caller and were removed: `list_all_preferences`, `get_theme`, `save_blob_to_file`, `preview_tabularis_import`, `apply_tabularis_import`, `export_connections_payload`, `import_connections_payload`, `encrypt_export_payload`, `decrypt_export_payload`, `open_visual_explain_window`, `open_json_viewer_window`, `get_json_viewer_session`, `complete_json_viewer_session`, `open_results_window` and `close_results_window`.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **tabularis** (10537 symbols, 25156 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/tabularis/context` | Codebase overview, check index freshness |
| `gitnexus://repo/tabularis/clusters` | All functional areas |
| `gitnexus://repo/tabularis/processes` | All execution flows |
| `gitnexus://repo/tabularis/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
