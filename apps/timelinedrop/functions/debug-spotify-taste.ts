import type { PagesFunction } from "@cloudflare/workers-types";
import { getSession } from "@gokkehub/auth/session";
import type { Env } from "./_env";
import { json, handlePreflight } from "./_cors";
import { getActiveHostToken, getMyTopArtists, getMyTopTracks } from "./_spotify";

// GET /debug-spotify-taste
//
// Diagnostic for the spotify-taste curation source. Returns everything
// we'd feed into buildSpotifyProfile for the caller, so you can see:
//   • which scopes Spotify granted you
//   • how many top artists / tracks come back per time range
//   • the raw artist + track lists (name + artist names + genres)
//   • whether the candidate-pool slice for each difficulty would actually
//     produce anything
//
// Requires a Spotify-linked session cookie. Returns 401 if not.

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const pre = handlePreflight(request as unknown as Request);
  if (pre) return pre;

  const req = request as unknown as Request;

  try {
    const session = await getSession(env.SESSIONS, req);
    if (!session?.spotify?.refreshToken) {
      return json({
        error: "No Spotify session — link Spotify on account.gokkehub.com/profile first",
      }, 401, req);
    }

    const accessToken = await getActiveHostToken(env, session.spotify.refreshToken);
    if (!accessToken) {
      return json({ error: "Could not refresh Spotify token" }, 500, req);
    }

    // Pull all three time windows to show how listening shifts. The
    // production code only uses medium_term right now; this output may
    // suggest combining ranges if one comes back thin.
    const [shortArtists, mediumArtists, longArtists,
           shortTracks,  mediumTracks,  longTracks] = await Promise.all([
      getMyTopArtists(accessToken, "short_term",  50),
      getMyTopArtists(accessToken, "medium_term", 50),
      getMyTopArtists(accessToken, "long_term",   50),
      getMyTopTracks(accessToken,  "short_term",  50),
      getMyTopTracks(accessToken,  "medium_term", 50),
      getMyTopTracks(accessToken,  "long_term",   50),
    ]);

    // Difficulty slice preview — what each candidate pool would contain
    // for the medium_term track list (the actual production slice).
    const mediumTrackList = mediumTracks.map(t => ({
      name:   t.name,
      artist: t.artists[0]?.name ?? "",
    }));
    const slicePreview = {
      easy:    mediumTrackList.slice(0,  15),
      medium:  mediumTrackList.slice(15, 35),
      hard:    mediumTrackList.slice(35, 50),
      hardest: mediumTrackList.slice(35, 50),  // currently uses hardestPoolArtists logic too
    };

    // Distinct-artist counts per time window. If one of these is ≤2
    // you'll see "only one artist recommended" — small slice + tight
    // taste = thin pool.
    const distinctArtists = (tracks: typeof mediumTracks) =>
      new Set(tracks.map(t => t.artists[0]?.name?.toLowerCase()).filter(Boolean)).size;

    return json({
      session: {
        spotify_id:    session.spotify.id,
        display_name:  session.spotify.displayName,
        scopes_granted: session.spotify.scope ?? "(none recorded)",
        scope_check: {
          required:  "user-top-read",
          granted:   (session.spotify.scope ?? "").split(" ").includes("user-top-read"),
        },
      },
      counts: {
        short_term:  { artists: shortArtists.length,  tracks: shortTracks.length  },
        medium_term: { artists: mediumArtists.length, tracks: mediumTracks.length, distinct_track_artists: distinctArtists(mediumTracks) },
        long_term:   { artists: longArtists.length,   tracks: longTracks.length   },
      },
      production_slice_preview_medium_term: slicePreview,
      top_artists_medium: mediumArtists.slice(0, 25).map((a, i) => ({
        rank:   i + 1,
        name:   a.name,
        genres: a.genres,
      })),
      top_tracks_medium: mediumTracks.slice(0, 25).map((t, i) => ({
        rank:    i + 1,
        track:   t.name,
        artist:  t.artists[0]?.name ?? "",
        all_artists: t.artists.map(a => a.name),
      })),
    }, 200, req);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500, req);
  }
};
