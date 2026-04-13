-- ================================================================
--  InsightDash AI — Demo Database Seed Script
--  Works with PostgreSQL
--  Run: psql -U postgres -d your_db -f seed_demo_db.sql
-- ================================================================

-- ── Drop existing tables ─────────────────────────────────────────
DROP TABLE IF EXISTS sales       CASCADE;
DROP TABLE IF EXISTS purchases   CASCADE;
DROP TABLE IF EXISTS items       CASCADE;
DROP TABLE IF EXISTS categories  CASCADE;
DROP TABLE IF EXISTS branches    CASCADE;
DROP TABLE IF EXISTS customers   CASCADE;
DROP TABLE IF EXISTS suppliers   CASCADE;

-- ── Categories ───────────────────────────────────────────────────
CREATE TABLE categories (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    description TEXT
);

INSERT INTO categories (name, description) VALUES
    ('Electronics',   'Computers, phones, gadgets'),
    ('Furniture',     'Office and home furniture'),
    ('Stationery',    'Pens, notebooks, paper'),
    ('Software',      'Licenses and subscriptions'),
    ('Accessories',   'Cables, bags, peripherals');

-- ── Branches ────────────────────────────────────────────────────
CREATE TABLE branches (
    id      SERIAL PRIMARY KEY,
    name    VARCHAR(100) NOT NULL,
    city    VARCHAR(100),
    region  VARCHAR(50)
);

INSERT INTO branches (name, city, region) VALUES
    ('Head Office',     'Mumbai',    'West'),
    ('North Branch',    'Delhi',     'North'),
    ('South Branch',    'Chennai',   'South'),
    ('East Branch',     'Kolkata',   'East'),
    ('West Branch',     'Ahmedabad', 'West');

-- ── Items (Products) ────────────────────────────────────────────
CREATE TABLE items (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(200) NOT NULL,
    category_id   INTEGER REFERENCES categories(id),
    sku           VARCHAR(50) UNIQUE,
    price         NUMERIC(10,2) NOT NULL,
    cost_price    NUMERIC(10,2) NOT NULL,
    stock         INTEGER DEFAULT 0,
    reorder_level INTEGER DEFAULT 10,
    created_at    TIMESTAMP DEFAULT NOW()
);

INSERT INTO items (name, category_id, sku, price, cost_price, stock, reorder_level) VALUES
    ('Laptop Pro 15"',       1, 'ELEC-001', 85000,  60000, 45,  5),
    ('Wireless Mouse',       1, 'ELEC-002',  1200,    600, 320, 20),
    ('Mechanical Keyboard',  1, 'ELEC-003',  3500,   1800, 180, 15),
    ('27" Monitor',          1, 'ELEC-004', 22000,  14000,  60,  5),
    ('Noise-Cancelling Headset', 1, 'ELEC-005', 8500, 4500, 95, 10),
    ('Smartphone X12',       1, 'ELEC-006', 45000,  32000,  30,  5),
    ('USB-C Hub',            1, 'ELEC-007',  2200,    900, 210, 20),
    ('Webcam HD',            1, 'ELEC-008',  4500,   2200, 125, 10),
    ('Office Chair',         2, 'FURN-001', 12000,   7000,  22,  3),
    ('Standing Desk',        2, 'FURN-002', 28000,  18000,  14,  2),
    ('Bookshelf',            2, 'FURN-003',  4500,   2500,  35,  5),
    ('A4 Paper (500 sheets)',3, 'STAT-001',   350,    180, 800, 50),
    ('Ballpoint Pens (Box)', 3, 'STAT-002',   180,     80, 600, 50),
    ('Sticky Notes Pack',    3, 'STAT-003',   120,     50, 450, 40),
    ('Whiteboard Markers',   3, 'STAT-004',   280,    120, 320, 30),
    ('MS Office License',    4, 'SOFT-001',  6500,   4000,  75, 10),
    ('Antivirus 1yr',        4, 'SOFT-002',  1800,    900, 150, 20),
    ('Laptop Bag',           5, 'ACCS-001',  2800,   1400, 140, 15),
    ('HDMI Cable 2m',        5, 'ACCS-002',   450,    180, 380, 30),
    ('Power Strip 4-port',   5, 'ACCS-003',   650,    280, 290, 25);

