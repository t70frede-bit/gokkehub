import type { PagesFunction } from "@cloudflare/workers-types";
import { requireAuth } from "@gokkehub/auth/session";
import { unlinkProvider } from "../_accounts";
import { beginOAuth } from "@gokkehub/auth/oauth-state";
import { rateLimit } from "../_ratelimit";
import type { Env } from "../_env";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DISCORD_CLIENT_ID) {
    return new Response("DISCORD_CLIENT_ID is not configured on this server.", { status: 500 });
  }

  const limited = await rateLimit(env.SESSIONS, request as unknown as Request, {
    max: 20,
    windowSeconds: 60,
    prefix: "rl:oauth",
  });
  if (limited) return limited;

  // `state` ties the callback to this browser (login CSRF) and carries the
  // page to return to after login.
  const returnTo = new URL(request.url).searchParams.get("redirect");
  const { state, cookie } = await beginOAuth(env.SESSIONS, returnTo);

  const params = new URLSearchParams({
    client_id:     env.DISCORD_CLIENT_ID,
    redirect_uri:  "https://account.gokkehub.com/auth/discord/callback",
    response_type: "code",
    scope:         "identify email",
    state,
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location:     `https://discord.com/oauth2/authorize?${params}`,
      "Set-Cookie": cookie,
    },
  });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const req = request as unknown as Request;
  const { session, response } = await requireAuth(env.SESSIONS, req);
  if (response) return response;
  return unlinkProvider(env, req, session!, "discord");
};
