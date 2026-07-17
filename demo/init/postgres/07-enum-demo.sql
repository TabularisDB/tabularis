-- =============================================================
-- Tabularis Demo — ENUM showcase (PostgreSQL 16)
-- Database: tabularis_demo
-- Table:    monitored_accounts
-- Purpose:  exercise PostgreSQL enum column handling (#465):
--   * information_schema reports enum columns only as "USER-DEFINED";
--     the driver must read the allowed labels from pg_enum so the UI
--     can render a dropdown of allowed values.
--   * UPDATE/INSERT of an enum value must cast the TEXT-bound
--     parameter through the enum type, or PostgreSQL rejects it with
--     SQLSTATE 42804 ("column is of type ... but expression is of
--     type text").
--   * `mood` includes a label with an embedded single quote to
--     exercise the '' unescaping in parseEnumValues().
-- =============================================================

\c tabularis_demo

DROP TABLE IF EXISTS monitored_accounts;
DROP TYPE IF EXISTS plan_type;
DROP TYPE IF EXISTS mood_type;

CREATE TYPE plan_type AS ENUM ('free', 'basic', 'pro', 'enterprise');
CREATE TYPE mood_type AS ENUM ('happy', 'it''s complicated', 'sad');

CREATE TABLE monitored_accounts (
    account_id  TEXT PRIMARY KEY,
    account_name TEXT NOT NULL,
    plan_type   plan_type NOT NULL DEFAULT 'free',
    mood        mood_type DEFAULT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO monitored_accounts (account_id, account_name, plan_type, mood) VALUES
    ('acc-001', 'Acme Corp', 'enterprise', 'happy'),
    ('acc-002', 'Beta LLC',  'basic',      'it''s complicated'),
    ('acc-003', 'Gamma Inc', 'free',       NULL),
    ('acc-004', 'Delta Srl', 'pro',        'sad');
