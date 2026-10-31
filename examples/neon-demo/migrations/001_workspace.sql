CREATE SCHEMA IF NOT EXISTS tabularis_demo;
CREATE TABLE IF NOT EXISTS tabularis_demo.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  color text NOT NULL DEFAULT '#5577ca',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id),
  UNIQUE (owner_id, name)
);
CREATE TABLE IF NOT EXISTS tabularis_demo.notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  project_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 180),
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 40000),
  summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id),
  FOREIGN KEY (project_id, owner_id) REFERENCES tabularis_demo.projects(id, owner_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS demo_notes_owner_updated ON tabularis_demo.notes(owner_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS tabularis_demo.attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  note_id uuid NOT NULL,
  object_key text NOT NULL UNIQUE,
  name text NOT NULL,
  size integer NOT NULL CHECK (size BETWEEN 1 AND 4194304),
  content_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (note_id, owner_id) REFERENCES tabularis_demo.notes(id, owner_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS demo_attachments_owner ON tabularis_demo.attachments(owner_id, note_id);
