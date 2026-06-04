-- =============================================================
-- Tabularis Demo — JSON showcase (MySQL 8)
-- Database: tabularis_demo
-- Purpose: exercise the JSON cell viewer & editor:
--   * payload    → native JSON column (always shows JSON UI)
--   * notes_text → TEXT column with JSON-shaped strings, for
--                  testing the "detect JSON in text columns" opt-in
-- =============================================================

SET NAMES utf8mb4;

USE tabularis_demo;

DROP TABLE IF EXISTS json_demo;
CREATE TABLE json_demo (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  label       VARCHAR(80) NOT NULL,
  payload     JSON NOT NULL,
  notes_text  TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO json_demo (label, payload, notes_text) VALUES
  ('flat object',
   '{"name":"Alice","age":30,"active":true}',
   '{"comment":"plain text column with JSON-like content"}'),
  ('nested object',
   '{"user":{"id":1,"profile":{"city":"Vienna","tags":["admin","beta"]}},"meta":{"created":"2026-01-15T08:00:00Z","source":"signup"}}',
   'not json, just a string'),
  ('array of objects',
   '[{"sku":"A-1","qty":2,"price":19.99},{"sku":"B-7","qty":1,"price":4.50},{"sku":"C-3","qty":12,"price":1.20}]',
   '[1,2,3,4,5]'),
  ('array of scalars',
   '["red","green","blue","yellow"]',
   NULL),
  ('deeply nested',
   '{"a":{"b":{"c":{"d":{"e":{"f":"end of the line"}}}}}}',
   '{"depth":5}'),
  ('mixed types',
   '{"string":"hello","number":42,"float":3.14,"bool_t":true,"bool_f":false,"null_val":null,"array":[1,"two",false,null]}',
   'mixed: not parseable'),
  ('empty object', '{}', '{}'),
  ('empty array',  '[]', '[]'),
  ('unicode + emoji',
   '{"greeting":"こんにちは","emoji":"🦊🐾","math":"∑(α+β)²"}',
   '{"emoji":"⚙️"}');

-- -------------------------------------------------------------
-- Large payload — reproduces grid lag with big JSON cells (#283).
-- ~3000 nested objects build a multi-hundred-KB / ~1MB JSON blob.
-- The grid must stay responsive: only a truncated preview renders
-- inline, the full value opens in the JSON viewer on demand.
-- -------------------------------------------------------------
SET SESSION cte_max_recursion_depth = 100000;

INSERT INTO json_demo (label, payload, notes_text)
SELECT
  'large payload (perf stress, 3000 items)',
  JSON_OBJECT('generated', TRUE, 'count', 3000, 'items', items.arr),
  'large JSON blob — see issue #283 (grid must not freeze)'
FROM (
  WITH RECURSIVE seq (n) AS (
    SELECT 1
    UNION ALL
    SELECT n + 1 FROM seq WHERE n < 3000
  )
  SELECT JSON_ARRAYAGG(
    JSON_OBJECT(
      'id', n,
      'name', CONCAT('item-', n),
      'description', REPEAT('lorem ipsum dolor sit amet consectetur ', 4),
      'value', n * 1.5,
      'active', (n % 2 = 0),
      'tags', JSON_ARRAY('alpha', 'beta', 'gamma', 'delta'),
      'nested', JSON_OBJECT('a', n, 'b', CONCAT('x-', n), 'c', JSON_ARRAY(n, n + 1, n + 2))
    )
  ) AS arr
  FROM seq
) AS items;
