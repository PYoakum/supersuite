import { Marked } from "marked";

const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    // Strip raw HTML tags to prevent XSS
    html() { return ""; },
  },
});

export function renderMarkdown(text) {
  if (!text) return "";
  return marked.parse(text);
}
