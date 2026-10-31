import type { PagesFunction } from "@cloudflare/workers-types";
import { requireAuth } from "@gokkehub/auth/session";
import { finishOAuth, clearOAuthStateCookie } from "@gokkehub/auth/oauth-state";
import { db, ensureSessionUser, linkIdentity, updateUser, refreshSession, IdentityTakenError } from "../../_accounts";
import type { Env } from "../../_env";

const STEAM_CALLBACK = "https://account.gokkehub.com/auth/steam/callback";
const PROFILE = "https://account.gokkehub.com/profile";
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

  // Reject callbacks this browser didn't start, and pick up where to go next.
  const oauth = await finishOAuth(env.SESSIONS, req);
  if (!oauth.ok) {
    return Response.redirect(`${PROFILE}?error=oauth_state`, 302);
  }
  const redirect = (location: string) => {
    const headers = new Headers({ Location: location });
    headers.append("Set-Cookie", clearOAuthStateCookie());
    return new Response(null, { status: 302, headers });
  };
  const fail = (code: string) => redirect(`${PROFILE}?error=${code}`);

  // The signed assertion must be for our own callback, not one minted for
  // some other site and replayed here.
  const returnTo = url.searchParams.get("openid.return_to") ?? "";
  if (!returnTo.startsWith(`${STEAM_CALLBACK}?`) ||
      url.searchParams.get("openid.op_endpoint") !== STEAM_OPENID_VERIFY) {
    return fail("steam_invalid");
  }

  // Verify OpenID assertion by re-submitting with mode=check_authentication
  const verifyParams = new URLSearchParams(url.searchParams);
  verifyParams.set("openid.mode", "check_authentication");
  verifyParams.delete("state");

  const verifyRes = await fetch(STEAM_OPENID_VERIFY, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: verifyParams.toString(),
  });

  const verifyText = await verifyRes.text();
  if (!verifyText.includes("is_valid:true")) {
    return fail("steam_invalid");
  }

  // Extract Steam ID from claimed_id (https://steamcommunity.com/openid/id/STEAMID64)
  const claimedId = url.searchParams.get("openid.claimed_id") ?? "";
  const steamId = claimedId.match(/^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/)?.[1];

  if (!steamId || !/^\d{17}$/.test(steamId)) {
    return fail("steam_id");
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

  const sb = db(env);
  try {
    await ensureSessionUser(sb, session!);
    await linkIdentity(sb, session!.userId, {
      provider:       "steam",
      providerUserId: steamId,
      displayName:    player?.personaname ?? null,
      avatarUrl:      steamAvatarUrl,
    });
  } catch (err) {
    if (err instanceof IdentityTakenError) {
      return fail("steam_taken");
    }
    throw err;
  }
  if (!session!.avatarUrl && steamAvatarUrl) {
    await updateUser(sb, session!.userId, { avatar_url: steamAvatarUrl });
  }
  await refreshSession(env, req, session!.userId);

  // Tell the page we came from that Steam was just linked, so it can import
  // the library straight away.
  if (oauth.returnTo) {
    const back = new URL(oauth.returnTo);
    back.searchParams.set("steam", "linked");
    return redirect(back.toString());
  }
  return redirect(PROFILE);
};
