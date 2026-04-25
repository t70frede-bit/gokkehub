import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Input, Panel, Badge } from "@gokkehub/ui";
import { useRoom } from "../hooks/useRoom";
import { supabase } from "../lib/supabase";
import type { TlPlayer } from "../lib/types";

export default function LobbyPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate   = useNavigate();
  const myPlayerId = roomId ? localStorage.getItem(`tl_player_${roomId}`) ?? undefined : undefined;

  const { state, error } = useRoom(roomId, myPlayerId);

  const [playlistUrl,    setPlaylistUrl]    = useState("");
  const [addingPlaylist, setAddingPlaylist] = useState(false);
  const [playlistError,  setPlaylistError]  = useState<string | null>(null);
  const [playlistMsg,    setPlaylistMsg]    = useState<string | null>(null);
  const [starting,       setStarting]       = useState(false);
  const [startError,     setStartError]     = useState<string | null>(null);

  useEffect(() => {
    if (state?.room.status === "playing") navigate(`/game/${roomId}`);
  }, [state?.room.status, roomId, navigate]);

  if (error)  return <Centered>Error: {error}</Centered>;
  if (!state) return <Centered>Loading…</Centered>;

  const { room, teams, players } = state;
  const isHost     = state.myPlayer?.is_host ?? false;
  const roomUrl    = `${window.location.origin}/lobby/${roomId}`;
  const trackCount = room.track_pool?.length ?? 0;

  async function addPlaylist() {
    if (!playlistUrl.trim()) return;
    setAddingPlaylist(true); setPlaylistError(null); setPlaylistMsg(null);
    try {
      // Get host's Spotify token from session
      const tokenRes = await fetch("/spotify/token", { credentials: "include" });
      if (!tokenRes.ok) {
        setPlaylistError("Connect Spotify on your profile at account.gokkehub.com first.");
        return;
      }
      const { access_token } = await tokenRes.json() as { access_token: string };

      // Extract playlist ID from URL or raw ID
      const match = playlistUrl.trim().match(/playlist\/([A-Za-z0-9]+)/);
      const playlistId = match?.[1] ?? (/^[A-Za-z0-9]{22}$/.test(playlistUrl.trim()) ? playlistUrl.trim() : null);
      if (!playlistId) { setPlaylistError("Invalid Spotify playlist URL"); return; }

      // Fetch playlist name
      const metaRes = await fetch(
        `https://api.spotify.com/v1/playlists/${playlistId}?fields=name`,
        { headers: { Authorization: `Bearer ${access_token}` } }
      );
      if (!metaRes.ok) {
        setPlaylistError(`Could not fetch playlist (Spotify ${metaRes.status}). Make sure it's public.`);
        return;
      }
      const { name } = await metaRes.json() as { name: string };

      // Fetch all tracks (paginated)
      const tracks: Array<{
        id: string; name: string; uri: string; artist: string;
        albumName: string; releaseYear: number; coverUrl: string;
      }> = [];
      let nextUrl: string | null =
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks` +
        `?limit=100&fields=next,items(track(id,name,uri,artists(name),album(name,release_date,images)))`;

      while (nextUrl) {
        const res = await fetch(nextUrl, { headers: { Authorization: `Bearer ${access_token}` } });
        if (!res.ok) {
          const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
          const detail = body?.error?.message ?? "";
          if (res.status === 403) {
            setPlaylistError(
              detail
                ? `Spotify 403: ${detail} — disconnect and reconnect Spotify on your profile to get the latest permissions.`
                : "Spotify 403 — your Spotify connection is missing playlist permissions. Disconnect and reconnect on your profile page."
            );
          } else {
            setPlaylistError(`Spotify error ${res.status}${detail ? `: ${detail}` : ""}. Make sure the playlist is public.`);
          }
          return;
        }
        const page = await res.json() as {
          next: string | null;
          items: Array<{ track: {
            id: string; name: string; uri: string;
            artists: Array<{ name: string }>;
            album: { name: string; release_date: string; images: Array<{ url: string; width: number }> };
          } | null }>;
        };
        for (const item of page.items) {
          const t = item.track;
          if (!t?.id || !t?.uri) continue;
          const releaseYear = parseInt(t.album.release_date?.slice(0, 4) ?? "", 10);
          if (isNaN(releaseYear)) continue;
          const cover = [...t.album.images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? "";
          tracks.push({ id: t.id, name: t.name, uri: t.uri, artist: t.artists[0]?.name ?? "Unknown", albumName: t.album.name, releaseYear, coverUrl: cover });
        }
        nextUrl = page.next;
      }

      if (tracks.length === 0) { setPlaylistError("No tracks found in playlist"); return; }

      // Send pre-fetched tracks to server
      const res = await fetch(`/room/${roomId}/playlist`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, tracks }),
      });
      const data = await res.json() as { added: number; total: number; name: string; error?: string };
      if (!res.ok) { setPlaylistError(data.error ?? "Failed to add playlist"); return; }
      setPlaylistMsg(`Added ${data.added} songs from "${data.name}" (${data.total} total)`);
      setPlaylistUrl("");
    } catch {
      setPlaylistError("Network error — check your connection and try again");
    } finally {
      setAddingPlaylist(false);
    }
  }

  async function setCaptain(player: TlPlayer) {
    const wasCapt    = player.is_captain;
    const teammates  = players.filter(p => p.team_id === player.team_id);
    for (const p of teammates) {
      if (p.is_captain) await supabase.from("tl_players").update({ is_captain: false }).eq("id", p.id);
    }
    if (!wasCapt) await supabase.from("tl_players").update({ is_captain: true }).eq("id", player.id);
  }

  async function moveToTeam(playerId: string, teamId: number) {
    await supabase.from("tl_players").update({ team_id: teamId, is_captain: false }).eq("id", playerId);
  }

  async function startGame() {
    setStarting(true); setStartError(null);
    try {
      const res = await fetch(`/room/${roomId}/start`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ player_id: myPlayerId }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { setStartError(data.error ?? "Failed to start"); return; }
    } catch {
      setStartError("Network error");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">

      {/* Room code */}
      <Panel className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-xs opacity-50 mb-1">Room code</p>
            <p className="text-3xl font-black tracking-widest"
              style={{ color: "rgb(var(--color-primary-rgb))", fontFamily: "var(--font-mono)" }}>
              {roomId}
            </p>
          </div>
          <button onClick={() => navigator.clipboard.writeText(roomUrl)}
            className="text-sm px-3 py-1.5 rounded-lg opacity-60 hover:opacity-100"
            style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
            Copy invite link
          </button>
        </div>
      </Panel>

      {/* Teams */}
      <Panel className="p-4">
        <h2 className="font-bold mb-3">Teams</h2>
        <div className="space-y-4">
          {teams.map(team => {
            const teamPlayers = players.filter(p => p.team_id === team.id);
            return (
              <div key={team.id}>
                <p className="text-sm font-semibold mb-2 opacity-70">{team.name}</p>
                <div className="space-y-1">
                  {teamPlayers.length === 0 && (
                    <p className="text-xs opacity-30 italic">No players yet</p>
                  )}
                  {teamPlayers.map(p => (
                    <div key={p.id} className="flex items-center gap-2 py-1">
                      <span className="text-sm flex-1">
                        {p.name}
                        {p.id === myPlayerId && (
                          <span className="ml-1 text-xs opacity-40">(you)</span>
                        )}
                      </span>
                      {p.is_captain && <Badge variant="primary">Captain</Badge>}
                      {isHost && (
                        <div className="flex gap-1">
                          <button onClick={() => setCaptain(p)}
                            className="text-xs px-2 py-0.5 rounded opacity-50 hover:opacity-100"
                            style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
                            {p.is_captain ? "Un-captain" : "Make captain"}
                          </button>
                          {teams.filter(t => t.id !== team.id).map(t => (
                            <button key={t.id} onClick={() => moveToTeam(p.id, t.id)}
                              className="text-xs px-2 py-0.5 rounded opacity-50 hover:opacity-100"
                              style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
                              → {t.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Unassigned */}
        {(() => {
          const unassigned = players.filter(p => p.team_id === null);
          if (!unassigned.length) return null;
          return (
            <div className="mt-4">
              <p className="text-sm font-semibold mb-2 opacity-40">Unassigned</p>
              {unassigned.map(p => (
                <div key={p.id} className="flex items-center gap-2 py-1">
                  <span className="text-sm flex-1">{p.name}</span>
                  {isHost && teams.map(t => (
                    <button key={t.id} onClick={() => moveToTeam(p.id, t.id)}
                      className="text-xs px-2 py-0.5 rounded opacity-50 hover:opacity-100"
                      style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
                      → {t.name}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          );
        })()}
      </Panel>

      {/* Playlists — host only */}
      {isHost && (
        <Panel className="p-4">
          <h2 className="font-bold mb-1">Playlists</h2>
          <p className="text-xs opacity-50 mb-3">
            {trackCount > 0
              ? `${trackCount} songs loaded. Add more playlists to mix in more songs.`
              : "Paste a Spotify playlist link to load songs."}
          </p>
          <div className="flex gap-2">
            <Input
              value={playlistUrl}
              onChange={e => setPlaylistUrl(e.target.value)}
              placeholder="https://open.spotify.com/playlist/..."
              className="flex-1"
            />
            <Button onClick={addPlaylist} loading={addingPlaylist} size="sm">Add</Button>
          </div>
          {playlistError && <p className="text-sm text-red-400 mt-2">{playlistError}</p>}
          {playlistMsg   && <p className="text-sm text-green-400 mt-2">{playlistMsg}</p>}
          <p className="text-xs opacity-40 mt-3">
            Paste a public Spotify playlist URL. Requires Spotify connected on your{" "}
            <a href="https://account.gokkehub.com/profile" target="_blank" rel="noreferrer" className="underline">profile</a>.
          </p>
        </Panel>
      )}

      {/* Start */}
      {isHost && (
        <div className="space-y-2">
          {startError && <p className="text-sm text-red-400">{startError}</p>}
          <Button
            onClick={startGame}
            loading={starting}
            disabled={trackCount < 5}
            className="w-full"
            size="lg"
          >
            {trackCount < 5 ? `Add songs first (${trackCount}/5 minimum)` : "Start Game →"}
          </Button>
        </div>
      )}

      {!isHost && (
        <p className="text-center text-sm opacity-50">Waiting for host to start…</p>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 flex items-center justify-center opacity-50">{children}</div>;
}
