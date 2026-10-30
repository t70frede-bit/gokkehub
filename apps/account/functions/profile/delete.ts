import type { PagesFunction } from "@cloudflare/workers-types";
import { requireAuth, deleteSession, getSessionId } from "@gokkehub/auth/session";
import { clearSessionCookie } from "@gokkehub/auth/cookie";
import { db } from "../_accounts";
import type { Env } from "../_env";

// DELETE /profile/delete — permanently delete the GokkeHub account:
// the gh_users row (identities cascade), the Party Bingo library, the
// account's KV keys and uploaded avatar, then this session.
// Hosted Jeopardy games and past musix rooms are left as they are.
export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const req = request as unknown as Request;
  const { session, response } = await requireAuth(env.SESSIONS, req);
  if (response) return response;

  const userId = session!.userId;
  const sb = db(env);

  for (const table of ["challenge_upvotes", "player_challenges", "player_games", "gh_users"]) {
    const { error } = await sb.from(table).delete().eq(table === "gh_users" ? "id" : "user_id", userId);
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }

  await Promise.all([
    ...["buzzer_sound", "buzzer_library", "lastfm_link", "spotify_link"]
      .map((k) => env.SESSIONS.delete(`${k}:${userId}`)),
    ...["jpg", "png", "webp", "gif"].map((ext) => env.AVATARS.delete(`avatars/${userId}.${ext}`)),
  ]);

  const sessionId = getSessionId(req);
  if (sessionId) await deleteSession(env.SESSIONS, sessionId);

  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": clearSessionCookie(env.COOKIE_DOMAIN) },
  });
};
