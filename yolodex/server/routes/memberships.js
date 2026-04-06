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
import { validate, required, isNumeric, min, isDate, oneOf } from "../lib/validation.js";

const STATUSES = ["prospect", "active", "lapsed", "cancelled"];
const PER_PAGE = 20;

/** GET /memberships/renewals — upcoming renewals list */
export async function membershipsRenewalsPage(ctx) {
  const authResult = requireAuth(ctx);
  if (authResult) return authResult;

  const page = Math.max(1, parseInt(ctx.query.page) || 1);
  const search = (ctx.query.search || "").trim();
  const statusFilter = ctx.query.status || "";
  const levelFilter = (ctx.query.level || "").trim();

  const conditions = [];
  const params = [];

  // Show memberships with renewal within 90 days or past due
  conditions.push(`(m.renewal_date <= CURRENT_DATE + INTERVAL '90 days' OR m.renewal_date < CURRENT_DATE)`);

  if (search) {
    conditions.push(`(c.first_name || ' ' || c.last_name) ILIKE $${params.length + 1}`);
    params.push(`%${search}%`);
  }
  if (statusFilter && STATUSES.includes(statusFilter)) {
    conditions.push(`m.status = $${params.length + 1}`);
    params.push(statusFilter);
  }
  if (levelFilter) {
    conditions.push(`m.level ILIKE $${params.length + 1}`);
    params.push(`%${levelFilter}%`);
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;
  const offset = (page - 1) * PER_PAGE;

  const countResult = await sql.unsafe(
    `SELECT count(*)::int AS count
     FROM memberships m
     JOIN contacts c ON m.contact_id = c.id
     ${whereClause}`,
    params
  );
  const totalCount = countResult[0].count;
  const totalPages = Math.ceil(totalCount / PER_PAGE);

  const rows = await sql.unsafe(
    `SELECT m.id, m.status, m.level, m.dues_amount, m.renewal_date,
            c.first_name, c.last_name, c.id AS contact_id
     FROM memberships m
     JOIN contacts c ON m.contact_id = c.id
     ${whereClause}
     ORDER BY m.renewal_date ASC NULLS LAST
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, PER_PAGE, offset]
  );

  const filterParams = new URLSearchParams();
  if (search) filterParams.set("search", search);
  if (statusFilter) filterParams.set("status", statusFilter);
  if (levelFilter) filterParams.set("level", levelFilter);
  const baseUrl = `/memberships/renewals${filterParams.toString() ? "?" + filterParams.toString() : ""}`;

  const table = tablePartial({
    columns: [
      {
        label: "Member",
        render: (r) => `<a href="/contacts/${h(r.contact_id)}">${h(r.first_name)} ${h(r.last_name)}</a>`,
      },
      { label: "Level", render: (r) => h(r.level) },
      {
        label: "Status",
        render: (r) => `<span class="badge badge-${h(r.status)}">${h(r.status)}</span>`,
      },
      { label: "Dues", render: (r) => `$${Number(r.dues_amount).toFixed(2)}` },
      {
        label: "Renewal Date",
        render: (r) => r.renewal_date ? new Date(r.renewal_date).toLocaleDateString() : "—",
      },
      {
        label: "",
        render: (r) => `<a href="/memberships/${h(r.id)}" class="btn btn-sm btn-outline">View</a>`,
      },
    ],
    rows,
    emptyMessage: "No upcoming renewals.",
  });

  const statusOptions = STATUSES.map(
    (s) => `<option value="${h(s)}"${s === statusFilter ? " selected" : ""}>${h(s)}</option>`
  ).join("");

  const content = `
  <div class="page-header">
    <h1>Membership Renewals</h1>
    <a href="/memberships/new" class="btn btn-primary">New Membership</a>
  </div>

  <form method="GET" action="/memberships/renewals" class="filter-bar">
    <input type="text" name="search" value="${h(search)}" placeholder="Search by member name…" class="input-search">
    <select name="status">
      <option value="">All Statuses</option>
      ${statusOptions}
    </select>
    <input type="text" name="level" value="${h(levelFilter)}" placeholder="Level…">
    <button type="submit" class="btn btn-outline">Filter</button>
  </form>

  ${table}
  ${paginationPartial({ currentPage: page, totalPages, baseUrl })}
  `;

  return htmlResponse(
    layout({ title: "Membership Renewals — Nonprofit CRM", content, user: ctx.state.user, activePath: "/memberships/renewals" })
  );
}

/** GET /memberships/new — new membership form */
export async function membershipsNewPage(ctx) {
  const authResult = requireAuth(ctx);
  if (authResult) return authResult;

  const contacts = await sql`
    SELECT id, first_name, last_name FROM contacts WHERE is_deleted = false ORDER BY last_name, first_name
  `;

  const content = membershipForm({ contacts, errors: {}, values: {}, csrfToken: ctx.state.csrfToken });
  return htmlResponse(
    layout({ title: "New Membership — Nonprofit CRM", content, user: ctx.state.user, activePath: "/memberships/renewals" })
  );
}

/** POST /memberships — validate and insert */
export async function membershipsCreateSubmit(ctx) {
  const authResult = requireAuth(ctx);
  if (authResult) return authResult;

  const body = ctx.state.body;
  const errors = validateMembership(body);

  if (errors) {
    const contacts = await sql`
      SELECT id, first_name, last_name FROM contacts WHERE is_deleted = false ORDER BY last_name, first_name
    `;
    const content = membershipForm({ contacts, errors, values: body, csrfToken: ctx.state.csrfToken });
    return htmlResponse(
      layout({ title: "New Membership — Nonprofit CRM", content, user: ctx.state.user, activePath: "/memberships/renewals" }),
      422
    );
  }

  const [membership] = await sql`
    INSERT INTO memberships (contact_id, status, level, dues_amount, start_date, end_date, renewal_date, notes)
    VALUES (
      ${body.contact_id},
      ${body.status || "prospect"},
      ${body.level.trim()},
      ${body.dues_amount || 0},
      ${body.start_date || null},
      ${body.end_date || null},
      ${body.renewal_date || null},
      ${body.notes?.trim() || null}
    )
    RETURNING id
  `;

  return redirect(`/memberships/${membership.id}`);
}

/** GET /memberships/:id — detail view */
export async function membershipsDetailPage(ctx) {
  const authResult = requireAuth(ctx);
  if (authResult) return authResult;

  const { id } = ctx.params;

  const rows = await sql`
    SELECT m.*,
           c.first_name, c.last_name, c.id AS member_contact_id
    FROM memberships m
    JOIN contacts c ON m.contact_id = c.id
    WHERE m.id = ${id}
  `;

  if (rows.length === 0) {
    return htmlResponse(
      layout({
        title: "Not Found — Nonprofit CRM",
        content: '<h1>Membership Not Found</h1><p><a href="/memberships/renewals">Back to memberships</a></p>',
        user: ctx.state.user,
        activePath: "/memberships/renewals",
      }),
      404
    );
  }

  const m = rows[0];

  const memberLink = `<a href="/contacts/${h(m.member_contact_id)}">${h(m.first_name)} ${h(m.last_name)}</a>`;

  const content = `
  <div class="page-header">
    <h1>Membership — ${h(m.first_name)} ${h(m.last_name)}</h1>
    <div>
      <a href="/memberships/${h(m.id)}/edit" class="btn btn-outline">Edit</a>
      <a href="/memberships/renewals" class="btn btn-outline">Back to List</a>
    </div>
  </div>

  <div class="detail-grid">
    <div class="detail-row"><span class="detail-label">Member</span><span>${memberLink}</span></div>
    <div class="detail-row"><span class="detail-label">Status</span><span><span class="badge badge-${h(m.status)}">${h(m.status)}</span></span></div>
    <div class="detail-row"><span class="detail-label">Level</span><span>${h(m.level)}</span></div>
    <div class="detail-row"><span class="detail-label">Dues Amount</span><span>$${Number(m.dues_amount).toFixed(2)}</span></div>
    <div class="detail-row"><span class="detail-label">Start Date</span><span>${m.start_date ? new Date(m.start_date).toLocaleDateString() : "—"}</span></div>
    <div class="detail-row"><span class="detail-label">End Date</span><span>${m.end_date ? new Date(m.end_date).toLocaleDateString() : "—"}</span></div>
    <div class="detail-row"><span class="detail-label">Renewal Date</span><span>${m.renewal_date ? new Date(m.renewal_date).toLocaleDateString() : "—"}</span></div>
    <div class="detail-row"><span class="detail-label">Notes</span><span>${h(m.notes || "—")}</span></div>
    <div class="detail-row"><span class="detail-label">Created</span><span>${new Date(m.created_at).toLocaleString()}</span></div>
    <div class="detail-row"><span class="detail-label">Updated</span><span>${new Date(m.updated_at).toLocaleString()}</span></div>
  </div>
  `;

  return htmlResponse(
    layout({ title: `Membership — ${m.first_name} ${m.last_name} — Nonprofit CRM`, content, user: ctx.state.user, activePath: "/memberships/renewals" })
  );
}

/** GET /memberships/:id/edit — edit form */
export async function membershipsEditPage(ctx) {
  const authResult = requireAuth(ctx);
  if (authResult) return authResult;

  const { id } = ctx.params;

  const rows = await sql`
    SELECT m.*, c.first_name, c.last_name
    FROM memberships m
    JOIN contacts c ON m.contact_id = c.id
    WHERE m.id = ${id}
  `;

  if (rows.length === 0) {
    return htmlResponse(
      layout({
        title: "Not Found — Nonprofit CRM",
        content: '<h1>Membership Not Found</h1><p><a href="/memberships/renewals">Back to memberships</a></p>',
        user: ctx.state.user,
        activePath: "/memberships/renewals",
      }),
      404
    );
  }

  const m = rows[0];
  const contacts = await sql`
    SELECT id, first_name, last_name FROM contacts WHERE is_deleted = false ORDER BY last_name, first_name
  `;

  // Format dates for input fields (YYYY-MM-DD)
  const values = {
    ...m,
    start_date: m.start_date ? new Date(m.start_date).toISOString().slice(0, 10) : "",
    end_date: m.end_date ? new Date(m.end_date).toISOString().slice(0, 10) : "",
    renewal_date: m.renewal_date ? new Date(m.renewal_date).toISOString().slice(0, 10) : "",
  };

  const content = membershipForm({ contacts, errors: {}, values, csrfToken: ctx.state.csrfToken, editId: m.id });
  return htmlResponse(
    layout({ title: `Edit Membership — ${m.first_name} ${m.last_name} — Nonprofit CRM`, content, user: ctx.state.user, activePath: "/memberships/renewals" })
  );
}

/** POST /memberships/:id — validate and update */
export async function membershipsUpdateSubmit(ctx) {
  const authResult = requireAuth(ctx);
  if (authResult) return authResult;

  const { id } = ctx.params;
  const body = ctx.state.body;

  const existing = await sql`SELECT id FROM memberships WHERE id = ${id}`;
  if (existing.length === 0) {
    return htmlResponse(
      layout({
        title: "Not Found — Nonprofit CRM",
        content: '<h1>Membership Not Found</h1><p><a href="/memberships/renewals">Back to memberships</a></p>',
        user: ctx.state.user,
        activePath: "/memberships/renewals",
      }),
      404
    );
  }

  const errors = validateMembership(body);

  if (errors) {
    const contacts = await sql`
      SELECT id, first_name, last_name FROM contacts WHERE is_deleted = false ORDER BY last_name, first_name
    `;
    const content = membershipForm({ contacts, errors, values: body, csrfToken: ctx.state.csrfToken, editId: id });
    return htmlResponse(
      layout({ title: "Edit Membership — Nonprofit CRM", content, user: ctx.state.user, activePath: "/memberships/renewals" }),
      422
    );
  }

  await sql`
    UPDATE memberships SET
      contact_id = ${body.contact_id},
      status = ${body.status || "prospect"},
      level = ${body.level.trim()},
      dues_amount = ${body.dues_amount || 0},
      start_date = ${body.start_date || null},
      end_date = ${body.end_date || null},
      renewal_date = ${body.renewal_date || null},
      notes = ${body.notes?.trim() || null},
      updated_at = now()
    WHERE id = ${id}
  `;

  return redirect(`/memberships/${id}`);
}

/** Shared validation */
function validateMembership(body) {
  return validate(body, {
    contact_id: [required("Member is required")],
    level: [required("Level is required")],
    dues_amount: [isNumeric("Must be a valid number"), min(0, "Must be zero or more")],
    status: [oneOf(STATUSES, "Invalid status")],
    start_date: [isDate("Must be a valid date")],
    end_date: [isDate("Must be a valid date")],
    renewal_date: [isDate("Must be a valid date")],
  });
}

/** Membership form HTML (used for both new and edit) */
function membershipForm({ contacts, errors = {}, values = {}, csrfToken = "", editId = null }) {
  const isEdit = editId != null;
  const action = isEdit ? `/memberships/${h(editId)}` : "/memberships";
  const title = isEdit ? "Edit Membership" : "New Membership";

  const contactOptions = [
    { value: "", label: "— Select Member —" },
    ...contacts.map((c) => ({ value: c.id, label: `${c.last_name}, ${c.first_name}` })),
  ];

  const statusOptions = [
    { value: "", label: "— Select Status —" },
    ...STATUSES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) })),
  ];

  return `
  <h1>${title}</h1>
  <form method="POST" action="${action}" class="form">
    <input type="hidden" name="_csrf" value="${h(csrfToken)}">
    ${fieldPartial({ label: "Member", name: "contact_id", value: values.contact_id, error: errors.contact_id, required: true, options: contactOptions })}
    ${fieldPartial({ label: "Status", name: "status", value: values.status, error: errors.status, options: statusOptions })}
    ${fieldPartial({ label: "Level", name: "level", value: values.level, error: errors.level, required: true, placeholder: "e.g. standard, premium" })}
    ${fieldPartial({ label: "Dues Amount ($)", name: "dues_amount", type: "number", value: values.dues_amount, error: errors.dues_amount, placeholder: "0.00" })}
    ${fieldPartial({ label: "Start Date", name: "start_date", type: "date", value: values.start_date, error: errors.start_date })}
    ${fieldPartial({ label: "End Date", name: "end_date", type: "date", value: values.end_date, error: errors.end_date })}
    ${fieldPartial({ label: "Renewal Date", name: "renewal_date", type: "date", value: values.renewal_date, error: errors.renewal_date })}
    ${fieldPartial({ label: "Notes", name: "notes", type: "textarea", value: values.notes, error: errors.notes })}
    <div class="form-actions">
      <button type="submit" class="btn btn-primary">${isEdit ? "Save Changes" : "Create Membership"}</button>
      <a href="${isEdit ? `/memberships/${h(editId)}` : "/memberships/renewals"}" class="btn btn-outline">Cancel</a>
    </div>
  </form>`;
}
