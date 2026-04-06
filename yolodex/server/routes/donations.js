import sql from "../lib/db.js";
import {
  layout,
  tablePartial,
  fieldPartial,
  paginationPartial,
  htmlResponse,
  redirect,
  h,
} from "../lib/templates.js";
import { requireAuth } from "../middleware/auth.js";
import { validate, required, isNumeric, min, oneOf, isDate } from "../lib/validation.js";

const METHODS = ["cash", "check", "card", "ach", "other"];
const PER_PAGE = 20;

/** GET /donations — paginated list with search/filter */
export async function donationsListPage(ctx) {
  const authResult = requireAuth(ctx);
  if (authResult) return authResult;

  const page = Math.max(1, parseInt(ctx.query.page) || 1);
  const search = (ctx.query.search || "").trim();
  const methodFilter = ctx.query.method || "";
  const designationFilter = (ctx.query.designation || "").trim();

  // Build WHERE clauses
  const conditions = [];
  const params = [];

  if (search) {
    conditions.push(`(c.first_name || ' ' || c.last_name) ILIKE $${params.length + 1}`);
    params.push(`%${search}%`);
  }
  if (methodFilter && METHODS.includes(methodFilter)) {
    conditions.push(`d.method = $${params.length + 1}`);
    params.push(methodFilter);
  }
  if (designationFilter) {
    conditions.push(`d.designation ILIKE $${params.length + 1}`);
    params.push(`%${designationFilter}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const offset = (page - 1) * PER_PAGE;

  // Use tagged template with unsafe for dynamic WHERE — but parameterize values via postgres.js
  // Since postgres.js uses tagged templates, we build with sql.unsafe for the dynamic parts
  const countResult = await sql.unsafe(
    `SELECT count(*)::int AS count
     FROM donations d
     LEFT JOIN contacts c ON d.contact_id = c.id
     ${whereClause}`,
    params
  );
  const totalCount = countResult[0].count;
  const totalPages = Math.ceil(totalCount / PER_PAGE);

  const rows = await sql.unsafe(
    `SELECT d.id, d.amount, d.received_at, d.method, d.designation, d.receipt_number,
            c.first_name, c.last_name, c.id AS contact_id
     FROM donations d
     LEFT JOIN contacts c ON d.contact_id = c.id
     ${whereClause}
     ORDER BY d.received_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, PER_PAGE, offset]
  );

  // Build base URL preserving filters
  const filterParams = new URLSearchParams();
  if (search) filterParams.set("search", search);
  if (methodFilter) filterParams.set("method", methodFilter);
  if (designationFilter) filterParams.set("designation", designationFilter);
  const baseUrl = `/donations${filterParams.toString() ? "?" + filterParams.toString() : ""}`;

  const table = tablePartial({
    columns: [
      { label: "Date", render: (r) => new Date(r.received_at).toLocaleDateString() },
      {
        label: "Donor",
        render: (r) =>
          r.contact_id
            ? `<a href="/contacts/${h(r.contact_id)}">${h(r.first_name)} ${h(r.last_name)}</a>`
            : "<em>Anonymous</em>",
      },
      { label: "Amount", render: (r) => `$${Number(r.amount).toFixed(2)}` },
      { label: "Method", key: "method" },
      { label: "Designation", render: (r) => h(r.designation || "—") },
      { label: "Receipt #", render: (r) => h(r.receipt_number || "—") },
      {
        label: "",
        render: (r) => `<a href="/donations/${h(r.id)}" class="btn btn-sm btn-outline">View</a>`,
      },
    ],
    rows,
    emptyMessage: "No donations found.",
  });

  const methodOptions = METHODS.map(
    (m) => `<option value="${h(m)}"${m === methodFilter ? " selected" : ""}>${h(m)}</option>`
  ).join("");

  const content = `
  <div class="page-header">
    <h1>Donations</h1>
    <a href="/donations/new" class="btn btn-primary">New Donation</a>
  </div>

  <form method="GET" action="/donations" class="filter-bar">
    <input type="text" name="search" value="${h(search)}" placeholder="Search by donor name…" class="input-search">
    <select name="method">
      <option value="">All Methods</option>
      ${methodOptions}
    </select>
    <input type="text" name="designation" value="${h(designationFilter)}" placeholder="Designation…">
    <button type="submit" class="btn btn-outline">Filter</button>
  </form>

  ${table}
  ${paginationPartial({ currentPage: page, totalPages, baseUrl })}
  `;

  return htmlResponse(
    layout({ title: "Donations — Nonprofit CRM", content, user: ctx.state.user, activePath: "/donations" })
  );
}

