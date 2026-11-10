---
name: tabularis-run-macos
description: "macOS only. Launch the real Tabularis desktop app (debug build, real WKWebView and Tauri IPC) and drive it from the agent through tauri-wd: click, fill forms, open menus, drag, take window screenshots and check the result on disk. Use to manually verify a PR or a change in the running app without writing e2e specs, e.g. 'test it in tauri dev', 'try the PR in the app', 'run the app and check'."
---

# Run and drive Tabularis on macOS

Drives the real app the way the e2e suite does (`e2e/`, `tauri-wd` + WebDriverIO), but interactively: one session stays open and you send it small snippets, look at screenshots, and check files or databases between steps. No spec files.

**macOS only.** It relies on `screencapture`, `osascript`, CoreGraphics (`swiftc`) and the WKWebView WebDriver server. On Linux/Windows use the e2e setup in CI instead.

Scripts live in `.claude/skills/tabularis-run-macos/scripts/`. Below, `SK` is that directory and `RUN_DIR` is `${TMPDIR}/tabularis-run` unless you set it (use the session scratchpad when you have one).

## Prerequisites

- `tauri-wd`: `cargo install tauri-webdriver-automation --version 0.1.3 --locked`
- Xcode command line tools (`swiftc`, `screencapture`)
- The terminal needs **Screen Recording** permission for window captures, and **Accessibility** for real keystrokes via `osascript`.
- For databases other than SQLite, start them first (Docker/OrbStack). SQLite needs nothing.

## 1. Check out and launch

```bash
gh pr checkout <N>                      # or stay on the branch you changed
# optional: test the result of the merge, not the stale PR base
git merge --no-edit origin/main         # local only, never push it
bash $SK/scripts/up.sh                  # build + tauri-wd + session (~1-2 min incremental)
```

`up.sh` backs up `config.json` and `connections.dev.json` (debug builds use the real config dir), builds with `pnpm tauri build --debug --no-bundle -- --features e2e-testing`, starts `tauri-wd` on :4444 and opens a session. Rebuild after every branch switch: the frontend is embedded in the binary. `SKIP_BUILD=1` reuses the last build.

## 2. Act, look, verify

Write a snippet and run it from `e2e/` (webdriverio resolves from there). The snippet is the body of an async function; `return` prints:

```bash
cat > $RUN_DIR/a.js <<'EOF'
await clickText('Add Connection'); await browser.pause(1200);
return await dump();
EOF
(cd e2e && node .drv-act.mjs $RUN_DIR/sid $RUN_DIR/a.js)
bash $SK/scripts/shot.sh $RUN_DIR/s1.png     # then Read the png
```

**Always look at the screenshot**, and verify the effect where it lands: `sqlite3` on the test DB, `connections.dev.json` / `config.json` in `~/Library/Application Support/tabularis/`.

Helpers available in every snippet (`scripts/helpers.js`):

| Helper | Use |
|---|---|
| `dump()` | visible inputs/buttons with labels: start here to find selectors |
| `fill(sel, value)` | set a React-controlled input |
| `clickText(text)` | click a button/tab/menu item by aria-label or text |
| `visibleTexts()` | visible button/menu labels with `[disabled]` |
| `hover(text)` | open a context submenu |
| `dbl(text)` | double-click a leaf by text (open a table in the explorer) |
| `toasts()` | current toast messages |
| `goConnections()`, `connectCard(id)` | Connections page, connect a card by `data-connection-id` |
| `cell(r, c, {shift, type:'contextmenu'})`, `gridText()` | data grid: c counts the `#` gutter |
| `dragStart(sel)`, `dragMove(sel, fx, fy)`, `dragEnd(sel, fx, fy)` | mouse drags (folders, cards, rail); fx/fy = fraction of the target box |

The app also exposes `window.__e2e_contextMenu(row, col)` and `window.__e2e_dblclickCell(row, col)` for the data grid.

## Test data

- **SQLite** is the quickest fixture: create it with `sqlite3 $RUN_DIR/pr.db "CREATE TABLE ..."` and add a connection through the UI (`Add Connection` → `button[aria-label="Connect to SQLite"]` → `fill` name and `input[placeholder="/absolute/path/to/file"]` → `Save`). Include a NOT NULL column, a table without a primary key, and text with spaces/mixed case when edits are involved.
- **Connections and groups**: write a small `connections.dev.json` (`{"groups":[{id,name,collapsed,sort_order,parent_id?}],"connections":[{id,name,group_id?,sort_order,params:{driver:"sqlite",database:"..."}}]}`) before `up.sh` (the backup is already taken on the first run), or `cp` it while the app is closed.

## Gotchas

| Symptom | Cause / fix |
|---|---|
| Page looks unstyled in screenshots | WebDriver's `saveScreenshot` ignores the app CSS. Use `shot.sh`. |
| App shows an old UI | Launched a stale binary. The target dir can be global (`~/.cargo/config.toml` `target-dir`); `up.sh` resolves it with `cargo metadata`. Rebuild after switching branch. |
| `setValue` does nothing | Typing does not reach React. Use `fill()`. |
| Enter/Escape via `browser.keys` ignored | `tauri-wd` keys are synthetic: no implicit form submit. For real keys: focus the input, then `osascript -e 'tell application "System Events" to set frontmost of (first process whose unix id is <pid>) to true' -e 'delay 0.4' -e 'tell application "System Events" to key code 36'` (36 Enter, 53 Escape; `keystroke "text"` types). |
| `doubleClick()` / XPath with `[last()]` fails | The actions API is limited. Dispatch DOM events (`dbl`, `cell`). |
| Strict selector errors | `$()` is strict: make selectors unique, or query inside `browser.execute`. |
| Database picker empty | The plugin catalog is still loading: `waitUntil` the card exists. |
| `shot.sh` captures the wrong window | It picks the largest on-screen window of the process; the window title changes with the active connection, so don't match by title. |
| Screenshot right after an action shows the old state | Add `browser.pause(400-1000)` before `shot.sh`. |

## 3. Tear down

```bash
bash $SK/scripts/down.sh
git checkout main
```

`down.sh` closes the session, stops the app and `tauri-wd`, restores `config.json` and `connections.dev.json`, and removes the copied driver scripts from `e2e/`. Run it even after a failure, otherwise the user's connections stay replaced by fixtures.
