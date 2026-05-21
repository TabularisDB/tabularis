-- =============================================================
-- Tabularis Demo - Finance (SQL Server 2022)
-- Database: finance_demo
-- Domain: Accounts, transactions, invoices
-- Idempotent: safe to re-run.
-- =============================================================

IF DB_ID('finance_demo') IS NULL
    CREATE DATABASE finance_demo;
GO

USE finance_demo;
GO

IF OBJECT_ID('dbo.accounts', 'U') IS NULL
CREATE TABLE dbo.accounts (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(100) NOT NULL,
    account_type NVARCHAR(20) NOT NULL,
    currency NVARCHAR(3) NOT NULL DEFAULT 'USD',
    opened_on DATE NOT NULL,
    balance DECIMAL(14,2) NOT NULL DEFAULT 0,
    CONSTRAINT chk_accounts_type CHECK (account_type IN ('asset', 'liability', 'equity', 'income', 'expense'))
);
GO

IF OBJECT_ID('dbo.categories', 'U') IS NULL
CREATE TABLE dbo.categories (
    id INT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(60) NOT NULL UNIQUE,
    kind NVARCHAR(10) NOT NULL,
    CONSTRAINT chk_categories_kind CHECK (kind IN ('income', 'expense'))
);
GO

IF OBJECT_ID('dbo.transactions', 'U') IS NULL
CREATE TABLE dbo.transactions (
    id INT IDENTITY(1,1) PRIMARY KEY,
    account_id INT NOT NULL,
    category_id INT NOT NULL,
    amount DECIMAL(12,2) NOT NULL,
    occurred_on DATE NOT NULL,
    description NVARCHAR(200) NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT fk_tx_account FOREIGN KEY (account_id) REFERENCES dbo.accounts(id),
    CONSTRAINT fk_tx_category FOREIGN KEY (category_id) REFERENCES dbo.categories(id)
);
GO

IF OBJECT_ID('dbo.invoices', 'U') IS NULL
CREATE TABLE dbo.invoices (
    id INT IDENTITY(1,1) PRIMARY KEY,
    invoice_number NVARCHAR(30) NOT NULL UNIQUE,
    customer_name NVARCHAR(120) NOT NULL,
    issued_on DATE NOT NULL,
    due_on DATE NOT NULL,
    status NVARCHAR(15) NOT NULL DEFAULT 'draft',
    currency NVARCHAR(3) NOT NULL DEFAULT 'USD',
    total DECIMAL(12,2) NOT NULL DEFAULT 0,
    CONSTRAINT chk_invoices_status CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'void'))
);
GO

IF OBJECT_ID('dbo.invoice_lines', 'U') IS NULL
CREATE TABLE dbo.invoice_lines (
    id INT IDENTITY(1,1) PRIMARY KEY,
    invoice_id INT NOT NULL,
    description NVARCHAR(200) NOT NULL,
    quantity DECIMAL(10,2) NOT NULL,
    unit_price DECIMAL(12,2) NOT NULL,
    CONSTRAINT fk_invoice_lines_invoice FOREIGN KEY (invoice_id) REFERENCES dbo.invoices(id) ON DELETE CASCADE
);
GO

-- Seed: Accounts
IF NOT EXISTS (SELECT 1 FROM dbo.accounts)
BEGIN
    INSERT INTO dbo.accounts (name, account_type, currency, opened_on, balance) VALUES
    ('Operating Checking',      'asset',     'USD', '2022-01-01',  185420.50),
    ('Savings Reserve',         'asset',     'USD', '2022-01-01',  450000.00),
    ('Stripe Clearing',         'asset',     'USD', '2022-03-15',   28940.10),
    ('Accounts Payable',        'liability', 'USD', '2022-01-01',  -42300.00),
    ('Credit Line',             'liability', 'USD', '2023-06-01', -150000.00),
    ('Owner Equity',            'equity',    'USD', '2022-01-01',  500000.00),
    ('Subscription Revenue',    'income',    'USD', '2022-01-01',  920000.00),
    ('Consulting Revenue',      'income',    'USD', '2022-04-01',  140000.00),
    ('Cloud Infrastructure',    'expense',   'USD', '2022-01-01',  -85400.00),
    ('Salaries',                'expense',   'USD', '2022-01-01', -640000.00),
    ('Marketing',               'expense',   'USD', '2022-01-01',  -78200.00),
    ('Office Rent',             'expense',   'USD', '2022-01-01',  -48000.00);
END
GO

-- Seed: Categories
IF NOT EXISTS (SELECT 1 FROM dbo.categories)
BEGIN
    INSERT INTO dbo.categories (name, kind) VALUES
    ('Subscription',     'income'),
    ('Consulting',       'income'),
    ('Refund Issued',    'expense'),
    ('Payroll',          'expense'),
    ('Cloud Hosting',    'expense'),
    ('Software Tools',   'expense'),
    ('Marketing & Ads',  'expense'),
    ('Rent & Utilities', 'expense'),
    ('Travel',           'expense'),
    ('Hardware',         'expense');
