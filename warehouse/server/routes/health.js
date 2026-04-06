export function registerHealthRoutes(router, config, sql) {
  router.get("/api/health", async () => {
    return Response.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  router.get("/api/health/ready", async () => {
    try {
      await sql`SELECT 1`;
      return Response.json({ status: "ready" });
    } catch (err) {
      return Response.json({ status: "error", message: err.message }, { status: 503 });
    }
  });
}
