/**
 * Server middleware - CORS and response helpers
 */

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function handleOptions() {
  return new Response(null, { headers: corsHeaders });
}

export function jsonResponse(data, status = 200) {
  return Response.json(data, { status, headers: corsHeaders });
}

export function htmlResponse(html) {
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders },
  });
}

export function errorResponse(err, status = 500) {
  console.error("Server error:", err);
  return Response.json(
    { success: false, error: err?.message || String(err) },
    { status, headers: corsHeaders },
  );
}
