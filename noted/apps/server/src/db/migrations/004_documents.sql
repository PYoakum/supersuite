-- Documents table (created first without FK to versions)
CREATE TABLE documents (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title            TEXT NOT NULL DEFAULT 'Untitled',
  slug             TEXT NOT NULL UNIQUE,
  current_version_id UUID,  -- FK added after document_versions exists
  is_public        BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at     TIMESTAMPTZ
);

CREATE INDEX idx_documents_slug ON documents (slug);
CREATE INDEX idx_documents_owner ON documents (owner_user_id);

-- Document versions table
CREATE TABLE document_versions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id       UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  base_version_id   UUID REFERENCES document_versions(id),
  content_markdown  TEXT NOT NULL DEFAULT '',
  content_hash      TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID NOT NULL REFERENCES users(id),
  summary           TEXT
);

CREATE INDEX idx_versions_document ON document_versions (document_id);
CREATE UNIQUE INDEX idx_versions_doc_hash ON document_versions (document_id, content_hash);

-- Now add the FK from documents -> document_versions
ALTER TABLE documents
  ADD CONSTRAINT fk_documents_current_version
  FOREIGN KEY (current_version_id) REFERENCES document_versions(id);
