-- =============================================================
-- Tabularis Demo — Web analytics (PostgreSQL 16)
-- Database: analytics_demo
-- Domain: Sessions, page views, custom events (JSONB properties)
-- =============================================================

CREATE DATABASE analytics_demo;

\connect analytics_demo

CREATE TABLE IF NOT EXISTS visitors (
    id SERIAL PRIMARY KEY,
    visitor_uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    country VARCHAR(50) NOT NULL,
    first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    referrer_source VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    visitor_id INT NOT NULL REFERENCES visitors(id),
    started_at TIMESTAMP NOT NULL,
    ended_at TIMESTAMP,
    device VARCHAR(20) NOT NULL CHECK (device IN ('desktop', 'mobile', 'tablet')),
    browser VARCHAR(30) NOT NULL,
    landing_path VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS page_views (
    id SERIAL PRIMARY KEY,
    session_id INT NOT NULL REFERENCES sessions(id),
    path VARCHAR(255) NOT NULL,
    referrer VARCHAR(255),
    duration_ms INT NOT NULL DEFAULT 0,
    viewed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    session_id INT NOT NULL REFERENCES sessions(id),
    name VARCHAR(80) NOT NULL,
    properties JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_name ON events(name);
CREATE INDEX IF NOT EXISTS idx_events_properties ON events USING GIN (properties);
CREATE INDEX IF NOT EXISTS idx_page_views_path ON page_views(path);

INSERT INTO visitors (country, first_seen_at, referrer_source) VALUES
('USA',         '2025-10-01 08:12:00', 'google'),
('Germany',     '2025-10-01 09:45:00', 'twitter'),
('UK',          '2025-10-02 11:20:00', 'direct'),
('France',      '2025-10-03 14:05:00', 'newsletter'),
('Italy',       '2025-10-04 09:00:00', 'google'),
('Japan',       '2025-10-05 03:30:00', 'producthunt'),
('Brazil',      '2025-10-06 16:10:00', 'google'),
('Canada',      '2025-10-07 12:00:00', 'github'),
('Spain',       '2025-10-08 10:25:00', 'twitter'),
('Australia',   '2025-10-09 22:40:00', 'direct'),
('India',       '2025-10-10 06:50:00', 'google'),
('Netherlands', '2025-10-11 13:15:00', 'newsletter');

INSERT INTO sessions (visitor_id, started_at, ended_at, device, browser, landing_path) VALUES
(1,  '2025-10-01 08:12:00', '2025-10-01 08:24:13', 'desktop', 'Chrome',  '/'),
(1,  '2025-10-05 19:00:00', '2025-10-05 19:08:30', 'mobile',  'Safari',  '/pricing'),
(2,  '2025-10-01 09:45:00', '2025-10-01 09:51:02', 'desktop', 'Firefox', '/blog/postgres-tips'),
(3,  '2025-10-02 11:20:00', '2025-10-02 11:35:11', 'desktop', 'Chrome',  '/'),
(4,  '2025-10-03 14:05:00', '2025-10-03 14:09:50', 'tablet',  'Safari',  '/features'),
(5,  '2025-10-04 09:00:00', '2025-10-04 09:18:22', 'desktop', 'Edge',    '/'),
(6,  '2025-10-05 03:30:00', '2025-10-05 03:42:15', 'mobile',  'Chrome',  '/download'),
(7,  '2025-10-06 16:10:00', '2025-10-06 16:14:40', 'mobile',  'Chrome',  '/'),
(8,  '2025-10-07 12:00:00', '2025-10-07 12:25:33', 'desktop', 'Chrome',  '/docs/quickstart'),
(9,  '2025-10-08 10:25:00', '2025-10-08 10:31:00', 'desktop', 'Safari',  '/'),
(10, '2025-10-09 22:40:00', '2025-10-09 22:55:48', 'desktop', 'Firefox', '/blog/llm-eval'),
(11, '2025-10-10 06:50:00', '2025-10-10 06:53:20', 'mobile',  'Chrome',  '/pricing'),
(12, '2025-10-11 13:15:00', '2025-10-11 13:42:05', 'desktop', 'Chrome',  '/'),
(2,  '2025-10-12 08:30:00', '2025-10-12 08:36:11', 'desktop', 'Firefox', '/changelog'),
(4,  '2025-10-13 17:00:00', '2025-10-13 17:11:25', 'mobile',  'Safari',  '/');

INSERT INTO page_views (session_id, path, referrer, duration_ms, viewed_at) VALUES
(1,  '/',                'https://google.com',          18230, '2025-10-01 08:12:00'),
(1,  '/features',        '/',                            42100, '2025-10-01 08:13:30'),
(1,  '/pricing',         '/features',                    21500, '2025-10-01 08:15:10'),
(1,  '/signup',          '/pricing',                     56800, '2025-10-01 08:17:00'),
(2,  '/pricing',         'https://t.co/abc',             19800, '2025-10-05 19:00:00'),
(2,  '/features',        '/pricing',                     32400, '2025-10-05 19:02:00'),
(3,  '/blog/postgres-tips','https://twitter.com',        87600, '2025-10-01 09:45:00'),
(4,  '/',                'https://news.example.com',     14200, '2025-10-02 11:20:00'),
(4,  '/features',        '/',                            61300, '2025-10-02 11:22:00'),
(4,  '/docs/quickstart', '/features',                    98400, '2025-10-02 11:25:00'),
(5,  '/features',        'https://mail.example.com',     28100, '2025-10-03 14:05:00'),
(6,  '/',                'https://google.com',           22000, '2025-10-04 09:00:00'),
(6,  '/blog/llm-eval',   '/',                           145300, '2025-10-04 09:03:00'),
(6,  '/pricing',         '/blog/llm-eval',               34200, '2025-10-04 09:14:00'),
(7,  '/download',        'https://producthunt.com',      52100, '2025-10-05 03:30:00'),
(8,  '/',                'https://google.com',           11500, '2025-10-06 16:10:00'),
(9,  '/docs/quickstart', 'https://github.com',           81200, '2025-10-07 12:00:00'),
(9,  '/docs/connections','/docs/quickstart',            124500, '2025-10-07 12:08:00'),
(9,  '/docs/notebooks',  '/docs/connections',           198400, '2025-10-07 12:15:00'),
(10, '/',                'https://twitter.com',          19800, '2025-10-08 10:25:00'),
(11, '/blog/llm-eval',   'https://news.example.com',     92300, '2025-10-09 22:40:00'),
(11, '/features',        '/blog/llm-eval',               54100, '2025-10-09 22:46:00'),
(12, '/pricing',         'https://google.com',           21000, '2025-10-10 06:50:00'),
(13, '/',                'https://mail.example.com',     16800, '2025-10-11 13:15:00'),
(13, '/features',        '/',                            73200, '2025-10-11 13:18:00'),
(13, '/pricing',         '/features',                    44800, '2025-10-11 13:23:00'),
(13, '/signup',          '/pricing',                    198000, '2025-10-11 13:30:00'),
(14, '/changelog',       'https://twitter.com',          47100, '2025-10-12 08:30:00'),
(15, '/',                'https://google.com',           23400, '2025-10-13 17:00:00');

INSERT INTO events (session_id, name, properties, occurred_at) VALUES
(1,  'cta_click',         '{"label": "Try free", "location": "hero"}',                  '2025-10-01 08:13:00'),
(1,  'pricing_view',      '{"plan_shown": "team"}',                                     '2025-10-01 08:15:30'),
(1,  'signup_started',    '{"plan": "team", "trial_days": 14}',                         '2025-10-01 08:17:30'),
(1,  'signup_completed',  '{"plan": "team", "method": "email"}',                        '2025-10-01 08:19:45'),
(2,  'pricing_view',      '{"plan_shown": "solo"}',                                     '2025-10-05 19:00:30'),
(2,  'cta_click',         '{"label": "Compare plans", "location": "pricing"}',          '2025-10-05 19:03:00'),
(3,  'blog_read',         '{"slug": "postgres-tips", "read_percent": 92}',              '2025-10-01 09:48:00'),
(3,  'newsletter_signup', '{"source": "blog"}',                                         '2025-10-01 09:50:30'),
(4,  'cta_click',         '{"label": "View docs", "location": "header"}',               '2025-10-02 11:24:00'),
(4,  'docs_search',       '{"query": "json column", "results": 7}',                     '2025-10-02 11:27:00'),
(5,  'cta_click',         '{"label": "See features", "location": "newsletter"}',        '2025-10-03 14:06:00'),
(6,  'blog_read',         '{"slug": "llm-eval", "read_percent": 100}',                  '2025-10-04 09:10:00'),
(6,  'cta_click',         '{"label": "Start trial", "location": "blog_footer"}',        '2025-10-04 09:14:30'),
(7,  'download_started',  '{"platform": "macos-arm64", "version": "1.4.2"}',            '2025-10-05 03:31:00'),
(7,  'download_completed','{"platform": "macos-arm64", "size_mb": 96}',                 '2025-10-05 03:32:45'),
(8,  'cta_click',         '{"label": "Watch demo", "location": "hero"}',                '2025-10-06 16:11:00'),
(9,  'docs_search',       '{"query": "mssql platform", "results": 3}',                  '2025-10-07 12:05:00'),
(9,  'docs_search',       '{"query": "import connections", "results": 5}',              '2025-10-07 12:12:00'),
(9,  'feedback_thumbs',   '{"value": "up", "page": "/docs/notebooks"}',                 '2025-10-07 12:24:00'),
(10, 'cta_click',         '{"label": "Try free", "location": "hero"}',                  '2025-10-08 10:27:00'),
(11, 'blog_read',         '{"slug": "llm-eval", "read_percent": 78}',                   '2025-10-09 22:43:30'),
(11, 'share_clicked',     '{"network": "twitter", "slug": "llm-eval"}',                 '2025-10-09 22:50:00'),
(12, 'pricing_view',      '{"plan_shown": "team"}',                                     '2025-10-10 06:51:00'),
(13, 'signup_started',    '{"plan": "solo", "trial_days": 14}',                         '2025-10-11 13:31:00'),
(13, 'signup_completed',  '{"plan": "solo", "method": "google"}',                       '2025-10-11 13:33:20'),
(14, 'changelog_view',    '{"version": "1.4.2"}',                                       '2025-10-12 08:32:00'),
(15, 'cta_click',         '{"label": "Try free", "location": "hero"}',                  '2025-10-13 17:02:00');
