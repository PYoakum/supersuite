import { getDb } from './connection.js';

/**
 * Look up a redirect by old slug.
 * Follows redirect chains (up to 10 hops to prevent loops).
 * @param {string} slug
 * @returns {Promise<{ finalSlug: string, documentId: string } | null>}
 */
export async function resolveRedirect(slug) {
  const sql = getDb();
  let currentSlug = slug;
  const visited = new Set();

  for (let i = 0; i < 10; i++) {
    if (visited.has(currentSlug)) return null; // loop detected
    visited.add(currentSlug);

    const [row] = await sql`
      SELECT document_id, new_slug
      FROM document_redirects
      WHERE old_slug = ${currentSlug}
      LIMIT 1
    `;

    if (!row) return null; // no redirect found

    // Check if new_slug points to an actual document
    const [doc] = await sql`
      SELECT id, slug FROM documents WHERE slug = ${row.new_slug} LIMIT 1
    `;

    if (doc) {
      return { finalSlug: doc.slug, documentId: doc.id };
    }

    // Otherwise follow the chain
    currentSlug = row.new_slug;
  }

  return null; // too many hops
}

/**
 * List all redirects for a document.
 * @param {string} documentId
 * @returns {Promise<object[]>}
 */
export async function listRedirects(documentId) {
  const sql = getDb();
  return sql`
    SELECT id, old_slug, new_slug, created_at
    FROM document_redirects
    WHERE document_id = ${documentId}
    ORDER BY created_at DESC
  `;
}
