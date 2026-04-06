import { useState, useEffect, useCallback, useRef, useMemo } from "react";

// ─── Constants & Helpers ─────────────────────────────────────────────
const FIELD_TYPES = [
  { type: "short_text", label: "Short Text", icon: "Aa" },
  { type: "long_text", label: "Long Text", icon: "¶" },
  { type: "email", label: "Email", icon: "@" },
  { type: "phone", label: "Phone", icon: "☎" },
  { type: "number", label: "Number", icon: "#" },
  { type: "dropdown", label: "Dropdown", icon: "▾" },
  { type: "radio", label: "Radio", icon: "◉" },
  { type: "checkbox", label: "Checkbox", icon: "☑" },
  { type: "multi_select", label: "Multi Select", icon: "☰" },
  { type: "date", label: "Date", icon: "📆" },
  { type: "rating", label: "Rating", icon: "★" },
  { type: "section", label: "Section Header", icon: "─" },
  { type: "consent", label: "Consent", icon: "✓" },
];

const PRESET_THEMES = [
  { name: "Minimal Light", primary: "#1a1a2e", bg: "#ffffff", text: "#1a1a2e", accent: "#e2725b", font: "'DM Sans'", radius: "8px", spacing: "comfortable" },
  { name: "Ocean Depth", primary: "#0a4d68", bg: "#f0f7fa", text: "#0a4d68", accent: "#05bfdb", font: "'Libre Franklin'", radius: "12px", spacing: "comfortable" },
  { name: "Warm Earth", primary: "#5c3d2e", bg: "#fdf6f0", text: "#3e2723", accent: "#d4a373", font: "'Lora'", radius: "6px", spacing: "relaxed" },
  { name: "Slate Pro", primary: "#334155", bg: "#f8fafc", text: "#1e293b", accent: "#6366f1", font: "'IBM Plex Sans'", radius: "10px", spacing: "compact" },
  { name: "Midnight", primary: "#e2e8f0", bg: "#0f172a", text: "#e2e8f0", accent: "#f59e0b", font: "'Space Mono'", radius: "4px", spacing: "comfortable" },
  { name: "Forest", primary: "#2d6a4f", bg: "#f1faee", text: "#1b4332", accent: "#95d5b2", font: "'Merriweather'", radius: "16px", spacing: "relaxed" },
];

const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => new Date().toISOString();
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const DEFAULT_THEME = { ...PRESET_THEMES[0] };

const makeField = (type) => ({
  id: uid(),
  type,
  label: FIELD_TYPES.find((f) => f.type === type)?.label || "Field",
  placeholder: "",
  helpText: "",
  required: false,
  options: type === "dropdown" || type === "radio" || type === "multi_select" ? ["Option 1", "Option 2"] : [],
  validation: {},
  order: 0,
});

// ─── Storage Helpers ─────────────────────────────────────────────────
const storage = {
  async load(key, fallback) {
    try {
      if (window.storage) {
        const r = await window.storage.get(key);
        return r ? JSON.parse(r.value) : fallback;
      }
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  },
  async save(key, value) {
    try {
      if (window.storage) {
        await window.storage.set(key, JSON.stringify(value));
      } else {
        localStorage.setItem(key, JSON.stringify(value));
      }
    } catch (e) { console.error("Storage save error:", e); }
  },
};

// ─── CSV Export ──────────────────────────────────────────────────────
function exportCSV(form, submissions) {
  if (!submissions.length) return;
  const fields = form.fields || [];
  const headers = ["Submitted At", "Status", "Categories", ...fields.map((f) => f.label)];
  const rows = submissions.map((s) => [
    new Date(s.submittedAt).toLocaleString(),
    s.status,
    (s.categories || []).join("; "),
    ...fields.map((f) => {
      const v = s.answers?.[f.id];
      return Array.isArray(v) ? v.join(", ") : v ?? "";
    }),
  ]);
  const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugify(form.title || "form")}-responses.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Rules Engine ────────────────────────────────────────────────────
function runRules(rules, answers, categories) {
  const matched = [];
  for (const rule of rules) {
    const val = answers[rule.fieldId];
    if (val === undefined || val === null) continue;
    const strVal = String(val).toLowerCase();
    let hit = false;
    switch (rule.operator) {
      case "contains": hit = strVal.includes(rule.value.toLowerCase()); break;
      case "equals": hit = strVal === rule.value.toLowerCase(); break;
      case "gt": hit = Number(val) > Number(rule.value); break;
      case "lt": hit = Number(val) < Number(rule.value); break;
      case "regex": try { hit = new RegExp(rule.value, "i").test(strVal); } catch { } break;
    }
    if (hit) {
      const cat = categories.find((c) => c.id === rule.categoryId);
      if (cat && !matched.includes(cat.name)) matched.push(cat.name);
    }
  }
  return matched;
}

// ─── Styles ──────────────────────────────────────────────────────────
const FONTS_LINK = "https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Playfair+Display:wght@400;600;700&family=Libre+Franklin:wght@300;400;500;600&family=Lora:wght@400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600&family=Space+Mono:wght@400;700&family=Merriweather:wght@300;400;700&display=swap";

// ─── Sub-components ──────────────────────────────────────────────────

function FieldRenderer({ field, value, onChange, theme }) {
  const inputStyle = {
    width: "100%",
    padding: "10px 14px",
    border: `1.5px solid ${theme.primary}22`,
    borderRadius: theme.radius,
    fontFamily: theme.font + ", sans-serif",
    fontSize: "15px",
    color: theme.text,
    background: theme.bg === "#ffffff" || theme.bg === "#f8fafc" || theme.bg === "#f0f7fa" || theme.bg === "#fdf6f0" || theme.bg === "#f1faee" ? "#fff" : theme.primary + "15",
    outline: "none",
    transition: "border-color 0.2s",
    boxSizing: "border-box",
  };

  if (field.type === "section") {
    return (
      <div style={{ borderBottom: `2px solid ${theme.accent}44`, paddingBottom: 8, marginTop: 12 }}>
        <h3 style={{ fontFamily: theme.font, color: theme.text, margin: 0, fontSize: 20, fontWeight: 600 }}>{field.label}</h3>
        {field.helpText && <p style={{ color: theme.text + "99", fontSize: 13, margin: "4px 0 0" }}>{field.helpText}</p>}
      </div>
    );
  }

  const label = (
    <label style={{ display: "block", marginBottom: 6, fontWeight: 500, fontSize: 14, color: theme.text, fontFamily: theme.font }}>
      {field.label} {field.required && <span style={{ color: theme.accent }}>*</span>}
      {field.helpText && <span style={{ fontWeight: 300, fontSize: 12, color: theme.text + "88", marginLeft: 6 }}>{field.helpText}</span>}
    </label>
  );

  switch (field.type) {
    case "short_text":
    case "email":
    case "phone":
      return <div>{label}<input type={field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"} placeholder={field.placeholder} value={value || ""} onChange={(e) => onChange(e.target.value)} style={inputStyle} /></div>;
    case "number":
      return <div>{label}<input type="number" placeholder={field.placeholder} value={value || ""} onChange={(e) => onChange(e.target.value)} style={inputStyle} /></div>;
    case "long_text":
      return <div>{label}<textarea rows={4} placeholder={field.placeholder} value={value || ""} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, resize: "vertical" }} /></div>;
    case "date":
      return <div>{label}<input type="date" value={value || ""} onChange={(e) => onChange(e.target.value)} style={inputStyle} /></div>;
    case "dropdown":
      return (
        <div>{label}
          <select value={value || ""} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
            <option value="">Select...</option>
            {field.options.map((o, i) => <option key={i} value={o}>{o}</option>)}
          </select>
        </div>
      );
    case "radio":
      return (
        <div>{label}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {field.options.map((o, i) => (
              <label key={i} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, fontFamily: theme.font, color: theme.text }}>
                <input type="radio" name={field.id} checked={value === o} onChange={() => onChange(o)} style={{ accentColor: theme.accent }} /> {o}
              </label>
            ))}
          </div>
        </div>
      );
    case "checkbox":
      return (
        <div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, fontFamily: theme.font, color: theme.text }}>
            <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: theme.accent }} />
            {field.label} {field.required && <span style={{ color: theme.accent }}>*</span>}
          </label>
        </div>
      );
    case "consent":
      return (
        <div style={{ padding: "12px 16px", background: theme.primary + "08", borderRadius: theme.radius, border: `1px solid ${theme.primary}11` }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 14, fontFamily: theme.font, color: theme.text }}>
            <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: theme.accent, marginTop: 3 }} />
            <span>{field.label} {field.required && <span style={{ color: theme.accent }}>*</span>}</span>
          </label>
        </div>
      );
    case "multi_select":
      return (
        <div>{label}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {field.options.map((o, i) => (
              <label key={i} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, fontFamily: theme.font, color: theme.text }}>
                <input type="checkbox" checked={(value || []).includes(o)} onChange={(e) => {
                  const arr = value || [];
                  onChange(e.target.checked ? [...arr, o] : arr.filter((x) => x !== o));
                }} style={{ accentColor: theme.accent }} /> {o}
              </label>
            ))}
          </div>
        </div>
      );
    case "rating":
      return (
        <div>{label}
          <div style={{ display: "flex", gap: 4 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => onChange(n)} style={{
                width: 36, height: 36, borderRadius: theme.radius, border: `1.5px solid ${n <= (value || 0) ? theme.accent : theme.primary + "22"}`,
                background: n <= (value || 0) ? theme.accent : "transparent", color: n <= (value || 0) ? "#fff" : theme.text,
                cursor: "pointer", fontWeight: 600, fontSize: 14, fontFamily: theme.font, transition: "all 0.15s",
              }}>{n}</button>
            ))}
          </div>
        </div>
      );
    default:
      return <div>{label}<input type="text" value={value || ""} onChange={(e) => onChange(e.target.value)} style={inputStyle} /></div>;
  }
}

