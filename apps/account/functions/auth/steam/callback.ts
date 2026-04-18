import type { PagesFunction } from "@cloudflare/workers-types";
import { requireAuth, getSessionId, updateSession } from "@gokkehub/auth/session";
import type { Env } from "../../_env";

const STEAM_OPENID_VERIFY = "https://steamcommunity.com/openid/login";
const STEAM_API_USER =
  "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const req = request as unknown as Request;

  // Must be logged in to link Steam
  const { session, response } = await requireAuth(env.SESSIONS, req);
  if (response) {
    return Response.redirect("https://account.gokkehub.com/login", 302);
  }

  // Verify OpenID assertion by re-submitting with mode=check_authentication
  const verifyParams = new URLSearchParams(url.searchParams);
  verifyParams.set("openid.mode", "check_authentication");

  const verifyRes = await fetch(STEAM_OPENID_VERIFY, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: verifyParams.toString(),
  });

  const verifyText = await verifyRes.text();
  if (!verifyText.includes("is_valid:true")) {
    return Response.redirect(
      "https://account.gokkehub.com/profile?error=steam_invalid",
      302
    );
  }

  // Extract Steam ID from claimed_id (https://steamcommunity.com/openid/id/STEAMID64)
  const claimedId = url.searchParams.get("openid.claimed_id") ?? "";
  const steamId = claimedId.split("/").pop();

  if (!steamId || !/^\d{17}$/.test(steamId)) {
    return Response.redirect(
      "https://account.gokkehub.com/profile?error=steam_id",
      302
    );
  }

  // Fetch Steam player summary
  const playerRes = await fetch(
    `${STEAM_API_USER}?key=${env.STEAM_API_KEY}&steamids=${steamId}`
  );
  const playerData = await playerRes.json<{
    response: {
      players: Array<{ personaname: string; avatarfull: string }>;
    };
  }>();

  const player = playerData.response.players[0];
  const steamAvatarUrl = player?.avatarfull ?? null;

  const sessionId = getSessionId(req)!;
  await updateSession(env.SESSIONS, sessionId, {
    steam: {
      steamId,
      displayName: player?.personaname ?? null,
      avatarUrl: steamAvatarUrl,
    },
    avatarUrl: session.avatarUrl ?? steamAvatarUrl,
  });

  return Response.redirect("https://account.gokkehub.com/profile", 302);
};
