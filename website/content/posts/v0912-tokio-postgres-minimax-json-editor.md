---
title: "v0.9.12: Under the Hood"
date: "2026-03-29T11:20:00"
release: "v0.9.12"
tags: ["release", "postgres", "ai", "ux", "mysql", "community"]
excerpt: "The PostgreSQL driver switches from sqlx to tokio-postgres, MiniMax joins the AI providers, JSON columns get a proper editor, and error messages stop being cryptic."
og:
  title: "v0.9.12:"
  accent: "Under the Hood."
  claim: "PostgreSQL rewired with tokio-postgres, MiniMax AI provider, JSON sidebar editor, and better error messages."
  image: "/img/tabularis-ai-assistant.png"
---

# v0.9.12: Under the Hood

Most of this release happened in Rust.

---

## PostgreSQL: from sqlx to tokio-postgres

This one comes from [dev-void-7](https://github.com/dev-void-7) in PR [#105](https://github.com/debba/tabularis/pull/105) — the entire PostgreSQL driver has been rewritten on top of `tokio-postgres`. This was a long overdue move — `sqlx` served us well in the early days, but as Tabularis grew to support composite types, arrays, and more exotic column kinds, we kept running into limitations in how `sqlx` handles type extraction.

The migration touched roughly 1,200 lines across the Rust backend. Connection pooling, query execution, row extraction, dump and export — all rewired. The `extract` module was split into focused submodules (`simple`, `array`, `composite`, `common`) to keep things maintainable as more types get added.

From the user's perspective nothing should look different. Queries run the same, edits work the same, exports produce the same output. If something does behave differently, that's a bug — please open an issue.

One concrete fix that came out of this: columns reported as `text` or `blob` by the driver metadata but actually holding a different type (common with certain PostgreSQL extensions) are now handled through a `known_type` hint that overrides the wire metadata when we know better.

---

## MiniMax AI Provider

[octo-patch](https://github.com/octo-patch) contributed MiniMax as a new first-class AI provider in PR [#108](https://github.com/debba/tabularis/pull/108). Two models are available: **MiniMax-M2.7** and **MiniMax-M2.7-highspeed**.

It works exactly like the other providers — set your API key in Settings, pick a model, and the AI assistant uses it for SQL generation and query explanation. The backend talks to `api.minimax.io/v1` using the same OpenAI-compatible format we already use for several other providers, so it slotted in cleanly.

This brings the supported providers to seven: OpenAI, Anthropic, OpenRouter, Ollama, OpenAI-Compatible, and now MiniMax.

:::newsletter:::

---

## JSON Editor in the Sidebar

Also from [midasism](https://github.com/midasism) (PR [#107](https://github.com/debba/tabularis/pull/107)) — editing JSON columns used to mean typing raw JSON into a single-line text input and hoping for the best. Now there's a proper multi-line editor with:

- **Live validation** — errors show inline as you type
- **Format button** — pretty-prints your JSON with one click
- **Proper sync** — the editor state stays in sync with the underlying cell value without fighting React's effect cycle

This applies to JSON and JSONB columns in the sidebar editor. The grid cell itself still shows the compact representation, but as soon as you click into the sidebar you get the full editor.

---

## Better PostgreSQL Error Messages

PostgreSQL errors can be verbose. The driver returns a one-line summary, then a wall of internal details (error codes, schema names, constraint definitions). Previously we dumped the whole thing into the error panel, which made it hard to spot the actual problem.

Now the error display splits the message: you see the brief summary first, and a **Show details** toggle reveals the rest. Small thing, but it makes a real difference when you're iterating on a query and getting syntax errors every few seconds.

---

## MySQL JSON Columns

JSON columns in MySQL were showing as `NULL` in the data grid. The root cause was a misread of the field type bytes in the MySQL binary protocol — the JSON type flag was being skipped during extraction. Fixed by [midasism](https://github.com/midasism) in PR [#107](https://github.com/debba/tabularis/pull/107).

---

## Smaller Changes

- **Active database in window title** — the Editor tab and the OS window title now show which database you're working in. Useful when you have multiple connections open.
- **Provider icons in Settings** — the AI provider dropdown now shows each provider's logo, making it easier to scan at a glance.
- **Global alert modal** — replaced the native browser `dialog()` calls with a proper in-app alert modal that respects theming and is keyboard-accessible.
- **React stability fixes** — several components had missing hook dependencies or unstable callback references causing unnecessary re-renders. Cleaned up.

---

:::contributors:::

---

_v0.9.12 is available now. Update via the in-app updater, or download from the [releases page](https://github.com/debba/tabularis/releases/tag/v0.9.12)._