END
GO

-- Seed: Transactions
IF NOT EXISTS (SELECT 1 FROM dbo.transactions)
BEGIN
    INSERT INTO dbo.transactions (account_id, category_id, amount, occurred_on, description) VALUES
    (1,  1,   24500.00, '2025-09-01', 'September subscription billing batch'),
    (1,  1,   25180.00, '2025-10-01', 'October subscription billing batch'),
    (1,  1,   26050.00, '2025-11-01', 'November subscription billing batch'),
    (1,  2,    8400.00, '2025-09-12', 'Consulting - Project Atlas, milestone 1'),
    (1,  2,   12600.00, '2025-10-22', 'Consulting - Project Atlas, milestone 2'),
    (1,  4,  -42500.00, '2025-09-28', 'Payroll - September'),
    (1,  4,  -43800.00, '2025-10-28', 'Payroll - October'),
    (1,  5,   -7240.00, '2025-09-30', 'AWS invoice - September'),
    (1,  5,   -7680.00, '2025-10-31', 'AWS invoice - October'),
    (1,  6,    -890.00, '2025-09-15', 'GitHub Enterprise renewal'),
    (1,  6,    -420.00, '2025-09-20', 'Linear annual'),
    (1,  7,   -3200.00, '2025-09-10', 'Google Ads - September campaign'),
    (1,  7,   -4100.00, '2025-10-10', 'Google Ads - October campaign'),
    (1,  8,   -4000.00, '2025-09-01', 'Office rent - September'),
    (1,  8,   -4000.00, '2025-10-01', 'Office rent - October'),
    (1,  9,   -1850.00, '2025-09-18', 'Conference travel - Berlin'),
    (1, 10,   -2400.00, '2025-10-05', 'New laptops x2 for engineering'),
    (1,  3,    -240.00, '2025-10-12', 'Refund - duplicate charge customer #4821');
END
GO

-- Seed: Invoices
IF NOT EXISTS (SELECT 1 FROM dbo.invoices)
BEGIN
    INSERT INTO dbo.invoices (invoice_number, customer_name, issued_on, due_on, status, currency, total) VALUES
    ('INV-2025-0091', 'Atlas Industries',     '2025-09-01', '2025-10-01', 'paid',    'USD',  8400.00),
    ('INV-2025-0092', 'Northwind Logistics',  '2025-09-05', '2025-10-05', 'paid',    'USD',  4200.00),
    ('INV-2025-0093', 'Helix Biotech',        '2025-09-12', '2025-10-12', 'paid',    'USD', 12600.00),
    ('INV-2025-0094', 'Atlas Industries',     '2025-10-01', '2025-11-01', 'paid',    'USD', 12600.00),
    ('INV-2025-0095', 'Globex Media',         '2025-10-08', '2025-11-08', 'overdue', 'USD',  3600.00),
    ('INV-2025-0096', 'Wayne Robotics',       '2025-10-15', '2025-11-15', 'sent',    'USD',  7800.00),
    ('INV-2025-0097', 'Helix Biotech',        '2025-10-22', '2025-11-22', 'sent',    'USD',  9300.00),
    ('INV-2025-0098', 'Northwind Logistics',  '2025-11-01', '2025-12-01', 'sent',    'USD',  4200.00),
    ('INV-2025-0099', 'Stark Analytics',      '2025-11-05', '2025-12-05', 'draft',   'USD',     0.00),
    ('INV-2025-0100', 'Globex Media',         '2025-11-10', '2025-12-10', 'sent',    'USD',  5400.00);
END
GO

-- Seed: Invoice lines
IF NOT EXISTS (SELECT 1 FROM dbo.invoice_lines)
BEGIN
    INSERT INTO dbo.invoice_lines (invoice_id, description, quantity, unit_price) VALUES
    (1,  'Consulting - architecture review',           40.00, 210.00),
    (2,  'Tabularis Team plan - 14 seats annual',      14.00, 300.00),
    (3,  'Consulting - data pipeline build',           60.00, 210.00),
    (4,  'Consulting - architecture review extension', 60.00, 210.00),
    (5,  'Tabularis Team plan - 12 seats annual',      12.00, 300.00),
    (6,  'Consulting - dashboard implementation',      30.00, 260.00),
    (7,  'Consulting - production readiness audit',    40.00, 232.50),
    (8,  'Tabularis Team plan - 14 seats annual',      14.00, 300.00),
    (10, 'Tabularis Team plan - 18 seats annual',      18.00, 300.00);
END
GO

PRINT 'finance_demo init complete.';
GO
