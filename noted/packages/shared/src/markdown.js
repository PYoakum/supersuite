import { createHash } from 'node:crypto';

/**
 * Canonicalize markdown content for consistent hashing.
 * Rules (from spec):
 *  - Normalize line endings to \n
 *  - Trim trailing whitespace per line
 *  - Ensure consistent list marker formatting (use `-` for unordered)
 *  - Normalize checkbox syntax to `- [ ]` / `- [x]`
 *  - Standardize code fence to triple backticks
 *  - Ensure single trailing newline
 *
 * @param {string} markdown
 * @returns {string}
 */
export function canonicalize(markdown) {
  let text = markdown;

  // Normalize line endings
  text = text.replace(/\r\n?/g, '\n');

  // Process line by line
  const lines = text.split('\n');
  const result = lines.map((line) => {
    // Trim trailing whitespace
    let l = line.replace(/\s+$/, '');

    // Normalize unordered list markers (* or +) to -
    l = l.replace(/^(\s*)[*+]\s/, '$1- ');

    // Normalize checkbox syntax
    l = l.replace(/^(\s*-\s)\[\s\]/, '$1[ ]');
    l = l.replace(/^(\s*-\s)\[[xX]\]/, '$1[x]');

    // Normalize code fences (~~~ -> ```) and trim space before language
    l = l.replace(/^~~~\s*(\w*)$/, '```$1');

    return l;
  });

  // Ensure single trailing newline
  let output = result.join('\n').replace(/\n*$/, '\n');

  return output;
}

/**
 * Compute SHA-256 hash of canonical markdown.
 * @param {string} markdown - already canonicalized
 * @returns {string} hex digest
 */
export function contentHash(markdown) {
  return createHash('sha256').update(markdown, 'utf8').digest('hex');
}
