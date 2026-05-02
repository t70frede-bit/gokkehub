# musix song curation engine

How tracks get picked for a game. The host controls difficulty + playlist
mode in the lobby. Players link their Last.fm username on
`account.gokkehub.com/profile` (or list 3-5 favourite artists as a fallback in
the lobby card). Spotify is only used for two things:

- **Web Playback SDK** for full-track audio (host-side)
- **Search by name+artist** to convert Last.fm names into Spotify URIs

## File layout

| File | Purpose |
|---|---|
| `functions/_lastfm.ts` | Last.fm REST client with KV-cached fetchers (1h TTL) |
| `functions/_spotify.ts` | `searchTrackUri(artist, track)` + host token refresh |
| `functions/_curate.ts` | Profile builder · scoring · difficulty bands · playlist arc |
| `functions/room/[id]/curate.ts` | `?action=generate-batch` and `?action=refill-buffer` |
| `supabase-migration-006.sql` | Schema additions for player music profile + blacklist |

## Per-player profile (`buildProfile`)

For each non-spectator player we collect, in parallel:

- `user.gettopartists` — overall top 50
- `user.gettopartists` — 3-month top 25 (recency signal)
- `user.gettoptracks` — overall top 50
- `user.gettoptracks` — 7-day top 25
- `user.getrecenttracks` — last 50 plays

Players without a Last.fm linked but with `manual_artists` get a synthetic
profile: each manual artist is treated as if they have ~100 all-time scrobbles
for it. Players with neither are scored 0 across the board.

## Familiarity score (per player, per track)

| Component | Threshold | Points |
|---|---|---|
| Artist all-time scrobbles | 2000+ / 500-1999 / 100-499 / 10-99 / 0-9 | 35 / 25 / 15 / 5 / 0 |
| Artist last 90 days | 50+ / 10-49 / 1-9 / 0 | 25 / 15 / 5 / 0 |
| Track playcount | 10+ / 3-9 / 1-2 / 0 | 30 / 20 / 10 / 0 |
| Bonus: scrobbled in last 7 days | yes/no | 10 / 0 |
| Bonus: in their all-time top 50 | yes/no | 10 / 0 |

Capped at 100 per player.

## Group score

`group_score = mean(per_player_scores) - fairness_penalty`

The fairness penalty fires when one player accounts for more than 40% of the
total raw score. This prevents one heavy-listener from dominating the
playlist. The penalty is the dominant player's share above 40% multiplied by
the mean.

Resulting confidence labels:

- `known` — 65 to 100
- `likely` — 35 to 64
- `stretch` — 15 to 34
- `wild` — 0 to 14

## Difficulty bands

| Band | Group score | Pool source |
|---|---|---|
| Easy | 65+ | All players' all-time top tracks |
| Medium | 35-64 | 40% Easy pool · 60% similar artists from top-5 shared favourites |
| Hard | 15-34 | 20% Easy pool · 80% similar artists from top-10 shared. Excludes any track ≥10 plays for any player |
| Hardest | 0-14 | Top tags from the group's top artists → `tag.gettopartists` for unknown artists in those genres |

## Playlist mode

Set in lobby. Three options:

- **Use as-is** — the host's playlist URL plays in order (or shuffled). No
  curation filtering. (This bypasses the engine entirely.)
- **Inspiration** — use the playlist's artist/genre fingerprint to pull songs
  the group knows. The output may differ wildly from the input.
- **Smart filter** — the playlist is the candidate pool; the difficulty +
  group taste filter what survives.

## Playlist arc (`arrangePlaylistArc`)

Regardless of difficulty, the final ordering is:

1. The 2 highest-scoring tracks (warm-up)
2. Difficulty-appropriate middle, lightly shuffled
3. 2 mid-score tracks (finish strong but not the top)

## Rolling buffer

- Initial generation = 30 tracks
- When fewer than 5 remain in the pool the host can hit the **Generate more**
  button in the lobby; mid-game refill is fired manually for now (background
  refill via `ctx.waitUntil` is a future polish).
- New batches exclude tracks already in `track_pool` for this room.

## 14-day blacklist

When the host has **Skip recently heard songs** enabled, any track-id played
by any of the current room's players within the last 14 days is excluded
from the candidate pool. Stored in `tl_played_tracks (room_id, player_id, track_id, played_at)`.

Pool exhaustion fallback chain:

1. Try with 14-day blacklist
2. Relax to 7-day
3. Relax to 3-day
4. Drop the blacklist entirely (with a warning in the lobby toast)

## Spotify URI lookup

`searchTrackUri(accessToken, artist, track)` →
`GET /v1/search?q=track:{name}+artist:{artist}&type=track&limit=1`. First
result wins. Throttled by ~75ms per call. If no Spotify match exists for a
Last.fm candidate, we silently skip it and move on.

## Environment variables

- `LASTFM_API_KEY` — free read API key. Required for any curation to work.
- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` — already present. Needed for
  the host's playback + URI search.

Both go in `wrangler.toml` (or as Cloudflare Pages secrets) for the timelinedrop
app, and the account app needs `LASTFM_API_KEY` for the link-validation
endpoint at `/auth/lastfm`.
