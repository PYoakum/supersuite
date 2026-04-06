-- Full-text search on documents: title + content
-- Uses ts_vector for efficient text search

-- Add a generated tsvector column for search
ALTER TABLE documents ADD COLUMN IF NOT EXISTS search_tsv tsvector;

-- Create GIN index for fast search
CREATE INDEX IF NOT EXISTS idx_documents_search ON documents USING GIN(search_tsv);

-- Also add simple indexes for common queries
CREATE INDEX IF NOT EXISTS idx_documents_owner_updated ON documents (owner_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_public ON documents (is_public) WHERE is_public = true;

-- Function to update the search vector from title + current content
CREATE OR REPLACE FUNCTION update_document_search_tsv() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(
      (SELECT content_markdown FROM document_versions WHERE id = NEW.current_version_id), ''
    )), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: update search vector on document insert/update
DROP TRIGGER IF EXISTS trg_documents_search ON documents;
CREATE TRIGGER trg_documents_search
  BEFORE INSERT OR UPDATE OF title, current_version_id ON documents
  FOR EACH ROW
  EXECUTE FUNCTION update_document_search_tsv();

-- Backfill existing documents
UPDATE documents SET search_tsv =
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(
    (SELECT content_markdown FROM document_versions WHERE id = documents.current_version_id), ''
  )), 'B');
