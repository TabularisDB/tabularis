-- E2E adversarial fixture for the SECONDARY database (tabularis_test_secondary).
-- Idempotent. Schema `review` mirrors the primary's names but with deliberately
-- DIFFERENT shapes/data so cross-DB leakage is detectable.

CREATE SCHEMA IF NOT EXISTS review;

-- Finding #5 (FK navigation): same PK as the primary's parent, different label.
-- Navigating the FK from secondary records(parent_id -> parent.id) must open
-- THIS row ('parent-from-SECONDARY'), not the primary's ('parent-from-PRIMARY').
-- Created BEFORE records because records.parent_id references this table.
CREATE TABLE IF NOT EXISTS review.parent (
  id    INTEGER PRIMARY KEY,
  label TEXT NOT NULL
);
INSERT INTO review.parent (id, label)
  SELECT 100, 'parent-from-SECONDARY'
  WHERE NOT EXISTS (SELECT 1 FROM review.parent WHERE id = 100);

-- Finding #1 (edit-secondary-row PK leakage): PK (id, tenant_id) — composite,
-- vs the primary's PK (id). Two rows share id=1 but differ on tenant_id, so a
-- leaked single-column PK updates BOTH rows.
-- Uses ON CONFLICT DO UPDATE (not INSERT ... WHERE NOT EXISTS) so a prior
-- run's destructive edit (the bug updates BOTH rows' note to the same value)
-- is reset to the original SECONDARY-10/SECONDARY-20 values on re-seed.
CREATE TABLE IF NOT EXISTS review.records (
  id        INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL,
  note      TEXT NOT NULL,
  parent_id INTEGER REFERENCES review.parent(id),
  PRIMARY KEY (id, tenant_id)
);
INSERT INTO review.records (id, tenant_id, note, parent_id) VALUES (1, 10, 'SECONDARY-10', 100)
  ON CONFLICT (id, tenant_id) DO UPDATE SET note = 'SECONDARY-10', parent_id = 100;
INSERT INTO review.records (id, tenant_id, note, parent_id) VALUES (1, 20, 'SECONDARY-20', 100)
  ON CONFLICT (id, tenant_id) DO UPDATE SET note = 'SECONDARY-20', parent_id = 100;

-- Finding #9 (boolean round-trip in dumps): a boolean column the dump path
-- must serialize as true/false (not 1/0) to round-trip into a typed-boolean
-- target table.
-- Uses ON CONFLICT DO UPDATE so a prior run's destructive import (DROP+CREATE
-- commits, INSERT fails → table empty) is reset to the 2 boolean rows on re-seed.
CREATE TABLE IF NOT EXISTS review.dump_types (
  id      INTEGER PRIMARY KEY,
  enabled BOOLEAN NOT NULL,
  payload JSONB
);
INSERT INTO review.dump_types (id, enabled, payload) VALUES (1, TRUE, '{"key":"value"}'::jsonb)
  ON CONFLICT (id) DO UPDATE SET enabled = TRUE, payload = '{"key":"value"}'::jsonb;
INSERT INTO review.dump_types (id, enabled, payload) VALUES (2, FALSE, '"string"'::jsonb)
  ON CONFLICT (id) DO UPDATE SET enabled = FALSE, payload = '"string"'::jsonb;

-- Finding #10 (nested autocomplete): a table that exists ONLY in the
-- secondary database. Autocomplete for a secondary-database console must
-- offer this table.
CREATE TABLE IF NOT EXISTS review.only_secondary (
  id    INTEGER PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO review.only_secondary (id, value)
  SELECT 1, 'only in secondary'
  WHERE NOT EXISTS (SELECT 1 FROM review.only_secondary WHERE id = 1);

-- Findings #3 & #4 (triggers): two tables with the SAME trigger name
-- `normalize` but different behaviors, backed (by the bug) by a single
-- same-named function `normalize_fn` via CREATE OR REPLACE. After creating
-- the trigger on trigger_b, inserting into trigger_a should still apply A's
-- behavior ('from A'), but the bug makes it apply B's ('from B').
CREATE TABLE IF NOT EXISTS review.trigger_a (
  id    INTEGER PRIMARY KEY,
  note  TEXT NOT NULL DEFAULT 'unset'
);
CREATE TABLE IF NOT EXISTS review.trigger_b (
  id    INTEGER PRIMARY KEY,
  note  TEXT NOT NULL DEFAULT 'unset'
);

-- Finding #3: an existing trigger on review.records for the guided-edit test.
-- The function name is table-scoped (records_trg_audit_fn) to match the fix
-- for finding #4 (triggerFunctionName scopes by table). Drop the old
-- non-scoped function name from prior runs.
DROP FUNCTION IF EXISTS review.trg_audit_fn();
CREATE OR REPLACE FUNCTION review.records_trg_audit_fn() RETURNS TRIGGER AS $$
BEGIN
  NEW.note := NEW.note || ' (audited)';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_audit ON review.records;
CREATE TRIGGER trg_audit BEFORE INSERT ON review.records
  FOR EACH ROW EXECUTE FUNCTION review.records_trg_audit_fn();

-- Trigger identity fix: two tables with the same trigger name
-- `normalize`, both pointing at the shared `normalize_fn`. The test opens
-- trigger_a's `normalize` in guided mode, saves with a new body, and asserts
-- the update landed on `normalize_fn` (the function the trigger actually
-- calls) — not on a new convention-named orphan `trigger_a_normalize_fn`.
-- The seed provides the initial shared state; beforeSession re-seeds it
-- between runs so the body is always reset to 'from A'.
CREATE OR REPLACE FUNCTION review.normalize_fn() RETURNS TRIGGER AS $$
BEGIN
  NEW.note := 'from A';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS normalize ON review.trigger_a;
CREATE TRIGGER normalize BEFORE INSERT ON review.trigger_a
  FOR EACH ROW EXECUTE FUNCTION review.normalize_fn();
DROP TRIGGER IF EXISTS normalize ON review.trigger_b;
CREATE TRIGGER normalize BEFORE INSERT ON review.trigger_b
  FOR EACH ROW EXECUTE FUNCTION review.normalize_fn();
