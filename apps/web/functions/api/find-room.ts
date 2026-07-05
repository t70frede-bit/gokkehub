import type { PagesFunction } from "@cloudflare/workers-types";

interface Env {
  SUPABASE_URL:      string;
  SUPABASE_ANON_KEY: string;
}

// Each entry is a (table, redirect URL) pair. The function probes each table
// in the shared Supabase project for the supplied room code; first hit wins.
const GAMES = [
  { table: "tl_rooms", url: "https://musix.gokkehub.com",      label: "musix"        },
  { table: "lobbies",  url: "https://partybingo.gokkehub.com", label: "gridchallenge"},
  { table: "jp_rooms", url: "https://jeopardy.gokkehub.com",   label: "jeopardy"     },
] as const;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const code = (url.searchParams.get("code") ?? "").toUpperCase().trim();
  if (!code || !/^[A-Z0-9]{4,12}$/.test(code)) {
    return Response.json({ error: "Invalid code" }, { status: 400 });
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return Response.json({ error: "Lookup not configured" }, { status: 500 });
  }

  // Race the queries; first table that returns a row wins.
  const lookups = GAMES.map(async (g) => {
    const probe = `${env.SUPABASE_URL}/rest/v1/${g.table}?id=eq.${encodeURIComponent(code)}&select=id&limit=1`;
    const res = await fetch(probe, {
      headers: {
        "apikey":        env.SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${env.SUPABASE_ANON_KEY}`,
      },
    });
    if (!res.ok) return null;
    const rows = await res.json() as Array<{ id?: string }>;
    if (!rows.length) return null;
    return { url: `${g.url}/join?room=${encodeURIComponent(code)}`, game: g.label };
  });

  const results = await Promise.allSettled(lookups);
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      return Response.json(r.value, { status: 200 });
    }
  }
  return Response.json({ error: "Room not found" }, { status: 404 });
};
