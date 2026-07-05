import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession } from "@gokkehub/auth/session";
import type { Env } from "../../_env";
import { json, handlePreflight } from "../../_cors";
import { getGame } from "../../_supabase";
import type { UploadResponse } from "../../../src/lib/types";

// Question-media upload → Supabase Storage jp-media bucket (public read).
// Host-checked; the anon key has no storage write access.

const MAX_BY_KIND: Record<string, number> = {
  image: 8  * 1024 * 1024,
  audio: 15 * 1024 * 1024,
  video: 60 * 1024 * 1024,
};
const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png":  "png",
  "image/webp": "webp",
  "image/gif":  "gif",
  "audio/mpeg": "mp3",
  "audio/mp4":  "m4a",
  "audio/ogg":  "ogg",
  "audio/webm": "weba",
  "audio/wav":  "wav",
  "audio/x-wav": "wav",
  "video/mp4":  "mp4",
  "video/webm": "webm",
};

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
    if (game.host_id !== session.userId) return json({ error: "Not your game" }, 403, req);

    const contentType = req.headers.get("Content-Type") ?? "";
    const ext = ALLOWED[contentType];
    if (!ext) return json({ error: "Unsupported file type (images, mp3/m4a/ogg/wav audio, mp4/webm video)" }, 415, req);

    const kind = contentType.split("/")[0];
    const max  = MAX_BY_KIND[kind] ?? MAX_BY_KIND.image;
    const length = Number(req.headers.get("Content-Length") ?? 0);
    if (length > max) {
      return json({ error: `File too large (max ${Math.round(max / 1024 / 1024)}MB)` }, 413, req);
    }

    const path = `${gameId}/${crypto.randomUUID()}.${ext}`;
    const res  = await fetch(`${env.SUPABASE_URL}/storage/v1/object/jp-media/${path}`, {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type":  contentType,
      },
      body: req.body,
    });
    if (!res.ok) {
      const text = await res.text();
      return json({ error: `Upload failed: ${text}` }, 502, req);
    }

    const url = `${env.SUPABASE_URL}/storage/v1/object/public/jp-media/${path}`;
    return json({ url } as UploadResponse, 201, req);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500, req);
  }
};
