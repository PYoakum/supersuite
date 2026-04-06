/**
 * Convert a string to a URL-safe slug.
 * Rules:
 *  - Lowercase
 *  - Replace spaces/underscores with hyphens
 *  - Strip non-alphanumeric (except hyphens)
 *  - Collapse consecutive hyphens
 *  - Trim leading/trailing hyphens
 *
 * @param {string} text
 * @returns {string}
 */
export function slugify(text) {
  return text
    .toString()
    .normalize('NFKD')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Generate a unique slug given existing slugs.
 * Appends -2, -3, etc. if base slug already exists.
 *
 * @param {string} title
 * @param {(slug: string) => Promise<boolean>} existsCheck - returns true if slug is taken
 * @returns {Promise<string>}
 */
export async function uniqueSlug(title, existsCheck) {
  const base = slugify(title);
  if (!base) throw new Error('Title produces empty slug');

  if (!(await existsCheck(base))) return base;

  let counter = 2;
  while (counter < 1000) {
    const candidate = `${base}-${counter}`;
    if (!(await existsCheck(candidate))) return candidate;
    counter++;
  }
  throw new Error('Could not generate unique slug after 999 attempts');
}
