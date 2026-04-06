import sql from "../../server/lib/db.js";

async function seed() {
  console.log("Seeding database...");

  // Create admin account (password: "admin123")
  const adminHash = await Bun.password.hash("admin123", { algorithm: "bcrypt", cost: 10 });
  const [admin] = await sql`
    INSERT INTO accounts (email, password_hash, first_name, last_name, role)
    VALUES ('admin@nonprofit.org', ${adminHash}, 'Admin', 'User', 'admin')
    ON CONFLICT (email) DO UPDATE SET password_hash = ${adminHash}
    RETURNING id
  `;

  // Create staff account (password: "staff123")
  const staffHash = await Bun.password.hash("staff123", { algorithm: "bcrypt", cost: 10 });
  const [staff] = await sql`
    INSERT INTO accounts (email, password_hash, first_name, last_name, role)
    VALUES ('staff@nonprofit.org', ${staffHash}, 'Staff', 'Member', 'staff')
    ON CONFLICT (email) DO UPDATE SET password_hash = ${staffHash}
    RETURNING id
  `;

  // Create 20 sample contacts
  const firstNames = ["Alice", "Bob", "Carol", "David", "Eva", "Frank", "Grace", "Henry", "Iris", "James",
                      "Karen", "Liam", "Maria", "Nathan", "Olivia", "Paul", "Quinn", "Rachel", "Sam", "Tina"];
  const lastNames  = ["Anderson", "Brown", "Clark", "Davis", "Evans", "Foster", "Garcia", "Harris", "Ito", "Jones",
                      "Kim", "Lopez", "Miller", "Nelson", "Ortiz", "Patel", "Quinn", "Rivera", "Smith", "Taylor"];
  const stages = ["prospect", "active", "donor", "lapsed", "active"];

  const contactIds = [];
  for (let i = 0; i < 20; i++) {
    const [c] = await sql`
      INSERT INTO contacts (first_name, last_name, email, phone, city, state, lifecycle_stage)
      VALUES (
        ${firstNames[i]},
        ${lastNames[i]},
        ${firstNames[i].toLowerCase() + "." + lastNames[i].toLowerCase() + "@example.com"},
        ${`555-${String(100 + i).padStart(4, "0")}`},
        ${"Anytown"},
        ${"CA"},
        ${stages[i % stages.length]}
      )
      RETURNING id
    `;
    contactIds.push(c.id);
  }

  // Create 2 organizations
  const [org1] = await sql`
    INSERT INTO organizations (name, city, state, primary_contact_id)
    VALUES ('Acme Foundation', 'San Francisco', 'CA', ${contactIds[0]})
    RETURNING id
  `;
  const [org2] = await sql`
    INSERT INTO organizations (name, city, state, primary_contact_id)
    VALUES ('Community Partners', 'Los Angeles', 'CA', ${contactIds[5]})
    RETURNING id
  `;

  // Link some contacts to orgs
  await sql`INSERT INTO contact_organizations (contact_id, organization_id, role_title) VALUES (${contactIds[0]}, ${org1.id}, 'Executive Director')`;
  await sql`INSERT INTO contact_organizations (contact_id, organization_id, role_title) VALUES (${contactIds[1]}, ${org1.id}, 'Board Member')`;
  await sql`INSERT INTO contact_organizations (contact_id, organization_id, role_title) VALUES (${contactIds[5]}, ${org2.id}, 'President')`;

  // Create memberships for first 10 contacts
  const levels = ["standard", "premium", "standard", "patron", "standard"];
  const dues = [50, 100, 50, 250, 50];
  for (let i = 0; i < 10; i++) {
    const startDate = new Date(2024, 0, 1 + i * 15);
    const renewalDate = new Date(startDate);
    renewalDate.setFullYear(renewalDate.getFullYear() + 1);
    const status = i < 7 ? "active" : "lapsed";

    await sql`
      INSERT INTO memberships (contact_id, status, level, dues_amount, start_date, renewal_date)
      VALUES (
        ${contactIds[i]},
        ${status},
        ${levels[i % levels.length]},
        ${dues[i % dues.length]},
        ${startDate.toISOString().slice(0, 10)},
        ${renewalDate.toISOString().slice(0, 10)}
      )
    `;
  }

  // Create donations
  const methods = ["card", "check", "cash", "ach", "card"];
  const designations = ["General Fund", "Building Fund", "Scholarship", "General Fund", "Events"];
  let receiptCounter = 1;
  for (let i = 0; i < 15; i++) {
    const contactIdx = i % contactIds.length;
    const amount = (Math.floor(Math.random() * 50) + 1) * 10; // $10 - $500
    const daysAgo = Math.floor(Math.random() * 365);
    const receivedAt = new Date();
    receivedAt.setDate(receivedAt.getDate() - daysAgo);

    await sql`
      INSERT INTO donations (contact_id, amount, received_at, method, designation, receipt_number)
      VALUES (
        ${contactIds[contactIdx]},
        ${amount},
        ${receivedAt.toISOString()},
        ${methods[i % methods.length]},
        ${designations[i % designations.length]},
        ${"RCP-" + String(receiptCounter++).padStart(5, "0")}
      )
    `;
  }

  // Create some tags
  const tagNames = ["Major Donor", "Volunteer", "Board", "Event Attendee", "Corporate"];
  const tagIds = [];
  for (const name of tagNames) {
    const [t] = await sql`INSERT INTO tags (name) VALUES (${name}) RETURNING id`;
    tagIds.push(t.id);
  }

  // Tag some contacts
  await sql`INSERT INTO contact_tags (contact_id, tag_id) VALUES (${contactIds[0]}, ${tagIds[0]})`;
  await sql`INSERT INTO contact_tags (contact_id, tag_id) VALUES (${contactIds[0]}, ${tagIds[2]})`;
  await sql`INSERT INTO contact_tags (contact_id, tag_id) VALUES (${contactIds[1]}, ${tagIds[1]})`;
  await sql`INSERT INTO contact_tags (contact_id, tag_id) VALUES (${contactIds[3]}, ${tagIds[0]})`;
  await sql`INSERT INTO contact_tags (contact_id, tag_id) VALUES (${contactIds[5]}, ${tagIds[4]})`;

  // Create some notes and interactions
  for (let i = 0; i < 5; i++) {
    await sql`
      INSERT INTO notes (contact_id, body, created_by)
      VALUES (${contactIds[i]}, ${"Follow-up note for " + firstNames[i] + " regarding membership renewal."}, ${admin.id})
    `;
    await sql`
      INSERT INTO interactions (contact_id, type, summary, outcome, created_by)
      VALUES (
        ${contactIds[i]},
        ${["call", "email", "meeting", "call", "email"][i]},
        ${"Discussed upcoming event and membership status with " + firstNames[i] + "."},
        ${"Positive — will attend next event"},
        ${admin.id}
      )
    `;
  }

  console.log("Seed complete:");
  console.log("  - 2 accounts (admin@nonprofit.org / admin123, staff@nonprofit.org / staff123)");
  console.log("  - 20 contacts, 2 organizations");
  console.log("  - 10 memberships, 15 donations");
  console.log("  - 5 tags, notes, and interactions");

  await sql.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
