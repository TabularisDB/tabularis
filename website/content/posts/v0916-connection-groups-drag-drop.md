---
title: "v0.9.16: Connection Groups, But Faster"
date: "2026-04-12T09:47:47"
release: "v0.9.16"
tags: ["release", "connections", "ux", "community"]
excerpt: "v0.9.16 makes connection groups feel much more direct: drag groups to reorder them, drag connections into a different group, and get more consistent pagination behavior across built-in drivers."
og:
  title: "v0.9.16:"
  accent: "Connection Groups, But Faster."
  claim: "Drag groups to reorder them, drag connections between groups, and get cleaner pagination behavior across drivers."
  image: "/img/posts/connection-groups.png"
---

# v0.9.16: Connection Groups, But Faster

After the much bigger notebook release, **v0.9.16** is a smaller one. The focus here is on making connection organization less clunky: fewer context menu steps, more direct manipulation. If you use groups heavily, this release removes a bit of friction you'll feel immediately.

---

## Drag and Drop for Connection Groups

This is [@thomaswasle](https://github.com/thomaswasle)'s contribution in PR [#126](https://github.com/debba/tabularis/pull/126).

Connection groups on the **Connections** page are now draggable.

You can:

- Drag a **group** by its grip handle to reorder it
- Drag a **connection** onto another group to move it there
- See a visual highlight on the target group while dragging

That sounds small, but it changes the workflow quite a bit. Before, reorganizing connections meant using menus and explicit move actions. Now it's the interaction you'd expect: grab, drop, done.

For anyone with separate local, staging, production, analytics, or client-specific setups, this makes keeping the list tidy much less annoying.

---

## Pagination Logic, Cleaned Up

There is also a useful backend cleanup in the built-in drivers: pagination logic is now centralized for **PostgreSQL**, **MySQL**, and **SQLite** instead of each driver carrying its own slightly different implementation.

The practical effect is consistency. When Tabularis paginates a `SELECT`, it now preserves `ORDER BY` more safely and respects user-written `LIMIT` / `OFFSET` clauses as a cap instead of treating them differently depending on the driver.

This is not the kind of change that needs a screenshot, but it is the kind that prevents subtle "why is page 2 weird?" behavior later.

---

## Small Follow-Up Fix

A small UI follow-up also landed right after the drag-and-drop work: a corrected `useDatabase` destructure in the sidebar. Not headline material, but exactly the kind of cleanup worth shipping in a point release.

---

## What's Next

One of the next updates will be **Visual Explain** — the new query plan analysis workflow previewed in the [dedicated blog post](/blog/visual-explain-query-plan-analysis).

---

:::contributors:::

---

_v0.9.16 is available now. Update via the in-app updater, or download from the [releases page](https://github.com/debba/tabularis/releases/tag/v0.9.16)._
