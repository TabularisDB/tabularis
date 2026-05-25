---
name: tabularis-discord-release
description: Generate a Discohook-ready JSON embed for a Tabularis release given its version. Reads CHANGELOG.md for the changes and src/data/changelog.ts for the blog post URL, then fills in template.json (which the user can customize) and writes the result. Use when the user asks for a Discord release announcement, a Discohook embed, or "il json per discohook" for a specific version.
---

# Tabularis Discord release embed

## When to use
- The user asks for a Discohook JSON, Discord embed, or Discord announcement for a Tabularis version.
- Phrases: "fai il json discohook per vX.Y.Z", "embed discord per la release", "annuncio discord vX.Y.Z".

## Inputs to gather
1. **Version** — required. Format `0.10.3` (no `v` prefix). If the user gives `v0.10.3`, strip the `v`.
2. **Repo working dir** — `~/Progetti/tabularis`. Don't `cd`; pass paths to commands.

If the user did not specify a version, default to the most recent one in `CHANGELOG.md` and confirm in one line before writing.

## How this skill works
The shape of the embed lives in **`template.json`** next to this file. The skill fills placeholders and writes the result. **Do not hardcode the JSON in this file or in your output — always start from `template.json`.** If the user wants to change the color, avatar, footer text, link layout, or structure, they edit `template.json` directly. The skill stays focused on content (bullets, description, dates).

### Placeholders in `template.json`
| Placeholder | What to substitute |
|---|---|
| `{{VERSION}}` | `0.10.3` (no leading `v`) |
| `{{BLOG_URL}}` | The URL from `versionLinks["X.Y.Z"]` in `src/data/changelog.ts`. The template already appends `?utm_src=discord` where needed, so substitute the bare URL. |
| `{{DESCRIPTION}}` | 2-3 plain sentences summarizing the release. No bullets here. Don't include the blog-post link — the template adds it on a new line. |
| `{{FEATURES_BULLETS}}` | Newline-joined `- bullet` list from the Features section. Empty string if none. |
| `{{FIXES_BULLETS}}` | Newline-joined `- bullet` list from the Bug Fixes section. Empty string if none. |
| `{{DATE_ISO}}` | The release date from the CHANGELOG heading (`(2026-05-11)` → `2026-05-11T00:00:00.000Z`). |

### Conditional fields
Fields with `"_omit_if_value_empty": true` in the template must be **removed entirely** when their substituted value is empty. After substitution:
- Parse the JSON.
- Walk `embeds[*].fields` and drop any object where `_omit_if_value_empty === true` AND the post-substitution `value` is empty/whitespace.
- Strip the `_omit_if_value_empty` key from every field (it's a skill marker, not a Discord field).
- Re-serialize with 2-space indentation.

This is the only post-processing step. Don't add other fields, don't reorder, don't change the color or avatar — those are template concerns.

## Sources of truth (read in this order)
1. **`CHANGELOG.md`** — the section starting with `## [X.Y.Z]` or `# [X.Y.Z]`. Stop at the next `## [` or `# [`. This gives you the Features and Bug Fixes lists, plus the release date.
2. **`src/data/changelog.ts`** — the `versionLinks` map. Look up the version key. If missing, **stop and tell the user** to add the entry first (the blog post might not be published yet).
3. **`src-tauri/tauri.conf.json`** (optional) — sanity-check the version matches.

## Hard rules (tone)
- **Never sound like marketing copy.** Drop adjectives like "powerful", "seamless", "friendlier", "safer", "resilient", "exciting".
- **Plain English, short sentences.** Lead with the verb. The user is a maintainer talking to power users, not a product manager.
- **Don't invent features.** Every bullet must come from a CHANGELOG line. If the CHANGELOG is terse, rewrite slightly — don't embellish.
- **Minimal emoji.** None in the title/description/bullets. The pre-embed `content` line stays plain.
- **No em-dashes as a stylistic tic.** Use periods. Parentheses are fine when actually parenthetical.
- **No "plus a couple of…" sweeps.** Just list the items.

## Bullet rewriting rules
The raw CHANGELOG lines are commit-message-shaped. Rewrite each one for a human reader:
- Strip the scope prefix when redundant: `**editor:** add error boundary` → `Editor error boundary (with tests)`.
- Drop commit hashes and PR autolinks. Discord users have the "Links" field for the full changelog.
- Turn imperative commit verbs into present-tense facts: `coerce boolean strings to bool` → `Postgres now coerces boolean strings to real booleans`.
- Keep each bullet to one line, ~80 chars max.

### Discord length limits
- Embed description ≤ 4096 chars.
- Each field `value` ≤ 1024 chars. If a release has many features, either trim the smallest items (point to blog) or split into "What's new (1/2)" + "What's new (2/2)".
- Total embed ≤ 6000 chars.

## Process
1. Read `CHANGELOG.md` (first ~200 lines).
2. Read `src/data/changelog.ts` and pull `versionLinks["X.Y.Z"]`. Missing → stop and ask.
3. Read `template.json` from this skill's directory.
4. Draft `{{DESCRIPTION}}` and the two bullet lists per the tone/bullet rules.
5. Substitute all `{{...}}` placeholders.
6. Parse the resulting JSON, apply the `_omit_if_value_empty` logic, strip the marker keys, re-serialize.
7. Write to `~/Progetti/tabularis/discohook-v<X.Y.Z>.json` (overwrite if exists).
8. In your final message: confirm the path, show the `content` line plus the first 2 bullets so the user can sanity-check the tone, and remind them to paste into the JSON Data Editor at https://discohook.app/.

## What NOT to do
- Don't bypass `template.json` by writing inline JSON. If the template doesn't exist, stop and tell the user.
- Don't add an `image` field unless the user provides a screenshot URL — edit `template.json` to add it permanently if they want it on every release.
- Don't add reactions or polls. (Link-button components in the template are fine and must be preserved through substitution — they only need `{{VERSION}}` and `{{BLOG_URL}}` substituted like the rest.)
- Don't include `:::contributors:::` or other blog-specific markdown — that syntax breaks Discord rendering.
- Don't translate to Italian unless the user explicitly asks; default is English (Tabularis Discord is international).

## Reference example
`~/Progetti/tabularis/discohook-v0.10.3.json` is the canonical output. Compare against it if you're unsure about tone or shape.
