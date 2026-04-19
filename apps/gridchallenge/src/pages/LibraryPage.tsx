import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Panel, Input, Modal, Toggle, useToast } from "@gokkehub/ui";
import { useSession } from "../hooks/useSession";
import { usePlayerGames } from "../hooks/usePlayerGames";
import { usePlayerChallenges } from "../hooks/usePlayerChallenges";
import { getGameDisplayName, getGameIconUrl } from "../lib/gameKeys";
import type { ChallengeType, PlayerGame, GameSource } from "../lib/types";

// ── Source badge ───────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<GameSource, string> = {
  steam:   "Steam",
  discord: "Discord",
  manual:  "Manual",
};

const SOURCE_COLORS: Record<GameSource, string> = {
  steam:   "#1a9fff",
  discord: "#5865f2",
  manual:  "rgba(255,255,255,0.3)",
};

function SourceBadge({ source }: { source: GameSource }) {
  return (
    <span
      className="text-xs font-semibold px-2 py-0.5 rounded-full"
      style={{
        background: `${SOURCE_COLORS[source]}22`,
        color: SOURCE_COLORS[source],
        border: `1px solid ${SOURCE_COLORS[source]}55`,
      }}
    >
      {SOURCE_LABELS[source]}
    </span>
  );
}

// ── Challenge type pill ────────────────────────────────────────────────────────

const TYPE_LABELS: Record<ChallengeType, string> = {
  single:  "👤 Single",
  group:   "👥 Group",
  versus:  "⚔️ Versus",
};

const TYPE_COLORS: Record<ChallengeType, string> = {
  single:  "rgba(var(--color-primary-rgb), 0.7)",
  group:   "rgba(var(--color-accent-rgb), 0.7)",
  versus:  "#e07a1c",
};

// ── Add challenge form ─────────────────────────────────────────────────────────

interface AddChallengeFormProps {
  game: PlayerGame;
  onAdd: (text: string, type: ChallengeType) => Promise<void>;
  onClose: () => void;
}

function AddChallengeForm({ game, onAdd, onClose }: AddChallengeFormProps) {
  const [text, setText] = useState("");
  const [type, setType] = useState<ChallengeType>("single");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!text.trim()) { setError("Challenge text is required."); return; }
    setLoading(true);
    setError(null);
    await onAdd(text, type);
    setLoading(false);
    setText("");
    onClose();
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-bold text-xl">Add Challenge</h2>
      <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>
        For <strong>{game.display_name}</strong>
      </p>

      <div>
        <p className="text-sm font-medium mb-2">Type</p>
        <Toggle
          options={[
            { value: "single",  label: "👤 Single" },
            { value: "group",   label: "👥 Group" },
            { value: "versus",  label: "⚔️ Versus" },
          ]}
          value={type}
          onChange={(v) => setType(v as ChallengeType)}
        />
      </div>

      <Input
        label="Challenge text"
        placeholder="e.g. Win a match without dying"
        value={text}
        onChange={(e) => { setText(e.target.value); setError(null); }}
        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        error={error ?? undefined}
      />

      <div className="flex gap-2">
        <Button variant="ghost" fullWidth onClick={onClose}>Cancel</Button>
        <Button variant="primary" fullWidth loading={loading} onClick={handleSubmit}>
          Add Challenge
        </Button>
      </div>
    </div>
  );
}

// ── Game card ──────────────────────────────────────────────────────────────────

interface GameCardProps {
  game: PlayerGame;
  challengeCount: number;
  onAddChallenge: () => void;
  onRemove: () => void;
}

