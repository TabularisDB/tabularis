-- PostgreSQL integration test seed.
-- Idempotent: uses IF NOT EXISTS / OR REPLACE throughout.
-- Creates objects in test_schema (not public) to avoid conflicts with
-- existing integration tests that use the public schema.

CREATE SCHEMA IF NOT EXISTS test_schema;

-- =============================================================================
-- Core type-coverage table (exercises every common PG type)
-- =============================================================================
CREATE TABLE IF NOT EXISTS test_schema.all_types (
    id              SERIAL PRIMARY KEY,
    col_text        TEXT,
    col_varchar     VARCHAR(255),
    col_int         INTEGER,
    col_bigint      BIGINT,
    col_smallint    SMALLINT,
    col_float       REAL,
    col_double      DOUBLE PRECISION,
    col_numeric     NUMERIC(10,2),
    col_bool        BOOLEAN,
    col_date        DATE,
    col_time        TIME,
    col_timetz      TIME WITH TIME ZONE,
    col_timestamp   TIMESTAMP,
    col_timestamptz TIMESTAMPTZ,
    col_uuid        UUID,
    col_json        JSON,
    col_jsonb       JSONB,
    col_bytea       BYTEA,
    col_inet        INET,
    col_cidr        CIDR,
    col_macaddr     MACADDR,
    col_int_array   INTEGER[],
    col_text_array  TEXT[],
    col_int4range   INT4RANGE,
    col_tsrange     TSRANGE,
    col_interval    INTERVAL
);

COMMENT ON TABLE test_schema.all_types IS 'PostgreSQL metadata integration fixture';
COMMENT ON COLUMN test_schema.all_types.col_text IS 'Free-form text used by metadata tests';

-- Seed rows for query/extraction tests
INSERT INTO test_schema.all_types (
    col_text, col_varchar, col_int, col_bigint, col_smallint,
    col_float, col_double, col_numeric, col_bool,
    col_date, col_time, col_timetz, col_timestamp, col_timestamptz,
    col_uuid,
    col_json, col_jsonb, col_bytea, col_inet, col_cidr, col_macaddr,
    col_int_array, col_text_array, col_int4range, col_tsrange, col_interval
) SELECT
    'hello', 'world', 42, 9223372036854775807, 32767,
    3.14, 2.718281828459045, 12345.67, TRUE,
    '2026-01-15', '14:30:00', '14:30:00+02', '2026-01-15 14:30:00', '2026-01-15 14:30:00+00',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid,
    '{"key": "value"}', '{"nested": {"arr": [1,2,3]}}',
    '\xDEADBEEF', '192.168.1.1', '10.0.0.0/8', '08:00:2b:01:02:03',
    ARRAY[1,2,3], ARRAY['a','b','c'], '[1,10)', '[2026-01-01, 2026-12-31)',
    '1 year 2 months 3 days'
WHERE NOT EXISTS (SELECT 1 FROM test_schema.all_types LIMIT 1);

-- NULL row for null-handling tests
INSERT INTO test_schema.all_types (col_text)
SELECT NULL
WHERE (SELECT COUNT(*) FROM test_schema.all_types) < 2;

-- =============================================================================
-- Enum type
-- =============================================================================
DO $$ BEGIN
    CREATE TYPE test_schema.mood AS ENUM ('happy', 'sad', 'neutral');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS test_schema.with_enum (
    id           SERIAL PRIMARY KEY,
    current_mood test_schema.mood NOT NULL DEFAULT 'neutral'
);

INSERT INTO test_schema.with_enum (current_mood)
SELECT 'happy'
WHERE NOT EXISTS (SELECT 1 FROM test_schema.with_enum LIMIT 1);

