import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession } from "@gokkehub/auth/session";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getGame, updateGame } from "../../_supabase";
import type { JpCollaborator, CollabPermissions } from "../../../src/lib/types";

// POST { token } → validate KV invite, add caller to collaborators, burn token.
export const onRequestPost: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;

  const req    = request as unknown as Request;
  const gameId = params.id as string;

  const session = await getSession(env.SESSIONS, req);
  if (!session) return json({ error: "Login required" }, 401, req);

  let body: { token?: string } = {};
  try { body = await req.json() as typeof body; } catch { /* ok */ }
  if (!body.token) return json({ error: "token required" }, 400, req);

  const raw = await (env.SESSIONS as KVNamespace).get(`jp_invite:${body.token}`);
  if (!raw) return json({ error: "Invite link is invalid or expired" }, 404, req);

  let invite: { gameId: string; permissions: CollabPermissions };
  try { invite = JSON.parse(raw) as typeof invite; } catch {
    return json({ error: "Corrupt invite" }, 400, req);
  }
  if (invite.gameId !== gameId) return json({ error: "Invite is for a different game" }, 400, req);

  const game = await getGame(env, gameId);
  if (!game) return json({ error: "Game not found" }, 404, req);
  if (game.host_id === session.userId) {
    return json({ error: "You are already the owner of this game" }, 409, req);
  }

  const collaborators: JpCollaborator[] = game.collaborators ?? [];
  let updated: JpCollaborator[];
  if (collaborators.some(c => c.userId === session.userId)) {
    updated = collaborators.map(c =>
      c.userId === session.userId ? { ...c, permissions: invite.permissions } : c,
    );
  } else {
    const entry: JpCollaborator = {
      userId:      session.userId,
      displayName: session.displayName,
      avatar:      session.avatarUrl ?? null,
      addedAt:     new Date().toISOString(),
      permissions: invite.permissions,
    };
    updated = [...collaborators, entry];
  }
  // Update DB first — only burn the token after a successful write so a
  // crash doesn't leave the user with a deleted token and no collaborator added.
  await updateGame(env, gameId, { collaborators: updated } as never);
  await (env.SESSIONS as KVNamespace).delete(`jp_invite:${body.token}`);
  return json({ collaborators: updated, gameId }, 200, req);
};
