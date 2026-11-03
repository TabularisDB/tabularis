-- =============================================================
-- Tabularis Demo — CRM wide-table showcase (PostgreSQL 16)
-- Database: crm_demo
-- Tables:   account_managers   ->   8 rows
--           customer_360       ->  99 columns x 240 rows
-- Purpose:  a realistic, very wide table for the transposed grid
--           view (#561): readable names, mixed types, NULLs, JSONB,
--           long text, an FK and masked columns (email, phone).
-- =============================================================

CREATE DATABASE crm_demo;

\connect crm_demo

DROP TABLE IF EXISTS customer_360;
DROP TABLE IF EXISTS account_managers;

CREATE TABLE account_managers (
    id          INTEGER PRIMARY KEY,
    full_name   VARCHAR(80) NOT NULL,
    region      VARCHAR(40) NOT NULL,
    team        VARCHAR(40) NOT NULL,
    hired_on    DATE NOT NULL
);

INSERT INTO account_managers (id, full_name, region, team, hired_on) VALUES
    (1, 'Priya Raman',      'EMEA',     'Enterprise', '2019-03-11'),
    (2, 'Marcus Oyelaran',  'EMEA',     'Mid-market', '2021-07-01'),
    (3, 'Hana Kobayashi',   'APAC',     'Enterprise', '2018-11-19'),
    (4, 'Diego Fernández',  'LATAM',    'Mid-market', '2022-02-14'),
    (5, 'Sofia Lindqvist',  'EMEA',     'SMB',        '2023-05-08'),
    (6, 'Jamal Whitaker',   'Americas', 'Enterprise', '2017-09-25'),
    (7, 'Mei-Ling Chou',    'APAC',     'SMB',        '2024-01-15'),
    (8, 'Olivia Brennan',   'Americas', 'Mid-market', '2020-10-05');

CREATE TABLE customer_360 (
    -- Identity
    id                      INTEGER PRIMARY KEY,
    customer_code           VARCHAR(12) NOT NULL UNIQUE,
    first_name              VARCHAR(40) NOT NULL,
    last_name               VARCHAR(40) NOT NULL,
    email                   VARCHAR(120) NOT NULL,
    phone                   VARCHAR(24),
    date_of_birth           DATE,
    preferred_language      CHAR(2) NOT NULL,
    nationality             CHAR(2),
    -- Company
    company_name            VARCHAR(80),
    job_title               VARCHAR(60),
    industry                VARCHAR(40),
    company_size            VARCHAR(12),
    website                 VARCHAR(120),
    vat_number              VARCHAR(20),
    -- Billing address
    billing_street          VARCHAR(80),
    billing_city            VARCHAR(40),
    billing_region          VARCHAR(40),
    billing_postcode        VARCHAR(12),
    billing_country         CHAR(2),
    -- Shipping address
    shipping_same_as_billing BOOLEAN NOT NULL,
    shipping_street         VARCHAR(80),
    shipping_city           VARCHAR(40),
    shipping_region         VARCHAR(40),
    shipping_postcode       VARCHAR(12),
    shipping_country        CHAR(2),
    timezone                VARCHAR(40),
    latitude                NUMERIC(9,6),
    longitude               NUMERIC(9,6),
    -- Account
    account_manager_id      INTEGER REFERENCES account_managers(id),
    account_status          VARCHAR(16) NOT NULL,
    tier                    VARCHAR(12) NOT NULL,
    segment                 VARCHAR(24),
    persona                 VARCHAR(32),
    signup_source           VARCHAR(24),
    referral_code           VARCHAR(12),
    is_verified             BOOLEAN NOT NULL,
    is_vip                  BOOLEAN NOT NULL,
    is_test_account         BOOLEAN NOT NULL,
    signup_at               TIMESTAMP NOT NULL,
    first_order_at          TIMESTAMP,
    last_order_at           TIMESTAMP,
    last_login_at           TIMESTAMP,
    last_contacted_at       TIMESTAMP,
    renewal_date            DATE,
    churned_at              TIMESTAMP,
    churn_reason            VARCHAR(60),
    -- Subscription & billing
    plan_name               VARCHAR(24) NOT NULL,
    billing_cycle           VARCHAR(10) NOT NULL,
    plan_price              NUMERIC(10,2) NOT NULL,
    currency                CHAR(3) NOT NULL,
    discount_pct            NUMERIC(5,2) NOT NULL,
    seats_purchased         INTEGER NOT NULL,
    seats_active            INTEGER NOT NULL,
    payment_method          VARCHAR(16),
    card_brand              VARCHAR(12),
    card_last4              CHAR(4),
    card_expiry             CHAR(5),
    credit_limit            NUMERIC(12,2),
    balance_due             NUMERIC(12,2) NOT NULL,
    days_past_due           INTEGER NOT NULL,
    -- Commerce metrics
    lifetime_value          NUMERIC(12,2) NOT NULL,
    total_orders            INTEGER NOT NULL,
    avg_order_value         NUMERIC(10,2),
    total_returns           INTEGER NOT NULL,
    refund_rate_pct         NUMERIC(5,2) NOT NULL,
    favourite_category      VARCHAR(32),
    -- Support
    open_tickets            INTEGER NOT NULL,
    total_tickets           INTEGER NOT NULL,
    avg_first_response_hrs  NUMERIC(6,2),
    csat_score              NUMERIC(3,2),
    nps_score               SMALLINT,
    last_ticket_subject     VARCHAR(120),
    -- Marketing
    email_opt_in            BOOLEAN NOT NULL,
    sms_opt_in              BOOLEAN NOT NULL,
    push_opt_in             BOOLEAN NOT NULL,
    newsletter_frequency    VARCHAR(12),
    utm_source              VARCHAR(24),
    utm_medium              VARCHAR(24),
    utm_campaign            VARCHAR(48),
    -- Product usage (last 30 days)
    sessions_30d            INTEGER NOT NULL,
    page_views_30d          INTEGER NOT NULL,
    avg_session_minutes     NUMERIC(6,2) NOT NULL,
    mobile_share_pct        NUMERIC(5,2) NOT NULL,
    api_calls_30d           BIGINT NOT NULL,
    storage_used_gb         NUMERIC(10,2) NOT NULL,
    feature_flags           JSONB NOT NULL,
    preferences             JSONB NOT NULL,
    -- Risk & compliance
    risk_score              SMALLINT NOT NULL,
    risk_band               VARCHAR(8) NOT NULL,
    chargebacks             INTEGER NOT NULL,
    kyc_status              VARCHAR(12) NOT NULL,
    kyc_verified_at         TIMESTAMP,
    gdpr_erasure_requested  BOOLEAN NOT NULL,
    -- Notes & audit
    notes                   TEXT,
    created_at              TIMESTAMP NOT NULL,
    updated_at              TIMESTAMP NOT NULL,
    updated_by              VARCHAR(40) NOT NULL,
    row_version             INTEGER NOT NULL
);

INSERT INTO customer_360
SELECT
    g,
    'CUS-' || lpad(g::text, 6, '0'),
    fn,
    ln,
    lower(fn) || '.' || lower(replace(ln, ' ', '')) || '@' || dom,
    CASE WHEN g % 9 = 0 THEN NULL
         ELSE '+' || cc_dial || ' ' || (200 + (g * 37) % 700)::text || ' ' || lpad(((g * 7919) % 10000)::text, 4, '0') || ' ' || lpad(((g * 104729) % 1000)::text, 3, '0') END,
    CASE WHEN g % 7 = 0 THEN NULL ELSE DATE '1958-01-01' + ((g * 2903) % 16000) END,
    lang,
    CASE WHEN g % 11 = 0 THEN NULL ELSE country END,
    CASE WHEN g % 6 = 0 THEN NULL ELSE company END,
    CASE WHEN g % 6 = 0 THEN NULL ELSE (ARRAY['Head of Data','CTO','Finance Manager','Operations Lead','Founder','Procurement Officer','Engineering Manager','Analyst','VP Sales','Product Owner'])[1 + (g * 3) % 10] END,
    CASE WHEN g % 6 = 0 THEN NULL ELSE (ARRAY['Retail','Logistics','Healthcare','Fintech','Manufacturing','Media','Education','Hospitality','Energy','SaaS'])[1 + (g * 7) % 10] END,
    CASE WHEN g % 6 = 0 THEN NULL ELSE (ARRAY['1-10','11-50','51-200','201-1000','1000+'])[1 + (g * 5) % 5] END,
    CASE WHEN g % 6 = 0 THEN NULL ELSE 'https://' || lower(replace(replace(company, ' ', ''), '&', 'and')) || '.example' END,
    CASE WHEN g % 6 = 0 OR g % 4 = 0 THEN NULL ELSE upper(country) || lpad(((g * 982451) % 1000000000)::text, 9, '0') END,
    (10 + (g * 13) % 190)::text || ' ' || street,
    city,
    region,
    postcode,
    country,
    g % 5 <> 0,
    CASE WHEN g % 5 = 0 THEN (1 + (g * 17) % 90)::text || ' Warehouse Road' END,
    CASE WHEN g % 5 = 0 THEN city END,
    CASE WHEN g % 5 = 0 THEN region END,
    CASE WHEN g % 5 = 0 THEN postcode END,
    CASE WHEN g % 5 = 0 THEN country END,
    tz,
    round((lat + ((g * 31) % 100) / 1000.0)::numeric, 6),
    round((lon + ((g * 53) % 100) / 1000.0)::numeric, 6),
    CASE WHEN g % 13 = 0 THEN NULL ELSE 1 + (g * 3) % 8 END,
    status,
    tier,
    (ARRAY['Growth','Core','At risk','Champions','Dormant','New'])[1 + (g * 11) % 6],
    (ARRAY['Data-driven buyer','Budget guardian','Power user','Occasional shopper','Team admin'])[1 + (g * 7) % 5],
    (ARRAY['Organic search','Paid social','Partner','Referral','Trade show','Direct'])[1 + (g * 5) % 6],
    CASE WHEN g % 3 = 0 THEN 'REF-' || upper(substr(md5(g::text), 1, 6)) END,
    g % 8 <> 0,
    tier = 'Platinum',
    g % 61 = 0,
    signup,
    CASE WHEN g % 10 = 0 THEN NULL ELSE signup + ((g * 3) % 40) * INTERVAL '1 day' END,
    CASE WHEN g % 10 = 0 THEN NULL ELSE TIMESTAMP '2026-10-30 18:00' - ((g * 7) % 300) * INTERVAL '1 day' - ((g * 13) % 1440) * INTERVAL '1 minute' END,
    TIMESTAMP '2026-10-31 09:00' - ((g * 11) % 90) * INTERVAL '1 day' - ((g * 29) % 1440) * INTERVAL '1 minute',
    CASE WHEN g % 4 = 0 THEN NULL ELSE TIMESTAMP '2026-10-28 15:30' - ((g * 5) % 120) * INTERVAL '1 day' END,
    CASE WHEN status = 'churned' THEN NULL ELSE DATE '2026-11-01' + ((g * 19) % 365) END,
    CASE WHEN status = 'churned' THEN TIMESTAMP '2026-09-30' - ((g * 3) % 200) * INTERVAL '1 day' END,
    CASE WHEN status = 'churned' THEN (ARRAY['Switched to competitor','Budget cuts','Missing integration','Company acquired','Poor onboarding'])[1 + g % 5] END,
    plan,
    cycle,
    price,
    cur,
    (ARRAY[0, 0, 0, 5, 10, 15, 20])[1 + (g * 3) % 7],
    seats,
    greatest(1, seats - (g * 7) % (seats + 1)),
    (ARRAY['card','card','card','sepa_debit','invoice','paypal'])[1 + (g * 5) % 6],
    CASE WHEN (g * 5) % 6 < 3 THEN (ARRAY['Visa','Mastercard','Amex'])[1 + g % 3] END,
    CASE WHEN (g * 5) % 6 < 3 THEN lpad(((g * 4513) % 10000)::text, 4, '0') END,
    CASE WHEN (g * 5) % 6 < 3 THEN lpad((1 + g % 12)::text, 2, '0') || '/' || (27 + g % 4)::text END,
    CASE WHEN tier IN ('Gold', 'Platinum') THEN (5000 + (g * 250) % 45000)::numeric END,
    CASE WHEN g % 4 = 0 THEN round(((g * 173) % 250000) / 100.0, 2) ELSE 0 END,
    CASE WHEN g % 4 = 0 THEN (g * 7) % 75 ELSE 0 END,
    ltv,
    orders,
    CASE WHEN orders = 0 THEN NULL ELSE round(ltv / orders, 2) END,
    (g * 3) % 9,
    round((((g * 17) % 120) / 10.0)::numeric, 2),
    (ARRAY['Office supplies','Electronics','Software licences','Furniture','Packaging','Lab equipment', NULL])[1 + (g * 3) % 7],
    (g * 7) % 4,
    3 + (g * 11) % 40,
    CASE WHEN g % 12 = 0 THEN NULL ELSE round((((g * 41) % 4800) / 100.0)::numeric, 2) END,
    CASE WHEN g % 9 = 0 THEN NULL ELSE round((3 + ((g * 23) % 200) / 100.0)::numeric, 2) END,
    CASE WHEN g % 8 = 0 THEN NULL ELSE ((g * 37) % 21) - 10 END,
    (ARRAY['Invoice shows wrong VAT rate','Cannot add a new seat','Export to CSV times out','SSO login loop after password reset','Refund still pending after 14 days','Feature request: dark mode in reports', NULL])[1 + (g * 5) % 7],
    g % 3 <> 0,
    g % 4 = 0,
    g % 2 = 0,
    (ARRAY['weekly','monthly','never', NULL])[1 + (g * 3) % 4],
    (ARRAY['google','linkedin','newsletter','partner_portal','bing', NULL])[1 + (g * 7) % 6],
    (ARRAY['cpc','social','email','referral', NULL])[1 + (g * 3) % 5],
    (ARRAY['spring_launch_2026','q3_enterprise_push','webinar_data_quality','black_friday_2025', NULL])[1 + (g * 11) % 5],
    (g * 37) % 180,
    (g * 211) % 4200,
    round((((g * 29) % 550) / 10.0)::numeric, 2),
    round((((g * 43) % 1000) / 10.0)::numeric, 2),
    ((g::bigint * 982451653) % 2500000),
    round((((g * 613) % 50000) / 100.0)::numeric, 2),
    jsonb_build_object(
        'beta_reports', g % 3 = 0,
        'new_checkout', g % 2 = 0,
        'ai_assistant', g % 5 = 0,
        'rollout_cohort', 'cohort-' || (1 + g % 4)
    ),
    jsonb_build_object(
        'theme', (ARRAY['light','dark','system'])[1 + g % 3],
        'digest', jsonb_build_object('enabled', g % 2 = 0, 'day', (ARRAY['mon','wed','fri'])[1 + g % 3]),
        'dashboard_widgets', jsonb_build_array('revenue', 'orders', (ARRAY['tickets','usage','churn'])[1 + g % 3])
    ),
    risk,
    CASE WHEN risk >= 70 THEN 'high' WHEN risk >= 35 THEN 'medium' ELSE 'low' END,
    CASE WHEN risk >= 70 THEN 1 + g % 3 ELSE 0 END,
    (ARRAY['verified','verified','verified','pending','failed','not_required'])[1 + (g * 7) % 6],
    CASE WHEN (g * 7) % 6 < 3 THEN signup + ((g % 20) + 1) * INTERVAL '1 day' END,
    g % 97 = 0,
    CASE WHEN g % 3 = 0 THEN NULL
         ELSE (ARRAY[
            'Prefers calls on Tuesday mornings. Evaluating the analytics add-on for the finance team; follow up after their quarterly planning.',
            'Migrated from the legacy plan in 2025. Asked twice about volume discounts on additional seats — loop in the account manager before renewal.',
            'Very engaged on the community forum. Reported the CSV export timeout that was fixed in 4.2; good candidate for the beta programme.',
            'Procurement requires PO numbers on every invoice. Do not send invoices without one; they will be rejected and paid late.',
            'Champion left the company in August. New contact not yet identified; usage has been flat since.'
         ])[1 + (g * 3) % 5] END,
    signup,
    TIMESTAMP '2026-10-31 08:00' - ((g * 17) % 60) * INTERVAL '1 day',
    (ARRAY['system','crm-sync','priya.raman','marcus.o','support-bot'])[1 + g % 5],
    1 + (g * 7) % 12
FROM (
    SELECT
        g,
        (ARRAY['Ava','Noah','Mia','Liam','Zara','Mateo','Yuki','Amara','Lukas','Ines','Omar','Freya','Ravi','Chloe','Tomás','Leila','Kai','Nora','Elias','Sana'])[1 + (g * 7) % 20] AS fn,
        (ARRAY['Hughes','Okafor','Schneider','Rossi','Tanaka','García','Novak','Haddad','Johansson','Silva','Park','Dubois','Kowalski','Murphy','Van Dijk','Moreau','Ali','Costa','Nguyen','Bauer'])[1 + (g * 13) % 20] AS ln,
        (ARRAY['gmail.example','outlook.example','proton.example','company.example'])[1 + (g * 3) % 4] AS dom,
        (ARRAY['Northwind Traders','Bluebird Analytics','Granite & Co','Helix Health','Orbit Logistics','Pinecone Studio','Quantum Kitchens','Riverbank Energy','Solstice Media','Tidewater Retail','Umbra Robotics','Vantage Learning'])[1 + (g * 5) % 12] AS company,
        c.country, c.city, c.region, c.postcode, c.street, c.tz, c.lat, c.lon, c.lang, c.cc_dial, c.cur,
        (ARRAY['active','active','active','active','trial','paused','churned'])[1 + (g * 3) % 7] AS status,
        (ARRAY['Bronze','Silver','Silver','Gold','Gold','Platinum'])[1 + (g * 5) % 6] AS tier,
        (ARRAY['Starter','Team','Business','Enterprise'])[1 + (g * 3) % 4] AS plan,
        (ARRAY['monthly','annual'])[1 + g % 2] AS cycle,
        (ARRAY[29.00, 99.00, 299.00, 1490.00])[1 + (g * 3) % 4] AS price,
        1 + (g * 7) % 120 AS seats,
        round(((g * 7919) % 9000000) / 100.0, 2) AS ltv,
        (g * 13) % 160 AS orders,
        ((g * 37) % 100)::smallint AS risk,
        TIMESTAMP '2019-01-01 09:00' + ((g * 6151) % 2700) * INTERVAL '1 day' + ((g * 97) % 1440) * INTERVAL '1 minute' AS signup
    FROM generate_series(1, 240) AS g
    CROSS JOIN LATERAL (
        SELECT * FROM (VALUES
            (0, 'GB', 'London',     'England',            'EC1A 1BB', 'Baker Street',       'Europe/London',       51.507, -0.128, 'en', '44',  'GBP'),
            (1, 'DE', 'Berlin',     'Berlin',             '10115',    'Torstraße',          'Europe/Berlin',       52.520, 13.405, 'de', '49',  'EUR'),
            (2, 'FR', 'Lyon',       'Auvergne-Rhône-Alpes','69002',   'Rue de la République','Europe/Paris',       45.764,  4.836, 'fr', '33',  'EUR'),
            (3, 'IT', 'Milan',      'Lombardy',           '20121',    'Via Torino',         'Europe/Rome',         45.464,  9.190, 'it', '39',  'EUR'),
            (4, 'ES', 'Valencia',   'Valencian Community','46002',    'Carrer de Colón',    'Europe/Madrid',       39.470, -0.376, 'es', '34',  'EUR'),
            (5, 'US', 'Austin',     'Texas',              '78701',    'Congress Avenue',    'America/Chicago',     30.267,-97.743, 'en', '1',   'USD'),
            (6, 'US', 'Seattle',    'Washington',         '98101',    'Pine Street',        'America/Los_Angeles', 47.606,-122.332,'en', '1',   'USD'),
            (7, 'JP', 'Osaka',      'Osaka',              '530-0001', 'Umeda',              'Asia/Tokyo',          34.694,135.502, 'ja', '81',  'JPY'),
            (8, 'BR', 'São Paulo',  'São Paulo',          '01310-100','Avenida Paulista',   'America/Sao_Paulo',  -23.551,-46.633, 'pt', '55',  'BRL'),
            (9, 'AU', 'Melbourne',  'Victoria',           '3000',     'Collins Street',     'Australia/Melbourne',-37.814,144.963, 'en', '61',  'AUD'),
            (10,'NL', 'Utrecht',    'Utrecht',            '3511 AA',  'Oudegracht',         'Europe/Amsterdam',    52.091,  5.122, 'nl', '31',  'EUR'),
            (11,'KR', 'Seoul',      'Seoul',              '04524',    'Sejong-daero',       'Asia/Seoul',          37.566,126.978, 'ko', '82',  'KRW')
        ) AS v(k, country, city, region, postcode, street, tz, lat, lon, lang, cc_dial, cur)
        WHERE v.k = (g * 7) % 12
    ) AS c
) AS src;
