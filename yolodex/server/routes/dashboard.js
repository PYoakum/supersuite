import sql from "../lib/db.js";
import { layout, htmlResponse, h } from "../lib/templates.js";
import { requireAuth } from "../middleware/auth.js";

export async function dashboardPage(ctx) {
  const authResult = requireAuth(ctx);
  if (authResult) return authResult;

  // Gather summary stats
  const [contactCount] = await sql`SELECT count(*)::int AS count FROM contacts`;
  const [activeMembers] = await sql`SELECT count(*)::int AS count FROM memberships WHERE status = 'active'`;
  const [donationStats] = await sql`
    SELECT
      coalesce(sum(amount), 0) AS total,
      count(*)::int AS count
    FROM donations
    WHERE received_at >= date_trunc('year', current_date)
  `;
  const [upcomingRenewals] = await sql`
    SELECT count(*)::int AS count
    FROM memberships
    WHERE status = 'active' AND renewal_date <= current_date + interval '30 days'
  `;

  const recentDonations = await sql`
    SELECT d.id, d.amount, d.received_at, d.method,
           c.first_name, c.last_name
    FROM donations d
    LEFT JOIN contacts c ON d.contact_id = c.id
    ORDER BY d.received_at DESC
    LIMIT 5
  `;

  const content = `
  <h1>Dashboard</h1>
  <div class="stat-grid">
    <div class="stat-card">
      <div class="stat-value">${h(contactCount.count)}</div>
      <div class="stat-label">Total Contacts</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${h(activeMembers.count)}</div>
      <div class="stat-label">Active Members</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">$${Number(donationStats.total).toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
      <div class="stat-label">Donations This Year</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${h(upcomingRenewals.count)}</div>
      <div class="stat-label">Renewals (30 days)</div>
    </div>
  </div>

  <h2>Recent Donations</h2>
  ${recentDonations.length === 0
    ? '<p class="empty-state">No donations yet.</p>'
    : `<table class="data-table">
      <thead><tr><th>Date</th><th>Donor</th><th>Amount</th><th>Method</th></tr></thead>
      <tbody>
        ${recentDonations
          .map(
            (d) => `<tr>
              <td>${new Date(d.received_at).toLocaleDateString()}</td>
              <td><a href="/contacts/${d.contact_id}">${h(d.first_name)} ${h(d.last_name)}</a></td>
              <td>$${Number(d.amount).toFixed(2)}</td>
              <td>${h(d.method)}</td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table>`
  }
  `;

  return htmlResponse(
    layout({ title: "Dashboard — Nonprofit CRM", content, user: ctx.state.user, activePath: "/" })
  );
}

/** Health check endpoint (no auth required) */
export async function healthPage(ctx) {
  try {
    await sql`SELECT 1`;
    return new Response(JSON.stringify({ status: "ok", db: "connected" }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ status: "error", db: "disconnected" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}
