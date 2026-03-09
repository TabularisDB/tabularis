---
title: "Smarter Filters, Close Tab, and a Better Plugin Install: v0.9.6"
date: "2026-03-07 12:30"
release: "v0.9.6"
tags: ["release", "filters", "plugins", "ux", "bugfix"]
excerpt: "v0.9.6 ships a structured filter toolbar with ORDER BY autocomplete, a close-tab keyboard shortcut, a cleaner plugin install error experience, and a handful of focused bug fixes."
og:
  title: "Smarter Filters,"
  accent: "v0.9.6."
  claim: "Structured filter toolbar, ORDER BY autocomplete, close-tab shortcut, and a cleaner plugin install flow."
  image: "/img/screenshot-9.png"
---

# Smarter Filters, Close Tab, and a Better Plugin Install: v0.9.6

**v0.9.6** focuses on the day-to-day editing experience: a structured filter toolbar that handles the common filtering case without writing SQL, ORDER BY autocomplete in the toolbar, a close-tab keyboard shortcut, and a plugin install error modal that finally tells you what went wrong.

---

## Structured Filter Toolbar and ORDER BY Autocomplete

The table toolbar has grown two new capabilities that make filtering and sorting larger datasets faster without writing raw SQL.

### Structured Filter UI

The filter toolbar now supports **structured filter expressions** — column, operator, and value entered as discrete fields rather than as a typed WHERE clause. The column list is autocompleted from the schema; operators adapt to the column type (text gets `=`, `!=`, `LIKE`, `NOT LIKE`; numbers and dates get the full comparison set). Multiple filters chain with AND by default.

This does not replace the ability to type a raw WHERE clause — the raw input is still there for complex predicates. The structured mode handles the common case of "show me rows where status = active and created_at > last week" without requiring SQL knowledge.

<video src="/videos/posts/filters-demo.mp4" autoplay loop muted playsinline style="width:100%;border-radius:8px;margin:1rem 0"></video>

### ORDER BY Autocomplete

The ORDER BY field in the toolbar now autocompletes column names from the current table or query result. Start typing a column name and a dropdown narrows the list. Selecting a column appends `ASC` by default; a toggle switches it to `DESC`. Compound sorts across multiple columns are supported.

---

## Close Tab Keyboard Shortcut

The editor tab bar now responds to a close-tab shortcut:

| Platform        | Shortcut |
| :-------------- | :------- |
| macOS           | `⌘+W`    |
| Windows / Linux | `Ctrl+W` |

If the tab has unsaved query changes, a confirmation prompt appears before closing. If the content is clean, the tab closes immediately. The shortcut is rebindable from **Settings → Keyboard Shortcuts** like all other custom bindings.

---

## Plugin Install Error Modal

Until now, a failed plugin installation was silent — the progress spinner would stop and the registry panel would return to idle with no indication of what went wrong. v0.9.6 adds a dedicated **Install Error modal** that surfaces the full error output from the installer.

If a download times out, an asset hash mismatches, or the archive is malformed, you now see the exact error message and which step failed. The modal includes a copy button for sharing the log when opening an issue. Installer logging is also more detailed internally, so the stack trace reaching the modal is actionable rather than a generic failure code.

---

## Bug Fixes

### Connection Dialog: Autocomplete and Autocorrect Disabled

Browser and OS autocomplete surfaces were interfering with connection form inputs — particularly the host, port, username, and database fields. On macOS, autocorrect was silently mangling hostnames. Both issues are fixed:

- `autoComplete="off"` is now set on all connection dialog inputs, preventing browser credential and history suggestions from appearing.
- The macOS `autoCorrect`, `autoCapitalize`, and `spellCheck` attributes are disabled on the same fields.

### Website: Badge Image CSP Rule Scoped to shields.io

A Content Security Policy rule for badge images was written too broadly, allowing any external image source where only `shields.io` badge URLs are used. The rule is now scoped to `shields.io` specifically.

---

:::contributors:::

---

_v0.9.6 is available now. Update via the in-app updater, or download from the releases page._
