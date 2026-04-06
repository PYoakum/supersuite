import { join } from "path";
import { config } from "./lib/config.js";
import { Router } from "./lib/router.js";
import { serveStatic } from "./lib/static.js";
import { sessionMiddleware, csrfProtection } from "./middleware/auth.js";
import { bodyParser } from "./middleware/bodyParser.js";

// Routes
import { loginPage, loginSubmit, logoutSubmit } from "./routes/auth.js";
import { dashboardPage, healthPage } from "./routes/dashboard.js";
import { donationsListPage, donationsNewPage, donationsCreateSubmit, donationsDetailPage } from "./routes/donations.js";
import { contactsListPage, contactsNewPage, contactsCreateSubmit, contactsDetailPage, contactsEditPage, contactsUpdateSubmit } from "./routes/contacts.js";
import { membershipsRenewalsPage, membershipsNewPage, membershipsCreateSubmit, membershipsDetailPage, membershipsEditPage, membershipsUpdateSubmit } from "./routes/memberships.js";

const PUBLIC_DIR = join(import.meta.dir, "..", "public");

const router = new Router();

// Global middleware
router.use(bodyParser);
router.use(sessionMiddleware);

// Health check
router.get("/health", healthPage);

// Auth routes
router.get("/login", loginPage);
router.post("/login", loginSubmit);
router.post("/logout", logoutSubmit);

// Dashboard
router.get("/", dashboardPage);

// Contacts
router.get("/contacts", contactsListPage);
router.get("/contacts/new", contactsNewPage);
router.post("/contacts", csrfProtection, contactsCreateSubmit);
router.get("/contacts/:id/edit", contactsEditPage);
router.post("/contacts/:id", csrfProtection, contactsUpdateSubmit);
router.get("/contacts/:id", contactsDetailPage);

// Donations
router.get("/donations", donationsListPage);
router.get("/donations/new", donationsNewPage);
router.post("/donations", csrfProtection, donationsCreateSubmit);
router.get("/donations/:id", donationsDetailPage);

// Memberships
router.get("/memberships/renewals", membershipsRenewalsPage);
router.get("/memberships/new", membershipsNewPage);
router.post("/memberships", csrfProtection, membershipsCreateSubmit);
router.get("/memberships/:id/edit", membershipsEditPage);
router.post("/memberships/:id", csrfProtection, membershipsUpdateSubmit);
router.get("/memberships/:id", membershipsDetailPage);

// Start server
const server = Bun.serve({
  port: config.port,
  async fetch(req) {
    const url = new URL(req.url);

    // Serve static files from /public
    if (url.pathname.startsWith("/css/") || url.pathname.startsWith("/js/") || url.pathname.startsWith("/favicon")) {
      const staticResp = await serveStatic(url.pathname, PUBLIC_DIR);
      if (staticResp) return staticResp;
    }

    // Route the request
    try {
      const response = await router.handle(req);
      if (response) return response;

      // 404
      return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/html" } });
    } catch (err) {
      console.error(`[${new Date().toISOString()}] ERROR:`, err);
      const body = config.isDev
        ? `<pre>Internal Server Error\n\n${err.stack}</pre>`
        : "Internal Server Error";
      return new Response(body, { status: 500, headers: { "Content-Type": "text/html" } });
    }
  },
});

console.log(`Nonprofit CRM running at http://localhost:${server.port}`);
