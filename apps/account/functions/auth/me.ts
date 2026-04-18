import type { PagesFunction } from "@cloudflare/workers-types";
import { requireAuth, toPublicSession } from "@gokkehub/auth/session";
import type { Env } from "../_env";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const { session, response } = await requireAuth(
    env.SESSIONS,
    request as unknown as Request
  );

  if (response) return response;

  return Response.json(toPublicSession(session!));
};
