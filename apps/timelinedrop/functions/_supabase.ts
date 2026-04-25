import type { Env } from "./_env";
import type { TlRoom, TlTeam, TlPlayer, TlRound, TlTimelineEntry, SpotifyTrack } from "../src/lib/types";

// Minimal Supabase REST client for use in Cloudflare Functions (no Node deps).

function makeHeaders(env: Env, upsert = false) {
  return {
    "Content-Type":  "application/json",
    "apikey":        env.SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Prefer":        upsert
      ? "resolution=merge-duplicates,return=representation"
      : "return=representation",
  };
}

function url(env: Env, table: string, params = "") {
  return `${env.SUPABASE_URL}/rest/v1/${table}${params ? `?${params}` : ""}`;
}

async function req<T>(env: Env, method: string, table: string, params = "", body?: unknown, upsert = false): Promise<T[]> {
  const res = await fetch(url(env, table, params), {
    method,
    headers: makeHeaders(env, upsert),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${method} ${table}: ${res.status} ${text}`);
  }
  if (res.status === 204) return [] as T[];
  return res.json() as Promise<T[]>;
}

// ── Room ──────────────────────────────────────────────────────────────────────

export async function getRoom(env: Env, roomId: string): Promise<TlRoom | null> {
  const rows = await req<TlRoom>(env, "GET", "tl_rooms", `id=eq.${roomId}&select=*`);
  return rows[0] ?? null;
}

export async function createRoom(env: Env, data: Partial<TlRoom>): Promise<TlRoom> {
  const rows = await req<TlRoom>(env, "POST", "tl_rooms", "", data);
  return rows[0];
}

export async function updateRoom(env: Env, roomId: string, data: Partial<TlRoom>): Promise<void> {
  await req(env, "PATCH", "tl_rooms", `id=eq.${roomId}`, data);
}

// ── Team ──────────────────────────────────────────────────────────────────────

export async function getTeams(env: Env, roomId: string): Promise<TlTeam[]> {
  return req<TlTeam>(env, "GET", "tl_teams", `room_id=eq.${roomId}&order=sort_order.asc&select=*`);
}

export async function createTeam(env: Env, data: Partial<TlTeam>): Promise<TlTeam> {
  const rows = await req<TlTeam>(env, "POST", "tl_teams", "", data);
  return rows[0];
}

export async function updateTeam(env: Env, teamId: number, data: Partial<TlTeam>): Promise<void> {
  await req(env, "PATCH", "tl_teams", `id=eq.${teamId}`, data);
}

// ── Player ────────────────────────────────────────────────────────────────────

export async function getPlayers(env: Env, roomId: string): Promise<TlPlayer[]> {
  return req<TlPlayer>(env, "GET", "tl_players", `room_id=eq.${roomId}&select=*`);
}

export async function createPlayer(env: Env, data: Partial<TlPlayer>): Promise<TlPlayer> {
  const rows = await req<TlPlayer>(env, "POST", "tl_players", "", data);
  return rows[0];
}

export async function updatePlayer(env: Env, playerId: string, data: Partial<TlPlayer>): Promise<void> {
  await req(env, "PATCH", "tl_players", `id=eq.${playerId}`, data);
}

// ── Round ─────────────────────────────────────────────────────────────────────

export async function createRound(env: Env, data: Partial<TlRound>): Promise<TlRound> {
  const rows = await req<TlRound>(env, "POST", "tl_rounds", "", data);
  return rows[0];
}

export async function getRound(env: Env, roundId: number): Promise<TlRound | null> {
  const rows = await req<TlRound>(env, "GET", "tl_rounds", `id=eq.${roundId}&select=*`);
  return rows[0] ?? null;
}

export async function updateRound(env: Env, roundId: number, data: Partial<TlRound>): Promise<void> {
  await req(env, "PATCH", "tl_rounds", `id=eq.${roundId}`, data);
}

// ── Timeline ──────────────────────────────────────────────────────────────────

export async function getTimeline(env: Env, teamId: number): Promise<TlTimelineEntry[]> {
  return req<TlTimelineEntry>(env, "GET", "tl_timeline", `team_id=eq.${teamId}&order=position.asc&select=*`);
}

export async function insertTimelineEntry(env: Env, data: TlTimelineEntry): Promise<void> {
  // Recalculate positions: insert sorted by year, shift others up
  const existing = await getTimeline(env, data.team_id);
  const all = [...existing, data].sort((a, b) => a.year - b.year);
  // Upsert all with corrected positions
  for (let i = 0; i < all.length; i++) {
    await req(env, "POST", "tl_timeline", "on_conflict=team_id,track_id", { ...all[i], position: i }, true);
  }
}

// ── Spotify token refresh ─────────────────────────────────────────────────────

export async function refreshSpotifyToken(
  env: Env,
  refreshToken: string
): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type":  "application/x-www-form-urlencoded",
      "Authorization": `Basic ${btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`)}`,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error(`Spotify token refresh failed: ${res.status}`);
  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}

async function getClientCredentialsToken(env: Env): Promise<string> {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type":  "application/x-www-form-urlencoded",
      "Authorization": `Basic ${btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`)}`,
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Spotify client credentials failed: ${res.status} ${body}`);
  }
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

// ── Spotify playlist fetch ────────────────────────────────────────────────────

interface SpotifyPlaylistItem {
  track: {
    id: string;
    name: string;
    uri: string;
    artists: Array<{ name: string }>;
    album: {
      name: string;
      release_date: string;
      images: Array<{ url: string; width: number }>;
    };
  } | null;
}

export async function fetchPlaylistTracks(
  env: Env,
  playlistId: string
): Promise<SpotifyTrack[]> {
  const accessToken = await getClientCredentialsToken(env);
  const tracks: SpotifyTrack[] = [];
  let url: string | null =
    `https://api.spotify.com/v1/playlists/${playlistId}/tracks` +
    `?limit=100&fields=next,items(track(id,name,uri,artists(name),album(name,release_date,images)))`;

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Spotify playlist fetch: ${res.status} — ${body}`);
    }
    const page = await res.json() as { next: string | null; items: SpotifyPlaylistItem[] };

    for (const item of page.items) {
      const t = item.track;
      if (!t || !t.id || !t.uri) continue;
      const releaseYear = parseInt(t.album.release_date.slice(0, 4), 10);
      if (isNaN(releaseYear)) continue;
      const cover = t.album.images.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? "";
      tracks.push({
        id:          t.id,
        name:        t.name,
        artist:      t.artists[0]?.name ?? "Unknown",
        albumName:   t.album.name,
        releaseYear,
        coverUrl:    cover,
        uri:         t.uri,
      });
    }
    url = page.next;
  }

  return tracks;
}
