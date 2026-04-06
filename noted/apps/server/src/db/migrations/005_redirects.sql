CREATE TABLE document_redirects (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  old_slug    TEXT NOT NULL UNIQUE,
  new_slug    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_redirects_old_slug ON document_redirects (old_slug);
CREATE INDEX idx_redirects_document ON document_redirects (document_id);
