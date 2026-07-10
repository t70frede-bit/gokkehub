import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input, Modal, Panel, useToast } from "@gokkehub/ui";
import { useSession } from "../hooks/useSession";
import { getStoredPlayerId, storePlayerId } from "../hooks/useRoom";
import { supabase } from "../lib/supabase";
import type { CreateGameResponse, JpGame, JpRoom, LaunchGameResponse } from "../lib/types";

type Tab = "mine" | "shared";

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: "6px 16px",
  borderRadius: "6px",
  fontWeight: active ? 600 : 400,
  background: active ? "rgb(var(--surface-card-rgb))" : "transparent",
  color: active ? "rgb(var(--text-primary-rgb))" : "rgb(var(--text-muted-rgb))",
  border: "none",
  cursor: "pointer",
  transition: "background 0.15s, color 0.15s",
});

export default function DashboardPage() {
  const navigate = useNavigate();
  const { session, loading: sessionLoading } = useSession();

  const { addToast } = useToast();
  const [tab,          setTab]          = useState<Tab>("mine");
  const [games,        setGames]        = useState<JpGame[]>([]);
  const [sharedGames,  setSharedGames]  = useState<JpGame[]>([]);
  const [rooms,        setRooms]        = useState<JpRoom[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [title,        setTitle]        = useState("");
  const [busy,         setBusy]         = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<JpGame | null>(null);

  useEffect(() => {
    if (!session) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const [{ data: gameRows }, { data: sharedRows }] = await Promise.all([
        supabase.from("jp_games").select("*")
          .eq("host_id", session.userId)
          .neq("status", "archived")
          .order("updated_at", { ascending: false }),
        supabase.from("jp_games").select("*")
          .contains("collaborators", [{ userId: session.userId }])
          .neq("status", "archived")
          .order("updated_at", { ascending: false }),
      ]);
      if (cancelled) return;
      const g = (gameRows ?? []) as JpGame[];
      setGames(g);
      setSharedGames((sharedRows ?? []) as JpGame[]);
      if (g.length) {
        const { data: roomRows } = await supabase.from("jp_rooms").select("*")
          .in("game_id", g.map(x => x.id))
          .neq("status", "finished");
        if (!cancelled) setRooms((roomRows ?? []) as JpRoom[]);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [session]);

  const createGame = async () => {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    const res  = await fetch("/game/create", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body:    JSON.stringify({ title: title.trim() }),
    });
    const body = await res.json().catch(() => null) as (CreateGameResponse & { error?: string }) | null;
    setBusy(false);
    if (!res.ok || !body?.game_id) {
      setError(body?.error ?? "Could not create game");
      return;
    }
    navigate(`/setup/${body.game_id}`);
  };

  const launchGame = async (gameId: string) => {
    setBusy(true);
    setError(null);
    const res  = await fetch(`/game/${gameId}/launch`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body:    JSON.stringify({ host_name: session?.displayName ?? "Host" }),
    });
    const body = await res.json().catch(() => null) as (LaunchGameResponse & { error?: string }) | null;
    setBusy(false);
    if (!res.ok || !body?.room_id) {
      setError(body?.error ?? "Could not launch game");
      return;
    }
    storePlayerId(body.room_id, body.player_id);
    navigate(`/lobby/${body.room_id}`);
  };

  const resumeRoom = async (room: JpRoom) => {
    if (!getStoredPlayerId(room.id)) {
      setBusy(true);
      const res  = await fetch(`/room/${room.id}/claim-host`, { method: "POST", credentials: "include" });
      const body = await res.json().catch(() => null) as { player_id?: string; error?: string } | null;
      setBusy(false);
      if (!res.ok || !body?.player_id) {
        setError(body?.error ?? "Could not take over hosting");
        return;
      }
      storePlayerId(room.id, body.player_id);
      addToast("Host control moved to this device");
    }
    navigate(room.status === "lobby" ? `/lobby/${room.id}` : `/host/${room.id}`);
  };

  const deleteGame = async (game: JpGame) => {
    setBusy(true);
    const res = await fetch(`/game/${game.id}/update`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body:    JSON.stringify({ status: "archived" }),
    });
    setBusy(false);
    setConfirmDelete(null);
    if (!res.ok) {
      addToast("Could not delete game");
      return;
    }
    setGames(gs => gs.filter(g => g.id !== game.id));
    addToast("Game deleted");
  };

  if (sessionLoading || loading) {
    return <div className="flex-1 flex items-center justify-center opacity-60">Loading…</div>;
  }

  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <Panel className="max-w-md text-center">
          <h1 className="text-2xl font-bold mb-2">Jeopardy</h1>
          <p style={{ color: "rgb(var(--text-secondary-rgb))" }}>
            Log in with Discord (top right) to build and host games.
            Players joining a game don't need an account — they join via a room code
            at gokkehub.com.
          </p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="flex-1 w-full max-w-3xl mx-auto p-4 sm:p-6 flex flex-col gap-6">
      {tab === "mine" && (
        <Panel>
          <h1 className="text-2xl font-bold mb-4">New game</h1>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <Input
                label="Game title"
                value={title}
                placeholder="Friday night quiz"
                onChange={e => setTitle(e.target.value)}
                onKeyDown={e => e.key === "Enter" && createGame()}
              />
            </div>
            <Button onClick={createGame} loading={busy} disabled={!title.trim()}>
              Create
            </Button>
          </div>
          {error && <p className="mt-3 text-sm" style={{ color: "rgb(var(--color-danger-rgb))" }}>{error}</p>}
        </Panel>
      )}

      <Panel>
        {/* Tab bar */}
        <div className="flex gap-1 mb-5" style={{ borderBottom: "1px solid rgb(var(--border-rgb))", paddingBottom: "12px" }}>
          <button style={tabStyle(tab === "mine")} onClick={() => setTab("mine")}>
            My games
            {games.length > 0 && (
              <span className="ml-2 text-xs opacity-60">{games.length}</span>
            )}
          </button>
          <button style={tabStyle(tab === "shared")} onClick={() => setTab("shared")}>
            Shared with me
            {sharedGames.length > 0 && (
              <span className="ml-2 text-xs opacity-60">{sharedGames.length}</span>
            )}
          </button>
        </div>

        {tab === "mine" && (
          <>
            {games.length === 0 && (
              <p style={{ color: "rgb(var(--text-secondary-rgb))" }}>No games yet — create one above.</p>
            )}
            <ul className="flex flex-col gap-3">
              {games.map(game => {
                const liveRoom = rooms.find(r => r.game_id === game.id);
                return (
                  <li key={game.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg p-3"
                    style={{ border: "1px solid rgb(var(--border-rgb))" }}
                  >
                    <div className="flex-1 min-w-40">
                      <div className="font-bold">{game.title}</div>
                      <div className="text-xs" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
                        {game.status} · {new Date(game.updated_at).toLocaleDateString()}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => navigate(`/setup/${game.id}`)}>
                      Edit
                    </Button>
                    {liveRoom ? (
                      <Button size="sm" loading={busy} onClick={() => resumeRoom(liveRoom)}>
                        {getStoredPlayerId(liveRoom.id) ? `Resume (${liveRoom.id})` : `Host here (${liveRoom.id})`}
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => launchGame(game.id)} loading={busy}>
                        Launch
                      </Button>
                    )}
                    <Button variant="danger" size="sm" onClick={() => setConfirmDelete(game)}>
                      🗑
                    </Button>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {tab === "shared" && (
          <>
            {sharedGames.length === 0 && (
              <p style={{ color: "rgb(var(--text-secondary-rgb))" }}>
                No games shared with you yet.
              </p>
            )}
            <ul className="flex flex-col gap-3">
              {sharedGames.map(game => (
                <li key={game.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg p-3"
                  style={{ border: "1px solid rgb(var(--border-rgb))" }}
                >
                  <div className="flex-1 min-w-40">
                    <div className="font-bold">{game.title}</div>
                    <div className="text-xs" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
                      {game.status} · {new Date(game.updated_at).toLocaleDateString()}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => navigate(`/setup/${game.id}`)}>
                    Edit
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      <Modal open={confirmDelete !== null} onClose={() => setConfirmDelete(null)}>
        {confirmDelete && (
          <div className="flex flex-col gap-4">
            <h3 className="text-lg font-bold">Delete "{confirmDelete.title}"?</h3>
            <p style={{ color: "rgb(var(--text-secondary-rgb))" }}>
              The game disappears from your dashboard. Finished rooms and their results are kept.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button variant="danger" loading={busy} onClick={() => deleteGame(confirmDelete)}>
                Delete game
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
