-- Restore operations need to create new versions even if the same content
-- existed before (for lineage tracking). Dedup during normal saves is
-- handled in application code via hash comparison.

DROP INDEX IF EXISTS idx_versions_doc_hash;
CREATE INDEX idx_versions_doc_hash ON document_versions (document_id, content_hash);
