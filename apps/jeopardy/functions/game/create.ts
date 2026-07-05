import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession } from "@gokkehub/auth/session";
import type { Env } from "../_env";
import { json, handlePreflight } from "../_cors";
import { createGame } from "../_supabase";
import type { CreateGameRequest, CreateGameResponse } from "../../src/lib/types";
import { DEFAULT_JP_CONFIG } from "../../src/lib/types";

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const req = request as unknown as Request;

  try {
    const session = await getSession(env.SESSIONS, req);
    if (!session) return json({ error: "Login required" }, 401, req);

    const body  = await req.json() as CreateGameRequest;
    const title = body.title?.trim();
    if (!title) return json({ error: "Title required" }, 400, req);

    const game = await createGame(env, {
      host_id: session.userId,
      title:   title.slice(0, 80),
      status:  "draft",
      config:  DEFAULT_JP_CONFIG,
    });

    return json({ game_id: game.id } as CreateGameResponse, 201, req);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500, req);
  }
};
