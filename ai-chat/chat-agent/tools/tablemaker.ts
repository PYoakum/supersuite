import { writeFile } from "fs/promises";
import { createHash } from "crypto";
import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";

// -- Types --------------------------------------------------------------------

interface TableData {
  headers: string[];
  rows: (string | number)[][];
}

interface TableOptions {
  title?: string;
  editable?: boolean;
  sortable?: boolean;
  exportCsv?: boolean;
  theme?: string;
}

interface ThemeColors {
  bg: string;
  containerBg: string;
  headerBg: string;
  headerColor: string;
  borderColor: string;
  hoverBg: string;
  inputBg: string;
  textColor: string;
}

// -- Parsing Helpers ----------------------------------------------------------

function parseJsonInput(data: unknown): TableData {
  const parsed = typeof data === "string" ? JSON.parse(data) : data;

  if (!parsed.headers || !Array.isArray(parsed.headers)) {
    throw new Error('JSON input must have a "headers" array');
  }
  if (!parsed.rows || !Array.isArray(parsed.rows)) {
    throw new Error('JSON input must have a "rows" array');
  }

  return {
    headers: parsed.headers.map((h: unknown) => String(h)),
    rows: parsed.rows.map((row: unknown) =>
      Array.isArray(row) ? row.map((cell: unknown) => cell ?? "") : []
    ),
  };
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());

  return values;
}

function parseCsvInput(data: unknown): TableData {
  if (typeof data !== "string") {
    throw new Error("CSV input must be a string");
  }

  const lines = data.trim().split("\n");
  if (lines.length < 1) {
    throw new Error("CSV input must have at least a header line");
  }

  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => parseCsvLine(line));

  return { headers, rows };
}

function parseObjectInput(data: unknown): TableData {
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Object input must be a non-empty array of objects");
  }

  const headers = Object.keys(data[0] as Record<string, unknown>);
  const rows = data.map((obj: Record<string, unknown>) =>
    headers.map((h) => (obj[h] ?? "") as string | number)
  );

  return { headers, rows };
}

// -- HTML Generation ----------------------------------------------------------

