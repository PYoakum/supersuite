/**
 * Configuration loader for theme and settings
 */

import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const THEME_PATH = join(__dirname, "theme.toml");

/**
 * Simple TOML parser for our theme config
 * Supports: strings, numbers, booleans, [sections], [nested.sections]
 */
function parseTOML(content) {
  const result = {};
  let currentSection = result;
  let sectionPath = [];

  for (let line of content.split("\n")) {
    line = line.trim();

    // Skip empty lines and comments
    if (!line || line.startsWith("#")) continue;

    // Section header
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      sectionPath = sectionMatch[1].split(".");
      currentSection = result;
      for (const part of sectionPath) {
        if (!currentSection[part]) currentSection[part] = {};
        currentSection = currentSection[part];
      }
      continue;
    }

    // Key = value
    const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
    if (kvMatch) {
      const [, key, rawValue] = kvMatch;
      let value = rawValue.trim();
      if (!value.startsWith('"') && !value.startsWith("'")) {
        const commentIdx = value.indexOf("#");
        if (commentIdx > 0) value = value.substring(0, commentIdx).trim();
      }
      currentSection[key] = parseValue(value);
    }
  }

  return result;
}

function parseValue(val) {
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  if (val === "true") return true;
  if (val === "false") return false;
  const num = Number(val);
  if (!isNaN(num)) return num;
  return val;
}

/**
 * Load theme configuration
 */
export function loadTheme(customPath) {
  const themePath = customPath || THEME_PATH;

  if (!existsSync(themePath)) {
    console.warn(`Theme file not found: ${themePath}, using defaults`);
    return getDefaultTheme();
  }

  try {
    const content = readFileSync(themePath, "utf8");
    return parseTOML(content);
  } catch (err) {
    console.error(`Failed to load theme: ${err.message}`);
    return getDefaultTheme();
  }
}

function kebab(str) {
  return str.replace(/_/g, "-");
}

/**
 * Generate themed CSS stylesheet for vm-provisioner
 */
