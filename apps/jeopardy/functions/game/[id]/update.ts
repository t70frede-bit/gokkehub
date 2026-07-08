import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession } from "@gokkehub/auth/session";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getGame, updateGame } from "../../_supabase";
import type { JpGame, UpdateGameRequest } from "../../../src/lib/types";

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req    = request as unknown as Request;
  const gameId = params.id as string;

  try {
    const session = await getSession(env.SESSIONS, req);
    if (!session) return json({ error: "Login required" }, 401, req);

    const game = await getGame(env, gameId);
    if (!game) return json({ error: "Game not found" }, 404, req);

    const isOwner    = game.host_id === session.userId;
    const meCollab   = (game.collaborators ?? []).find(c => c.userId === session.userId);
    if (!isOwner && !meCollab) return json({ error: "Not your game" }, 403, req);

    const body    = await req.json() as UpdateGameRequest;
    const updates: Partial<JpGame> = {};

    const canSettings = isOwner || meCollab?.permissions.editSettings;
    const canQuestions = isOwner || meCollab?.permissions.editQuestions || canSettings;

    if (canSettings && typeof body.title === "string" && body.title.trim()) {
      updates.title = body.title.trim().slice(0, 80);
    }
    if (body.config && typeof body.config === "object") {
      if (canQuestions) updates.config = body.config;
    }
    if (canSettings && (body.status === "draft" || body.status === "ready" || body.status === "archived")) {
      updates.status = body.status;
    }
    if (Object.keys(updates).length === 0) return json({ error: "Nothing to update" }, 400, req);

    await updateGame(env, gameId, updates);
    return json({ ok: true }, 200, req);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500, req);
  }
};
