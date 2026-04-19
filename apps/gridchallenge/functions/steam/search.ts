import type { PagesFunction } from "@cloudflare/workers-types";

interface StoreSearchItem {
  id:          number;
  name:        string;
  tiny_image?: string;
}

// GET /steam/search?q=<query>
// Proxies the public Steam store search API — no API key required.
export const onRequestGet: PagesFunction = async ({ request }) => {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";

  if (!q || q.length < 2) {
    return Response.json({ items: [] });
  }

  const steamUrl =
    `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&l=english&cc=us`;

  let res: Response;
  try {
    res = await fetch(steamUrl, {
      headers: { "Accept": "application/json" },
    });
  } catch {
    return Response.json({ error: "Could not reach Steam." }, { status: 502 });
  }

  if (!res.ok) {
    return Response.json({ error: "Steam search failed." }, { status: 502 });
  }

  const data = (await res.json()) as { total?: number; items?: StoreSearchItem[] };

  const items = (data.items ?? []).slice(0, 12).map((item) => ({
    appid: item.id,
    name:  item.name,
  }));

  return Response.json({ items });
};