-- ── Customers ────────────────────────────────────────────────────
CREATE TABLE customers (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(200) NOT NULL,
    email      VARCHAR(200),
    phone      VARCHAR(20),
    city       VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO customers (name, email, city) VALUES
    ('Rahul Sharma',     'rahul@techcorp.in',    'Mumbai'),
    ('Priya Patel',      'priya@innovate.co',    'Ahmedabad'),
    ('Amit Singh',       'amit@solutions.in',    'Delhi'),
    ('Sunita Verma',     'sunita@global.com',    'Chennai'),
    ('Rajesh Kumar',     'rajesh@startups.io',   'Bangalore'),
    ('Deepa Nair',       'deepa@ventures.in',    'Kochi'),
    ('Vikram Joshi',     'vikram@enterprise.co', 'Pune'),
    ('Kavitha Reddy',    'kavitha@systems.in',   'Hyderabad'),
    ('Manoj Tiwari',     'manoj@corp.com',       'Kolkata'),
    ('Anjali Mehta',     'anjali@consult.in',    'Delhi');

-- ── Suppliers ────────────────────────────────────────────────────
CREATE TABLE suppliers (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(200) NOT NULL,
    contact    VARCHAR(200),
    city       VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO suppliers (name, contact, city) VALUES
    ('TechSource India',    'tech@source.in',   'Delhi'),
    ('Office Essentials',   'info@oe.in',       'Mumbai'),
    ('Digital Imports Co.', 'sales@digi.in',    'Chennai'),
    ('FurnCraft Ltd.',      'order@furncraft.in','Pune'),
    ('SoftwareDirect',      'license@sd.in',    'Bangalore');

-- ── Sales ────────────────────────────────────────────────────────
CREATE TABLE sales (
    id          SERIAL PRIMARY KEY,
    item_id     INTEGER NOT NULL REFERENCES items(id),
    customer_id INTEGER REFERENCES customers(id),
    branch_id   INTEGER REFERENCES branches(id),
    quantity    INTEGER NOT NULL,
    price       NUMERIC(10,2) NOT NULL,
    discount    NUMERIC(5,2) DEFAULT 0,
    total       NUMERIC(12,2) GENERATED ALWAYS AS (quantity * price * (1 - discount/100)) STORED,
    created_at  TIMESTAMP NOT NULL
);

-- Generate ~1500 sales records across last 2 years
INSERT INTO sales (item_id, customer_id, branch_id, quantity, price, discount, created_at)
SELECT
    (random() * 19 + 1)::INT,                         -- item_id 1–20
    (random() * 9  + 1)::INT,                         -- customer_id 1–10
    (random() * 4  + 1)::INT,                         -- branch_id 1–5
    (random() * 9  + 1)::INT,                         -- quantity 1–10
    i.price,
    CASE WHEN random() < 0.3 THEN round((random()*15)::NUMERIC, 1) ELSE 0 END,   -- 30% chance discount
    NOW() - (random() * 730)::INT * INTERVAL '1 day'  -- last 2 years
FROM generate_series(1, 1500) g
JOIN items i ON i.id = ((random() * 19 + 1)::INT);

-- ── Purchases (from suppliers) ────────────────────────────────────
CREATE TABLE purchases (
    id           SERIAL PRIMARY KEY,
    item_id      INTEGER NOT NULL REFERENCES items(id),
    supplier_id  INTEGER REFERENCES suppliers(id),
    branch_id    INTEGER REFERENCES branches(id),
    quantity     INTEGER NOT NULL,
    cost_price   NUMERIC(10,2) NOT NULL,
    total_cost   NUMERIC(12,2) GENERATED ALWAYS AS (quantity * cost_price) STORED,
    created_at   TIMESTAMP NOT NULL
);

INSERT INTO purchases (item_id, supplier_id, branch_id, quantity, cost_price, created_at)
SELECT
    (random() * 19 + 1)::INT,
    (random() * 4  + 1)::INT,
    (random() * 4  + 1)::INT,
    (random() * 49 + 10)::INT,
    i.cost_price,
    NOW() - (random() * 730)::INT * INTERVAL '1 day'
FROM generate_series(1, 600) g
JOIN items i ON i.id = ((random() * 19 + 1)::INT);

-- ── Useful views (optional) ──────────────────────────────────────
CREATE OR REPLACE VIEW sales_summary AS
SELECT
    i.name          AS item_name,
    c.name          AS category,
    b.name          AS branch,
    br.name         AS region,
    DATE_TRUNC('month', s.created_at)::DATE AS month,
    SUM(s.quantity)             AS total_qty,
    SUM(s.total)                AS total_revenue
FROM sales s
JOIN items      i ON s.item_id    = i.id
JOIN categories c ON i.category_id = c.id
JOIN branches   b ON s.branch_id  = b.id
LEFT JOIN branches br ON br.id = b.id
GROUP BY i.name, c.name, b.name, br.name, month;

-- ── Quick row counts ─────────────────────────────────────────────
SELECT 'items'      AS tbl, COUNT(*) FROM items
UNION ALL SELECT 'sales',     COUNT(*) FROM sales
UNION ALL SELECT 'purchases', COUNT(*) FROM purchases
UNION ALL SELECT 'customers', COUNT(*) FROM customers;
