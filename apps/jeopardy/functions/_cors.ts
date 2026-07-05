const ALLOWED_ORIGIN_RE = /^https?:\/\/(localhost(:\d+)?|[\w-]+\.gokkehub\.com)$/;

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  if (!origin || !ALLOWED_ORIGIN_RE.test(origin)) return {};
  return {
    "Access-Control-Allow-Origin":      origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods":     "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":     "Content-Type",
    "Vary":                             "Origin",
  };
}

export function handlePreflight(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function json(data: unknown, status = 200, request?: Request): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(request ? corsHeaders(request) : {}),
    },
  });
}
