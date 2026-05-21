-- =============================================================
-- Tabularis Demo — BIGINT precision showcase (MySQL 8)
-- Database: tabularis_demo
-- Purpose: exercise the JS-safe-integer fix for issue #210.
--   JavaScript loses precision for integers outside ±(2^53 - 1).
--   Values above that boundary must arrive in the UI as strings
--   that preserve every digit; values inside the boundary must
--   stay as native JSON numbers so sorting/filtering still work.
-- =============================================================

SET NAMES utf8mb4;

USE tabularis_demo;

DROP TABLE IF EXISTS bigint_demo;
CREATE TABLE bigint_demo (
  id          BIGINT       PRIMARY KEY,
  unsigned_id BIGINT UNSIGNED,
  amount      BIGINT,
  label       VARCHAR(80)  NOT NULL,
  note        VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO bigint_demo (id, unsigned_id, amount, label, note) VALUES
  -- Row 1: small signed bigint. Must stay a real JSON number so the
  -- UI keeps numeric sort, range filters and inline arithmetic.
  (42,
   42,
   1000,
   'small (stays JSON number)',
   'Below 2^53 — round-trips as number, no behaviour change.'),

  -- Row 2: exactly Number.MAX_SAFE_INTEGER = 2^53 - 1. Boundary case:
  -- still safe, must stay number.
  (9007199254740991,
   9007199254740991,
   9007199254740991,
   '2^53 - 1 (boundary, still number)',
   'Largest integer JS can represent without precision loss.'),

  -- Row 3: 2^53 — one past safe. Must come back as a JSON STRING.
  -- Pre-fix this rendered as 9007199254740992 (rounded up by JSON.parse).
  (9007199254740992,
   9007199254740992,
   9007199254740992,
   '2^53 (becomes JSON string)',
   'First value that JS Number cannot represent exactly.'),

  -- Row 4: the snowflake ID from the original bug report. The whole
  -- reason this seed exists — pre-fix the UI showed ...842300.
  (844197938335842304,
   844197938335842304,
   844197938335842304,
   'snowflake from issue #210',
   'Reported by xausky on 2026-05-17.'),

  -- Row 5: negative bigint outside the safe range. Confirms the
  -- string-fallback also fires for the negative side.
  (-844197938335842304,
   NULL,
   -844197938335842304,
   'negative snowflake',
   'Same precision rules apply on the negative axis.'),

  -- Row 6: i64::MAX. Stress-test the upper edge of signed bigint.
  (9223372036854775807,
   9223372036854775807,
   9223372036854775807,
   'i64::MAX (extreme signed)',
   'Largest value a BIGINT column can hold — pure-string roundtrip.'),

  -- Row 7: u64 value above i64::MAX. Only fits in BIGINT UNSIGNED.
  -- Validates the u64_to_json path independently of i64.
  (1,
   18446744073709551614,
   NULL,
   'u64 above i64::MAX (unsigned only)',
   'BIGINT UNSIGNED supports values that exceed signed i64::MAX.');
