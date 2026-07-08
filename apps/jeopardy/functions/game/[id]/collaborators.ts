import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession } from "@gokkehub/auth/session";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getGame, updateGame } from "../../_supabase";
import type { JpCollaborator, CollabPermissions } from "../../../src/lib/types";

// Re-export for accept-invite.ts
export type { JpCollaborator as Collaborator, CollabPermissions };

// Collaborator management for the game owner.
//   GET                                  → { collaborators }
//   POST  { permissions }                → { inviteUrl }  (creates 24h KV invite token)
//   PATCH { userId, permissions }        → { collaborators }  (update existing)
//   DELETE body { userId }               → { collaborators }  (remove)

const INVITE_TTL = 60 * 60 * 24; // 24 hours

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;

  const req    = request as unknown as Request;
  const gameId = params.id as string;

  const session = await getSession(env.SESSIONS, req);
  if (!session) return json({ error: "Login required" }, 401, req);

  const game = await getGame(env, gameId);
  if (!game) return json({ error: "Game not found" }, 404, req);

  const isOwner = game.host_id === session.userId;
  const collaborators: JpCollaborator[] = game.collaborators ?? [];
  const meCollab = collaborators.find(c => c.userId === session.userId);

  if (!isOwner && !meCollab) return json({ error: "Access denied" }, 403, req);

  if (request.method === "GET") {
    return json({ collaborators }, 200, req);
  }

  // All write operations are owner-only.
  if (!isOwner) return json({ error: "Only the game owner can manage collaborators" }, 403, req);

  if (request.method === "POST") {
    let body: { permissions?: CollabPermissions } = {};
    try { body = await req.json() as typeof body; } catch { /* ok */ }
    const perms: CollabPermissions = {
      editQuestions: body.permissions?.editQuestions ?? true,
      editSettings:  body.permissions?.editSettings  ?? false,
    };
    const token = crypto.randomUUID();
    await (env.SESSIONS as KVNamespace).put(
      `jp_invite:${token}`,
      JSON.stringify({ gameId, permissions: perms }),
      { expirationTtl: INVITE_TTL },
    );
    const inviteUrl = `https://jeopardy.gokkehub.com/setup/${gameId}?invite=${token}`;
    return json({ inviteUrl }, 200, req);
  }

  if (request.method === "PATCH") {
    let body: { userId?: string; permissions?: CollabPermissions } = {};
    try { body = await req.json() as typeof body; } catch { /* ok */ }
    if (!body.userId || !body.permissions) return json({ error: "userId and permissions required" }, 400, req);
    const updated = collaborators.map(c =>
      c.userId === body.userId ? { ...c, permissions: body.permissions! } : c,
    );
    await updateGame(env, gameId, { collaborators: updated } as never);
    return json({ collaborators: updated }, 200, req);
  }

  if (request.method === "DELETE") {
    let body: { userId?: string } = {};
    try { body = await req.json() as typeof body; } catch { /* ok */ }
    if (!body.userId) return json({ error: "userId required" }, 400, req);
    const updated = collaborators.filter(c => c.userId !== body.userId);
    await updateGame(env, gameId, { collaborators: updated } as never);
    return json({ collaborators: updated }, 200, req);
  }

  return json({ error: "Method not allowed" }, 405, req);
};
