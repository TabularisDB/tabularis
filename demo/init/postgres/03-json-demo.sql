-- =============================================================
-- Tabularis Demo — JSON / JSONB showcase (PostgreSQL 16)
-- Database: tabularis_demo
-- Purpose: exercise the JSON cell viewer & editor:
--   * payload   → native JSONB column (always shows JSON UI)
--   * notes_text → TEXT column with JSON-shaped strings, for
--                 testing the "detect JSON in text columns" opt-in
-- =============================================================

\c tabularis_demo

DROP TABLE IF EXISTS json_demo;
CREATE TABLE json_demo (
  id          SERIAL PRIMARY KEY,
  label       VARCHAR(80) NOT NULL,
  payload     JSONB NOT NULL,
  notes_text  TEXT
);

INSERT INTO json_demo (label, payload, notes_text) VALUES
  ('flat object',
   '{"name":"Alice","age":30,"active":true}'::jsonb,
   '{"comment":"plain text column with JSON-like content"}'),
  ('nested object',
   '{"user":{"id":1,"profile":{"city":"Vienna","tags":["admin","beta"]}},"meta":{"created":"2026-01-15T08:00:00Z","source":"signup"}}'::jsonb,
   'not json, just a string'),
  ('array of objects',
   '[{"sku":"A-1","qty":2,"price":19.99},{"sku":"B-7","qty":1,"price":4.50},{"sku":"C-3","qty":12,"price":1.20}]'::jsonb,
   '[1,2,3,4,5]'),
  ('array of scalars',
   '["red","green","blue","yellow"]'::jsonb,
   NULL),
  ('deeply nested',
   '{"a":{"b":{"c":{"d":{"e":{"f":"end of the line"}}}}}}'::jsonb,
   '{"depth":5}'),
  ('mixed types',
   '{"string":"hello","number":42,"float":3.14,"bool_t":true,"bool_f":false,"null_val":null,"array":[1,"two",false,null]}'::jsonb,
   'mixed: not parseable'),
  ('empty object', '{}'::jsonb, '{}'),
  ('empty array',  '[]'::jsonb, '[]'),
  ('large list',
   to_jsonb(array(SELECT json_build_object('row', i, 'sq', i*i, 'name', 'item-'||i) FROM generate_series(1,40) AS i)),
   'list of 40 items'),
  ('unicode + emoji',
   '{"greeting":"こんにちは","emoji":"🦊🐾","math":"∑(α+β)²"}'::jsonb,
   '{"emoji":"⚙️"}');

-- -------------------------------------------------------------
-- Large payload — reproduces grid lag with big JSON cells (#283).
-- ~3000 nested objects build a multi-hundred-KB / ~1MB JSON blob.
-- The grid must stay responsive: only a truncated preview renders
-- inline, the full value opens in the JSON viewer on demand.
-- -------------------------------------------------------------
INSERT INTO json_demo (label, payload, notes_text)
SELECT
  'large payload (perf stress, 3000 items)',
  jsonb_build_object(
    'generated', true,
    'count', 3000,
    'items', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', i,
          'name', 'item-' || i,
          'description', repeat('lorem ipsum dolor sit amet consectetur ', 4),
          'value', i * 1.5,
          'active', (i % 2 = 0),
          'tags', jsonb_build_array('alpha', 'beta', 'gamma', 'delta'),
          'nested', jsonb_build_object('a', i, 'b', 'x-' || i, 'c', jsonb_build_array(i, i + 1, i + 2))
        )
      )
      FROM generate_series(1, 3000) AS i
    )
  ),
  'large JSON blob — see issue #283 (grid must not freeze)';
