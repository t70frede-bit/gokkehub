import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button, Modal, Panel } from "@gokkehub/ui";
import { getStoredPlayerId, useRoom } from "../hooks/useRoom";
import { useHostController } from "../hooks/useHostController";
import type { JpPlayer } from "../lib/types";

const secondary = { color: "rgb(var(--text-secondary-rgb))" } as const;

const inputStyle = {
  background: "rgb(var(--surface-input-rgb))",
  border:     "1px solid rgb(var(--border-rgb))",
  color:      "rgb(var(--text-primary-rgb))",
} as const;

export default function LobbyPage() {
  const navigate   = useNavigate();
  const { roomId } = useParams();
  const { room, game, teams, players, loading, error } = useRoom(roomId);

  const playerId = roomId ? getStoredPlayerId(roomId) : null;
  const isHost   = !!room && !!playerId && room.host_id === playerId;
  const { dispatch, busy, error: actionError } = useHostController(roomId, playerId);

  const [managePlayer, setManagePlayer] = useState<JpPlayer | null>(null);
  const [renameTeam, setRenameTeam]     = useState<{ teamId: number; value: string } | null>(null);

  // Follow the room's status wherever it goes.
  useEffect(() => {
    if (!room || !roomId) return;
    if (room.status === "playing")  navigate(isHost ? `/host/${roomId}` : `/play/${roomId}`, { replace: true });
    if (room.status === "finished") navigate(`/end/${roomId}`, { replace: true });
  }, [room?.status, roomId, isHost]);

  if (loading) return <div className="flex-1 flex items-center justify-center opacity-60">Loading…</div>;
  if (error || !room) {
    return <div className="flex-1 flex items-center justify-center">{error ?? "Room not found"}</div>;
  }

  const teamMode    = game?.config.teams?.mode === "teams";
  const contestants = players.filter(p => p.id !== room.host_id);

  return (
    <div className="flex-1 w-full max-w-2xl mx-auto p-4 sm:p-6 flex flex-col gap-5">
      <Panel className="text-center">
        <p className="text-sm uppercase tracking-widest" style={secondary}>Room code</p>
        <p className="font-mono font-black text-5xl sm:text-6xl my-2"
          style={{ color: "rgb(var(--color-primary-rgb))" }}
        >
          {room.id}
        </p>
        <p className="text-sm" style={secondary}>
          Join at <span className="font-bold">gokkehub.com/join</span>
        </p>
      </Panel>

      {teamMode ? (
        <Panel>
          <div className="flex items-center gap-3 mb-3">
            <h2 className="text-lg font-bold flex-1">Teams</h2>
            {isHost && (
              <Button variant="ghost" size="sm" loading={busy}
                onClick={() => dispatch({ type: "shuffle_teams" })}>
                🎲 Shuffle
              </Button>
            )}
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {teams.map(team => {
              const members = contestants.filter(p => p.team_id === team.id);
              return (
                <div key={team.id} className="rounded-lg p-3"
                  style={{ border: "1px solid rgb(var(--border-rgb))" }}>
                  <button type="button" disabled={!isHost}
                    className="font-bold mb-2 text-left w-full"
                    title={isHost ? "Rename team" : undefined}
                    onClick={() => isHost && setRenameTeam({ teamId: team.id, value: team.name })}>
                    {team.name} {isHost && <span className="opacity-40 text-xs">✎</span>}
                  </button>
                  {members.length === 0 && (
                    <p className="text-sm" style={secondary}>Empty</p>
                  )}
                  <ul className="flex flex-col gap-1">
                    {members.map(p => (
                      <li key={p.id}>
                        <button type="button" disabled={!isHost}
                          className="w-full text-left rounded px-2 py-1 text-sm font-semibold"
                          style={{ background: "rgba(255,255,255,0.03)" }}
                          onClick={() => isHost && setManagePlayer(p)}>
                          {team.captain_id === p.id && "⭐ "}
                          {p.name}
                          {p.id === playerId && <span style={secondary}> (you)</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
          <p className="text-xs mt-3" style={secondary}>
            ⭐ = captain — special questions are answered on their phone, with the team around it.
            {isHost ? " Tap a player to move them or hand over the captaincy." : ""}
          </p>
        </Panel>
      ) : (
        <Panel>
          <h2 className="text-lg font-bold mb-3">Players ({contestants.length})</h2>
          {contestants.length === 0 && (
            <p style={secondary}>Waiting for players to join…</p>
          )}
          <ul className="flex flex-col gap-2">
            {contestants.map(p => (
              <li key={p.id} className="rounded-md px-3 py-2 font-semibold"
                style={{ border: "1px solid rgb(var(--border-rgb))" }}
              >
                {p.name}
                {p.id === playerId && <span style={secondary}> (you)</span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {isHost ? (
        <Panel>
          <div className="flex flex-col gap-3">
            <Button fullWidth size="lg" loading={busy} disabled={contestants.length === 0}
              onClick={() => dispatch({ type: "start" })}
            >
              Start game
            </Button>
            <Button fullWidth variant="ghost" onClick={() => window.open(`/screen/${room.id}`, "_blank")}>
              Open big screen (on the TV)
            </Button>
            {actionError && (
              <p className="text-sm" style={{ color: "rgb(var(--color-danger-rgb))" }}>{actionError}</p>
            )}
          </div>
        </Panel>
      ) : !playerId ? (
        <Panel className="text-center">
          <p className="mb-3" style={secondary}>You're viewing this lobby — join to play.</p>
          <Link to={`/join?room=${room.id}`}>
            <Button fullWidth>Join this game</Button>
          </Link>
        </Panel>
      ) : (
        <p className="text-center" style={secondary}>Waiting for the host to start…</p>
      )}

      {/* ── Host: manage a player ─────────────────────────────────────── */}
      <Modal open={managePlayer !== null} onClose={() => setManagePlayer(null)}>
        {managePlayer && (
          <div className="flex flex-col gap-3">
            <h3 className="text-lg font-bold">{managePlayer.name}</h3>
            <Button fullWidth variant="ghost" loading={busy}
              onClick={async () => {
                await dispatch({ type: "set_captain", playerId: managePlayer.id });
                setManagePlayer(null);
              }}>
              ⭐ Make captain
            </Button>
            <p className="text-sm font-semibold" style={secondary}>Move to…</p>
            {teams.filter(t => t.id !== managePlayer.team_id).map(t => (
              <Button key={t.id} fullWidth variant="ghost" loading={busy}
                onClick={async () => {
                  await dispatch({ type: "assign_player", playerId: managePlayer.id, teamId: t.id });
                  setManagePlayer(null);
                }}>
                {t.name}
              </Button>
            ))}
          </div>
        )}
      </Modal>

      {/* ── Host: rename team ─────────────────────────────────────────── */}
      <Modal open={renameTeam !== null} onClose={() => setRenameTeam(null)}>
        {renameTeam && (
          <div className="flex flex-col gap-4">
            <h3 className="text-lg font-bold">Rename team</h3>
            <input value={renameTeam.value} autoFocus maxLength={30}
              onChange={e => setRenameTeam({ ...renameTeam, value: e.target.value })}
              onKeyDown={async e => {
                if (e.key === "Enter" && renameTeam.value.trim()) {
                  await dispatch({ type: "rename_team", teamId: renameTeam.teamId, name: renameTeam.value.trim() });
                  setRenameTeam(null);
                }
              }}
              className="w-full px-4 py-2.5 rounded-md font-sans text-base outline-none"
              style={inputStyle} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRenameTeam(null)}>Cancel</Button>
              <Button loading={busy} disabled={!renameTeam.value.trim()}
                onClick={async () => {
                  await dispatch({ type: "rename_team", teamId: renameTeam.teamId, name: renameTeam.value.trim() });
                  setRenameTeam(null);
                }}>
                Save
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
