import type { PagesFunction } from "@cloudflare/workers-types";
import { requireAuth, toPublicSession } from "@gokkehub/auth/session";
import { corsHeaders, handlePreflight } from "../_cors";
import type { Env } from "../_env";

// Handle CORS preflight
export const onRequestOptions: PagesFunction<Env> = async ({ request }) => {
  return handlePreflight(request as unknown as Request) ?? new Response(null, { status: 204 });
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const req = request as unknown as Request;
  const { session, response } = await requireAuth(env.SESSIONS, req);

  // Session state must NEVER be cached: a cached same-origin copy replayed
  // for a cross-origin fetch has no CORS headers and breaks the game apps'
  // login check (and a cached 200 would outlive a logout).
  const noStore = { "Cache-Control": "no-store" };

  if (response) {
    // Not authenticated — still add CORS headers so the client can read the 401
    const headers = new Headers(response.headers);
    Object.entries({ ...corsHeaders(req), ...noStore }).forEach(([k, v]) => headers.set(k, v));
    return new Response(response.body, { status: response.status, headers });
  }

  return Response.json(toPublicSession(session!), {
    headers: { ...corsHeaders(req), ...noStore },
  });
};
