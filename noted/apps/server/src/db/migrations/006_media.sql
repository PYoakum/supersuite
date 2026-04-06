CREATE TABLE media (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  storage_path  TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  byte_size     BIGINT NOT NULL DEFAULT 0,
  width         INTEGER,
  height        INTEGER,
  duration      REAL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_media_owner ON media (owner_user_id);
