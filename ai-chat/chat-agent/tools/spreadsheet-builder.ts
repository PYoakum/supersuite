import type { Tool, ToolResult, ToolContext } from "./types";
import { formatResponse, formatError } from "./types";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";

const ACTIONS = ["create_workbook", "add_sheet", "set_cells", "set_cell", "import_csv", "export_csv", "export_json"] as const;
type Action = (typeof ACTIONS)[number];

function genId(): string { return Math.random().toString(36).slice(2, 14); }

function colLetter(idx: number): string {
  let s = "";
  idx++;
  while (idx > 0) { idx--; s = String.fromCharCode(65 + (idx % 26)) + s; idx = Math.floor(idx / 26); }
  return s;
}

function detectType(raw: string): { value: any; type: string } {
  if (raw === "") return { value: "", type: "empty" };
  if (raw.startsWith("=")) return { value: raw, type: "formula" };
  if (raw === "TRUE" || raw === "true") return { value: true, type: "boolean" };
  if (raw === "FALSE" || raw === "false") return { value: false, type: "boolean" };
  const num = Number(raw);
  if (!isNaN(num) && raw.trim() !== "") return { value: num, type: "number" };
  return { value: raw, type: "text" };
}

function getWbPath(sandboxBase: string, agentId: string, wbId: string): string {
  return join(sandboxBase, agentId, "spreadsheets", `${wbId}.json`);
}

