import type { PagesFunction } from "@cloudflare/workers-types";
import type { Env } from "../_env";

function parseInput(raw: string): { steamid?: string; vanity?: string } | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{17}$/.test(s)) return { steamid: s };
  const profileMatch = s.match(/steamcommunity\.com\/profiles\/(\d{17})/);
  if (profileMatch) return { steamid: profileMatch[1] };
  const vanityMatch = s.match(/steamcommunity\.com\/id\/([^/?#]+)/);
  if (vanityMatch) return { vanity: vanityMatch[1] };
  return { vanity: s };
}

// GET /steam/games?input=<steamid|vanity|url>
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.STEAM_API_KEY) {
    return Response.json({ error: "Steam integration is not configured." }, { status: 503 });
  }

  const url = new URL(request.url);
  const raw = url.searchParams.get("input") ?? "";
  const parsed = parseInput(raw);

  if (!parsed) {
    return Response.json({ error: "Enter your Steam ID, vanity URL, or profile link." }, { status: 400 });
  }

  let steamId = parsed.steamid;

  if (!steamId && parsed.vanity) {
    const res = await fetch(
      `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${env.STEAM_API_KEY}&vanityurl=${encodeURIComponent(parsed.vanity)}`,
    );
    if (!res.ok) return Response.json({ error: "Could not reach Steam API." }, { status: 502 });
    const data = (await res.json()) as { response: { success: number; steamid?: string } };
    if (data.response.success !== 1 || !data.response.steamid) {
      return Response.json({ error: "Steam profile not found. Check your username or URL." }, { status: 404 });
    }
    steamId = data.response.steamid;
  }

  const gamesRes = await fetch(
    `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${env.STEAM_API_KEY}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1&format=json`,
  );
  if (!gamesRes.ok) return Response.json({ error: "Failed to fetch your Steam library." }, { status: 502 });

  const gamesData = (await gamesRes.json()) as {
    response: {
      game_count?: number;
      games?: Array<{ appid: number; name: string }>;
    };
  };

  if (!gamesData.response?.games?.length) {
    return Response.json(
      { error: "No games found. Make sure your Steam profile and game details are set to Public in Steam Privacy Settings." },
      { status: 404 },
    );
  }

  // Return only what the client needs — name and appid for cover art
  const games = gamesData.response.games.map((g) => ({
    appid: g.appid,
    name:  g.name,
  }));

  return Response.json({ steamid: steamId, games });
};
