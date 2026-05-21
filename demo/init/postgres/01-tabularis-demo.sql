-- =============================================================
-- Tabularis Demo — Common schema (PostgreSQL 16)
-- Database: tabularis_demo (pre-created via POSTGRES_DB env)
-- Domain: HR + e-commerce
-- =============================================================

CREATE TABLE IF NOT EXISTS departments (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    budget NUMERIC(12,2) NOT NULL DEFAULT 0,
    location VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
    id SERIAL PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    department_id INT NOT NULL REFERENCES departments(id),
    hire_date DATE NOT NULL,
    salary NUMERIC(10,2) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    category VARCHAR(50) NOT NULL,
    price NUMERIC(10,2) NOT NULL,
    stock INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    country VARCHAR(50) NOT NULL,
    signup_date DATE NOT NULL,
    lifetime_value NUMERIC(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    customer_id INT NOT NULL REFERENCES customers(id),
    order_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled')),
    total NUMERIC(10,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    order_id INT NOT NULL REFERENCES orders(id),
    product_id INT NOT NULL REFERENCES products(id),
    quantity INT NOT NULL,
    unit_price NUMERIC(10,2) NOT NULL
);

INSERT INTO departments (name, budget, location) VALUES
('Engineering',     1500000.00, 'San Francisco'),
('Marketing',        800000.00, 'New York'),
('Sales',            650000.00, 'Chicago'),
('Human Resources',  400000.00, 'San Francisco'),
('Finance',          550000.00, 'New York'),
('Customer Support', 350000.00, 'Austin');

INSERT INTO employees (first_name, last_name, email, department_id, hire_date, salary, is_active) VALUES
('Alice',   'Johnson',   'alice.johnson@company.com',   1, '2022-03-15', 125000.00, TRUE),
('Bob',     'Smith',     'bob.smith@company.com',       1, '2021-07-01', 135000.00, TRUE),
('Carol',   'Williams',  'carol.williams@company.com',  1, '2023-01-10', 115000.00, TRUE),
('David',   'Brown',     'david.brown@company.com',     2, '2022-06-20',  95000.00, TRUE),
('Elena',   'Davis',     'elena.davis@company.com',     2, '2023-09-01',  88000.00, TRUE),
('Frank',   'Miller',    'frank.miller@company.com',    3, '2021-11-15',  82000.00, TRUE),
('Grace',   'Wilson',    'grace.wilson@company.com',    3, '2022-04-10',  78000.00, TRUE),
('Henry',   'Moore',     'henry.moore@company.com',     3, '2023-02-28',  76000.00, TRUE),
('Iris',    'Taylor',    'iris.taylor@company.com',     4, '2022-08-01',  72000.00, TRUE),
('Jack',    'Anderson',  'jack.anderson@company.com',   4, '2023-05-15',  68000.00, TRUE),
('Karen',   'Thomas',    'karen.thomas@company.com',    5, '2021-09-01',  98000.00, TRUE),
('Leo',     'Jackson',   'leo.jackson@company.com',     5, '2022-12-01',  92000.00, TRUE),
('Maria',   'White',     'maria.white@company.com',     6, '2023-03-20',  65000.00, TRUE),
('Nathan',  'Harris',    'nathan.harris@company.com',   6, '2022-10-15',  62000.00, TRUE),
('Olivia',  'Martin',    'olivia.martin@company.com',   1, '2020-05-01', 145000.00, TRUE),
('Paul',    'Garcia',    'paul.garcia@company.com',     2, '2024-01-15',  85000.00, TRUE),
('Quinn',   'Martinez',  'quinn.martinez@company.com',  3, '2024-02-01',  74000.00, FALSE),
('Rachel',  'Robinson',  'rachel.robinson@company.com', 1, '2024-03-01', 110000.00, TRUE);

INSERT INTO products (name, category, price, stock, created_at) VALUES
('Laptop Pro 16',               'Electronics', 1499.99, 120, '2024-01-15 10:00:00'),
('Wireless Mouse MX',           'Electronics',   34.99, 500, '2024-01-15 10:00:00'),
('Standing Desk Oak',           'Furniture',    599.00,  45, '2024-02-01 09:00:00'),
('Ergonomic Chair V2',          'Furniture',    449.00,  60, '2024-02-01 09:00:00'),
('USB-C Hub 7-in-1',            'Electronics',   64.99, 300, '2024-03-10 14:00:00'),
('Monitor 27" 4K',              'Electronics',  389.99,  80, '2024-03-10 14:00:00'),
('Mechanical Keyboard',         'Electronics',  119.99, 200, '2024-04-01 11:00:00'),
('Desk Lamp LED',               'Furniture',     49.99, 150, '2024-04-01 11:00:00'),
('Webcam 4K Pro',               'Electronics',   89.99, 180, '2024-05-01 08:00:00'),
('Cable Organizer Kit',         'Accessories',   14.99, 400, '2024-05-01 08:00:00'),
('Noise Cancelling Headphones', 'Electronics',  279.99,  90, '2024-06-01 10:00:00'),
('Laptop Stand Aluminum',       'Accessories',   59.99, 220, '2024-06-01 10:00:00'),
('Portable SSD 1TB',            'Electronics',  109.99, 150, '2024-07-01 09:00:00'),
('Wireless Charger Pad',        'Electronics',   29.99, 350, '2024-07-01 09:00:00'),
('Whiteboard 48x36',            'Furniture',     89.99,  40, '2024-08-01 10:00:00');

INSERT INTO customers (name, email, country, signup_date, lifetime_value) VALUES
('TechCorp Inc.',      'orders@techcorp.com',     'USA',         '2024-01-10', 15420.00),
('Digital Solutions',  'buy@digitalsol.co.uk',    'UK',          '2024-01-25',  8950.00),
('Innovation Labs',    'sales@innovationlabs.es', 'Spain',       '2024-02-14',  4230.00),
('Shanghai Tech',      'orders@shanghaitech.cn',  'China',       '2024-03-01', 12800.00),
('Rome Design Studio', 'info@romedesign.it',      'Italy',       '2024-03-20',  6750.00),
('Berlin Startup Hub', 'office@berlinstartup.de', 'Germany',     '2024-04-05',  9100.00),
('Tokyo Innovations',  'sales@tokyoinno.jp',      'Japan',       '2024-04-22', 11200.00),
('Paris Creative',     'orders@pariscreative.fr', 'France',      '2024-05-10',  5600.00),
('Nordic Systems',     'order@nordicsys.se',      'Sweden',      '2024-06-01',  7300.00),
('Sao Paulo Digital',  'sales@spdigital.br',      'Brazil',      '2024-06-18',  3800.00),
('Sydney Tech Group',  'orders@sydneytech.au',    'Australia',   '2024-07-05',  6200.00),
('Mumbai Solutions',   'buy@mumbaisol.in',        'India',       '2024-07-20',  4100.00),
('Toronto Software',   'orders@torontosw.ca',     'Canada',      '2024-08-01',  8400.00),
('Amsterdam AI Lab',   'info@amsterdamai.nl',     'Netherlands', '2024-08-15',  9800.00),
('Seoul Electronics',  'orders@seoulelec.kr',     'South Korea', '2024-09-01',  7600.00);

INSERT INTO orders (customer_id, order_date, status, total) VALUES
(1,  '2024-06-15', 'delivered', 1634.97),
(1,  '2024-08-20', 'delivered', 2099.97),
(2,  '2024-06-22', 'delivered', 1048.00),
(2,  '2024-09-10', 'shipped',    449.98),
(3,  '2024-07-01', 'delivered',  714.98),
(4,  '2024-07-15', 'delivered', 3389.96),
(4,  '2024-10-01', 'confirmed',  669.97),
(5,  '2024-08-05', 'delivered', 1108.98),
(5,  '2024-11-10', 'pending',    149.97),
(6,  '2024-08-18', 'delivered', 1799.97),
(7,  '2024-09-01', 'delivered', 2549.96),
(7,  '2024-11-15', 'shipped',    389.99),
(8,  '2024-09-20', 'delivered',  764.97),
(9,  '2024-10-05', 'delivered', 1239.97),
(10, '2024-10-20', 'shipped',    479.98),
(11, '2024-11-01', 'confirmed', 1949.97),
(12, '2024-11-10', 'pending',    394.97),
(13, '2024-11-20', 'confirmed', 2179.96),
(14, '2024-12-01', 'pending',   1619.97),
(15, '2024-12-10', 'pending',    839.97);

INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES
(1,  1, 1, 1499.99), (1,  2, 1,   34.99), (1, 10, 2,   14.99),
(2,  6, 2,  389.99), (2,  1, 1, 1499.99),
(3,  3, 1,  599.00), (3,  4, 1,  449.00),
(4,  7, 2,  119.99), (4,  9, 1,   89.99), (4, 14, 4,   29.99),
(5,  5, 2,   64.99), (5,  8, 1,   49.99), (5,  3, 1,  599.00),
(6,  1, 2, 1499.99), (6,  6, 1,  389.99),
(7, 11, 1,  279.99), (7,  6, 1,  389.99),
(8,  4, 1,  449.00), (8,  7, 1,  119.99), (8, 12, 3,   59.99), (8, 8, 1, 49.99), (8, 15, 1, 89.99),
(9, 10, 5,   14.99), (9, 14, 2,   29.99),
(10, 1, 1, 1499.99), (10, 2, 1,   34.99), (10, 5, 1,   64.99), (10, 12, 1, 59.99), (10, 7, 1, 119.99),
(11, 1, 1, 1499.99), (11, 4, 1,  449.00), (11, 3, 1,  599.00),
(12, 6, 1,  389.99),
(13, 3, 1,  599.00), (13, 8, 2,   49.99), (13, 10, 3, 14.99), (13, 12, 1, 59.99),
(14, 11, 1, 279.99), (14, 13, 2, 109.99), (14, 1, 1, 1499.99),
(15, 4, 1,  449.00), (15, 14, 1,  29.99),
(16, 1, 1, 1499.99), (16, 4, 1,  449.00),
(17, 5, 2,   64.99), (17, 9, 1,   89.99), (17, 12, 1, 59.99), (17, 14, 4, 29.99),
(18, 1, 1, 1499.99), (18, 6, 1,  389.99), (18, 11, 1, 279.99),
(19, 1, 1, 1499.99), (19, 7, 1,  119.99),
(20, 11, 1, 279.99), (20, 13, 2, 109.99), (20, 9, 1,  89.99), (20, 7, 1, 119.99);