/** GET /donations/new — new donation form */
export async function donationsNewPage(ctx) {
  const authResult = requireAuth(ctx);
  if (authResult) return authResult;

  const contacts = await sql`
    SELECT id, first_name, last_name FROM contacts WHERE is_deleted = false ORDER BY last_name, first_name
  `;

  const content = donationForm({ contacts, errors: {}, values: {}, csrfToken: ctx.state.csrfToken });
  return htmlResponse(
    layout({ title: "New Donation — Nonprofit CRM", content, user: ctx.state.user, activePath: "/donations" })
  );
}

/** POST /donations — validate and insert */
export async function donationsCreateSubmit(ctx) {
  const authResult = requireAuth(ctx);
  if (authResult) return authResult;

  const body = ctx.state.body;

  const errors = validate(body, {
    contact_id: [required("Donor is required")],
    amount: [required("Amount is required"), isNumeric("Must be a valid number"), min(0.01, "Must be at least $0.01")],
    received_at: [required("Date is required"), isDate("Must be a valid date")],
    method: [required("Method is required"), oneOf(METHODS, "Invalid payment method")],
  });

  if (errors) {
    const contacts = await sql`
      SELECT id, first_name, last_name FROM contacts WHERE is_deleted = false ORDER BY last_name, first_name
    `;
    const content = donationForm({ contacts, errors, values: body, csrfToken: ctx.state.csrfToken });
    return htmlResponse(
      layout({ title: "New Donation — Nonprofit CRM", content, user: ctx.state.user, activePath: "/donations" }),
      422
    );
  }

  // Generate receipt number
  const [{ value: prefix }] = await sql`SELECT value FROM app_settings WHERE key = 'receipt_prefix'`;
  const [{ next_num }] = await sql`
    SELECT coalesce(max(
      nullif(regexp_replace(receipt_number, '^.*-', ''), '')::int
    ), 0) + 1 AS next_num
    FROM donations
    WHERE receipt_number LIKE ${prefix + '-%'}
  `;
  const receiptNumber = `${prefix}-${String(next_num).padStart(5, "0")}`;

  const [donation] = await sql`
    INSERT INTO donations (contact_id, amount, received_at, method, designation, fund, reference_id, memo, receipt_number)
    VALUES (
      ${body.contact_id},
      ${body.amount},
      ${body.received_at},
      ${body.method},
      ${body.designation || null},
      ${body.fund || null},
      ${body.reference_id || null},
      ${body.memo || null},
      ${receiptNumber}
    )
    RETURNING id
  `;

  return redirect(`/donations/${donation.id}`);
}

