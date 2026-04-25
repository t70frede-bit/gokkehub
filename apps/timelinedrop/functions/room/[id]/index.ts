import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getRoom, getTeams, getPlayers } from "../../_supabase";

export const onRequest: PagesFunction<Env> = async ({ request, params, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;

  const roomId = params.id as string;
  const room = await getRoom(env, roomId);
  if (!room) return json({ error: "Room not found" }, 404, request as unknown as Request);

  const [teams, players] = await Promise.all([
    getTeams(env, roomId),
    getPlayers(env, roomId),
  ]);

  return json({ room, teams, players }, 200, request as unknown as Request);
};
