/**
 * Simple line-level diff for version comparison.
 * Uses LCS (Longest Common Subsequence) to produce a readable diff.
 */

/**
 * Compute a line-level diff between two strings.
 * @param {string} oldText
 * @param {string} newText
 * @returns {{ type: 'same'|'add'|'remove', line: string }[]}
 */
function computeDiff(oldText, newText) {
  const oldLines = (oldText || '').split('\n');
  const newLines = (newText || '').split('\n');

  // LCS table
  const m = oldLines.length;
  const n = newLines.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff
  const result = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: 'same', line: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'add', line: newLines[j - 1] });
      j--;
    } else {
      result.unshift({ type: 'remove', line: oldLines[i - 1] });
      i--;
    }
  }

  return result;
}

/**
 * Render a diff as HTML.
 * @param {{ type: string, line: string }[]} diff
 * @returns {string} HTML
 */
function renderDiffHtml(diff) {
  if (!diff || diff.length === 0) return '<div class="diff-empty">No changes.</div>';

  const esc = s => {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  };

  // Collapse consecutive same lines if there are many
  const lines = [];
  let sameCount = 0;

  for (const entry of diff) {
    if (entry.type === 'same') {
      sameCount++;
      if (sameCount <= 3 || sameCount >= diff.filter(e => e.type === 'same').length - 2) {
        lines.push(`<div class="diff-line diff-same"><span class="diff-marker"> </span>${esc(entry.line) || '&nbsp;'}</div>`);
      } else if (sameCount === 4) {
        lines.push(`<div class="diff-line diff-collapse">···</div>`);
      }
    } else {
      sameCount = 0;
      const cls = entry.type === 'add' ? 'diff-add' : 'diff-remove';
      const marker = entry.type === 'add' ? '+' : '−';
      lines.push(`<div class="diff-line ${cls}"><span class="diff-marker">${marker}</span>${esc(entry.line) || '&nbsp;'}</div>`);
    }
  }

  return `<div class="diff-view">${lines.join('')}</div>`;
}

window.computeDiff = computeDiff;
window.renderDiffHtml = renderDiffHtml;
