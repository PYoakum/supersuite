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
import { validate, required, isEmail, oneOf } from "../lib/validation.js";

const STAGES = ["prospect", "active", "donor", "lapsed", "inactive"];
const CONTACT_METHODS = ["email", "phone", "mail"];
const PER_PAGE = 20;

/** GET /contacts — paginated list with search/filter */
export async function contactsListPage(ctx) {
  const authResult = requireAuth(ctx);
  if (authResult) return authResult;

  const page = Math.max(1, parseInt(ctx.query.page) || 1);
  const search = (ctx.query.search || "").trim();
  const stageFilter = ctx.query.stage || "";

  const conditions = [];
  const params = [];

  conditions.push("c.is_deleted = false");

  if (search) {
    conditions.push(`((c.first_name || ' ' || c.last_name) ILIKE $${params.length + 1} OR c.email ILIKE $${params.length + 1})`);
    params.push(`%${search}%`);
  }
  if (stageFilter && STAGES.includes(stageFilter)) {
    conditions.push(`c.lifecycle_stage = $${params.length + 1}`);
    params.push(stageFilter);
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;
  const offset = (page - 1) * PER_PAGE;

  const countResult = await sql.unsafe(
    `SELECT count(*)::int AS count FROM contacts c ${whereClause}`,
    params
  );
  const totalCount = countResult[0].count;
  const totalPages = Math.ceil(totalCount / PER_PAGE);

  const rows = await sql.unsafe(
    `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.lifecycle_stage, c.city, c.state
     FROM contacts c
     ${whereClause}
     ORDER BY c.last_name, c.first_name
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, PER_PAGE, offset]
  );

  const filterParams = new URLSearchParams();
  if (search) filterParams.set("search", search);
  if (stageFilter) filterParams.set("stage", stageFilter);
  const baseUrl = `/contacts${filterParams.toString() ? "?" + filterParams.toString() : ""}`;

  const table = tablePartial({
    columns: [
      {
        label: "Name",
        render: (r) => `<a href="/contacts/${h(r.id)}">${h(r.last_name)}, ${h(r.first_name)}</a>`,
      },
      { label: "Email", render: (r) => h(r.email || "—") },
      { label: "Phone", render: (r) => h(r.phone || "—") },
      {
        label: "Stage",
        render: (r) => `<span class="badge badge-${h(r.lifecycle_stage)}">${h(r.lifecycle_stage)}</span>`,
      },
      {
        label: "Location",
        render: (r) => {
          const parts = [r.city, r.state].filter(Boolean);
          return h(parts.join(", ") || "—");
        },
      },
      {
        label: "",
        render: (r) => `<a href="/contacts/${h(r.id)}" class="btn btn-sm btn-outline">View</a>`,
      },
    ],
    rows,
    emptyMessage: "No contacts found.",
  });

  const stageOptions = STAGES.map(
    (s) => `<option value="${h(s)}"${s === stageFilter ? " selected" : ""}>${h(s)}</option>`
  ).join("");

  const content = `
  <div class="page-header">
    <h1>Contacts</h1>
    <a href="/contacts/new" class="btn btn-primary">New Contact</a>
  </div>

  <form method="GET" action="/contacts" class="filter-bar">
    <input type="text" name="search" value="${h(search)}" placeholder="Search by name or email…" class="input-search">
    <select name="stage">
      <option value="">All Stages</option>
      ${stageOptions}
    </select>
    <button type="submit" class="btn btn-outline">Filter</button>
  </form>

  ${table}
  ${paginationPartial({ currentPage: page, totalPages, baseUrl })}
  `;

  return htmlResponse(
    layout({ title: "Contacts — Nonprofit CRM", content, user: ctx.state.user, activePath: "/contacts" })
  );
}

/** GET /contacts/new — new contact form */
export async function contactsNewPage(ctx) {
  const authResult = requireAuth(ctx);
  if (authResult) return authResult;

  const content = contactForm({ errors: {}, values: {}, csrfToken: ctx.state.csrfToken });
  return htmlResponse(
    layout({ title: "New Contact — Nonprofit CRM", content, user: ctx.state.user, activePath: "/contacts" })
  );
}

/** POST /contacts — validate and insert */
export async function contactsCreateSubmit(ctx) {
  const authResult = requireAuth(ctx);
  if (authResult) return authResult;

  const body = ctx.state.body;
  const errors = validateContact(body);

  if (errors) {
    const content = contactForm({ errors, values: body, csrfToken: ctx.state.csrfToken });
    return htmlResponse(
      layout({ title: "New Contact — Nonprofit CRM", content, user: ctx.state.user, activePath: "/contacts" }),
      422
    );
  }

  const [contact] = await sql`
    INSERT INTO contacts (first_name, last_name, email, phone, address_line1, address_line2, city, state, postal_code, preferred_contact_method, lifecycle_stage)
    VALUES (
      ${body.first_name.trim()},
      ${body.last_name.trim()},
      ${body.email?.trim() || null},
      ${body.phone?.trim() || null},
      ${body.address_line1?.trim() || null},
      ${body.address_line2?.trim() || null},
      ${body.city?.trim() || null},
      ${body.state?.trim() || null},
      ${body.postal_code?.trim() || null},
      ${body.preferred_contact_method || "email"},
      ${body.lifecycle_stage || "prospect"}
    )
    RETURNING id
  `;

  return redirect(`/contacts/${contact.id}`);
}

/** GET /contacts/:id — detail view */
export async function contactsDetailPage(ctx) {
  const authResult = requireAuth(ctx);
  if (authResult) return authResult;

  const { id } = ctx.params;

  const rows = await sql`
    SELECT * FROM contacts WHERE id = ${id} AND is_deleted = false
  `;

  if (rows.length === 0) {
    return htmlResponse(
      layout({
        title: "Not Found — Nonprofit CRM",
        content: '<h1>Contact Not Found</h1><p><a href="/contacts">Back to contacts</a></p>',
        user: ctx.state.user,
        activePath: "/contacts",
      }),
      404
    );
  }

  const c = rows[0];

  const memberships = await sql`
    SELECT id, status, level, dues_amount, renewal_date, start_date, end_date
    FROM memberships
    WHERE contact_id = ${id}
    ORDER BY start_date DESC
  `;

  const donations = await sql`
    SELECT id, amount, received_at, method, designation, receipt_number
    FROM donations
    WHERE contact_id = ${id}
    ORDER BY received_at DESC
    LIMIT 10
  `;

  const tags = await sql`
    SELECT t.name
    FROM tags t
    JOIN contact_tags ct ON ct.tag_id = t.id
    WHERE ct.contact_id = ${id}
    ORDER BY t.name
  `;

  const orgs = await sql`
    SELECT o.id, o.name, co.role
    FROM organizations o
    JOIN contact_organizations co ON co.organization_id = o.id
    WHERE co.contact_id = ${id}
    ORDER BY o.name
  `;

  const membershipsHtml = memberships.length === 0 ? "" : `
    <h2>Memberships</h2>
    ${tablePartial({
      columns: [
        { label: "Level", key: "level" },
        { label: "Status", render: (r) => `<span class="badge badge-${h(r.status)}">${h(r.status)}</span>` },
        { label: "Dues", render: (r) => `$${Number(r.dues_amount).toFixed(2)}` },
        { label: "Start", render: (r) => r.start_date ? new Date(r.start_date).toLocaleDateString() : "—" },
        { label: "End", render: (r) => r.end_date ? new Date(r.end_date).toLocaleDateString() : "—" },
        { label: "Renewal", render: (r) => r.renewal_date ? new Date(r.renewal_date).toLocaleDateString() : "—" },
        { label: "", render: (r) => `<a href="/memberships/${h(r.id)}" class="btn btn-sm btn-outline">View</a>` },
      ],
      rows: memberships,
    })}`;

  const donationsHtml = donations.length === 0 ? "" : `
    <h2>Recent Donations</h2>
    ${tablePartial({
      columns: [
        { label: "Date", render: (r) => new Date(r.received_at).toLocaleDateString() },
        { label: "Amount", render: (r) => `$${Number(r.amount).toFixed(2)}` },
        { label: "Method", key: "method" },
        { label: "Designation", render: (r) => h(r.designation || "—") },
        { label: "Receipt #", render: (r) => h(r.receipt_number || "—") },
        { label: "", render: (r) => `<a href="/donations/${h(r.id)}" class="btn btn-sm btn-outline">View</a>` },
      ],
      rows: donations,
    })}`;

  const tagsHtml = tags.length === 0 ? "" : `
    <h2>Tags</h2>
    <div class="tag-list">${tags.map((t) => `<span class="badge">${h(t.name)}</span>`).join(" ")}</div>`;

  const orgsHtml = orgs.length === 0 ? "" : `
    <h2>Organizations</h2>
    ${tablePartial({
      columns: [
        { label: "Organization", render: (r) => h(r.name) },
        { label: "Role", render: (r) => h(r.role || "—") },
      ],
      rows: orgs,
    })}`;

  const location = [c.address_line1, c.address_line2, [c.city, c.state].filter(Boolean).join(", "), c.postal_code]
    .filter(Boolean)
    .join("<br>");

  const content = `
  <div class="page-header">
    <h1>${h(c.first_name)} ${h(c.last_name)}</h1>
    <div>
      <a href="/contacts/${h(c.id)}/edit" class="btn btn-outline">Edit</a>
      <a href="/contacts" class="btn btn-outline">Back to List</a>
    </div>
  </div>

  <div class="detail-grid">
    <div class="detail-row"><span class="detail-label">Email</span><span>${h(c.email || "—")}</span></div>
    <div class="detail-row"><span class="detail-label">Phone</span><span>${h(c.phone || "—")}</span></div>
    <div class="detail-row"><span class="detail-label">Address</span><span>${location || "—"}</span></div>
    <div class="detail-row"><span class="detail-label">Preferred Contact</span><span>${h(c.preferred_contact_method || "—")}</span></div>
    <div class="detail-row"><span class="detail-label">Lifecycle Stage</span><span><span class="badge badge-${h(c.lifecycle_stage)}">${h(c.lifecycle_stage)}</span></span></div>
    <div class="detail-row"><span class="detail-label">Created</span><span>${new Date(c.created_at).toLocaleString()}</span></div>
    <div class="detail-row"><span class="detail-label">Updated</span><span>${new Date(c.updated_at).toLocaleString()}</span></div>
  </div>

  ${membershipsHtml}
  ${donationsHtml}
  ${tagsHtml}
  ${orgsHtml}
  `;

  return htmlResponse(
    layout({ title: `${c.first_name} ${c.last_name} — Nonprofit CRM`, content, user: ctx.state.user, activePath: "/contacts" })
  );
}

/** GET /contacts/:id/edit — edit form */
export async function contactsEditPage(ctx) {
  const authResult = requireAuth(ctx);
  if (authResult) return authResult;

  const { id } = ctx.params;
  const rows = await sql`
    SELECT * FROM contacts WHERE id = ${id} AND is_deleted = false
  `;

  if (rows.length === 0) {
    return htmlResponse(
      layout({
        title: "Not Found — Nonprofit CRM",
        content: '<h1>Contact Not Found</h1><p><a href="/contacts">Back to contacts</a></p>',
        user: ctx.state.user,
        activePath: "/contacts",
      }),
      404
    );
  }

  const c = rows[0];
  const content = contactForm({ errors: {}, values: c, csrfToken: ctx.state.csrfToken, editId: c.id });
  return htmlResponse(
    layout({ title: `Edit ${c.first_name} ${c.last_name} — Nonprofit CRM`, content, user: ctx.state.user, activePath: "/contacts" })
  );
}

/** POST /contacts/:id — validate and update */
export async function contactsUpdateSubmit(ctx) {
  const authResult = requireAuth(ctx);
  if (authResult) return authResult;

  const { id } = ctx.params;
  const body = ctx.state.body;

  const existing = await sql`SELECT id FROM contacts WHERE id = ${id} AND is_deleted = false`;
  if (existing.length === 0) {
    return htmlResponse(
      layout({
        title: "Not Found — Nonprofit CRM",
        content: '<h1>Contact Not Found</h1><p><a href="/contacts">Back to contacts</a></p>',
        user: ctx.state.user,
        activePath: "/contacts",
      }),
      404
    );
  }

  const errors = validateContact(body);

  if (errors) {
    const content = contactForm({ errors, values: body, csrfToken: ctx.state.csrfToken, editId: id });
    return htmlResponse(
      layout({ title: "Edit Contact — Nonprofit CRM", content, user: ctx.state.user, activePath: "/contacts" }),
      422
    );
  }

  await sql`
    UPDATE contacts SET
      first_name = ${body.first_name.trim()},
      last_name = ${body.last_name.trim()},
      email = ${body.email?.trim() || null},
      phone = ${body.phone?.trim() || null},
      address_line1 = ${body.address_line1?.trim() || null},
      address_line2 = ${body.address_line2?.trim() || null},
      city = ${body.city?.trim() || null},
      state = ${body.state?.trim() || null},
      postal_code = ${body.postal_code?.trim() || null},
      preferred_contact_method = ${body.preferred_contact_method || "email"},
      lifecycle_stage = ${body.lifecycle_stage || "prospect"},
      updated_at = now()
    WHERE id = ${id}
  `;

  return redirect(`/contacts/${id}`);
}

/** Shared validation */
function validateContact(body) {
  return validate(body, {
    first_name: [required("First name is required")],
    last_name: [required("Last name is required")],
    email: [isEmail("Must be a valid email address")],
    preferred_contact_method: [oneOf(CONTACT_METHODS, "Invalid contact method")],
    lifecycle_stage: [oneOf(STAGES, "Invalid lifecycle stage")],
  });
}

/** Contact form HTML (used for both new and edit) */
function contactForm({ errors = {}, values = {}, csrfToken = "", editId = null }) {
  const isEdit = editId != null;
  const action = isEdit ? `/contacts/${h(editId)}` : "/contacts";
  const title = isEdit ? "Edit Contact" : "New Contact";

  const methodOptions = [
    { value: "", label: "— Select —" },
    ...CONTACT_METHODS.map((m) => ({ value: m, label: m.charAt(0).toUpperCase() + m.slice(1) })),
  ];

  const stageOptions = [
    { value: "", label: "— Select —" },
    ...STAGES.map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) })),
  ];

  return `
  <h1>${title}</h1>
  <form method="POST" action="${action}" class="form">
    <input type="hidden" name="_csrf" value="${h(csrfToken)}">
    ${fieldPartial({ label: "First Name", name: "first_name", value: values.first_name, error: errors.first_name, required: true })}
    ${fieldPartial({ label: "Last Name", name: "last_name", value: values.last_name, error: errors.last_name, required: true })}
    ${fieldPartial({ label: "Email", name: "email", type: "email", value: values.email, error: errors.email })}
    ${fieldPartial({ label: "Phone", name: "phone", type: "tel", value: values.phone, error: errors.phone })}
    ${fieldPartial({ label: "Address Line 1", name: "address_line1", value: values.address_line1, error: errors.address_line1 })}
    ${fieldPartial({ label: "Address Line 2", name: "address_line2", value: values.address_line2, error: errors.address_line2 })}
    ${fieldPartial({ label: "City", name: "city", value: values.city, error: errors.city })}
    ${fieldPartial({ label: "State", name: "state", value: values.state, error: errors.state })}
    ${fieldPartial({ label: "Postal Code", name: "postal_code", value: values.postal_code, error: errors.postal_code })}
    ${fieldPartial({ label: "Preferred Contact Method", name: "preferred_contact_method", value: values.preferred_contact_method, error: errors.preferred_contact_method, options: methodOptions })}
    ${fieldPartial({ label: "Lifecycle Stage", name: "lifecycle_stage", value: values.lifecycle_stage, error: errors.lifecycle_stage, options: stageOptions })}
    <div class="form-actions">
      <button type="submit" class="btn btn-primary">${isEdit ? "Save Changes" : "Create Contact"}</button>
      <a href="${isEdit ? `/contacts/${h(editId)}` : "/contacts"}" class="btn btn-outline">Cancel</a>
    </div>
  </form>`;
}