function loadWb(path: string): any {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

function saveWb(path: string, wb: any): void {
  wb.updatedAt = new Date().toISOString();
  writeFileSync(path, JSON.stringify(wb, null, 2), "utf-8");
}

async function execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const action = args.action as Action | undefined;
  if (!action || !ACTIONS.includes(action)) return formatError(`Unknown action. Available: ${ACTIONS.join(", ")}`);

  const agentId = (ctx.config.agentId as string) || "default";
  const sandboxBase = (ctx.sandbox as any)?.baseDir || "./sandbox";
  const ssDir = join(sandboxBase, agentId, "spreadsheets");
  mkdirSync(ssDir, { recursive: true });

  switch (action) {
    case "create_workbook": {
      const name = args.name as string;
      if (!name) return formatError("name is required");

      const id = genId();
      const now = new Date().toISOString();
      const wb = {
        id, name,
        sheets: [{
          id: "sheet1", name: "Sheet 1",
          rowCount: 100, colCount: 26,
          cells: {}, colWidths: {}, rowHeights: {},
          filters: {}, frozenRow: 0, frozenCol: 0,
        }],
        createdAt: now, updatedAt: now,
      };

      const path = getWbPath(sandboxBase, agentId, id);
      saveWb(path, wb);

      return formatResponse({ created: true, id, name, path: `sandbox/${agentId}/spreadsheets/${id}.json` });
    }

    case "add_sheet": {
      const wbId = args.workbook_id as string;
      if (!wbId) return formatError("workbook_id is required");
      const path = getWbPath(sandboxBase, agentId, wbId);
      const wb = loadWb(path);
      if (!wb) return formatError(`Workbook not found: ${wbId}`);

      const sheetName = (args.name as string) || `Sheet ${wb.sheets.length + 1}`;
      const sheet = {
        id: genId(), name: sheetName,
        rowCount: 100, colCount: 26,
        cells: {}, colWidths: {}, rowHeights: {},
        filters: {}, frozenRow: 0, frozenCol: 0,
      };
      wb.sheets.push(sheet);
      saveWb(path, wb);

      return formatResponse({ added: true, sheet_id: sheet.id, sheet_name: sheetName });
    }

    case "set_cells": {
      const wbId = args.workbook_id as string;
      const sheetId = (args.sheet_id as string) || "sheet1";
      const data = args.data as string[][] | undefined;
      const startRow = (args.start_row as number) || 1;
      const startCol = (args.start_col as number) || 0;
      if (!wbId) return formatError("workbook_id is required");
      if (!data || !Array.isArray(data)) return formatError("data is required (2D array of strings)");

      const path = getWbPath(sandboxBase, agentId, wbId);
      const wb = loadWb(path);
      if (!wb) return formatError(`Workbook not found: ${wbId}`);

      const sheet = wb.sheets.find((s: any) => s.id === sheetId);
      if (!sheet) return formatError(`Sheet not found: ${sheetId}`);

      let cellCount = 0;
      for (let r = 0; r < data.length; r++) {
        for (let c = 0; c < data[r].length; c++) {
          const raw = String(data[r][c] ?? "");
          if (!raw) continue;
          const ref = `${colLetter(startCol + c)}${startRow + r}`;
          const { value, type } = detectType(raw);
          sheet.cells[ref] = { raw, value, type };
          cellCount++;
        }
      }

      saveWb(path, wb);
      return formatResponse({ written: cellCount, workbook_id: wbId, sheet_id: sheetId });
    }

    case "set_cell": {
      const wbId = args.workbook_id as string;
      const sheetId = (args.sheet_id as string) || "sheet1";
      const ref = args.cell as string;
      const raw = String(args.value ?? "");
      if (!wbId || !ref) return formatError("workbook_id and cell (e.g. A1) are required");

      const path = getWbPath(sandboxBase, agentId, wbId);
      const wb = loadWb(path);
      if (!wb) return formatError(`Workbook not found: ${wbId}`);

      const sheet = wb.sheets.find((s: any) => s.id === sheetId);
      if (!sheet) return formatError(`Sheet not found: ${sheetId}`);

      const { value, type } = detectType(raw);
      sheet.cells[ref.toUpperCase()] = { raw, value, type, format: args.format || {} };
      saveWb(path, wb);

      return formatResponse({ set: true, cell: ref.toUpperCase(), type });
    }

    case "import_csv": {
      const wbId = args.workbook_id as string;
      const csv = args.csv as string;
      const csvPath = args.csv_path as string;
      const sheetId = (args.sheet_id as string) || "sheet1";
      if (!wbId) return formatError("workbook_id is required");

      let csvContent = csv || "";
      if (!csvContent && csvPath) {
        if (!existsSync(csvPath)) return formatError(`CSV file not found: ${csvPath}`);
        csvContent = readFileSync(csvPath, "utf-8");
      }
      if (!csvContent) return formatError("csv (string) or csv_path (file) is required");

      const rows = csvContent.split("\n").map(line => {
        const cells: string[] = [];
        let current = "";
        let inQuote = false;
        for (const ch of line) {
          if (ch === '"') { inQuote = !inQuote; continue; }
          if (ch === "," && !inQuote) { cells.push(current); current = ""; continue; }
          current += ch;
        }
        cells.push(current);
        return cells;
      }).filter(r => r.some(c => c.trim()));

      const path = getWbPath(sandboxBase, agentId, wbId);
      const wb = loadWb(path);
      if (!wb) return formatError(`Workbook not found: ${wbId}`);

      const sheet = wb.sheets.find((s: any) => s.id === sheetId);
      if (!sheet) return formatError(`Sheet not found: ${sheetId}`);

      let cellCount = 0;
      for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < rows[r].length; c++) {
          const raw = rows[r][c].trim();
          if (!raw) continue;
          const ref = `${colLetter(c)}${r + 1}`;
          const { value, type } = detectType(raw);
          sheet.cells[ref] = { raw, value, type };
          cellCount++;
        }
      }

      saveWb(path, wb);
      return formatResponse({ imported: true, rows: rows.length, cells: cellCount });
    }

    case "export_csv": {
      const wbId = args.workbook_id as string;
      const sheetId = (args.sheet_id as string) || "sheet1";
      if (!wbId) return formatError("workbook_id is required");

      const path = getWbPath(sandboxBase, agentId, wbId);
      const wb = loadWb(path);
      if (!wb) return formatError(`Workbook not found: ${wbId}`);

      const sheet = wb.sheets.find((s: any) => s.id === sheetId);
      if (!sheet) return formatError(`Sheet not found: ${sheetId}`);

      let maxRow = 0, maxCol = 0;
      for (const ref of Object.keys(sheet.cells)) {
        const m = ref.match(/^([A-Z]+)(\d+)$/);
        if (!m) continue;
        const col = m[1].split("").reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        const row = parseInt(m[2]) - 1;
        maxRow = Math.max(maxRow, row);
        maxCol = Math.max(maxCol, col);
      }

      const lines: string[] = [];
      for (let r = 0; r <= maxRow; r++) {
        const vals: string[] = [];
        for (let c = 0; c <= maxCol; c++) {
          const ref = `${colLetter(c)}${r + 1}`;
          const cell = sheet.cells[ref];
          const v = cell ? String(cell.value ?? cell.raw ?? "") : "";
          vals.push(v.includes(",") || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v);
        }
        lines.push(vals.join(","));
      }

      const csvOut = lines.join("\n");
      const csvPath = join(ssDir, `${wbId}-${sheetId}.csv`);
      writeFileSync(csvPath, csvOut, "utf-8");

      return formatResponse({ exported: true, rows: maxRow + 1, path: `sandbox/${agentId}/spreadsheets/${wbId}-${sheetId}.csv` });
    }

    case "export_json": {
      const wbId = args.workbook_id as string;
      if (!wbId) return formatError("workbook_id is required");

      const path = getWbPath(sandboxBase, agentId, wbId);
      const wb = loadWb(path);
      if (!wb) return formatError(`Workbook not found: ${wbId}`);

      return formatResponse({ workbook: wb, path: `sandbox/${agentId}/spreadsheets/${wbId}.json` });
    }
  }

  return formatError("Unhandled action");
}

const tool: Tool = {
  name: "spreadsheet_builder",
  description:
    "Create spreadsheets compatible with js-spreadsheets. Build workbooks with sheets, " +
    "set cells (text, numbers, formulas, booleans), import/export CSV, and export JSON.",
  needsSandbox: false,
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: [...ACTIONS], description: "Action to perform" },
      workbook_id: { type: "string" },
      sheet_id: { type: "string", description: "Sheet ID (default: sheet1)" },
      name: { type: "string", description: "Workbook or sheet name" },
      cell: { type: "string", description: "Cell reference e.g. A1 (for set_cell)" },
      value: { type: "string", description: "Cell value (for set_cell). Prefix with = for formulas" },
      format: { type: "object", description: "Cell format {bold, italic, align, textColor, fillColor, numberFormat}" },
      data: { type: "array", description: "2D array of strings (for set_cells)" },
      start_row: { type: "number", description: "Starting row number (default 1)" },
      start_col: { type: "number", description: "Starting column index 0=A (default 0)" },
      csv: { type: "string", description: "CSV content string (for import_csv)" },
      csv_path: { type: "string", description: "Path to CSV file (for import_csv)" },
    },
    required: ["action"],
  },
  execute,
};

export default tool;
