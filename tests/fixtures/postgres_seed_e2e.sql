-- E2E adversarial fixture for the PRIMARY database (testdb).
-- Idempotent. Schema `review` does not collide with test_schema/other_schema.
-- These tables are the PRIMARY-database collision partners: same names as the
-- secondary database, but deliberately DIFFERENT shapes/data so cross-DB
-- leakage (a call that targets the primary when it should target the
-- secondary) is detectable via direct-DB assertion.

CREATE SCHEMA IF NOT EXISTS review;

-- Finding #1 (edit-secondary-row PK leakage): PK (id) only — vs the
-- secondary's PK (id, tenant_id). If the editor fetches PK columns from the
-- primary, it records [id] and an edit to the secondary updates BOTH rows.
CREATE TABLE IF NOT EXISTS review.records (
  id    INTEGER PRIMARY KEY,
  note  TEXT NOT NULL
);
INSERT INTO review.records (id, note)
  SELECT 1, 'PRIMARY sentinel'
  WHERE NOT EXISTS (SELECT 1 FROM review.records WHERE id = 1);

-- Finding #5 (FK navigation): same PK as the secondary's parent, but a
-- different label value. If FK navigation opens the primary's row instead of
-- the source tab's secondary DB, the opened row shows the wrong label.
CREATE TABLE IF NOT EXISTS review.parent (
  id    INTEGER PRIMARY KEY,
  label TEXT NOT NULL
);
INSERT INTO review.parent (id, label)
  SELECT 100, 'parent-from-PRIMARY'
  WHERE NOT EXISTS (SELECT 1 FROM review.parent WHERE id = 100);

-- The secondary's records table references parent(id). Add the FK here too so
-- the secondary's FK navigation target is well-defined in BOTH databases.
ALTER TABLE review.records
  DROP CONSTRAINT IF EXISTS records_parent_id_fk;
-- records has no parent_id column in the primary shape; the FK lives only in
-- the secondary (see postgres_seed_e2e_secondary.sql).
