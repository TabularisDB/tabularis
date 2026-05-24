-- =============================================================
-- Tabularis Demo — Blog CMS (MySQL 8)
-- Database: blog_demo
-- Domain: Multi-author blog with posts, comments, tags
-- =============================================================

SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS blog_demo
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE blog_demo;

CREATE TABLE IF NOT EXISTS authors (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(60) NOT NULL UNIQUE,
    display_name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    bio TEXT,
    joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS posts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    author_id INT NOT NULL,
    title VARCHAR(200) NOT NULL,
    slug VARCHAR(220) NOT NULL UNIQUE,
    body MEDIUMTEXT NOT NULL,
    status ENUM('draft', 'published', 'archived') NOT NULL DEFAULT 'draft',
    published_at DATETIME NULL,
    view_count INT NOT NULL DEFAULT 0,
    FOREIGN KEY (author_id) REFERENCES authors(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tags (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS post_tags (
    post_id INT NOT NULL,
    tag_id INT NOT NULL,
    PRIMARY KEY (post_id, tag_id),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS comments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    post_id INT NOT NULL,
    author_name VARCHAR(100) NOT NULL,
    author_email VARCHAR(150) NOT NULL,
    body TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_spam TINYINT(1) NOT NULL DEFAULT 0,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Seed: Authors
INSERT INTO authors (username, display_name, email, bio) VALUES
('jdoe',     'Jane Doe',        'jane@blogdemo.test',    'Software engineer writing about distributed systems.'),
('msmith',   'Mark Smith',      'mark@blogdemo.test',    'Product manager and former founder.'),
('lwong',    'Lisa Wong',       'lisa@blogdemo.test',    'Data scientist focused on ML in production.'),
('pkumar',   'Priya Kumar',     'priya@blogdemo.test',   'Frontend developer and accessibility advocate.'),
('aolsson',  'Anders Olsson',   'anders@blogdemo.test',  'DevOps lead, container enthusiast, mountain runner.');

-- Seed: Tags
INSERT INTO tags (name) VALUES
('databases'), ('postgres'), ('mysql'), ('performance'), ('react'),
('typescript'), ('rust'), ('docker'), ('kubernetes'), ('machine-learning'),
('career'), ('accessibility'), ('design-systems'), ('observability'), ('security');

-- Seed: Posts
INSERT INTO posts (author_id, title, slug, body, status, published_at, view_count) VALUES
(1, 'Why Your Postgres Queries Are Slow',
    'why-your-postgres-queries-are-slow',
    'A practical tour of EXPLAIN ANALYZE, missing indexes, and the cost of unnecessary sorts...',
    'published', '2025-09-12 09:30:00', 4520),
(1, 'Designing Idempotent APIs',
    'designing-idempotent-apis',
    'Idempotency keys, retries, and how to keep your billing system from double-charging customers...',
    'published', '2025-10-04 14:00:00', 2810),
(2, 'The PM Reading List I Wish I Had at 25',
    'pm-reading-list-25',
    'Seven books that actually changed how I think about product, plus a few I would skip...',
    'published', '2025-08-21 10:15:00', 6230),
(2, 'Notes on Roadmap Roulette',
    'notes-on-roadmap-roulette',
    'Why most quarterly roadmaps are wrong and how to plan for that without giving up planning...',
    'draft', NULL, 0),
(3, 'A Gentle Introduction to Vector Databases',
    'gentle-intro-vector-databases',
    'Embeddings, cosine similarity, and when you actually need a dedicated vector store...',
    'published', '2025-10-18 08:00:00', 3940),
(3, 'Evaluating LLM Outputs Without Going Insane',
    'evaluating-llm-outputs',
    'Rubrics, golden sets, and the trap of letting one model grade another...',
    'published', '2025-11-02 16:45:00', 5120),
(4, 'Accessible Modals in 2026',
    'accessible-modals-2026',
    'Focus traps, the dialog element, and the small details screen readers will not forgive...',
    'published', '2025-09-28 11:20:00', 1890),
(4, 'TypeScript Generics, Demystified',
    'typescript-generics-demystified',
    'A worked example: building a type-safe form helper that infers field names from a schema...',
    'published', '2025-11-15 13:00:00', 3260),
(5, 'Docker Compose for Local Polyglot Stacks',
    'docker-compose-polyglot-stacks',
    'How we run Postgres, Redis, Kafka, and three services locally without losing our minds...',
    'published', '2025-10-22 09:00:00', 2150),
(5, 'Tracing Slow Requests Across Three Services',
    'tracing-slow-requests',
    'OpenTelemetry, sampling decisions, and finding the one query that ate the request budget...',
    'archived', '2025-06-14 15:30:00', 980);

-- Seed: Post tags (10 posts, varied tags)
INSERT INTO post_tags (post_id, tag_id) VALUES
(1, 1), (1, 2), (1, 4),
(2, 4), (2, 15),
(3, 11),
(4, 11),
(5, 1), (5, 10),
(6, 10),
(7, 5), (7, 12), (7, 13),
(8, 5), (8, 6),
(9, 8), (9, 9), (9, 14),
(10, 14), (10, 8);

-- Seed: Comments
INSERT INTO comments (post_id, author_name, author_email, body, is_spam) VALUES
(1, 'Reader42',       'r42@example.com',     'This finally helped me understand index-only scans. Thanks!',                       0),
(1, 'DBA Mike',       'mike@example.com',    'Worth mentioning BRIN indexes for very large append-only tables.',                  0),
(1, 'cheap-watches',  'spam@spam.test',      'Buy designer watches at discount!!!',                                                1),
(2, 'Anna L.',        'anna@example.com',    'Great post. We hit exactly this issue with Stripe webhooks last year.',             0),
(3, 'Junior PM',      'jpm@example.com',     'Inspired Action was the one I needed most. Adding to my list.',                     0),
(3, 'Skeptical Sam',  'sam@example.com',     'I would swap two of these for Continuous Discovery Habits.',                        0),
(5, 'ML Curious',     'mlc@example.com',     'Any benchmark of pgvector vs Qdrant for ~10M vectors?',                              0),
(6, 'Researcher',     'res@example.com',     'The golden-set drift problem is real. We rotate ours quarterly.',                   0),
(6, 'AI Hype Guy',    'hype@example.com',    'Just use GPT-5 as a judge, problem solved.',                                        0),
(7, 'A11y Advocate',  'a11y@example.com',    'Saving this. The focus-restore detail is the one most libraries get wrong.',        0),
(8, 'TS Newbie',      'ts@example.com',      'Conditional types finally clicked after reading this.',                              0),
(9, 'Indie Dev',      'indie@example.com',   'Your healthcheck pattern saved me a weekend. Stealing it.',                          0),
(9, 'crypto-coin',    'spam@spam.test',      'Earn $$$ daily from home!!!',                                                        1),
(10, 'SRE Lead',      'sre@example.com',     'The 1% sampling decision is what most teams get wrong.',                             0);
