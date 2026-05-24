-- =============================================================
-- Tabularis Demo — Long text showcase (PostgreSQL 16)
-- Database: tabularis_demo
-- Purpose: exercise the long-text chevron + Monaco diff editor
--   (see issue #207). Each row targets a specific edge case:
--   short, long single-line, multi-line, markdown, code,
--   varchar-over-threshold, NULLs, unicode.
-- =============================================================

\c tabularis_demo

DROP TABLE IF EXISTS text_demo;
CREATE TABLE text_demo (
  id        SERIAL PRIMARY KEY,
  label     VARCHAR(80)  NOT NULL,
  summary   VARCHAR(500),
  body      TEXT,
  notes     TEXT
);

INSERT INTO text_demo (label, summary, body, notes) VALUES
  -- Row 1: everything short — no chevron should appear anywhere.
  ('short', 'just a brief note', 'hello world', NULL),

  -- Row 2: body is a single-line value over the 80-char threshold.
  -- Chevron should appear but the cell preview stays single-line.
  ('long single-line',
   NULL,
   'A practical tour of EXPLAIN ANALYZE, missing indexes, and the cost of unnecessary sorts that turn a 10ms query into a 4s nightmare.',
   NULL),

  -- Row 3: body is short overall (< 80) but contains newlines.
  -- Chevron triggers via the newline branch; preview shows the
  -- U+23CE return symbol between lines.
  ('multi-line short',
   NULL,
   E'line one\nline two\nline three',
   NULL),

  -- Row 4: realistic multi-line markdown content. Primary test case
  -- for the chevron + diff editor with rich content.
  ('markdown article',
   'Field notes from migrating a 50M-row Postgres table without downtime',
   E'# Zero-downtime migration\n\nWe needed to add a `tenant_id` column to a 50M-row table\nwithout pausing writes. Here is what worked.\n\n## Step 1 — Backfill in batches\n\nA single `UPDATE … SET tenant_id = …` would have locked the\ntable for hours. We batched by primary-key range:\n\n```sql\nUPDATE events\nSET tenant_id = derive_tenant(account_id)\nWHERE id BETWEEN $1 AND $1 + 10000\n  AND tenant_id IS NULL;\n```\n\n## Step 2 — Add the NOT NULL constraint\n\nOnly after the backfill completed did we promote the column\nto `NOT NULL` and add the index, both as concurrent operations.\n\n## What we would do differently\n\n- Run the batches at lower priority during peak hours.\n- Add a kill-switch env var, not a code redeploy.\n',
   'Original draft — reviewed by SRE 2026-04-11.'),

  -- Row 5: code snippet with indentation. Tests Monaco plain-text
  -- preserves whitespace and that the diff handles indentation
  -- changes cleanly.
  ('code snippet',
   'Quicksort in Python — recursive variant for teaching, not production',
   E'def quicksort(items):\n    if len(items) <= 1:\n        return items\n    pivot = items[len(items) // 2]\n    left = [x for x in items if x < pivot]\n    middle = [x for x in items if x == pivot]\n    right = [x for x in items if x > pivot]\n    return quicksort(left) + middle + quicksort(right)\n\n\nif __name__ == "__main__":\n    sample = [3, 6, 1, 8, 2, 9, 4, 7, 5]\n    print(quicksort(sample))\n',
   NULL),

  -- Row 6: multi-line SQL with comments — diffs should show clear
  -- per-line changes when the user edits a clause.
  ('SQL query',
   NULL,
   E'-- Top 10 slowest endpoints in the last hour\nSELECT\n    endpoint,\n    COUNT(*)            AS hits,\n    AVG(duration_ms)    AS avg_ms,\n    MAX(duration_ms)    AS max_ms,\n    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms\nFROM request_log\nWHERE created_at >= NOW() - INTERVAL ''1 hour''\nGROUP BY endpoint\nORDER BY p95_ms DESC\nLIMIT 10;\n',
   'Saved query — pinned in Grafana dashboard "API latency".'),

  -- Row 7: VARCHAR(500) holds a single-line value over threshold.
  -- Confirms the chevron also fires on VARCHAR columns, not only TEXT.
  ('long varchar',
   'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
   'see summary column',
   NULL),

  -- Row 8: all NULL — chevron must NOT appear on null cells.
  ('all null', NULL, NULL, NULL),

  -- Row 9: unicode + emoji across multiple lines. Monaco should
  -- render glyphs correctly and the diff view should align them.
  ('unicode + emoji',
   'Greetings from around the world 🌍',
   E'こんにちは — Japanese\n안녕하세요 — Korean\nПривет — Russian\n∑(α+β)² — math\n🦊🐾 — fox tracks\nمرحبا — Arabic\n',
   '⚙️ technical note: ensure UTF-8 client encoding');
