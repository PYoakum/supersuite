import { getDb } from './connection.js';

/**
 * Extract wiki-link targets from markdown content.
 * Matches [[target]] and [[target|display]] patterns.
 * @param {string} markdown
 * @returns {string[]} array of slugified target strings
 */
export function extractWikiLinks(markdown) {
  if (!markdown) return [];
  const regex = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g;
  const targets = new Set();
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    const target = match[1].trim().toLowerCase().replace(/\s+/g, '-');
    if (target) targets.add(target);
  }
  return [...targets];
}

/**
 * Update the document_links table for a document.
 * Called after saving content.
 * Resolves target slugs to document IDs where possible.
 *
 * @param {string} sourceDocId
 * @param {string} markdown
 */
export async function updateDocumentLinks(sourceDocId, markdown) {
  const sql = getDb();
  const targetSlugs = extractWikiLinks(markdown);

  await sql.begin(async (tx) => {
    // Remove existing links from this source
    await tx`DELETE FROM document_links WHERE source_document_id = ${sourceDocId}`;

    // Insert new links
    for (const slug of targetSlugs) {
      // Try to resolve the slug to a document
      const [doc] = await tx`
        SELECT id FROM documents WHERE slug = ${slug} LIMIT 1
      `;
      await tx`
        INSERT INTO document_links (source_document_id, target_slug, target_document_id)
        VALUES (${sourceDocId}, ${slug}, ${doc?.id || null})
        ON CONFLICT DO NOTHING
      `;
    }
  });
}

/**
 * Get backlinks for a document (other docs that link TO this one).
 * @param {string} documentId
 * @returns {Promise<object[]>}
 */
export async function getBacklinks(documentId) {
  const sql = getDb();
  // Also find links by slug (for docs that link before target exists)
  const doc = await sql`SELECT slug FROM documents WHERE id = ${documentId} LIMIT 1`;
  if (!doc[0]) return [];

  return sql`
    SELECT DISTINCT d.id, d.title, d.slug, d.updated_at
    FROM document_links dl
    JOIN documents d ON d.id = dl.source_document_id
    WHERE dl.target_document_id = ${documentId}
       OR dl.target_slug = ${doc[0].slug}
    ORDER BY d.updated_at DESC
  `;
}

/**
 * Get outgoing links from a document.
 * @param {string} documentId
 * @returns {Promise<object[]>}
 */
export async function getOutgoingLinks(documentId) {
  const sql = getDb();
  return sql`
    SELECT dl.target_slug,
           d.id AS target_id, d.title AS target_title, d.slug AS resolved_slug
    FROM document_links dl
    LEFT JOIN documents d ON d.id = dl.target_document_id
    WHERE dl.source_document_id = ${documentId}
    ORDER BY dl.target_slug
  `;
}
