-- =============================================================
-- Tabularis Demo — Multi-schema showcase (PostgreSQL 16)
-- Database: erp_demo
-- Purpose: exercise the PostgreSQL schema picker / multi-schema
--   sidebar. A single database holds four schemas, each owning a
--   slice of a tiny ERP, wired together with CROSS-SCHEMA foreign
--   keys so FK resolution (pg_namespace) is exercised too:
--     * public    -> app metadata + audit log
--     * hr        -> departments, employees
--     * inventory -> warehouses, products, stock_levels
--     * sales     -> customers, orders, order_items
-- =============================================================

CREATE DATABASE erp_demo;

\connect erp_demo

CREATE SCHEMA IF NOT EXISTS hr;
CREATE SCHEMA IF NOT EXISTS inventory;
CREATE SCHEMA IF NOT EXISTS sales;

-- -------------------------------------------------------------
-- public — application metadata + audit trail
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_meta (
    key   VARCHAR(50) PRIMARY KEY,
    value VARCHAR(200) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.audit_log (
    id         SERIAL PRIMARY KEY,
    table_ref  VARCHAR(100) NOT NULL,
    action     VARCHAR(20)  NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
    actor      VARCHAR(100) NOT NULL,
    logged_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO public.app_meta (key, value) VALUES
('schema_version', '1.0.0'),
('seeded_by',      'tabularis-demo'),
('domain',         'multi-schema ERP showcase');

-- -------------------------------------------------------------
-- hr — departments & employees
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hr.departments (
    id       SERIAL PRIMARY KEY,
    name     VARCHAR(100) NOT NULL,
    location VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS hr.employees (
    id            SERIAL PRIMARY KEY,
    first_name    VARCHAR(50)  NOT NULL,
    last_name     VARCHAR(50)  NOT NULL,
    email         VARCHAR(150) NOT NULL UNIQUE,
    department_id INT          NOT NULL REFERENCES hr.departments(id),
    hire_date     DATE         NOT NULL,
    salary        NUMERIC(10,2) NOT NULL
);

INSERT INTO hr.departments (name, location) VALUES
('Sales',      'New York'),
('Warehouse',  'Newark'),
('Purchasing', 'Chicago'),
('Management',  'New York');

INSERT INTO hr.employees (first_name, last_name, email, department_id, hire_date, salary) VALUES
('Alice',  'Johnson', 'alice.johnson@erp.demo', 1, '2022-03-15', 78000.00),
('Bob',    'Smith',   'bob.smith@erp.demo',     1, '2021-07-01', 82000.00),
('Carol',  'Williams','carol.williams@erp.demo',2, '2023-01-10', 56000.00),
('David',  'Brown',   'david.brown@erp.demo',   2, '2022-06-20', 54000.00),
('Elena',  'Davis',   'elena.davis@erp.demo',   3, '2023-09-01', 64000.00),
('Frank',  'Miller',  'frank.miller@erp.demo',  4, '2020-05-01', 110000.00);

-- -------------------------------------------------------------
-- inventory — warehouses, products, per-warehouse stock
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory.warehouses (
    id      SERIAL PRIMARY KEY,
    code    VARCHAR(10)  NOT NULL UNIQUE,
    city    VARCHAR(100) NOT NULL,
    -- cross-schema FK: warehouse is run by an HR employee
    manager_id INT REFERENCES hr.employees(id)
);

CREATE TABLE IF NOT EXISTS inventory.products (
    id       SERIAL PRIMARY KEY,
    sku      VARCHAR(20)  NOT NULL UNIQUE,
    name     VARCHAR(150) NOT NULL,
    category VARCHAR(50)  NOT NULL,
    price    NUMERIC(10,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory.stock_levels (
    id           SERIAL PRIMARY KEY,
    product_id   INT NOT NULL REFERENCES inventory.products(id),
    warehouse_id INT NOT NULL REFERENCES inventory.warehouses(id),
    quantity     INT NOT NULL DEFAULT 0,
    UNIQUE (product_id, warehouse_id)
);

INSERT INTO inventory.warehouses (code, city, manager_id) VALUES
('NWK', 'Newark',  3),
('CHI', 'Chicago', 4);

INSERT INTO inventory.products (sku, name, category, price) VALUES
('SKU-1001', 'Laptop Pro 16',      'Electronics', 1499.99),
('SKU-1002', 'Wireless Mouse MX',  'Electronics',   34.99),
('SKU-1003', 'Standing Desk Oak',  'Furniture',    599.00),
('SKU-1004', 'Ergonomic Chair V2', 'Furniture',    449.00),
('SKU-1005', 'USB-C Hub 7-in-1',   'Electronics',   64.99),
('SKU-1006', 'Monitor 27" 4K',     'Electronics',  389.99);

INSERT INTO inventory.stock_levels (product_id, warehouse_id, quantity) VALUES
(1, 1, 40), (1, 2, 20),
(2, 1, 300),
(3, 2, 15),
(4, 1, 25), (4, 2, 10),
(5, 1, 180),
(6, 2, 35);

-- -------------------------------------------------------------
-- sales — customers, orders, order items
--   orders.sales_rep_id  -> hr.employees      (cross-schema)
--   order_items.product_id -> inventory.products (cross-schema)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales.customers (
    id      SERIAL PRIMARY KEY,
    name    VARCHAR(100) NOT NULL,
    email   VARCHAR(150) NOT NULL UNIQUE,
    country VARCHAR(50)  NOT NULL
);

CREATE TABLE IF NOT EXISTS sales.orders (
    id           SERIAL PRIMARY KEY,
    customer_id  INT NOT NULL REFERENCES sales.customers(id),
    sales_rep_id INT REFERENCES hr.employees(id),
    order_date   DATE NOT NULL,
    status       VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled')),
    total        NUMERIC(10,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sales.order_items (
    id         SERIAL PRIMARY KEY,
    order_id   INT NOT NULL REFERENCES sales.orders(id),
    product_id INT NOT NULL REFERENCES inventory.products(id),
    quantity   INT NOT NULL,
    unit_price NUMERIC(10,2) NOT NULL
);

INSERT INTO sales.customers (name, email, country) VALUES
('TechCorp Inc.',     'orders@techcorp.com',     'USA'),
('Digital Solutions', 'buy@digitalsol.co.uk',    'UK'),
('Rome Design Studio','info@romedesign.it',      'Italy'),
('Berlin Startup Hub','office@berlinstartup.de', 'Germany');

INSERT INTO sales.orders (customer_id, sales_rep_id, order_date, status, total) VALUES
(1, 1, '2024-06-15', 'delivered', 1569.97),
(1, 2, '2024-08-20', 'delivered',  389.99),
(2, 1, '2024-06-22', 'shipped',    449.00),
(3, 2, '2024-07-01', 'confirmed',  664.98),
(4, 1, '2024-08-05', 'pending',   1499.99);

INSERT INTO sales.order_items (order_id, product_id, quantity, unit_price) VALUES
(1, 1, 1, 1499.99), (1, 2, 2, 34.99),
(2, 6, 1,  389.99),
(3, 4, 1,  449.00),
(4, 3, 1,  599.00), (4, 5, 1, 64.99),
(5, 1, 1, 1499.99);

INSERT INTO public.audit_log (table_ref, action, actor) VALUES
('sales.orders',          'insert', 'seed-script'),
('inventory.stock_levels','update', 'seed-script'),
('hr.employees',          'insert', 'seed-script');
