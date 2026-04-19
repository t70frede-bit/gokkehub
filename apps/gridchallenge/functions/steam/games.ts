import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../_env";

interface SteamGame {
  appid:          number;
  name:           string;
  playtime_hours: number;
  last_played:    number; // Unix timestamp, 0 if never
}

/** Parse raw input → { steamid } or { vanity } */
function parseInput(raw: string): { steamid?: string; vanity?: string } | null {
  const s = raw.trim();
  if (!s) return null;

  // 17-digit numeric Steam ID
  if (/^\d{17}$/.test(s)) return { steamid: s };

  // steamcommunity.com/profiles/<id>
  const profileMatch = s.match(/steamcommunity\.com\/profiles\/(\d{17})/);
  if (profileMatch) return { steamid: profileMatch[1] };

  // steamcommunity.com/id/<vanity>
  const vanityMatch = s.match(/steamcommunity\.com\/id\/([^/?#]+)/);
  if (vanityMatch) return { vanity: vanityMatch[1] };

  // Anything else: treat as vanity name
  return { vanity: s };
}

// GET /steam/games?input=<steamid|vanity|url>
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.STEAM_API_KEY) {
    return Response.json(
      { error: "Steam integration is not configured on this server." },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const raw = url.searchParams.get("input") ?? "";
  const parsed = parseInput(raw);

  if (!parsed) {
    return Response.json(
      { error: "Enter your Steam ID, vanity URL, or profile link." },
      { status: 400 }
    );
  }

  let steamId = parsed.steamid;

  // Resolve vanity URL → Steam ID
  if (!steamId && parsed.vanity) {
    const res = await fetch(
      `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${env.STEAM_API_KEY}&vanityurl=${encodeURIComponent(parsed.vanity)}`
    );
    if (!res.ok) {
      return Response.json({ error: "Could not reach Steam API." }, { status: 502 });
    }
    const data = (await res.json()) as {
      response: { success: number; steamid?: string };
    };
    if (data.response.success !== 1 || !data.response.steamid) {
      return Response.json(
        { error: "Steam profile not found. Double-check your username or URL." },
        { status: 404 }
      );
    }
    steamId = data.response.steamid;
  }

  // Fetch owned games
  const gamesRes = await fetch(
    `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${env.STEAM_API_KEY}&steamid=${steamId}&include_appinfo=1&format=json`
  );
  if (!gamesRes.ok) {
    return Response.json({ error: "Failed to fetch your Steam library." }, { status: 502 });
  }

  const gamesData = (await gamesRes.json()) as {
    response: {
      game_count?: number;
      games?: Array<{
        appid:             number;
        name:              string;
        playtime_forever:  number;
        rtime_last_played?: number;
      }>;
    };
  };

  if (!gamesData.response?.games?.length) {
    return Response.json(
      {
        error:
          "No games found. Make sure your Steam profile and game details are set to Public in your Steam Privacy Settings.",
      },
      { status: 404 }
    );
  }

  const games: SteamGame[] = gamesData.response.games
    .map((g) => ({
      appid:          g.appid,
      name:           g.name,
      playtime_hours: Math.round((g.playtime_forever ?? 0) / 60),
      last_played:    g.rtime_last_played ?? 0,
    }))
    .sort((a, b) => b.playtime_hours - a.playtime_hours); // most played first

  return Response.json({ steamid: steamId, games });
};