function escapeHtml(str: string): string {
  const escapeMap: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return str.replace(/[&<>"']/g, (c) => escapeMap[c]);
}

function buildEditableTable(
  tableData: TableData,
  options: { editable?: boolean; sortable?: boolean } = {}
): string {
  const { editable = true, sortable = true } = options;
  const { headers, rows } = tableData;

  const headerCells = headers
    .map(
      (h, i) =>
        `<th${sortable ? ` data-col="${i}" class="sortable"` : ""}>${escapeHtml(String(h))}</th>`
    )
    .join("\n          ");

  const bodyRows = rows
    .map((row, rowIdx) => {
      const cells = headers
        .map((_, colIdx) => {
          const value = row[colIdx] ?? "";
          if (editable) {
            return `<td><input type="text" value="${escapeHtml(String(value))}" data-row="${rowIdx}" data-col="${colIdx}"></td>`;
          }
          return `<td>${escapeHtml(String(value))}</td>`;
        })
        .join("\n          ");
      return `        <tr data-row="${rowIdx}">\n          ${cells}\n        </tr>`;
    })
    .join("\n");

  return `<table id="data-table">
      <thead>
        <tr>
          ${headerCells}
        </tr>
      </thead>
      <tbody>
${bodyRows}
      </tbody>
    </table>`;
}

function getStyles(theme: string): string {
  const themes: Record<string, ThemeColors> = {
    default: {
      bg: "#f5f5f5",
      containerBg: "#ffffff",
      headerBg: "#2196F3",
      headerColor: "#ffffff",
      borderColor: "#ddd",
      hoverBg: "#f0f0f0",
      inputBg: "#ffffff",
      textColor: "#333",
    },
    dark: {
      bg: "#1a1a2e",
      containerBg: "#16213e",
      headerBg: "#0f3460",
      headerColor: "#e94560",
      borderColor: "#0f3460",
      hoverBg: "#1a1a2e",
      inputBg: "#16213e",
      textColor: "#eee",
    },
    minimal: {
      bg: "#ffffff",
      containerBg: "#ffffff",
      headerBg: "#f8f9fa",
      headerColor: "#212529",
      borderColor: "#dee2e6",
      hoverBg: "#f8f9fa",
      inputBg: "#ffffff",
      textColor: "#212529",
    },
  };

  const t = themes[theme] || themes.default;

  return `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: ${t.bg};
        color: ${t.textColor};
        padding: 20px;
      }
      .container {
        max-width: 1200px;
        margin: 0 auto;
        background: ${t.containerBg};
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        overflow: hidden;
      }
      header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px;
        background: ${t.headerBg};
        color: ${t.headerColor};
      }
      h1 { font-size: 1.5rem; font-weight: 600; }
      .toolbar { display: flex; gap: 10px; }
      .btn {
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        background: rgba(255,255,255,0.2);
        color: inherit;
        cursor: pointer;
        font-size: 14px;
        transition: background 0.2s;
      }
      .btn:hover { background: rgba(255,255,255,0.3); }
      main { padding: 20px; overflow-x: auto; }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }
      th, td {
        padding: 12px;
        text-align: left;
        border-bottom: 1px solid ${t.borderColor};
      }
      th {
        background: ${t.headerBg};
        color: ${t.headerColor};
        font-weight: 600;
        position: sticky;
        top: 0;
      }
      th.sortable { cursor: pointer; user-select: none; }
      th.sortable:hover { opacity: 0.8; }
      th.sortable::after { content: ' \\21C5'; opacity: 0.5; }
      th.sort-asc::after { content: ' \\2191'; opacity: 1; }
      th.sort-desc::after { content: ' \\2193'; opacity: 1; }
      tr:hover { background: ${t.hoverBg}; }
      td input {
        width: 100%;
        padding: 8px;
        border: 1px solid transparent;
        border-radius: 4px;
        background: ${t.inputBg};
        color: ${t.textColor};
        font-size: inherit;
        transition: border-color 0.2s;
      }
      td input:focus {
        outline: none;
        border-color: ${t.headerBg};
      }
    `;
}

function getScripts(options: { sortable?: boolean; exportCsv?: boolean } = {}): string {
  const { sortable = true, exportCsv = true } = options;

  return `
      (function() {
        const table = document.getElementById('data-table');
        const tbody = table.querySelector('tbody');
        const headers = Array.from(table.querySelectorAll('th'));

        // Get current data
        function getData() {
          const headerNames = headers.map(th => th.textContent.trim());
          const rows = Array.from(tbody.querySelectorAll('tr')).map(tr => {
            return Array.from(tr.querySelectorAll('input, td')).map(cell =>
              cell.tagName === 'INPUT' ? cell.value : cell.textContent
            );
          });
          return { headers: headerNames, rows };
        }

        ${
          sortable
            ? `
        // Sorting
        let sortCol = -1;
        let sortAsc = true;

        headers.forEach((th, idx) => {
          if (th.classList.contains('sortable')) {
            th.addEventListener('click', () => {
              if (sortCol === idx) {
                sortAsc = !sortAsc;
              } else {
                sortCol = idx;
                sortAsc = true;
              }

              headers.forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
              th.classList.add(sortAsc ? 'sort-asc' : 'sort-desc');

              const rows = Array.from(tbody.querySelectorAll('tr'));
              rows.sort((a, b) => {
                const aVal = a.querySelector(\`[data-col="\${idx}"]\`)?.value ||
                            a.children[idx]?.textContent || '';
                const bVal = b.querySelector(\`[data-col="\${idx}"]\`)?.value ||
                            b.children[idx]?.textContent || '';
                const cmp = aVal.localeCompare(bVal, undefined, { numeric: true });
                return sortAsc ? cmp : -cmp;
              });
              rows.forEach(row => tbody.appendChild(row));
            });
          }
        });
        `
            : ""
        }

        ${
          exportCsv
            ? `
        // CSV Export
        document.getElementById('export-csv')?.addEventListener('click', () => {
          const { headers: h, rows } = getData();
          const escape = v => '"' + String(v).replace(/"/g, '""') + '"';
          const csv = [h.map(escape).join(',')]
            .concat(rows.map(r => r.map(escape).join(',')))
            .join('\\n');

          const blob = new Blob([csv], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'table-export.csv';
          a.click();
          URL.revokeObjectURL(url);
        });
        `
            : ""
        }

        // Add Row
        document.getElementById('add-row')?.addEventListener('click', () => {
          const colCount = headers.length;
          const rowCount = tbody.querySelectorAll('tr').length;
          const tr = document.createElement('tr');
          tr.dataset.row = rowCount;

          for (let i = 0; i < colCount; i++) {
            const td = document.createElement('td');
            const input = document.createElement('input');
            input.type = 'text';
            input.dataset.row = rowCount;
            input.dataset.col = i;
            td.appendChild(input);
            tr.appendChild(td);
          }

          tbody.appendChild(tr);
        });
      })();
    `;
}

function buildHtmlPage(tableData: TableData, options: TableOptions = {}): string {
  const {
    title = "Data Table",
    editable = true,
    sortable = true,
    exportCsv = true,
    theme = "default",
  } = options;

  const tableHtml = buildEditableTable(tableData, { editable, sortable });
  const styles = getStyles(theme);
  const scripts = getScripts({ sortable, exportCsv });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>${styles}</style>
</head>
<body>
  <div class="container">
    <header>
      <h1>${escapeHtml(title)}</h1>
      <div class="toolbar">
        ${exportCsv ? '<button id="export-csv" class="btn">Export CSV</button>' : ""}
        ${editable ? '<button id="add-row" class="btn">Add Row</button>' : ""}
      </div>
    </header>
    <main>
      ${tableHtml}
    </main>
  </div>
  <script>${scripts}</script>
</body>
</html>`;
}

// -- Execute ------------------------------------------------------------------

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const sessionId = args.sessionId as string | undefined;
  const path = args.path as string | undefined;
  const inputFormat = (args.inputFormat as string) ?? "json";
  const data = args.data;
  const options = (args.options as TableOptions) ?? {};

  if (!path) return formatError("path is required");
  if (!data) return formatError("data is required");

  // Parse input data based on format
  let tableData: TableData;
  switch (inputFormat) {
    case "json":
      tableData = parseJsonInput(data);
      break;
    case "csv":
      tableData = parseCsvInput(data);
      break;
    case "object":
      tableData = parseObjectInput(data);
      break;
    default:
      return formatError(
        `Unknown input format: ${inputFormat}. Valid formats: json, csv, object`
      );
  }

  // Generate HTML
  const html = buildHtmlPage(tableData, options);
  const buffer = Buffer.from(html, "utf-8");

  // Resolve path within sandbox
  const absPath = await ctx.sandbox.resolvePath(sessionId, path);

  // Validate size
  ctx.sandbox.validateFileSize(buffer.length, sessionId);

  // Ensure parent directory exists
  await ctx.sandbox.ensureParentDir(absPath);

  // Write file
  await writeFile(absPath, buffer);

  // Update size tracking
  ctx.sandbox.updateSandboxSize(sessionId, buffer.length);

  // Calculate checksum
  const checksum = createHash("sha256").update(buffer).digest("hex");

  return formatResponse({
    success: true,
    path,
    size: buffer.length,
    checksum: `sha256:${checksum}`,
    rowCount: tableData.rows.length,
    columnCount: tableData.headers.length,
    headers: tableData.headers,
  });
}

// -- Tool Definition ----------------------------------------------------------

const tablemakerTool: Tool = {
  name: "tablemaker",
  description:
    "Generate editable HTML tables from structured data (JSON, CSV, or object arrays). Creates interactive web pages with sorting, editing, and CSV export capabilities.",
  needsSandbox: true,
  inputSchema: {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description:
          'Session ID for sandbox isolation (optional, uses "default" if not provided)',
      },
      path: {
        type: "string",
        description:
          'Output path for the HTML file within the sandbox (e.g., "output/table.html")',
      },
      inputFormat: {
        type: "string",
        enum: ["json", "csv", "object"],
        default: "json",
        description:
          'Format of input data: "json" (headers+rows), "csv" (string), or "object" (array of objects)',
      },
      data: {
        oneOf: [
          {
            type: "object",
            properties: {
              headers: { type: "array", items: { type: "string" } },
              rows: { type: "array", items: { type: "array" } },
            },
            required: ["headers", "rows"],
            description:
              'JSON format: { headers: ["Col1", "Col2"], rows: [["val1", "val2"]] }',
          },
          {
            type: "string",
            description: "CSV format: header line followed by data rows",
          },
          {
            type: "array",
            items: { type: "object" },
            description: "Object format: array of objects with consistent keys",
          },
        ],
        description: "The data to render as a table",
      },
      options: {
        type: "object",
        description: "Table rendering options",
        properties: {
          title: {
            type: "string",
            default: "Data Table",
            description: "Title displayed above the table",
          },
          editable: {
            type: "boolean",
            default: true,
            description: "Make table cells editable",
          },
          sortable: {
            type: "boolean",
            default: true,
            description: "Enable column sorting by clicking headers",
          },
          exportCsv: {
            type: "boolean",
            default: true,
            description: "Include CSV export button",
          },
          theme: {
            type: "string",
            enum: ["default", "dark", "minimal"],
            default: "default",
            description: "Visual theme for the table",
          },
        },
      },
    },
    required: ["path", "data"],
  },
  execute,
};

export default tablemakerTool;