/** GET /donations/:id — detail view */
export async function donationsDetailPage(ctx) {
  const authResult = requireAuth(ctx);
  if (authResult) return authResult;

  const { id } = ctx.params;

  const rows = await sql`
    SELECT d.*,
           c.first_name, c.last_name, c.id AS donor_contact_id
    FROM donations d
    LEFT JOIN contacts c ON d.contact_id = c.id
    WHERE d.id = ${id}
  `;

  if (rows.length === 0) {
    return htmlResponse(
      layout({
        title: "Not Found — Nonprofit CRM",
        content: '<h1>Donation Not Found</h1><p><a href="/donations">Back to donations</a></p>',
        user: ctx.state.user,
        activePath: "/donations",
      }),
      404
    );
  }

  const d = rows[0];

  const adjustments = await sql`
    SELECT da.*, a.email AS created_by_email
    FROM donation_adjustments da
    LEFT JOIN accounts a ON da.created_by = a.id
    WHERE da.donation_id = ${id}
    ORDER BY da.created_at DESC
  `;

  const adjustmentsHtml =
    adjustments.length === 0
      ? ""
      : `
    <h2>Adjustments</h2>
    ${tablePartial({
      columns: [
        { label: "Date", render: (r) => new Date(r.created_at).toLocaleDateString() },
        { label: "Type", key: "adjustment_type" },
        { label: "Amount", render: (r) => `$${Number(r.amount).toFixed(2)}` },
        { label: "Reason", render: (r) => h(r.reason || "—") },
        { label: "By", render: (r) => h(r.created_by_email || "—") },
      ],
      rows: adjustments,
    })}`;

  const donorLink = d.donor_contact_id
    ? `<a href="/contacts/${h(d.donor_contact_id)}">${h(d.first_name)} ${h(d.last_name)}</a>`
    : "<em>Anonymous</em>";

  const content = `
  <div class="page-header">
    <h1>Donation ${h(d.receipt_number || "")}</h1>
    <a href="/donations" class="btn btn-outline">Back to List</a>
  </div>

  <div class="detail-grid">
    <div class="detail-row"><span class="detail-label">Donor</span><span>${donorLink}</span></div>
    <div class="detail-row"><span class="detail-label">Amount</span><span>$${Number(d.amount).toFixed(2)} ${h(d.currency)}</span></div>
    <div class="detail-row"><span class="detail-label">Date Received</span><span>${new Date(d.received_at).toLocaleDateString()}</span></div>
    <div class="detail-row"><span class="detail-label">Method</span><span>${h(d.method)}</span></div>
    <div class="detail-row"><span class="detail-label">Receipt #</span><span>${h(d.receipt_number || "—")}</span></div>
    <div class="detail-row"><span class="detail-label">Designation</span><span>${h(d.designation || "—")}</span></div>
    <div class="detail-row"><span class="detail-label">Fund</span><span>${h(d.fund || "—")}</span></div>
    <div class="detail-row"><span class="detail-label">Reference ID</span><span>${h(d.reference_id || "—")}</span></div>
    <div class="detail-row"><span class="detail-label">Memo</span><span>${h(d.memo || "—")}</span></div>
    <div class="detail-row"><span class="detail-label">Created</span><span>${new Date(d.created_at).toLocaleString()}</span></div>
  </div>

  ${adjustmentsHtml}
  `;

  return htmlResponse(
    layout({ title: `Donation ${d.receipt_number || ""} — Nonprofit CRM`, content, user: ctx.state.user, activePath: "/donations" })
  );
}

/** Donation form HTML */
function donationForm({ contacts, errors = {}, values = {}, csrfToken = "" }) {
  const contactOptions = [
    { value: "", label: "— Select Donor —" },
    ...contacts.map((c) => ({ value: c.id, label: `${c.last_name}, ${c.first_name}` })),
  ];

  const methodOptions = [
    { value: "", label: "— Select Method —" },
    ...METHODS.map((m) => ({ value: m, label: m.charAt(0).toUpperCase() + m.slice(1) })),
  ];

  return `
  <h1>New Donation</h1>
  <form method="POST" action="/donations" class="form">
    <input type="hidden" name="_csrf" value="${h(csrfToken)}">
    ${fieldPartial({ label: "Donor", name: "contact_id", value: values.contact_id, error: errors.contact_id, required: true, options: contactOptions })}
    ${fieldPartial({ label: "Amount ($)", name: "amount", type: "number", value: values.amount, error: errors.amount, required: true, placeholder: "0.00" })}
    ${fieldPartial({ label: "Date Received", name: "received_at", type: "date", value: values.received_at, error: errors.received_at, required: true })}
    ${fieldPartial({ label: "Method", name: "method", value: values.method, error: errors.method, required: true, options: methodOptions })}
    ${fieldPartial({ label: "Designation", name: "designation", value: values.designation, error: errors.designation })}
    ${fieldPartial({ label: "Fund", name: "fund", value: values.fund, error: errors.fund })}
    ${fieldPartial({ label: "Reference ID", name: "reference_id", value: values.reference_id, error: errors.reference_id, placeholder: "Check #, transaction ID, etc." })}
    ${fieldPartial({ label: "Memo", name: "memo", type: "textarea", value: values.memo, error: errors.memo })}
    <div class="form-actions">
      <button type="submit" class="btn btn-primary">Save Donation</button>
      <a href="/donations" class="btn btn-outline">Cancel</a>
    </div>
  </form>`;
}