// ─── Main App ────────────────────────────────────────────────────────
export default function FormBuilderApp() {
  // Global state
  const [forms, setForms] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [rules, setRules] = useState([]);
  const [loaded, setLoaded] = useState(false);

  // Navigation
  const [page, setPage] = useState("dashboard"); // dashboard | builder | responses | public | categories
  const [activeFormId, setActiveFormId] = useState(null);
  const [builderTab, setBuilderTab] = useState("build"); // build | style | preview | publish
  const [editingFieldId, setEditingFieldId] = useState(null);
  const [submissionDetail, setSubmissionDetail] = useState(null);

  // Public form state
  const [publicFormId, setPublicFormId] = useState(null);
  const [publicAnswers, setPublicAnswers] = useState({});
  const [publicSubmitted, setPublicSubmitted] = useState(false);
  const [publicErrors, setPublicErrors] = useState({});

  // Categories page state
  const [newCat, setNewCat] = useState({ name: "", color: "#e2725b", description: "" });
  const [newRule, setNewRule] = useState({ fieldId: "", operator: "contains", value: "", categoryId: "" });

  // Drag state
  const dragItem = useRef(null);
  const dragOver = useRef(null);

  // Load data
  useEffect(() => {
    (async () => {
      const f = await storage.load("formbuilder-forms", []);
      const s = await storage.load("formbuilder-submissions", []);
      const c = await storage.load("formbuilder-categories", []);
      const r = await storage.load("formbuilder-rules", []);
      setForms(f); setSubmissions(s); setCategories(c); setRules(r);
      setLoaded(true);
    })();
  }, []);

  // Persist
  useEffect(() => { if (loaded) storage.save("formbuilder-forms", forms); }, [forms, loaded]);
  useEffect(() => { if (loaded) storage.save("formbuilder-submissions", submissions); }, [submissions, loaded]);
  useEffect(() => { if (loaded) storage.save("formbuilder-categories", categories); }, [categories, loaded]);
  useEffect(() => { if (loaded) storage.save("formbuilder-rules", rules); }, [rules, loaded]);

  const activeForm = forms.find((f) => f.id === activeFormId);

  const updateForm = useCallback((id, updates) => {
    setForms((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates, updatedAt: now() } : f)));
  }, []);

  // ─── Dashboard ───────────────────────────────────────────────────
  const createForm = () => {
    const f = {
      id: uid(), title: "Untitled Form", description: "", status: "draft", slug: "form-" + uid(),
      fields: [], theme: { ...DEFAULT_THEME }, settings: { successMessage: "Thank you for your submission." },
      createdAt: now(), updatedAt: now(),
    };
    setForms((p) => [...p, f]);
    setActiveFormId(f.id);
    setBuilderTab("build");
    setPage("builder");
  };

  const deleteForm = (id) => {
    setForms((p) => p.filter((f) => f.id !== id));
    setSubmissions((p) => p.filter((s) => s.formId !== id));
    setCategories((p) => p.filter((c) => c.formId !== id));
    setRules((p) => p.filter((r) => r.formId !== id));
  };

  const openBuilder = (id) => {
    setActiveFormId(id);
    setBuilderTab("build");
    setEditingFieldId(null);
    setPage("builder");
  };

  const openResponses = (id) => {
    setActiveFormId(id);
    setSubmissionDetail(null);
    setPage("responses");
  };

  const openPublicForm = (id) => {
    setPublicFormId(id);
    setPublicAnswers({});
    setPublicSubmitted(false);
    setPublicErrors({});
    setPage("public");
  };

  // ─── Builder Actions ─────────────────────────────────────────────
  const addField = (type) => {
    if (!activeForm) return;
    const f = makeField(type);
    f.order = (activeForm.fields || []).length;
    updateForm(activeFormId, { fields: [...(activeForm.fields || []), f] });
    setEditingFieldId(f.id);
  };

  const updateField = (fieldId, updates) => {
    if (!activeForm) return;
    updateForm(activeFormId, { fields: activeForm.fields.map((f) => (f.id === fieldId ? { ...f, ...updates } : f)) });
  };

  const removeField = (fieldId) => {
    if (!activeForm) return;
    updateForm(activeFormId, { fields: activeForm.fields.filter((f) => f.id !== fieldId) });
    if (editingFieldId === fieldId) setEditingFieldId(null);
  };

  const moveField = (fromIdx, toIdx) => {
    if (!activeForm) return;
    const arr = [...activeForm.fields];
    const [item] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, item);
    updateForm(activeFormId, { fields: arr.map((f, i) => ({ ...f, order: i })) });
  };

  // ─── Submission ──────────────────────────────────────────────────
  const submitPublicForm = () => {
    const form = forms.find((f) => f.id === publicFormId);
    if (!form) return;
    const errors = {};
    for (const field of form.fields) {
      if (field.required && field.type !== "section") {
        const v = publicAnswers[field.id];
        if (v === undefined || v === null || v === "" || v === false || (Array.isArray(v) && v.length === 0)) {
          errors[field.id] = "This field is required";
        }
      }
      if (field.type === "email" && publicAnswers[field.id]) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(publicAnswers[field.id])) errors[field.id] = "Invalid email";
      }
    }
    if (Object.keys(errors).length) { setPublicErrors(errors); return; }

    const formCategories = categories.filter((c) => c.formId === publicFormId);
    const formRules = rules.filter((r) => r.formId === publicFormId);
    const matchedCategories = runRules(formRules, publicAnswers, formCategories);

    const sub = {
      id: uid(), formId: publicFormId, answers: { ...publicAnswers },
      status: "new", categories: matchedCategories, submittedAt: now(),
    };
    setSubmissions((p) => [...p, sub]);
    setPublicSubmitted(true);
  };

  // ─── AI Categorization ───────────────────────────────────────────
  const [aiLoading, setAiLoading] = useState(null);
  const aiCategorize = async (subId) => {
    const sub = submissions.find((s) => s.id === subId);
    const form = forms.find((f) => f.id === sub?.formId);
    const formCats = categories.filter((c) => c.formId === sub?.formId);
    if (!sub || !form) return;

    setAiLoading(subId);
    try {
      const fieldMap = {};
      for (const f of form.fields) {
        if (sub.answers[f.id] !== undefined) fieldMap[f.label] = sub.answers[f.id];
      }
      const catNames = formCats.map((c) => c.name);
      const prompt = `You are a form response categorization assistant. Given these form answers and available categories, assign the most appropriate categories. If none fit well, suggest new ones.

Form: ${form.title}
Answers: ${JSON.stringify(fieldMap, null, 2)}
Available categories: ${catNames.length ? catNames.join(", ") : "None defined yet"}

Respond ONLY with JSON (no markdown): {"categories": ["cat1"], "confidence": 0.85, "summary": "brief summary", "suggestedNewCategories": []}`;

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await resp.json();
      const text = data.content?.map((c) => c.text || "").join("") || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const result = JSON.parse(clean);

      setSubmissions((prev) => prev.map((s) => s.id === subId ? {
        ...s,
        categories: [...new Set([...(s.categories || []), ...(result.categories || [])])],
        aiResult: result,
      } : s));
    } catch (e) {
      console.error("AI categorization error:", e);
    }
    setAiLoading(null);
  };

  // ─── Response Filters ────────────────────────────────────────────
  const [responseFilter, setResponseFilter] = useState({ status: "all", category: "all", search: "" });

  const filteredSubmissions = useMemo(() => {
    if (!activeFormId) return [];
    return submissions
      .filter((s) => s.formId === activeFormId)
      .filter((s) => responseFilter.status === "all" || s.status === responseFilter.status)
      .filter((s) => responseFilter.category === "all" || (s.categories || []).includes(responseFilter.category))
      .filter((s) => {
        if (!responseFilter.search) return true;
        const q = responseFilter.search.toLowerCase();
        return Object.values(s.answers || {}).some((v) => String(v).toLowerCase().includes(q));
      })
      .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  }, [submissions, activeFormId, responseFilter]);

  // ─── Render ──────────────────────────────────────────────────────
  if (!loaded) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "'DM Sans', sans-serif", background: "#fafaf8" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 32, height: 32, border: "3px solid #e2725b", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 16px" }} />
          <p style={{ color: "#666", fontSize: 14 }}>Loading workspace...</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  // ─── Public Form Page ────────────────────────────────────────────
  if (page === "public") {
    const form = forms.find((f) => f.id === publicFormId);
    if (!form) return <div style={{ padding: 40, textAlign: "center" }}>Form not found.</div>;
    const t = form.theme || DEFAULT_THEME;

    return (
      <div style={{ minHeight: "100vh", background: t.bg, fontFamily: t.font + ", sans-serif", color: t.text }}>
        <link href={FONTS_LINK} rel="stylesheet" />
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "40px 20px" }}>
          <button onClick={() => setPage("dashboard")} style={{ background: "none", border: "none", color: t.accent, cursor: "pointer", fontFamily: t.font, fontSize: 13, marginBottom: 24, padding: 0 }}>
            ← Back to dashboard
          </button>
          {publicSubmitted ? (
            <div style={{ textAlign: "center", padding: "60px 20px" }}>
              <div style={{ width: 64, height: 64, borderRadius: "50%", background: t.accent + "22", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontSize: 28 }}>✓</div>
              <h2 style={{ fontFamily: t.font, marginBottom: 12 }}>{form.settings?.successMessage || "Thank you!"}</h2>
              <button onClick={() => { setPublicAnswers({}); setPublicSubmitted(false); setPublicErrors({}); }}
                style={{ padding: "10px 24px", border: `1.5px solid ${t.accent}`, borderRadius: t.radius, background: "transparent", color: t.accent, cursor: "pointer", fontFamily: t.font, fontWeight: 500, marginTop: 12 }}>
                Submit another response
              </button>
            </div>
          ) : (
            <>
              <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8, fontFamily: t.font }}>{form.title}</h1>
              {form.description && <p style={{ color: t.text + "88", marginBottom: 32, fontSize: 15, lineHeight: 1.6 }}>{form.description}</p>}
              <div style={{ display: "flex", flexDirection: "column", gap: t.spacing === "compact" ? 16 : t.spacing === "relaxed" ? 28 : 22 }}>
                {(form.fields || []).map((field) => (
                  <div key={field.id}>
                    <FieldRenderer field={field} value={publicAnswers[field.id]} onChange={(v) => { setPublicAnswers((p) => ({ ...p, [field.id]: v })); setPublicErrors((p) => { const n = { ...p }; delete n[field.id]; return n; }); }} theme={t} />
                    {publicErrors[field.id] && <p style={{ color: "#dc2626", fontSize: 12, marginTop: 4 }}>{publicErrors[field.id]}</p>}
                  </div>
                ))}
              </div>
              <button onClick={submitPublicForm} style={{
                marginTop: 32, padding: "14px 40px", background: t.accent, color: "#fff", border: "none",
                borderRadius: t.radius, fontFamily: t.font, fontSize: 16, fontWeight: 600, cursor: "pointer", transition: "opacity 0.2s",
              }}>Submit</button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ─── App Shell ───────────────────────────────────────────────────
  const shellBg = "#fafaf8";
  const shellText = "#1a1a2e";
  const shellAccent = "#e2725b";
  const shellMuted = "#94a3b8";
  const shellBorder = "#e8e5df";

  const nav = (
    <div style={{ width: 220, borderRight: `1px solid ${shellBorder}`, padding: "24px 0", display: "flex", flexDirection: "column", background: "#fff", flexShrink: 0 }}>
      <div style={{ padding: "0 20px 24px", borderBottom: `1px solid ${shellBorder}` }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: shellText, margin: 0, fontFamily: "'DM Sans', sans-serif", letterSpacing: "-0.02em" }}>
          <span style={{ color: shellAccent }}>◈</span> FormForge
        </h1>
        <p style={{ fontSize: 11, color: shellMuted, margin: "4px 0 0", fontFamily: "'DM Sans', sans-serif" }}>Form Builder MVP</p>
      </div>
      <div style={{ padding: "16px 12px", flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
        {[
          { id: "dashboard", label: "Dashboard", icon: "⊞" },
          ...(activeFormId ? [
            { id: "builder", label: "Form Builder", icon: "✎" },
            { id: "responses", label: "Responses", icon: "◫" },
            { id: "categories", label: "Categories", icon: "◉" },
          ] : []),
        ].map((item) => (
          <button key={item.id} onClick={() => { setPage(item.id); if (item.id === "responses") setSubmissionDetail(null); }}
            style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 12px",
              border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13.5, fontWeight: page === item.id ? 600 : 400,
              fontFamily: "'DM Sans', sans-serif", textAlign: "left", transition: "all 0.15s",
              background: page === item.id ? shellAccent + "12" : "transparent",
              color: page === item.id ? shellAccent : shellText,
            }}>
            <span style={{ fontSize: 15 }}>{item.icon}</span> {item.label}
          </button>
        ))}
      </div>
      {activeForm && (
        <div style={{ padding: "12px 16px", borderTop: `1px solid ${shellBorder}`, fontSize: 12, color: shellMuted, fontFamily: "'DM Sans'" }}>
          Editing: <span style={{ color: shellText, fontWeight: 500 }}>{activeForm.title}</span>
        </div>
      )}
    </div>
  );

  // ─── Dashboard Page ──────────────────────────────────────────────
  const renderDashboard = () => (
    <div style={{ padding: "32px 40px", maxWidth: 900 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0, fontFamily: "'DM Sans'", color: shellText }}>Your Forms</h2>
          <p style={{ color: shellMuted, fontSize: 14, margin: "4px 0 0", fontFamily: "'DM Sans'" }}>{forms.length} form{forms.length !== 1 ? "s" : ""} created</p>
        </div>
        <button onClick={createForm} style={{
          padding: "10px 24px", background: shellAccent, color: "#fff", border: "none", borderRadius: 8,
          fontFamily: "'DM Sans'", fontWeight: 600, fontSize: 14, cursor: "pointer", transition: "opacity 0.2s",
        }}>+ New Form</button>
      </div>
      {forms.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 20px", background: "#fff", borderRadius: 12, border: `1px solid ${shellBorder}` }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>◈</div>
          <h3 style={{ fontFamily: "'DM Sans'", color: shellText, marginBottom: 8 }}>No forms yet</h3>
          <p style={{ color: shellMuted, fontSize: 14, fontFamily: "'DM Sans'" }}>Create your first form to get started.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {forms.map((f) => {
            const count = submissions.filter((s) => s.formId === f.id).length;
            return (
              <div key={f.id} style={{ background: "#fff", borderRadius: 12, border: `1px solid ${shellBorder}`, padding: 20, transition: "box-shadow 0.2s", cursor: "pointer" }}
                onClick={() => openBuilder(f.id)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0, fontFamily: "'DM Sans'", color: shellText }}>{f.title}</h3>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20, fontFamily: "'DM Sans'",
                    background: f.status === "published" ? "#dcfce7" : "#f1f5f9", color: f.status === "published" ? "#16a34a" : "#64748b",
                  }}>{f.status}</span>
                </div>
                <p style={{ color: shellMuted, fontSize: 13, margin: "0 0 16px", fontFamily: "'DM Sans'" }}>
                  {(f.fields || []).length} fields · {count} response{count !== 1 ? "s" : ""}
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={(e) => { e.stopPropagation(); openBuilder(f.id); }} style={btnSmall}>Edit</button>
                  <button onClick={(e) => { e.stopPropagation(); openResponses(f.id); }} style={btnSmall}>Responses</button>
                  {f.status === "published" && (
                    <button onClick={(e) => { e.stopPropagation(); openPublicForm(f.id); }} style={{ ...btnSmall, color: shellAccent, borderColor: shellAccent }}>Open</button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); if (confirm("Delete this form?")) deleteForm(f.id); }} style={{ ...btnSmall, color: "#dc2626", borderColor: "#fecaca", marginLeft: "auto" }}>✕</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const btnSmall = { padding: "5px 12px", border: `1px solid ${shellBorder}`, borderRadius: 6, background: "#fff", color: shellText, cursor: "pointer", fontSize: 12, fontFamily: "'DM Sans'", fontWeight: 500 };

  // ─── Builder Page ────────────────────────────────────────────────
  const renderBuilder = () => {
    if (!activeForm) return <div style={{ padding: 40 }}>Select a form.</div>;
    const t = activeForm.theme || DEFAULT_THEME;

    const tabs = ["build", "style", "preview", "publish"];

    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "16px 24px", borderBottom: `1px solid ${shellBorder}`, background: "#fff", display: "flex", alignItems: "center", gap: 16 }}>
          <input value={activeForm.title} onChange={(e) => updateForm(activeFormId, { title: e.target.value })}
            style={{ fontSize: 18, fontWeight: 600, border: "none", outline: "none", fontFamily: "'DM Sans'", color: shellText, flex: 1, background: "transparent" }} />
          <div style={{ display: "flex", gap: 2, background: "#f1f5f9", borderRadius: 8, padding: 3 }}>
            {tabs.map((tab) => (
              <button key={tab} onClick={() => setBuilderTab(tab)} style={{
                padding: "6px 16px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, fontWeight: builderTab === tab ? 600 : 400,
                fontFamily: "'DM Sans'", background: builderTab === tab ? "#fff" : "transparent", color: builderTab === tab ? shellText : shellMuted,
                boxShadow: builderTab === tab ? "0 1px 3px rgba(0,0,0,0.08)" : "none", transition: "all 0.15s", textTransform: "capitalize",
              }}>{tab}</button>
            ))}
          </div>
        </div>

        {builderTab === "build" && (
          <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
            {/* Field palette */}
            <div style={{ width: 200, borderRight: `1px solid ${shellBorder}`, padding: 16, overflowY: "auto", background: "#fff" }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: shellMuted, textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 12px", fontFamily: "'DM Sans'" }}>Add Field</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {FIELD_TYPES.map((ft) => (
                  <button key={ft.type} onClick={() => addField(ft.type)} style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: `1px solid ${shellBorder}`, borderRadius: 6,
                    background: "#fff", cursor: "pointer", fontSize: 12.5, fontFamily: "'DM Sans'", color: shellText, textAlign: "left", transition: "background 0.1s",
                  }}>
                    <span style={{ width: 22, textAlign: "center", fontSize: 13, color: shellAccent }}>{ft.icon}</span> {ft.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Field list */}
            <div style={{ flex: 1, padding: 24, overflowY: "auto" }}>
              <textarea placeholder="Form description (optional)" value={activeForm.description || ""} onChange={(e) => updateForm(activeFormId, { description: e.target.value })}
                style={{ width: "100%", padding: "10px 14px", border: `1px solid ${shellBorder}`, borderRadius: 8, fontFamily: "'DM Sans'", fontSize: 14, resize: "none", outline: "none", marginBottom: 20, color: shellText, background: "#fff", boxSizing: "border-box" }} rows={2} />

              {(activeForm.fields || []).length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px 20px", color: shellMuted, fontFamily: "'DM Sans'", fontSize: 14 }}>
                  Add fields from the palette on the left.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {activeForm.fields.map((field, idx) => (
                    <div key={field.id}
                      draggable
                      onDragStart={() => { dragItem.current = idx; }}
                      onDragEnter={() => { dragOver.current = idx; }}
                      onDragEnd={() => { if (dragItem.current !== null && dragOver.current !== null && dragItem.current !== dragOver.current) moveField(dragItem.current, dragOver.current); dragItem.current = null; dragOver.current = null; }}
                      onDragOver={(e) => e.preventDefault()}
                      onClick={() => setEditingFieldId(field.id)}
                      style={{
                        padding: "12px 16px", background: editingFieldId === field.id ? shellAccent + "08" : "#fff", border: `1.5px solid ${editingFieldId === field.id ? shellAccent + "44" : shellBorder}`,
                        borderRadius: 8, cursor: "grab", display: "flex", alignItems: "center", gap: 12, transition: "all 0.15s",
                      }}>
                      <span style={{ color: shellMuted, fontSize: 14, cursor: "grab" }}>⋮⋮</span>
                      <span style={{ fontSize: 14, color: shellAccent, width: 22, textAlign: "center" }}>{FIELD_TYPES.find((ft) => ft.type === field.type)?.icon}</span>
                      <span style={{ flex: 1, fontSize: 14, fontFamily: "'DM Sans'", fontWeight: 500, color: shellText }}>{field.label}</span>
                      {field.required && <span style={{ fontSize: 10, color: shellAccent, fontWeight: 600, fontFamily: "'DM Sans'" }}>REQ</span>}
                      <span style={{ fontSize: 11, color: shellMuted, fontFamily: "'DM Sans'" }}>{FIELD_TYPES.find((ft) => ft.type === field.type)?.label}</span>
                      <button onClick={(e) => { e.stopPropagation(); removeField(field.id); }}
                        style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 16, padding: "0 4px" }}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Field config panel */}
            {editingFieldId && activeForm.fields.find((f) => f.id === editingFieldId) && (() => {
              const field = activeForm.fields.find((f) => f.id === editingFieldId);
              const hasOptions = ["dropdown", "radio", "multi_select"].includes(field.type);
              return (
                <div style={{ width: 280, borderLeft: `1px solid ${shellBorder}`, padding: 20, overflowY: "auto", background: "#fff" }}>
                  <p style={{ fontSize: 11, fontWeight: 600, color: shellMuted, textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 16px", fontFamily: "'DM Sans'" }}>Field Settings</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div>
                      <label style={labelStyle}>Label</label>
                      <input value={field.label} onChange={(e) => updateField(field.id, { label: e.target.value })} style={inputSmall} />
                    </div>
                    <div>
                      <label style={labelStyle}>Placeholder</label>
                      <input value={field.placeholder || ""} onChange={(e) => updateField(field.id, { placeholder: e.target.value })} style={inputSmall} />
                    </div>
                    <div>
                      <label style={labelStyle}>Help Text</label>
                      <input value={field.helpText || ""} onChange={(e) => updateField(field.id, { helpText: e.target.value })} style={inputSmall} />
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "'DM Sans'", fontSize: 13, color: shellText, cursor: "pointer" }}>
                      <input type="checkbox" checked={field.required} onChange={(e) => updateField(field.id, { required: e.target.checked })} style={{ accentColor: shellAccent }} />
                      Required field
                    </label>
                    {hasOptions && (
                      <div>
                        <label style={labelStyle}>Options</label>
                        {field.options.map((opt, oi) => (
                          <div key={oi} style={{ display: "flex", gap: 4, marginBottom: 4 }}>
                            <input value={opt} onChange={(e) => { const opts = [...field.options]; opts[oi] = e.target.value; updateField(field.id, { options: opts }); }} style={{ ...inputSmall, flex: 1 }} />
                            <button onClick={() => updateField(field.id, { options: field.options.filter((_, i) => i !== oi) })} style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 16 }}>×</button>
                          </div>
                        ))}
                        <button onClick={() => updateField(field.id, { options: [...field.options, `Option ${field.options.length + 1}`] })}
                          style={{ ...btnSmall, width: "100%", marginTop: 4, textAlign: "center" }}>+ Add Option</button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {builderTab === "style" && (
          <div style={{ flex: 1, overflowY: "auto", padding: 32, display: "flex", gap: 32 }}>
            <div style={{ width: 300, flexShrink: 0 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: shellMuted, textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 16px", fontFamily: "'DM Sans'" }}>Preset Themes</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 28 }}>
                {PRESET_THEMES.map((pt, i) => (
                  <button key={i} onClick={() => updateForm(activeFormId, { theme: { ...pt } })}
                    style={{
                      display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", border: `1.5px solid ${t.name === pt.name ? shellAccent : shellBorder}`,
                      borderRadius: 8, background: "#fff", cursor: "pointer", textAlign: "left", transition: "all 0.15s",
                    }}>
                    <div style={{ display: "flex", gap: 3 }}>
                      <div style={{ width: 16, height: 16, borderRadius: 4, background: pt.bg, border: "1px solid #ddd" }} />
                      <div style={{ width: 16, height: 16, borderRadius: 4, background: pt.primary }} />
                      <div style={{ width: 16, height: 16, borderRadius: 4, background: pt.accent }} />
                    </div>
                    <span style={{ fontSize: 13, fontFamily: "'DM Sans'", fontWeight: 500, color: shellText }}>{pt.name}</span>
                  </button>
                ))}
              </div>
              <p style={{ fontSize: 11, fontWeight: 600, color: shellMuted, textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 16px", fontFamily: "'DM Sans'" }}>Custom</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {[
                  ["primary", "Primary Color"], ["bg", "Background"], ["text", "Text Color"], ["accent", "Accent Color"],
                ].map(([key, lab]) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input type="color" value={t[key]} onChange={(e) => updateForm(activeFormId, { theme: { ...t, [key]: e.target.value } })} style={{ width: 32, height: 32, border: "none", cursor: "pointer", borderRadius: 4 }} />
                    <span style={{ fontSize: 13, fontFamily: "'DM Sans'", color: shellText }}>{lab}</span>
                  </div>
                ))}
                <div>
                  <label style={labelStyle}>Border Radius</label>
                  <input value={t.radius || "8px"} onChange={(e) => updateForm(activeFormId, { theme: { ...t, radius: e.target.value } })} style={inputSmall} />
                </div>
                <div>
                  <label style={labelStyle}>Spacing</label>
                  <select value={t.spacing || "comfortable"} onChange={(e) => updateForm(activeFormId, { theme: { ...t, spacing: e.target.value } })} style={inputSmall}>
                    <option value="compact">Compact</option>
                    <option value="comfortable">Comfortable</option>
                    <option value="relaxed">Relaxed</option>
                  </select>
                </div>
              </div>
            </div>
            {/* Live preview */}
            <div style={{ flex: 1, background: t.bg, borderRadius: 12, border: `1px solid ${shellBorder}`, padding: 32, overflow: "auto" }}>
              <h2 style={{ fontFamily: t.font + ", sans-serif", color: t.text, fontSize: 24, marginBottom: 8 }}>{activeForm.title}</h2>
              {activeForm.description && <p style={{ fontFamily: t.font, color: t.text + "88", fontSize: 14, marginBottom: 24 }}>{activeForm.description}</p>}
              <div style={{ display: "flex", flexDirection: "column", gap: t.spacing === "compact" ? 14 : t.spacing === "relaxed" ? 26 : 20 }}>
                {(activeForm.fields || []).slice(0, 5).map((field) => (
                  <FieldRenderer key={field.id} field={field} value="" onChange={() => {}} theme={t} />
                ))}
              </div>
              {(activeForm.fields || []).length > 5 && <p style={{ color: t.text + "66", fontSize: 13, marginTop: 16, fontFamily: t.font }}>...and {activeForm.fields.length - 5} more fields</p>}
              <button style={{ marginTop: 24, padding: "12px 32px", background: t.accent, color: "#fff", border: "none", borderRadius: t.radius, fontFamily: t.font, fontSize: 15, fontWeight: 600 }}>Submit</button>
            </div>
          </div>
        )}

        {builderTab === "preview" && (
          <div style={{ flex: 1, overflowY: "auto", background: t.bg }}>
            <div style={{ maxWidth: 640, margin: "0 auto", padding: "40px 20px" }}>
              <h1 style={{ fontSize: 28, fontWeight: 700, fontFamily: t.font + ", sans-serif", color: t.text, marginBottom: 8 }}>{activeForm.title}</h1>
              {activeForm.description && <p style={{ color: t.text + "88", fontSize: 15, fontFamily: t.font, marginBottom: 32, lineHeight: 1.6 }}>{activeForm.description}</p>}
              <div style={{ display: "flex", flexDirection: "column", gap: t.spacing === "compact" ? 16 : t.spacing === "relaxed" ? 28 : 22 }}>
                {(activeForm.fields || []).map((field) => (
                  <FieldRenderer key={field.id} field={field} value="" onChange={() => {}} theme={t} />
                ))}
              </div>
              <button style={{ marginTop: 32, padding: "14px 40px", background: t.accent, color: "#fff", border: "none", borderRadius: t.radius, fontFamily: t.font, fontSize: 16, fontWeight: 600 }}>Submit</button>
            </div>
          </div>
        )}

        {builderTab === "publish" && (
          <div style={{ flex: 1, overflowY: "auto", padding: 40 }}>
            <div style={{ maxWidth: 500 }}>
              <h3 style={{ fontFamily: "'DM Sans'", fontSize: 20, marginBottom: 20, color: shellText }}>Publish Settings</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", background: "#fff", borderRadius: 10, border: `1px solid ${shellBorder}` }}>
                  <div>
                    <p style={{ fontFamily: "'DM Sans'", fontWeight: 600, fontSize: 14, margin: 0, color: shellText }}>Form Status</p>
                    <p style={{ fontFamily: "'DM Sans'", fontSize: 12, color: shellMuted, margin: "2px 0 0" }}>
                      {activeForm.status === "published" ? "Live and accepting responses" : "Draft — not publicly accessible"}
                    </p>
                  </div>
                  <button onClick={() => updateForm(activeFormId, { status: activeForm.status === "published" ? "draft" : "published" })}
                    style={{
                      padding: "8px 20px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "'DM Sans'", fontWeight: 600, fontSize: 13,
                      background: activeForm.status === "published" ? "#fef2f2" : shellAccent, color: activeForm.status === "published" ? "#dc2626" : "#fff",
                    }}>
                    {activeForm.status === "published" ? "Unpublish" : "Publish"}
                  </button>
                </div>
                {activeForm.status === "published" && (
                  <div style={{ padding: "16px 20px", background: "#fff", borderRadius: 10, border: `1px solid ${shellBorder}` }}>
                    <p style={{ fontFamily: "'DM Sans'", fontWeight: 600, fontSize: 14, margin: "0 0 8px", color: shellText }}>Public Link</p>
                    <div style={{ display: "flex", gap: 8 }}>
                      <div style={{ flex: 1, padding: "8px 12px", background: "#f8fafc", borderRadius: 6, fontSize: 13, fontFamily: "'DM Sans'", color: shellText, border: `1px solid ${shellBorder}`, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        form/{activeForm.slug}
                      </div>
                      <button onClick={() => openPublicForm(activeForm.id)} style={{ ...btnSmall, background: shellAccent, color: "#fff", border: "none" }}>Open</button>
                    </div>
                  </div>
                )}
                <div style={{ padding: "16px 20px", background: "#fff", borderRadius: 10, border: `1px solid ${shellBorder}` }}>
                  <label style={labelStyle}>Success Message</label>
                  <input value={activeForm.settings?.successMessage || ""} onChange={(e) => updateForm(activeFormId, { settings: { ...activeForm.settings, successMessage: e.target.value } })} style={inputSmall} />
                </div>
                <div style={{ padding: "16px 20px", background: "#fff", borderRadius: 10, border: `1px solid ${shellBorder}` }}>
                  <label style={labelStyle}>URL Slug</label>
                  <input value={activeForm.slug || ""} onChange={(e) => updateForm(activeFormId, { slug: slugify(e.target.value) })} style={inputSmall} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const labelStyle = { display: "block", fontSize: 11, fontWeight: 600, color: shellMuted, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4, fontFamily: "'DM Sans'" };
  const inputSmall = { width: "100%", padding: "8px 12px", border: `1px solid ${shellBorder}`, borderRadius: 6, fontFamily: "'DM Sans'", fontSize: 13, color: shellText, outline: "none", boxSizing: "border-box", background: "#fff" };

  // ─── Responses Page ──────────────────────────────────────────────
  const renderResponses = () => {
    if (!activeForm) return null;
    const formCats = categories.filter((c) => c.formId === activeFormId);

    if (submissionDetail) {
      const sub = submissions.find((s) => s.id === submissionDetail);
      if (!sub) return null;
      return (
        <div style={{ padding: "32px 40px", maxWidth: 700 }}>
          <button onClick={() => setSubmissionDetail(null)} style={{ background: "none", border: "none", color: shellAccent, cursor: "pointer", fontFamily: "'DM Sans'", fontSize: 13, padding: 0, marginBottom: 20 }}>
            ← Back to responses
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
            <h3 style={{ fontFamily: "'DM Sans'", fontSize: 20, margin: 0, color: shellText }}>Submission Detail</h3>
            <select value={sub.status} onChange={(e) => setSubmissions((p) => p.map((s) => s.id === sub.id ? { ...s, status: e.target.value } : s))} style={inputSmall} >
              <option value="new">New</option>
              <option value="reviewed">Reviewed</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <p style={{ fontSize: 13, color: shellMuted, fontFamily: "'DM Sans'", marginBottom: 20 }}>Submitted: {new Date(sub.submittedAt).toLocaleString()}</p>

          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 28 }}>
            {activeForm.fields.filter((f) => f.type !== "section").map((field) => (
              <div key={field.id} style={{ padding: "12px 16px", background: "#fff", borderRadius: 8, border: `1px solid ${shellBorder}` }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: shellMuted, margin: "0 0 4px", fontFamily: "'DM Sans'" }}>{field.label}</p>
                <p style={{ fontSize: 14, color: shellText, margin: 0, fontFamily: "'DM Sans'" }}>
                  {(() => {
                    const v = sub.answers?.[field.id];
                    if (v === undefined || v === null || v === "") return <span style={{ color: shellMuted, fontStyle: "italic" }}>—</span>;
                    if (typeof v === "boolean") return v ? "Yes" : "No";
                    if (Array.isArray(v)) return v.join(", ");
                    return String(v);
                  })()}
                </p>
              </div>
            ))}
          </div>

          {/* Categories */}
          <div style={{ padding: "16px 20px", background: "#fff", borderRadius: 10, border: `1px solid ${shellBorder}`, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: shellText, margin: 0, fontFamily: "'DM Sans'" }}>Categories</p>
              <button onClick={() => aiCategorize(sub.id)} disabled={aiLoading === sub.id}
                style={{ ...btnSmall, background: aiLoading === sub.id ? "#f1f5f9" : "#f0f0ff", color: "#6366f1", borderColor: "#c7d2fe" }}>
                {aiLoading === sub.id ? "Analyzing..." : "AI Categorize"}
              </button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {(sub.categories || []).map((cat, i) => {
                const catObj = formCats.find((c) => c.name === cat);
                return (
                  <span key={i} style={{
                    display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 20, fontSize: 12,
                    fontFamily: "'DM Sans'", fontWeight: 500, background: (catObj?.color || shellAccent) + "18", color: catObj?.color || shellAccent,
                  }}>
                    {cat}
                    <button onClick={() => setSubmissions((p) => p.map((s) => s.id === sub.id ? { ...s, categories: s.categories.filter((c) => c !== cat) } : s))}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                  </span>
                );
              })}
              {formCats.length > 0 && (
                <select onChange={(e) => {
                  if (e.target.value && !(sub.categories || []).includes(e.target.value)) {
                    setSubmissions((p) => p.map((s) => s.id === sub.id ? { ...s, categories: [...(s.categories || []), e.target.value] } : s));
                  }
                  e.target.value = "";
                }} style={{ ...inputSmall, width: "auto", padding: "4px 8px", fontSize: 12 }}>
                  <option value="">+ Add</option>
                  {formCats.filter((c) => !(sub.categories || []).includes(c.name)).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              )}
            </div>
            {sub.aiResult && (
              <div style={{ marginTop: 12, padding: "10px 14px", background: "#f8f7ff", borderRadius: 8, fontSize: 12, fontFamily: "'DM Sans'", color: "#4338ca" }}>
                <p style={{ margin: "0 0 4px", fontWeight: 600 }}>AI Analysis (confidence: {Math.round((sub.aiResult.confidence || 0) * 100)}%)</p>
                {sub.aiResult.summary && <p style={{ margin: 0 }}>{sub.aiResult.summary}</p>}
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div style={{ padding: "32px 40px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, fontFamily: "'DM Sans'", color: shellText }}>
            Responses — {activeForm.title}
          </h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => exportCSV(activeForm, filteredSubmissions)} disabled={!filteredSubmissions.length}
              style={{ ...btnSmall, opacity: filteredSubmissions.length ? 1 : 0.4 }}>Export CSV</button>
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
          <input placeholder="Search responses..." value={responseFilter.search} onChange={(e) => setResponseFilter((p) => ({ ...p, search: e.target.value }))}
            style={{ ...inputSmall, width: 220 }} />
          <select value={responseFilter.status} onChange={(e) => setResponseFilter((p) => ({ ...p, status: e.target.value }))} style={{ ...inputSmall, width: 130 }}>
            <option value="all">All Statuses</option>
            <option value="new">New</option>
            <option value="reviewed">Reviewed</option>
            <option value="archived">Archived</option>
          </select>
          <select value={responseFilter.category} onChange={(e) => setResponseFilter((p) => ({ ...p, category: e.target.value }))} style={{ ...inputSmall, width: 150 }}>
            <option value="all">All Categories</option>
            {formCats.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        </div>

        {filteredSubmissions.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 20px", background: "#fff", borderRadius: 12, border: `1px solid ${shellBorder}` }}>
            <p style={{ color: shellMuted, fontFamily: "'DM Sans'", fontSize: 14 }}>No responses yet.</p>
          </div>
        ) : (
          <div style={{ background: "#fff", borderRadius: 12, border: `1px solid ${shellBorder}`, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'DM Sans'", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    <th style={thStyle}>Date</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Categories</th>
                    {activeForm.fields.filter((f) => f.type !== "section").slice(0, 4).map((f) => (
                      <th key={f.id} style={thStyle}>{f.label}</th>
                    ))}
                    <th style={thStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSubmissions.map((sub) => (
                    <tr key={sub.id} style={{ borderBottom: `1px solid ${shellBorder}`, cursor: "pointer", transition: "background 0.1s" }}
                      onClick={() => setSubmissionDetail(sub.id)}>
                      <td style={tdStyle}>{new Date(sub.submittedAt).toLocaleDateString()}</td>
                      <td style={tdStyle}>
                        <span style={{
                          padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600,
                          background: sub.status === "new" ? "#dbeafe" : sub.status === "reviewed" ? "#dcfce7" : "#f1f5f9",
                          color: sub.status === "new" ? "#2563eb" : sub.status === "reviewed" ? "#16a34a" : "#64748b",
                        }}>{sub.status}</span>
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {(sub.categories || []).map((c, i) => (
                            <span key={i} style={{ padding: "1px 8px", borderRadius: 10, fontSize: 10, background: shellAccent + "15", color: shellAccent, fontWeight: 500 }}>{c}</span>
                          ))}
                        </div>
                      </td>
                      {activeForm.fields.filter((f) => f.type !== "section").slice(0, 4).map((f) => (
                        <td key={f.id} style={{ ...tdStyle, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {(() => { const v = sub.answers?.[f.id]; return v === undefined ? "—" : Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v); })()}
                        </td>
                      ))}
                      <td style={tdStyle}>
                        <span style={{ color: shellAccent, fontSize: 12 }}>View →</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  const thStyle = { textAlign: "left", padding: "10px 14px", fontWeight: 600, fontSize: 11, color: shellMuted, textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: `1px solid ${shellBorder}` };
  const tdStyle = { padding: "10px 14px", color: shellText, fontSize: 13 };

  // ─── Categories Page ─────────────────────────────────────────────
  const renderCategories = () => {
    if (!activeForm) return null;
    const formCats = categories.filter((c) => c.formId === activeFormId);
    const formRules = rules.filter((r) => r.formId === activeFormId);

    return (
      <div style={{ padding: "32px 40px", maxWidth: 800 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 24px", fontFamily: "'DM Sans'", color: shellText }}>
          Categories & Rules — {activeForm.title}
        </h2>

        {/* Categories */}
        <div style={{ marginBottom: 36 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 12px", fontFamily: "'DM Sans'", color: shellText }}>Categories</h3>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            {formCats.map((cat) => (
              <div key={cat.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", background: cat.color + "15", borderRadius: 20, border: `1px solid ${cat.color}33` }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: cat.color }} />
                <span style={{ fontSize: 13, fontFamily: "'DM Sans'", fontWeight: 500, color: shellText }}>{cat.name}</span>
                <button onClick={() => { setCategories((p) => p.filter((c) => c.id !== cat.id)); setRules((p) => p.filter((r) => r.categoryId !== cat.id)); }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: 14, padding: 0 }}>×</button>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div>
              <label style={labelStyle}>Name</label>
              <input value={newCat.name} onChange={(e) => setNewCat((p) => ({ ...p, name: e.target.value }))} style={inputSmall} placeholder="Category name" />
            </div>
            <div>
              <label style={labelStyle}>Color</label>
              <input type="color" value={newCat.color} onChange={(e) => setNewCat((p) => ({ ...p, color: e.target.value }))} style={{ width: 40, height: 36, border: "none", cursor: "pointer" }} />
            </div>
            <button onClick={() => {
              if (!newCat.name.trim()) return;
              setCategories((p) => [...p, { id: uid(), formId: activeFormId, name: newCat.name.trim(), color: newCat.color, description: newCat.description }]);
              setNewCat({ name: "", color: "#e2725b", description: "" });
            }} style={{ ...btnSmall, background: shellAccent, color: "#fff", border: "none", height: 36, whiteSpace: "nowrap" }}>Add</button>
          </div>
        </div>

        {/* Rules */}
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 12px", fontFamily: "'DM Sans'", color: shellText }}>Categorization Rules</h3>
          {formRules.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {formRules.map((rule) => {
                const field = activeForm.fields.find((f) => f.id === rule.fieldId);
                const cat = formCats.find((c) => c.id === rule.categoryId);
                return (
                  <div key={rule.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "#fff", borderRadius: 8, border: `1px solid ${shellBorder}`, fontSize: 13, fontFamily: "'DM Sans'" }}>
                    <span style={{ color: shellMuted }}>If</span>
                    <span style={{ fontWeight: 500, color: shellText }}>{field?.label || "?"}</span>
                    <span style={{ color: shellAccent, fontWeight: 500 }}>{rule.operator}</span>
                    <span style={{ color: shellText }}>"{rule.value}"</span>
                    <span style={{ color: shellMuted }}>→</span>
                    <span style={{ padding: "2px 10px", borderRadius: 12, background: (cat?.color || shellAccent) + "18", color: cat?.color || shellAccent, fontWeight: 500, fontSize: 12 }}>{cat?.name || "?"}</span>
                    <button onClick={() => setRules((p) => p.filter((r) => r.id !== rule.id))} style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", marginLeft: "auto" }}>×</button>
                  </div>
                );
              })}
            </div>
          )}
          {formCats.length > 0 && activeForm.fields.length > 0 ? (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div>
                <label style={labelStyle}>Field</label>
                <select value={newRule.fieldId} onChange={(e) => setNewRule((p) => ({ ...p, fieldId: e.target.value }))} style={{ ...inputSmall, width: 150 }}>
                  <option value="">Select field</option>
                  {activeForm.fields.filter((f) => f.type !== "section").map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Operator</label>
                <select value={newRule.operator} onChange={(e) => setNewRule((p) => ({ ...p, operator: e.target.value }))} style={{ ...inputSmall, width: 120 }}>
                  <option value="contains">contains</option>
                  <option value="equals">equals</option>
                  <option value="gt">greater than</option>
                  <option value="lt">less than</option>
                  <option value="regex">regex</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>Value</label>
                <input value={newRule.value} onChange={(e) => setNewRule((p) => ({ ...p, value: e.target.value }))} style={{ ...inputSmall, width: 140 }} placeholder="Value" />
              </div>
              <div>
                <label style={labelStyle}>Category</label>
                <select value={newRule.categoryId} onChange={(e) => setNewRule((p) => ({ ...p, categoryId: e.target.value }))} style={{ ...inputSmall, width: 150 }}>
                  <option value="">Select category</option>
                  {formCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <button onClick={() => {
                if (!newRule.fieldId || !newRule.value || !newRule.categoryId) return;
                setRules((p) => [...p, { id: uid(), formId: activeFormId, ...newRule }]);
                setNewRule({ fieldId: "", operator: "contains", value: "", categoryId: "" });
              }} style={{ ...btnSmall, background: shellAccent, color: "#fff", border: "none", height: 36, whiteSpace: "nowrap" }}>Add Rule</button>
            </div>
          ) : (
            <p style={{ fontSize: 13, color: shellMuted, fontFamily: "'DM Sans'" }}>
              {formCats.length === 0 ? "Create categories above before adding rules." : "Add fields to the form before creating rules."}
            </p>
          )}
        </div>
      </div>
    );
  };

  // ─── Main Layout ─────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "'DM Sans', sans-serif", background: shellBg, overflow: "hidden" }}>
      <link href={FONTS_LINK} rel="stylesheet" />
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; }
        input:focus, select:focus, textarea:focus { border-color: ${shellAccent} !important; }
        button:hover { opacity: 0.85; }
        tr:hover { background: #f8fafc; }
        @keyframes spin { to { transform: rotate(360deg) } }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
      `}</style>
      {nav}
      <div style={{ flex: 1, overflow: "auto" }}>
        {page === "dashboard" && renderDashboard()}
        {page === "builder" && renderBuilder()}
        {page === "responses" && renderResponses()}
        {page === "categories" && renderCategories()}
      </div>
    </div>
  );
}