function GameCard({ game, challengeCount, onAddChallenge, onRemove }: GameCardProps) {
  const iconUrl = getGameIconUrl(game.normalized_key);

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all group"
      style={{
        background: "rgba(var(--surface-raised-rgb), 0.5)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Icon */}
      <div
        className="w-9 h-9 rounded-lg flex-shrink-0 flex items-center justify-center"
        style={{ background: "rgba(255,255,255,0.06)" }}
      >
        {iconUrl ? (
          <img
            src={iconUrl}
            alt=""
            className="w-5 h-5 opacity-75"
            style={{ filter: "invert(1)" }}
          />
        ) : (
          <span className="text-base">🎮</span>
        )}
      </div>

      {/* Name + source */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm leading-tight truncate">{game.display_name}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <SourceBadge source={game.source} />
          {challengeCount > 0 && (
            <span className="text-xs" style={{ color: "rgb(var(--text-muted-rgb))" }}>
              {challengeCount} challenge{challengeCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={onAddChallenge}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-lg font-bold transition-all"
          style={{
            background: "rgba(var(--color-primary-rgb), 0.15)",
            color: "rgb(var(--color-primary-rgb))",
          }}
          title="Add challenge"
        >
          +
        </button>
        <button
          onClick={onRemove}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-all opacity-0 group-hover:opacity-100"
          style={{
            background: "rgba(255,80,80,0.1)",
            color: "rgba(255,100,100,0.8)",
          }}
          title="Remove game"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function LibraryPage() {
  const { session, loading: sessionLoading } = useSession();
  const { games, loading: gamesLoading, addGame, removeGame } = usePlayerGames(session);
  const { challenges, loading: challengesLoading, addChallenge, removeChallenge } = usePlayerChallenges(session);
  const { addToast } = useToast();

  // Add game form
  const [addGameName, setAddGameName] = useState("");
  const [addGameLoading, setAddGameLoading] = useState(false);

  // Add challenge modal
  const [challengeModalGame, setChallengeModalGame] = useState<PlayerGame | null>(null);

  // Challenge list expansion
  const [expandedGame, setExpandedGame] = useState<string | null>(null);

  const loading = sessionLoading || gamesLoading || challengesLoading;

  async function handleAddGame() {
    const name = addGameName.trim();
    if (!name) return;
    setAddGameLoading(true);
    const error = await addGame(name, "manual");
    setAddGameLoading(false);
    if (error) {
      addToast("Failed to add game: " + error.message, "error");
    } else {
      setAddGameName("");
      addToast(`Added "${name}" to your library.`, "success");
    }
  }

  async function handleAddChallenge(text: string, type: ChallengeType) {
    if (!challengeModalGame) return;
    const error = await addChallenge(text, type, challengeModalGame.normalized_key);
    if (error) {
      addToast("Failed to add challenge: " + error.message, "error");
    } else {
      addToast("Challenge added!", "success");
    }
  }

  // ── Not logged in ────────────────────────────────────────────────────────────

  if (!sessionLoading && !session) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center p-6 gap-6 text-center">
        <div>
          <h1 className="font-bold text-2xl mb-2">Game Library</h1>
          <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            Sign in with your GokkeHub account to save games and personal challenges.
          </p>
        </div>
        <a href="https://account.gokkehub.com">
          <Button variant="primary">Sign in with GokkeHub</Button>
        </a>
        <Link to="/" className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          ← Back to GridChallenge
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 flex flex-col gap-8">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <Link
            to="/"
            className="text-sm flex items-center gap-1 mb-3"
            style={{ color: "rgb(var(--text-muted-rgb))" }}
          >
            ← Back
          </Link>
          <h1 className="font-bold text-2xl tracking-tight">Game Library</h1>
          <p className="text-sm mt-0.5" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            Your games and personal challenges
          </p>
        </div>
        {session && (
          <a
            href="https://account.gokkehub.com/profile"
            className="flex items-center gap-2 text-sm"
            style={{ color: "rgb(var(--text-muted-rgb))" }}
          >
            {session.avatarUrl && (
              <img src={session.avatarUrl} alt="" className="w-7 h-7 rounded-full" />
            )}
            <span className="hidden sm:block">{session.displayName}</span>
          </a>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-center py-12" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          Loading…
        </p>
      ) : (
        <>
          {/* ── Add game section ── */}
          <Panel>
            <h2 className="font-semibold text-base mb-3">Add a Game</h2>
            <div className="flex gap-2">
              <Input
                placeholder="Game name (e.g. Minecraft)"
                value={addGameName}
                onChange={(e) => setAddGameName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddGame()}
              />
              <Button
                variant="primary"
                loading={addGameLoading}
                onClick={handleAddGame}
              >
                Add
              </Button>
            </div>
            {session?.linked?.steam && (
              <p className="text-xs mt-2" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                Steam connected — your Steam library can be synced from your{" "}
                <a href="https://account.gokkehub.com/profile" className="underline">
                  account settings
                </a>.
              </p>
            )}
          </Panel>

          {/* ── Games list ── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-base">
                Your Games
                {games.length > 0 && (
                  <span className="ml-2 text-sm font-normal" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                    ({games.length})
                  </span>
                )}
              </h2>
            </div>

            {games.length === 0 ? (
              <Panel>
                <p className="text-sm text-center py-6" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                  No games yet. Add a game above to get started.
                </p>
              </Panel>
            ) : (
              <div className="flex flex-col gap-2">
                {games.map((game) => {
                  const gameChallenges = challenges.filter((c) => c.game === game.normalized_key);
                  const isExpanded = expandedGame === game.id;

                  return (
                    <div key={game.id}>
                      <GameCard
                        game={game}
                        challengeCount={gameChallenges.length}
                        onAddChallenge={() => setChallengeModalGame(game)}
                        onRemove={() => removeGame(game.id)}
                      />

                      {/* Challenge list for this game */}
                      {gameChallenges.length > 0 && (
                        <div
                          style={{
                            display: "grid",
                            gridTemplateRows: isExpanded ? "1fr" : "0fr",
                            transition: "grid-template-rows 0.25s ease",
                          }}
                        >
                          <div style={{ overflow: "hidden" }}>
                            <div className="ml-4 mt-1 flex flex-col gap-1 pb-1">
                              {gameChallenges.map((c) => (
                                <div
                                  key={c.id}
                                  className="flex items-start gap-2 px-3 py-2 rounded-lg group"
                                  style={{ background: "rgba(255,255,255,0.03)" }}
                                >
                                  <span
                                    className="text-xs font-semibold mt-0.5 flex-shrink-0 px-1.5 py-0.5 rounded"
                                    style={{
                                      background: `${TYPE_COLORS[c.type as ChallengeType]}22`,
                                      color: TYPE_COLORS[c.type as ChallengeType],
                                    }}
                                  >
                                    {TYPE_LABELS[c.type as ChallengeType]}
                                  </span>
                                  <p className="text-sm flex-1 leading-snug">{c.text}</p>
                                  <button
                                    onClick={() => removeChallenge(c.id)}
                                    className="text-xs opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity flex-shrink-0"
                                    style={{ color: "rgba(255,100,100,0.8)" }}
                                    title="Remove challenge"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Expand/collapse toggle */}
                      {gameChallenges.length > 0 && (
                        <button
                          onClick={() => setExpandedGame(isExpanded ? null : game.id)}
                          className="ml-4 mt-0.5 text-xs"
                          style={{ color: "rgb(var(--text-muted-rgb))" }}
                        >
                          {isExpanded
                            ? "▲ Hide challenges"
                            : `▼ Show ${gameChallenges.length} challenge${gameChallenges.length !== 1 ? "s" : ""}`}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Orphaned challenges (games removed but challenges remain) ── */}
          {(() => {
            const gameKeys = new Set(games.map((g) => g.normalized_key));
            const orphaned = challenges.filter((c) => !gameKeys.has(c.game));
            if (!orphaned.length) return null;
            return (
              <div>
                <h2 className="font-semibold text-base mb-3">
                  Other Challenges
                  <span className="ml-2 text-sm font-normal" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                    (games not in library)
                  </span>
                </h2>
                <Panel>
                  <div className="flex flex-col gap-2">
                    {orphaned.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-start gap-2 px-3 py-2 rounded-lg group"
                        style={{ background: "rgba(255,255,255,0.03)" }}
                      >
                        <span
                          className="text-xs font-semibold mt-0.5 flex-shrink-0 px-1.5 py-0.5 rounded"
                          style={{
                            background: `${TYPE_COLORS[c.type as ChallengeType]}22`,
                            color: TYPE_COLORS[c.type as ChallengeType],
                          }}
                        >
                          {TYPE_LABELS[c.type as ChallengeType]}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs mb-0.5" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                            {getGameDisplayName(c.game)}
                          </p>
                          <p className="text-sm leading-snug">{c.text}</p>
                        </div>
                        <button
                          onClick={() => removeChallenge(c.id)}
                          className="text-xs opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity flex-shrink-0"
                          style={{ color: "rgba(255,100,100,0.8)" }}
                          title="Remove challenge"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
            );
          })()}
        </>
      )}

      {/* Add challenge modal */}
      <Modal open={!!challengeModalGame} onClose={() => setChallengeModalGame(null)}>
        {challengeModalGame && (
          <AddChallengeForm
            game={challengeModalGame}
            onAdd={handleAddChallenge}
            onClose={() => setChallengeModalGame(null)}
          />
        )}
      </Modal>
    </div>
  );
}
