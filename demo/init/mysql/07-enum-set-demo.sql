-- =============================================================
-- Tabularis Demo — ENUM / SET showcase (MySQL 8)
-- Database: enum_demo
-- Table:    enum_set_test
-- Purpose:  exercise the ENUM/SET column handling:
--   * information_schema exposes the full allowed-value list only via
--     column_type (e.g. "enum('low','medium','high','urgent')"), not
--     data_type — the driver must surface that so the UI can render a
--     dropdown of allowed values.
--   * `label` includes a value with an escaped single quote to exercise
--     the '' unescaping in parseEnumValues().
--   * `tags` is a SET column, including empty-set and NULL rows.
-- =============================================================

SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS enum_demo
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE enum_demo;

DROP TABLE IF EXISTS enum_set_test;
CREATE TABLE enum_set_test (
    id       INT AUTO_INCREMENT PRIMARY KEY,
    priority ENUM('low', 'medium', 'high', 'urgent') NOT NULL DEFAULT 'medium',
    -- ENUM value containing an escaped single quote, to exercise the '' parser
    label    ENUM('plain', 'it''s complicated', 'other') DEFAULT 'plain',
    tags     SET('news', 'sport', 'tech', 'music') DEFAULT NULL,
    note     VARCHAR(100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO enum_set_test (priority, label, tags, note) VALUES
    ('urgent', 'it''s complicated', 'news,tech', 'first row'),
    ('low',    'plain',            'music',     'second row'),
    ('high',   'other',            '',          'empty set'),
    ('medium', 'plain',            NULL,        'null set');
