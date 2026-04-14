---
title: "One Month In — and We're Just Getting Started"
date: "2026-02-25T12:57:00"
tags: ["community", "milestone", "open-source"]
excerpt: "Tabularis was born on the night of January 25th. Today marks exactly one month. Here's what we built together — and what comes next."
og:
  title: "One Month In —"
  accent: "Just Getting Started."
  claim: "270 stars, 1,000 downloads, a plugin system, and a community that makes it all worth it."
  image: "/img/tabularis-connection-manager.png"
---

# One Month In — and We're Just Getting Started

Tabularis was born on the night of January 25th, 2026. A solo project — one person, a frustration turned into code, a binary pushed to GitHub.

Today is exactly one month since that first release. And in one month, it stopped being a solo project.

I believe deeply in what this can become. Not just as a database tool, but as proof that a small team — or even a single person — can build something genuinely useful, genuinely open, and genuinely worth growing. That belief hasn't wavered for a single day. If anything, watching people show up and contribute has made it stronger.

A lot has happened.

## The Numbers

[![RepoStars](https://repostars.dev/api/embed?repo=debba%2Ftabularis&theme=dark)](https://repostars.dev/?repos=debba%2Ftabularis&theme=dark)

~**270 stars**. **5 contributors**. Around **1,000 downloads**. Around twenty issues opened by people who actually tried the product, pull requests reviewed, bugs squashed.

For a one-month-old open source project, that's not nothing — that's a community. And communities don't happen by accident. They happen because people show up.

So: thank you. Genuinely.

## What We Built

A month ago, Tabularis could connect to PostgreSQL, MySQL, and SQLite. It had a SQL editor, a data grid, and not much else.

Since then, we've shipped:

- **Plugin System** — the biggest release of the month. A language-agnostic JSON-RPC protocol that lets anyone build a new database driver without touching the core app. The first plugin, [tabularis-duckdb-plugin](https://github.com/debba/tabularis-duckdb-plugin), was ready on day one. This is the feature that changes what Tabularis can become: not a tool that supports three databases, but a platform that can support any database.

- **AI Assistant** — generate SQL from natural language, get explanations for complex queries. Integrated with OpenAI, Anthropic, OpenRouter, and Ollama for those who want to keep everything local.

- **Visual Query Builder** — build JOINs and filters without writing a line of SQL.

- **SSH Tunneling** — connect to remote databases through SSH with key and password auth.

- **Split View** — work with two connections simultaneously, side by side.

- **Schema Management** — ER diagrams, inline column editing, table creation wizards.

- **MCP Server** — expose your database to Claude and other AI agents via the Model Context Protocol.

- **10+ Themes** — because your tools should feel good to use.

One month. That's the velocity the community made possible.

:::newsletter:::

## The Wiki Is Open

Starting today, the [Tabularis Wiki](/wiki) is live and open for contributions. Every page has an **Edit on GitHub** link — if you spot something wrong, outdated, or missing, you can fix it directly.

This is intentional. Documentation written only by the maintainers reflects only the maintainers' perspective. If you've figured out a non-obvious workflow, found a gotcha during setup, or have a tip that saved you time — the wiki is the right place for it.

The wiki belongs to whoever writes it. Consider this an open invitation.

:::contributors:::

## What's Next

The plugin ecosystem is still young. We want to see drivers for DuckDB, ClickHouse, CockroachDB, and more. We want the registry to grow. We want the community to build things we haven't thought of yet.

On the core side: better query history, smarter autocomplete, a more complete ER diagram, and performance improvements are all in flight.

But more than any specific feature, what we want is for Tabularis to keep earning the trust that ~270 people have already placed in it by giving it a star. That means shipping reliably, fixing bugs quickly, and keeping the project open in every sense of the word.

## One More Thing

If Tabularis has been useful to you — tell someone. Open source lives and dies by word of mouth. A mention in a Slack channel, a post on a forum, a link in a README. Small things compound.

And if you want to get more involved: the [Discord](https://discord.gg/YrZPHAwMSG) is the fastest way to reach the team. Come say hi.

Here's to month two.

---

_The Tabularis Team_
