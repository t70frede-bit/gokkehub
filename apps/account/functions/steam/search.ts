import type { PagesFunction } from "@cloudflare/workers-types";

interface StoreSearchItem {
  id:   number;
  name: string;
}

// GET /steam/search?q=<query>
// Proxies the public Steam store search API — no API key required.
// Results are cached at the edge for 5 minutes per query string.
export const onRequestGet: PagesFunction = async ({ request }) => {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";

  if (!q || q.length < 2) {
    return Response.json({ items: [] });
  }

  // Normalise query for cache key — lowercase, collapse whitespace
  const cacheKey = new Request(
    `https://steam-search-cache/search?q=${encodeURIComponent(q.toLowerCase())}`,
  );

  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const steamUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&l=english&cc=us`;

  let res: Response;
  try {
    res = await fetch(steamUrl, { headers: { Accept: "application/json" } });
  } catch {
    return Response.json({ error: "Could not reach Steam." }, { status: 502 });
  }

  if (!res.ok) {
    return Response.json({ error: "Steam search failed." }, { status: 502 });
  }

  const data = (await res.json()) as { items?: StoreSearchItem[] };

  const items = (data.items ?? []).slice(0, 12).map((item) => ({
    appid: item.id,
    name:  item.name,
  }));

  const response = Response.json({ items }, {
    headers: { "Cache-Control": "public, max-age=300" },
  });

  // Store in edge cache — fire-and-forget
  cache.put(cacheKey, response.clone());

  return response;
};