export function generateThemedCSS(theme) {
  const c = theme.colors || {};
  const g = theme.general || {};
  const t = theme.typography || {};
  const s = theme.spacing || {};
  const toolbar = theme.components?.toolbar || {};
  const cards = theme.components?.cards || {};
  const modal = theme.components?.modal || {};
  const badges = theme.components?.badges || {};
  const dots = theme.components?.status_dots || {};
  const toast = theme.components?.toast || {};
  const filter = theme.components?.filter || {};
  const tabs = theme.components?.tabs || {};
  const fileBrowser = theme.components?.file_browser || {};

  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: ${g.font_family || "system-ui, -apple-system, sans-serif"}; background: ${c.background || "#1a1a2e"}; color: ${c.text_primary || "#eee"}; margin: 0; min-height: 100vh; display: flex; }
    .app-layout { display: flex; width: 100%; min-height: 100vh; }
    .main-content { flex: 1; padding: ${s.page_padding || 20}px; overflow-y: auto; min-width: 0; }
    h1 { margin-bottom: ${s.section_gap || 16}px; font-size: ${t.h1_size || "1.5rem"}; color: ${c.text_primary || "#fff"}; display: flex; align-items: center; gap: 12px; }
    .ws-status { font-size: ${t.tiny_size || "11px"}; padding: 3px 8px; border-radius: 10px; background: #666; }
    .ws-status.connected { background: ${c.success || "#4ade80"}; color: ${c.text_inverted || "#000"}; }
    .toolbar { display: flex; gap: ${s.element_gap || 8}px; margin-bottom: ${s.section_gap || 16}px; flex-wrap: wrap; align-items: center; }
    .toolbar-btn { padding: ${toolbar.padding || "8px 16px"}; border: none; border-radius: ${g.border_radius || 6}px; font-size: ${toolbar.font_size || t.label_size || "13px"}; cursor: pointer; background: ${c.btn_default || "#333"}; color: ${c.text_primary || "#fff"}; }
    .toolbar-btn:hover { background: ${c.surface_hover || "#444"}; }
    .toolbar-btn.primary { background: ${c.accent || "#3b82f6"}; }
    .toolbar-btn.primary:hover { background: ${c.accent_hover || "#2563eb"}; }
    .filter-group { display: flex; gap: ${s.small_gap || 4}px; margin-left: auto; }
    .filter-btn { padding: 4px 10px; border: none; border-radius: 4px; font-size: ${t.small_size || "12px"}; cursor: pointer; background: ${filter.background || c.surface || "#252540"}; color: ${filter.text_color || c.text_secondary || "#aaa"}; }
    .filter-btn:hover { background: ${c.surface_hover || "#333"}; color: ${c.text_primary || "#fff"}; }
    .filter-btn.active { background: ${filter.active_background || c.accent || "#3b82f6"}; color: ${filter.active_text_color || "#fff"}; }
    .vm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(${cards.min_width || "320px"}, 1fr)); gap: 12px; }
    .vm-card { background: ${cards.background || c.surface || "#252540"}; border-radius: 8px; padding: ${cards.padding || 16}px; border: 1px solid ${cards.border_color || c.border || "#333"}; }
    .vm-card-header { display: flex; align-items: center; gap: ${s.element_gap || 8}px; margin-bottom: 12px; }
    .vm-name { font-weight: 600; font-size: 15px; flex: 1; }
    .badge { font-size: ${badges.font_size || "10px"}; padding: 2px 8px; border-radius: 10px; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; }
    .badge.firecracker { background: ${badges.firecracker || "#f97316"}; color: ${c.text_inverted || "#000"}; }
    .badge.qemu { background: ${badges.qemu || "#8b5cf6"}; color: #fff; }
    .badge.docker-compose { background: ${badges.docker_compose || "#06b6d4"}; color: ${c.text_inverted || "#000"}; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .status-dot.created { background: ${dots.created || "#888"}; }
    .status-dot.starting { background: ${dots.starting || "#fbbf24"}; }
    .status-dot.running { background: ${dots.running || c.success || "#4ade80"}; }
    .status-dot.stopping { background: ${dots.stopping || "#fbbf24"}; }
    .status-dot.stopped { background: ${dots.stopped || "#666"}; }
    .status-dot.error { background: ${dots.error || c.error || "#ef4444"}; }
    .vm-stats { font-size: ${t.label_size || "13px"}; color: ${c.text_secondary || "#aaa"}; margin-bottom: 12px; }
    .vm-stats-row { display: flex; justify-content: space-between; padding: 3px 0; }
    .vm-stats-label { color: ${c.text_muted || "#888"}; }
    .vm-actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .btn { padding: 6px 12px; border: none; border-radius: 4px; font-size: ${t.small_size || "12px"}; cursor: pointer; background: ${c.btn_default || "#333"}; color: ${c.text_primary || "#fff"}; }
    .btn:hover { background: ${c.btn_default_hover || "#555"}; }
    .btn:disabled { opacity: 0.4; cursor: default; }
    .btn.start-btn { background: ${c.success || "#4ade80"}; color: ${c.text_inverted || "#000"}; }
    .btn.stop-btn { background: ${c.warning || "#f59e0b"}; color: ${c.text_inverted || "#000"}; }
    .btn.destroy-btn { background: ${c.error || "#ef4444"}; }
    .btn.persist-badge { background: transparent; border: 1px solid #666; color: ${c.text_muted || "#888"}; cursor: default; font-size: ${badges.font_size || "10px"}; margin-left: auto; }
    .btn.persist-badge:hover { background: transparent; }
    .empty-state { text-align: center; padding: 60px 20px; color: #666; }
    .empty-state p { margin-bottom: 12px; }
    .modal-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: ${c.overlay || "rgba(0,0,0,0.7)"}; z-index: 1000; justify-content: center; align-items: center; padding: ${s.page_padding || 20}px; }
    .modal-overlay.open { display: flex; }
    .modal { background: ${modal.background || c.surface_alt || "#2a2a4a"}; border-radius: 8px; padding: ${modal.padding || 20}px; min-width: 360px; max-width: ${modal.max_width || 480}px; width: 100%; max-height: 90vh; overflow-y: auto; }
    .modal h2 { margin-bottom: ${s.section_gap || 16}px; font-size: ${t.h2_size || "1.2rem"}; }
    .form-group { margin-bottom: 14px; }
    .form-group label { display: block; margin-bottom: 4px; font-size: ${t.label_size || "13px"}; color: ${c.text_secondary || "#aaa"}; }
    .form-group input, .form-group select { width: 100%; padding: 8px 10px; border: 1px solid ${c.border || "#444"}; border-radius: 4px; background: ${c.background || "#1a1a2e"}; color: ${c.text_primary || "#fff"}; font-size: ${t.body_size || "14px"}; }
    .form-group input:focus, .form-group select:focus { outline: none; border-color: ${c.accent || "#3b82f6"}; }
    .form-row { display: flex; gap: 12px; }
    .form-row .form-group { flex: 1; }
    .checkbox-row { display: flex; align-items: center; gap: ${s.element_gap || 8}px; }
    .checkbox-row input[type=checkbox] { width: 16px; height: 16px; accent-color: ${c.accent || "#3b82f6"}; }
    .modal-actions { display: flex; gap: ${s.element_gap || 8}px; justify-content: flex-end; margin-top: ${s.section_gap || 16}px; }
    .modal-actions .btn { padding: 8px 16px; }
    .toast { position: fixed; bottom: ${s.page_padding || 20}px; right: ${s.page_padding || 20}px; padding: 12px 20px; background: ${toast.background || c.toast_bg || "#333"}; border-radius: ${g.border_radius || 6}px; z-index: 2000; display: none; font-size: ${t.label_size || "13px"}; }
    .toast.success { background: ${toast.success || c.toast_success || "#166534"}; }
    .toast.error { background: ${toast.error || c.toast_error || "#991b1b"}; }
    .toast.show { display: block; }
    .tab-bar { display: flex; gap: 0; border-bottom: 1px solid ${c.border || "#333"}; margin-bottom: ${s.section_gap || 16}px; }
    .tab-btn { padding: ${tabs.padding || "10px 20px"}; font-size: ${tabs.font_size || t.label_size || "13px"}; background: ${tabs.background || "transparent"}; color: ${c.text_muted || "#888"}; border: none; border-bottom: 2px solid transparent; cursor: pointer; font-family: inherit; }
    .tab-btn:hover { color: ${c.text_primary || "#fff"}; }
    .tab-btn.active { color: ${c.text_primary || "#fff"}; border-bottom-color: ${tabs.active_border || c.accent || "#3b82f6"}; }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }
    .file-toolbar { display: flex; gap: ${s.element_gap || 8}px; margin-bottom: ${s.element_gap || 8}px; align-items: center; }
    .file-breadcrumbs { display: flex; align-items: center; flex: 1; gap: 2px; font-size: ${t.label_size || "13px"}; overflow-x: auto; white-space: nowrap; }
    .breadcrumb-sep { color: ${c.text_muted || "#888"}; margin: 0 2px; }
    .breadcrumb-item { color: ${c.text_secondary || "#aaa"}; cursor: pointer; padding: 2px 4px; border-radius: 3px; background: none; border: none; font-family: inherit; font-size: inherit; }
    .breadcrumb-item:hover { color: ${c.text_primary || "#fff"}; background: ${c.surface_hover || "#444"}; }
    .file-list { border: 1px solid ${fileBrowser.border_color || c.border || "#333"}; border-radius: ${g.border_radius || 6}px; background: ${fileBrowser.background || c.surface || "#252540"}; max-height: 60vh; overflow-y: auto; }
    .file-row { display: grid; grid-template-columns: 24px 1fr 80px 140px; gap: 8px; align-items: center; padding: ${fileBrowser.row_padding || "8px 12px"}; border-bottom: 1px solid ${c.border || "#333"}22; cursor: pointer; font-size: ${t.label_size || "13px"}; }
    .file-row:last-child { border-bottom: none; }
    .file-row:hover { background: ${c.surface_hover || "#444"}; }
    .file-row.selected { background: ${fileBrowser.selected_background || c.accent || "#3b82f6"}33; }
    .file-icon { text-align: center; font-size: 16px; }
    .file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .file-size { text-align: right; color: ${c.text_muted || "#888"}; font-size: ${t.small_size || "12px"}; }
    .file-modified { color: ${c.text_muted || "#888"}; font-size: ${t.small_size || "12px"}; }
    .file-status-bar { display: flex; align-items: center; gap: ${s.element_gap || 8}px; padding: 8px 12px; margin-top: ${s.element_gap || 8}px; border-radius: ${g.border_radius || 6}px; background: ${fileBrowser.statusbar_background || "#1e1e38"}; font-size: ${t.small_size || "12px"}; color: ${c.text_secondary || "#aaa"}; }
    .file-status-bar .selected-path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${c.text_primary || "#fff"}; }
    .file-status-bar .btn { font-size: ${t.small_size || "12px"}; padding: 4px 10px; }
    .file-list-empty { padding: 40px 20px; text-align: center; color: ${c.text_muted || "#888"}; }

    /* Sidebar */
    .sidebar { width: 220px; min-width: 220px; background: ${c.surface || "#252540"}; border-right: 1px solid ${c.border || "#333"}; display: flex; flex-direction: column; overflow-y: auto; transition: width 0.2s, min-width 0.2s; }
    .sidebar.collapsed { width: 0; min-width: 0; overflow: hidden; border-right: none; }
    .sidebar-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid ${c.border || "#333"}; }
    .sidebar-header h2 { font-size: ${t.label_size || "13px"}; font-weight: 600; margin: 0; }
    .sidebar-toggle { background: none; border: none; color: ${c.text_muted || "#888"}; cursor: pointer; font-size: 16px; padding: 2px 6px; border-radius: 4px; }
    .sidebar-toggle:hover { color: ${c.text_primary || "#fff"}; background: ${c.surface_hover || "#444"}; }
    .sidebar-toggle.collapsed-toggle { position: fixed; left: 0; top: 50%; transform: translateY(-50%); z-index: 100; background: ${c.surface || "#252540"}; border: 1px solid ${c.border || "#333"}; border-left: none; border-radius: 0 6px 6px 0; padding: 8px 4px; }
    .sidebar-section { padding: 8px 0; }
    .sidebar-section-header { display: flex; align-items: center; justify-content: space-between; padding: 4px 14px; font-size: ${t.tiny_size || "11px"}; text-transform: uppercase; letter-spacing: 0.5px; color: ${c.text_muted || "#888"}; font-weight: 600; }
    .sidebar-section-header button { background: none; border: none; color: ${c.text_muted || "#888"}; cursor: pointer; font-size: 16px; line-height: 1; padding: 0 2px; }
    .sidebar-section-header button:hover { color: ${c.text_primary || "#fff"}; }
    .sidebar-item { display: flex; align-items: center; gap: 8px; padding: 6px 14px; cursor: pointer; font-size: ${t.label_size || "13px"}; color: ${c.text_secondary || "#aaa"}; border: none; background: none; width: 100%; text-align: left; font-family: inherit; }
    .sidebar-item:hover { background: ${c.surface_hover || "#444"}; color: ${c.text_primary || "#fff"}; }
    .sidebar-item.active { background: ${c.accent || "#3b82f6"}22; color: ${c.accent || "#3b82f6"}; }
    .sidebar-color-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .sidebar-item-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sidebar-item-count { font-size: ${t.tiny_size || "11px"}; background: ${c.btn_default || "#333"}; padding: 1px 6px; border-radius: 8px; color: ${c.text_muted || "#888"}; }
    .sidebar-item-menu { background: none; border: none; color: ${c.text_muted || "#888"}; cursor: pointer; font-size: 14px; padding: 0 2px; opacity: 0; transition: opacity 0.15s; }
    .sidebar-item:hover .sidebar-item-menu { opacity: 1; }
    .sidebar-item-menu:hover { color: ${c.text_primary || "#fff"}; }

    /* Bulk action bar */
    .bulk-bar { display: flex; align-items: center; gap: ${s.element_gap || 8}px; padding: 10px 14px; margin-bottom: 12px; background: ${c.surface || "#252540"}; border: 1px solid ${c.border || "#333"}; border-radius: ${g.border_radius || 6}px; }
    .bulk-bar-title { font-size: ${t.label_size || "13px"}; font-weight: 600; flex: 1; }
    .bulk-bar .btn { font-size: ${t.small_size || "12px"}; }

    /* Tag chips on VM cards */
    .vm-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
    .tag-chip { font-size: ${t.tiny_size || "11px"}; padding: 1px 8px; border-radius: 10px; background: ${c.accent || "#3b82f6"}22; color: ${c.accent || "#3b82f6"}; cursor: default; }
    .tag-chip.removable { cursor: pointer; }
    .tag-chip.removable:hover { background: ${c.error || "#ef4444"}44; color: ${c.error || "#ef4444"}; }

    /* Group assign + tag edit buttons on VM cards */
    .vm-meta-actions { display: flex; gap: 6px; margin-bottom: 8px; }
    .vm-meta-btn { font-size: ${t.tiny_size || "11px"}; padding: 2px 8px; border: 1px dashed ${c.border || "#333"}; border-radius: 4px; background: none; color: ${c.text_muted || "#888"}; cursor: pointer; font-family: inherit; }
    .vm-meta-btn:hover { border-color: ${c.accent || "#3b82f6"}; color: ${c.accent || "#3b82f6"}; }

    /* Context menu / dropdown */
    .ctx-menu { position: fixed; background: ${c.surface_alt || "#2a2a4a"}; border: 1px solid ${c.border || "#333"}; border-radius: ${g.border_radius || 6}px; padding: 4px 0; z-index: 3000; min-width: 160px; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
    .ctx-menu-item { display: block; width: 100%; padding: 6px 14px; font-size: ${t.label_size || "13px"}; background: none; border: none; color: ${c.text_primary || "#fff"}; cursor: pointer; text-align: left; font-family: inherit; }
    .ctx-menu-item:hover { background: ${c.surface_hover || "#444"}; }
    .ctx-menu-item.danger { color: ${c.error || "#ef4444"}; }
    .ctx-menu-sep { height: 1px; background: ${c.border || "#333"}; margin: 4px 0; }

    /* Inline tag editor popover */
    .tag-popover { position: fixed; background: ${c.surface_alt || "#2a2a4a"}; border: 1px solid ${c.border || "#333"}; border-radius: ${g.border_radius || 6}px; padding: 10px; z-index: 3000; min-width: 200px; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
    .tag-popover input { width: 100%; padding: 6px 8px; border: 1px solid ${c.border || "#444"}; border-radius: 4px; background: ${c.background || "#1a1a2e"}; color: ${c.text_primary || "#fff"}; font-size: ${t.label_size || "13px"}; margin-bottom: 6px; font-family: inherit; }
    .tag-popover input:focus { outline: none; border-color: ${c.accent || "#3b82f6"}; }
    .tag-popover-chips { display: flex; flex-wrap: wrap; gap: 4px; }

    /* Color picker in modal */
    .color-options { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
    .color-swatch { width: 24px; height: 24px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
    .color-swatch:hover, .color-swatch.active { border-color: ${c.text_primary || "#fff"}; }
  `;
}

function getDefaultTheme() {
  return {
    meta: { name: "Default Dark", version: "1.0" },
    general: { title: "VM Provisioner", font_family: "system-ui, -apple-system, sans-serif", border_radius: 6 },
    colors: {
      background: "#1a1a2e", surface: "#252540", surface_hover: "#444", surface_alt: "#2a2a4a",
      border: "#333", overlay: "rgba(0,0,0,0.7)",
      text_primary: "#eee", text_secondary: "#aaa", text_muted: "#888", text_inverted: "#000",
      accent: "#3b82f6", accent_hover: "#2563eb",
      success: "#4ade80", warning: "#f59e0b", error: "#ef4444",
      btn_default: "#333", btn_default_hover: "#555",
      toast_bg: "#333", toast_success: "#166534", toast_error: "#991b1b"
    },
    typography: { h1_size: "1.5rem", h2_size: "1.2rem", body_size: "14px", small_size: "12px", tiny_size: "11px", label_size: "13px" },
    spacing: { page_padding: 20, section_gap: 16, element_gap: 8, small_gap: 4 },
    components: {
      toolbar: { padding: "8px 16px", font_size: "13px" },
      cards: { background: "#252540", border_color: "#333", padding: 16, min_width: "320px" },
      modal: { background: "#2a2a4a", max_width: 480, padding: 20 },
      badges: { firecracker: "#f97316", qemu: "#8b5cf6", docker_compose: "#06b6d4", font_size: "10px" },
      status_dots: { created: "#888", starting: "#fbbf24", running: "#4ade80", stopping: "#fbbf24", stopped: "#666", error: "#ef4444" },
      toast: { background: "#333", success: "#166534", error: "#991b1b" },
      filter: { background: "#252540", active_background: "#3b82f6", text_color: "#aaa", active_text_color: "#fff" },
      tabs: { padding: "10px 20px", font_size: "13px", background: "transparent", active_border: "#3b82f6" },
      file_browser: { background: "#252540", border_color: "#333", row_padding: "8px 12px", selected_background: "#3b82f6", statusbar_background: "#1e1e38" }
    }
  };
}
