-- =============================================================
-- Tabularis Demo — BIGINT precision showcase (PostgreSQL 16)
-- Database: tabularis_demo
-- Purpose: exercise the JS-safe-integer fix for issue #210.
--   JavaScript loses precision for integers outside ±(2^53 - 1).
--   Values above that boundary must arrive in the UI as strings
--   that preserve every digit; values inside the boundary must
--   stay as native JSON numbers so sorting/filtering still work.
--   Postgres-specific: xid8 (transaction id) and money are both
--   backed by 64-bit integers and share the same precision risk.
-- =============================================================

\c tabularis_demo

DROP TABLE IF EXISTS bigint_demo;
CREATE TABLE bigint_demo (
  id        BIGINT      PRIMARY KEY,
  amount    BIGINT,
  xid_val   XID8,
  money_val MONEY,
  label     VARCHAR(80) NOT NULL,
  note      TEXT
);

INSERT INTO bigint_demo (id, amount, xid_val, money_val, label, note) VALUES
  -- Row 1: small signed bigint. Must stay a real JSON number so the
  -- UI keeps numeric sort, range filters and inline arithmetic.
  (42,
   1000,
   '42'::xid8,
   '10.00'::money,
   'small (stays JSON number)',
   'Below 2^53 — round-trips as number, no behaviour change.'),

  -- Row 2: exactly Number.MAX_SAFE_INTEGER = 2^53 - 1. Boundary case:
  -- still safe, must stay number.
  (9007199254740991,
   9007199254740991,
   '9007199254740991'::xid8,
   NULL,
   '2^53 - 1 (boundary, still number)',
   'Largest integer JS can represent without precision loss.'),

  -- Row 3: 2^53 — one past safe. Must come back as a JSON STRING for
  -- BIGINT, XID8 and MONEY. Pre-fix all three rounded silently.
  (9007199254740992,
   9007199254740992,
   '9007199254740992'::xid8,
   '90071992547409.92'::money,
   '2^53 (becomes JSON string)',
   'First value that JS Number cannot represent exactly.'),

  -- Row 4: the snowflake ID from the original bug report. The whole
  -- reason this seed exists — pre-fix the UI showed ...842300.
  (844197938335842304,
   844197938335842304,
   '844197938335842304'::xid8,
   NULL,
   'snowflake from issue #210',
   'Reported by xausky on 2026-05-17.'),

  -- Row 5: negative bigint outside the safe range. Confirms the
  -- string-fallback also fires for the negative side. xid8 is
  -- unsigned so we leave it NULL here.
  (-844197938335842304,
   -844197938335842304,
   NULL,
   '-844197938335.84'::money,
   'negative snowflake',
   'Same precision rules apply on the negative axis.'),

  -- Row 6: i64::MAX. Stress-test the upper edge of signed bigint
  -- and the corresponding xid8 value.
  (9223372036854775807,
   9223372036854775807,
   '9223372036854775807'::xid8,
   NULL,
   'i64::MAX (extreme signed)',
   'Largest value a BIGINT column can hold — pure-string roundtrip.'),

  -- Row 7: xid8 value above i64::MAX. Postgres xid8 is u64, so this
  -- only exercises the u64_to_json path.
  (1,
   NULL,
   '18446744073709551614'::xid8,
   NULL,
   'xid8 above i64::MAX (unsigned only)',
   'xid8 supports values that exceed signed i64::MAX.');
