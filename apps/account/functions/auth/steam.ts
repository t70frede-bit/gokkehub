import type { PagesFunction } from "@cloudflare/workers-types";
import { requireAuth } from "@gokkehub/auth/session";
import { unlinkProvider } from "../_accounts";
import { beginOAuth } from "@gokkehub/auth/oauth-state";
import { loginUrl } from "@gokkehub/auth/redirect";
import { rateLimit } from "../_ratelimit";
import type { Env } from "../_env";

const STEAM_CALLBACK = "https://account.gokkehub.com/auth/steam/callback";

// GET /auth/steam?redirect=<url> — link Steam via Steam OpenID
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  // 20 OAuth initiations per minute per IP
  const limited = await rateLimit(env.SESSIONS, request as unknown as Request, {
    max: 20,
    windowSeconds: 60,
    prefix: "rl:oauth",
  });
  if (limited) return limited;

  const url = new URL(request.url);
  const returnTo = url.searchParams.get("redirect");

  // Steam is linked to an existing account, so sign in first and come back.
  const { session } = await requireAuth(env.SESSIONS, request as unknown as Request);
  if (!session) {
    return Response.redirect(loginUrl(url.toString()), 302);
  }

  // `state` binds the callback to this browser and carries the page to return
  // to (e.g. the Party Bingo lobby). Steam echoes return_to back verbatim, so
  // the state rides along as a query parameter.
  const { state, cookie } = await beginOAuth(env.SESSIONS, returnTo);

  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": `${STEAM_CALLBACK}?state=${state}`,
    "openid.realm": "https://account.gokkehub.com",
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location:     `https://steamcommunity.com/openid/login?${params}`,
      "Set-Cookie": cookie,
    },
  });
};

// DELETE /auth/steam — disconnect Steam from account
export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const req = request as unknown as Request;
  const { session, response } = await requireAuth(env.SESSIONS, req);
  if (response) return response;
  return unlinkProvider(env, req, session!, "steam");
};