-- =============================================================================
-- Foreign key relationships (single PK and composite PK)
-- =============================================================================
CREATE TABLE IF NOT EXISTS test_schema.orders (
    id      SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES test_schema.all_types(id) ON DELETE CASCADE,
    amount  NUMERIC(10,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS test_schema.order_items (
    order_id INTEGER NOT NULL,
    item_no  INTEGER NOT NULL,
    product  TEXT NOT NULL,
    PRIMARY KEY (order_id, item_no),
    FOREIGN KEY (order_id) REFERENCES test_schema.orders(id) ON DELETE CASCADE
);

-- Seed FK data
INSERT INTO test_schema.orders (user_id, amount)
SELECT 1, 99.99
WHERE NOT EXISTS (SELECT 1 FROM test_schema.orders LIMIT 1);

INSERT INTO test_schema.order_items (order_id, item_no, product)
SELECT 1, 1, 'Widget'
WHERE NOT EXISTS (SELECT 1 FROM test_schema.order_items LIMIT 1);

-- =============================================================================
-- Indexes (btree, unique, partial, composite)
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_all_types_text
    ON test_schema.all_types (col_text);

CREATE UNIQUE INDEX IF NOT EXISTS idx_all_types_uuid
    ON test_schema.all_types (col_uuid);

CREATE INDEX IF NOT EXISTS idx_orders_amount_positive
    ON test_schema.orders (amount)
    WHERE amount > 0;

CREATE INDEX IF NOT EXISTS idx_order_items_composite
    ON test_schema.order_items (order_id, product);

-- =============================================================================
-- Views
-- =============================================================================
CREATE OR REPLACE VIEW test_schema.active_users AS
    SELECT id, col_text AS name, col_bool AS is_active
    FROM test_schema.all_types
    WHERE col_bool = TRUE;

-- =============================================================================
-- Materialized views
-- =============================================================================
-- DROP + CREATE because CREATE ... IF NOT EXISTS doesn't exist for MVs
DO $$ BEGIN
    PERFORM 1 FROM pg_matviews
    WHERE schemaname = 'test_schema' AND matviewname = 'user_stats';
    IF NOT FOUND THEN
        EXECUTE 'CREATE MATERIALIZED VIEW test_schema.user_stats AS
            SELECT COUNT(*) AS total, MAX(id) AS max_id
            FROM test_schema.all_types';
    END IF;
END $$;

-- =============================================================================
-- Functions (including overloaded)
-- =============================================================================
CREATE OR REPLACE FUNCTION test_schema.add_numbers(a INTEGER, b INTEGER)
    RETURNS INTEGER
    LANGUAGE SQL
    IMMUTABLE
AS $$ SELECT a + b $$;

CREATE OR REPLACE FUNCTION test_schema.add_numbers(a INTEGER, b INTEGER, c INTEGER)
    RETURNS INTEGER
    LANGUAGE SQL
    IMMUTABLE
AS $$ SELECT a + b + c $$;

CREATE OR REPLACE FUNCTION test_schema.get_user(p_id INTEGER)
    RETURNS TABLE(id INTEGER, name TEXT)
    LANGUAGE SQL
    STABLE
AS $$
    SELECT id, col_text FROM test_schema.all_types WHERE id = p_id
$$;

-- =============================================================================
-- Procedures
-- =============================================================================
CREATE OR REPLACE PROCEDURE test_schema.reset_orders()
    LANGUAGE SQL
AS $$
    DELETE FROM test_schema.order_items;
    DELETE FROM test_schema.orders;
$$;

-- =============================================================================
-- Triggers
-- =============================================================================
CREATE OR REPLACE FUNCTION test_schema.audit_trigger_fn()
    RETURNS TRIGGER
    LANGUAGE plpgsql
AS $$
BEGIN
    -- In a real app this would log to an audit table
    RAISE NOTICE 'Row modified in %', TG_TABLE_NAME;
    RETURN NEW;
END $$;

-- Drop and recreate trigger (no IF NOT EXISTS for triggers)
DROP TRIGGER IF EXISTS trg_audit ON test_schema.all_types;
CREATE TRIGGER trg_audit
    AFTER UPDATE ON test_schema.all_types
    FOR EACH ROW
    EXECUTE FUNCTION test_schema.audit_trigger_fn();

-- =============================================================================
-- Cross-schema FK (for ref_schema testing)
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS other_schema;

CREATE TABLE IF NOT EXISTS other_schema.lookup (
    code  TEXT PRIMARY KEY,
    label TEXT NOT NULL
);

INSERT INTO other_schema.lookup (code, label)
SELECT 'A', 'Alpha'
WHERE NOT EXISTS (SELECT 1 FROM other_schema.lookup WHERE code = 'A');

CREATE TABLE IF NOT EXISTS test_schema.with_cross_schema_fk (
    id          SERIAL PRIMARY KEY,
    lookup_code TEXT REFERENCES other_schema.lookup(code)
);

-- =============================================================================
-- CRUD scratch table (tests can freely mutate this; truncated between test runs)
-- =============================================================================
CREATE TABLE IF NOT EXISTS test_schema.crud_scratch (
    id    SERIAL PRIMARY KEY,
    name  TEXT,
    value INTEGER
);
TRUNCATE test_schema.crud_scratch RESTART IDENTITY;
