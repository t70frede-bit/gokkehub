import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Button, Input, Modal, Toggle, useToast } from "@gokkehub/ui";
import { useSession } from "../hooks/useSession";
import { usePlayerGames } from "../hooks/usePlayerGames";
import { usePlayerChallenges } from "../hooks/usePlayerChallenges";
import { normalizeGameKey } from "../lib/gameKeys";
import type { ChallengeType, PlayerGame } from "../lib/types";

// ── Steam game (from /steam/games API) ────────────────────────────────────────

interface SteamGameResult {
  appid:          number;
  name:           string;
  playtime_hours: number;
  last_played:    number;
}

// ── Cover image with fallback chain ──────────────────────────────────────────

function CoverImage({
  steamAppId,
  name,
  className = "",
}: {
  steamAppId: number | null;
  name:       string;
  className?: string;
}) {
  const [stage, setStage] = useState<"portrait" | "header" | "none">(
    steamAppId ? "portrait" : "none",
  );

  if (stage === "none" || !steamAppId) {
    return (
      <div
        className={`w-full h-full flex items-center justify-center text-3xl font-extrabold select-none ${className}`}
        style={{
          background:
            "linear-gradient(135deg, rgba(var(--color-primary-rgb),0.45), rgba(var(--color-accent-rgb),0.35))",
          color: "rgba(255,255,255,0.5)",
        }}
      >
        {name.charAt(0).toUpperCase()}
      </div>
    );
  }

  const src =
    stage === "portrait"
      ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/library_600x900.jpg`
      : `https://cdn.cloudflare.steamstatic.com/steam/apps/${steamAppId}/header.jpg`;

  return (
    <img
      src={src}
      alt={name}
      loading="lazy"
      className={`w-full h-full object-cover ${className}`}
      onError={() =>
        setStage((s) => (s === "portrait" ? "header" : "none"))
      }
    />
  );
}

// ── Your-library cover card ───────────────────────────────────────────────────

function GameCard({
  game,
  challengeCount,
  onToggleFavorite,
  onRemove,
  onClick,
}: {
  game:             PlayerGame;
  challengeCount:   number;
  onToggleFavorite: () => void;
  onRemove:         () => void;
  onClick:          () => void;
}) {
  return (
    <div
      className="group flex flex-col cursor-pointer"
      onClick={onClick}
      title={game.display_name}
    >
      {/* Art */}
      <div
        className="relative rounded-xl overflow-hidden flex-shrink-0"
        style={{ aspectRatio: "2/3" }}
      >
        <CoverImage steamAppId={game.steam_app_id} name={game.display_name} />

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-all duration-150" />

        {/* Top-right controls (always show favorite if active) */}
        <div className="absolute top-1.5 right-1.5 flex flex-col gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
            className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold transition-all
              ${game.is_favorite
                ? "opacity-100 bg-yellow-400 text-black"
                : "opacity-0 group-hover:opacity-100 bg-black/70 text-white"
              }`}
            title={game.is_favorite ? "Remove from favourites" : "Mark as favourite"}
          >
            ★
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-all bg-black/70"
            style={{ color: "rgba(255,110,110,0.9)" }}
            title="Remove from library"
          >
            ✕
          </button>
        </div>

        {/* Challenge count badge */}
        {challengeCount > 0 && (
          <div
            className="absolute bottom-1.5 left-1.5 text-xs font-bold px-1.5 py-0.5 rounded-full"
            style={{
              background: "rgba(var(--color-primary-rgb),0.9)",
              color: "white",
            }}
          >
            {challengeCount}
          </div>
        )}

        {/* Source badge */}
        {game.source === "steam" && (
          <div
            className="absolute bottom-1.5 right-1.5 text-xs font-bold px-1.5 py-0.5 rounded"
            style={{ background: "rgba(26,159,255,0.85)", color: "white" }}
          >
            Steam
          </div>
        )}
      </div>

      {/* Name */}
      <p
        className="mt-1.5 text-xs font-semibold leading-tight line-clamp-2"
        style={{ color: "rgb(var(--text-primary-rgb))" }}
      >
        {game.display_name}
      </p>
    </div>
  );
}

// ── Steam import card (used inside modal) ─────────────────────────────────────

function SteamImportCard({
  game,
  selected,
  alreadyOwned,
  onToggle,
}: {
  game:         SteamGameResult;
  selected:     boolean;
  alreadyOwned: boolean;
  onToggle:     () => void;
}) {
  return (
    <div
      className={`group relative flex flex-col cursor-pointer select-none ${alreadyOwned ? "opacity-40" : ""}`}
      onClick={alreadyOwned ? undefined : onToggle}
      title={alreadyOwned ? `${game.name} (already in library)` : game.name}
    >
      <div
        className="relative rounded-xl overflow-hidden"
        style={{ aspectRatio: "2/3" }}
      >
        <CoverImage steamAppId={game.appid} name={game.name} />

        {/* Selection overlay */}
        {!alreadyOwned && (
          <div
            className={`absolute inset-0 transition-all duration-150 flex items-center justify-center
              ${selected ? "bg-blue-600/40" : "bg-black/0 group-hover:bg-black/30"}`}
          >
            <div
              className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all
                ${selected
                  ? "bg-blue-500 border-blue-400"
                  : "border-white/50 bg-black/50 opacity-0 group-hover:opacity-100"
                }`}
            >
              {selected && (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          </div>
        )}

        {/* Already-owned badge */}
        {alreadyOwned && (
          <div
            className="absolute inset-0 flex items-end justify-center pb-2"
            style={{ background: "rgba(0,0,0,0.5)" }}
          >
            <span className="text-xs font-bold text-white bg-black/60 px-2 py-0.5 rounded">
              In library
            </span>
          </div>
        )}
      </div>

      {/* Name + playtime */}
      <p
        className="mt-1.5 text-xs font-semibold leading-tight line-clamp-2"
        style={{ color: "rgb(var(--text-primary-rgb))" }}
      >
        {game.name}
      </p>
      {game.playtime_hours > 0 && (
        <p className="text-xs" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          {game.playtime_hours}h
        </p>
      )}
    </div>
  );
}

// ── Steam import modal ────────────────────────────────────────────────────────

function SteamImportModal({
  open,
  onClose,
  existingKeys,
  onImport,
}: {
  open:         boolean;
  onClose:      () => void;
  existingKeys: Set<string>;
  onImport:     (games: Array<{ name: string; steamAppId: number }>) => Promise<number>;
}) {
  const [input, setInput]         = useState("");
  const [fetching, setFetching]   = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [results, setResults]     = useState<SteamGameResult[]>([]);
  const [selected, setSelected]   = useState<Set<number>>(new Set());
  const [filter, setFilter]       = useState<"all" | "played" | "unplayed">("played");
  const [importing, setImporting] = useState(false);
  const { addToast } = useToast();

  const filtered = useMemo(() => {
    switch (filter) {
      case "played":   return results.filter((g) => g.playtime_hours > 0);
      case "unplayed": return results.filter((g) => g.playtime_hours === 0);
      default:         return results;
    }
  }, [results, filter]);

  async function fetchLibrary() {
    if (!input.trim()) return;
    setFetching(true);
    setError(null);
    setResults([]);
    setSelected(new Set());
    try {
      const res = await fetch(`/steam/games?input=${encodeURIComponent(input.trim())}`);
      const data = (await res.json()) as { games?: SteamGameResult[]; error?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? "Failed to fetch library.");
      } else {
        setResults(data.games ?? []);
        // Pre-select all played games not already in library
        setSelected(
          new Set(
            (data.games ?? [])
              .filter(
                (g) =>
                  g.playtime_hours > 0 &&
                  !existingKeys.has(normalizeGameKey(g.name)),
              )
              .map((g) => g.appid),
          ),
        );
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setFetching(false);
    }
  }

  function toggleGame(appid: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(appid) ? next.delete(appid) : next.add(appid);
      return next;
    });
  }

  function selectAll() {
    setSelected(
      new Set(
        filtered
          .filter((g) => !existingKeys.has(normalizeGameKey(g.name)))
          .map((g) => g.appid),
      ),
    );
  }

  function selectNone() {
    setSelected(new Set());
  }

  async function handleImport() {
    const toImport = results.filter((g) => selected.has(g.appid));
    if (toImport.length === 0) return;
    setImporting(true);
    await onImport(toImport.map((g) => ({ name: g.name, steamAppId: g.appid })));
    addToast(`Imported ${toImport.length} game${toImport.length !== 1 ? "s" : ""} from Steam!`, "success");
    setImporting(false);
    onClose();
  }

  const selectedCount = Array.from(selected).filter(
    (id) => !existingKeys.has(normalizeGameKey(results.find((g) => g.appid === id)?.name ?? "")),
  ).length;

  return (
    <Modal open={open} onClose={onClose}>
      <div className="flex flex-col gap-4 w-full" style={{ maxWidth: "min(90vw, 900px)", maxHeight: "85vh" }}>
        <div>
          <h2 className="font-bold text-xl">Import from Steam</h2>
          <p className="text-sm mt-0.5" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            Enter your Steam ID, vanity username, or profile URL. Your Steam profile must be set to <strong>Public</strong>.
          </p>
        </div>

        {/* Input row */}
        <div className="flex gap-2">
          <Input
            placeholder="e.g. 76561198012345678 · gaben · steamcommunity.com/id/gaben"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchLibrary()}
          />
          <Button variant="primary" loading={fetching} onClick={fetchLibrary}>
            Fetch
          </Button>
        </div>

        {error && (
          <p className="text-sm" style={{ color: "rgba(255,100,100,0.9)" }}>
            ⚠️ {error}
          </p>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div className="flex flex-col gap-3 overflow-hidden">
            {/* Controls */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <Toggle
                options={[
                  { value: "played",   label: `Played (${results.filter((g) => g.playtime_hours > 0).length})` },
                  { value: "unplayed", label: `Not played (${results.filter((g) => g.playtime_hours === 0).length})` },
                  { value: "all",      label: `All (${results.length})` },
                ]}
                value={filter}
                onChange={(v) => setFilter(v as typeof filter)}
              />
              <div className="flex items-center gap-3">
                <button
                  className="text-xs font-semibold"
                  style={{ color: "rgb(var(--color-primary-rgb))" }}
                  onClick={selectAll}
                >
                  Select all
                </button>
                <button
                  className="text-xs"
                  style={{ color: "rgb(var(--text-muted-rgb))" }}
                  onClick={selectNone}
                >
                  None
                </button>
              </div>
            </div>

            {/* Grid */}
            <div
              className="overflow-y-auto pr-1"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
                gap: "10px",
                maxHeight: "45vh",
              }}
            >
              {filtered.map((g) => (
                <SteamImportCard
                  key={g.appid}
                  game={g}
                  selected={selected.has(g.appid)}
                  alreadyOwned={existingKeys.has(normalizeGameKey(g.name))}
                  onToggle={() => toggleGame(g.appid)}
                />
              ))}
            </div>

            {/* Import button */}
            <Button
              variant="primary"
              fullWidth
              loading={importing}
              onClick={handleImport}
            >
              {selectedCount > 0
                ? `Import ${selectedCount} selected game${selectedCount !== 1 ? "s" : ""}`
                : "Select games to import"}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Add challenge form (modal content) ────────────────────────────────────────

function AddChallengeForm({
  game,
  onAdd,
  onClose,
}: {
  game:    PlayerGame;
  onAdd:   (text: string, type: ChallengeType) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText]       = useState("");
  const [type, setType]       = useState<ChallengeType>("single");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function handleSubmit() {
    if (!text.trim()) { setError("Challenge text is required."); return; }
    setLoading(true);
    setError(null);
    await onAdd(text, type);
    setLoading(false);
    onClose();
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-bold text-xl">Add Challenge</h2>
        <p className="text-sm mt-0.5" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          For <strong>{game.display_name}</strong>
        </p>
      </div>

      <Toggle
        options={[
          { value: "single",  label: "👤 Single" },
          { value: "group",   label: "👥 Group" },
          { value: "versus",  label: "⚔️ Versus" },
        ]}
        value={type}
        onChange={(v) => setType(v as ChallengeType)}
      />

      <Input
        label="Challenge"
        placeholder="e.g. Win a match without dying"
        value={text}
        onChange={(e) => { setText(e.target.value); setError(null); }}
        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        error={error ?? undefined}
        autoFocus
      />

      <div className="flex gap-2">
        <Button variant="ghost" fullWidth onClick={onClose}>Cancel</Button>
        <Button variant="primary" fullWidth loading={loading} onClick={handleSubmit}>
          Add
        </Button>
      </div>
    </div>
  );
}

// ── Game detail panel (slide-in or modal) ─────────────────────────────────────

function GameDetailModal({
  game,
  challenges,
  onAddChallenge,
  onRemoveChallenge,
  onClose,
}: {
  game:              PlayerGame;
  challenges:        Array<{ id: string; text: string; type: string }>;
  onAddChallenge:    () => void;
  onRemoveChallenge: (id: string) => void;
  onClose:           () => void;
}) {
  const TYPE_ICONS: Record<string, string> = {
    single: "👤", group: "👥", versus: "⚔️",
  };

  return (
    <Modal open onClose={onClose}>
      <div className="flex flex-col gap-4" style={{ minWidth: "min(80vw, 420px)" }}>
        {/* Header */}
        <div className="flex gap-4 items-start">
          <div
            className="rounded-xl overflow-hidden flex-shrink-0"
            style={{ width: 72, aspectRatio: "2/3" }}
          >
            <CoverImage steamAppId={game.steam_app_id} name={game.display_name} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-xl leading-tight">{game.display_name}</h2>
            {game.source === "steam" && (
              <span
                className="inline-block mt-1 text-xs font-semibold px-2 py-0.5 rounded"
                style={{ background: "rgba(26,159,255,0.2)", color: "#1a9fff" }}
              >
                Steam
              </span>
            )}
          </div>
        </div>

        {/* Challenges */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="font-semibold text-sm">
              Challenges{" "}
              <span style={{ color: "rgb(var(--text-muted-rgb))" }}>({challenges.length})</span>
            </p>
            <Button size="sm" variant="ghost" onClick={onAddChallenge}>
              + Add
            </Button>
          </div>

          {challenges.length === 0 ? (
            <p className="text-sm text-center py-4" style={{ color: "rgb(var(--text-muted-rgb))" }}>
              No challenges yet. Add the first one!
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {challenges.map((c) => (
                <div
                  key={c.id}
                  className="flex items-start gap-2 px-3 py-2 rounded-lg group"
                  style={{ background: "rgba(255,255,255,0.04)" }}
                >
                  <span className="text-base flex-shrink-0 mt-px">{TYPE_ICONS[c.type] ?? "🎮"}</span>
                  <p className="text-sm flex-1 leading-snug">{c.text}</p>
                  <button
                    onClick={() => onRemoveChallenge(c.id)}
                    className="text-xs opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity flex-shrink-0 mt-0.5"
                    style={{ color: "rgba(255,100,100,0.8)" }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LibraryPage() {
  const { session, loading: sessionLoading } = useSession();
  const { games, loading: gamesLoading, addGame, removeGame, toggleFavorite, bulkImport } =
    usePlayerGames(session);
  const { challenges, loading: challengesLoading, addChallenge, removeChallenge } =
    usePlayerChallenges(session);
  const { addToast } = useToast();

  // Search + filter
  const [search, setSearch]         = useState("");
  const [libraryFilter, setLibraryFilter] = useState<"all" | "favorites" | "steam" | "manual">("all");

  // Modals
  const [steamModalOpen, setSteamModalOpen]     = useState(false);
  const [detailGame, setDetailGame]             = useState<PlayerGame | null>(null);
  const [addChallengeGame, setAddChallengeGame] = useState<PlayerGame | null>(null);

  // Manual add
  const [addName, setAddName]       = useState("");
  const [addLoading, setAddLoading] = useState(false);

  const loading = sessionLoading || gamesLoading || challengesLoading;

  // Filtered games for the grid
  const displayedGames = useMemo(() => {
    let list = games;
    if (libraryFilter === "favorites") list = list.filter((g) => g.is_favorite);
    if (libraryFilter === "steam")     list = list.filter((g) => g.source === "steam");
    if (libraryFilter === "manual")    list = list.filter((g) => g.source === "manual");
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((g) => g.display_name.toLowerCase().includes(q));
    }
    return list;
  }, [games, libraryFilter, search]);

  const existingKeys = useMemo(
    () => new Set(games.map((g) => g.normalized_key)),
    [games],
  );

  // Handle manual add
  async function handleAddGame() {
    const name = addName.trim();
    if (!name) return;
    setAddLoading(true);
    const error = await addGame(name, "manual");
    setAddLoading(false);
    if (error) {
      addToast("Failed to add game: " + error.message, "error");
    } else {
      setAddName("");
      addToast(`Added "${name}".`, "success");
    }
  }

  async function handleAddChallenge(text: string, type: ChallengeType) {
    if (!addChallengeGame) return;
    const error = await addChallenge(text, type, addChallengeGame.normalized_key);
    if (error) {
      addToast("Failed to add challenge.", "error");
    } else {
      addToast("Challenge added!", "success");
    }
  }

  // ── Not logged in ─────────────────────────────────────────────────────────

  if (!sessionLoading && !session) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center p-6 gap-6 text-center">
        <div>
          <h1 className="font-bold text-2xl mb-2">Game Library</h1>
          <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            Sign in with your GokkeHub account to manage your game library.
          </p>
        </div>
        <a href="https://account.gokkehub.com">
          <Button variant="primary">Sign in with GokkeHub</Button>
        </a>
        <Link to="/" className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          ← Back
        </Link>
      </div>
    );
  }

  const favoriteCount = games.filter((g) => g.is_favorite).length;
  const steamCount    = games.filter((g) => g.source === "steam").length;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 flex flex-col gap-6">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            to="/"
            className="text-sm flex items-center gap-1 mb-2"
            style={{ color: "rgb(var(--text-muted-rgb))" }}
          >
            ← Back
          </Link>
          <h1 className="font-extrabold text-2xl tracking-tight">Game Library</h1>
          <p className="text-sm mt-0.5" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            {games.length} game{games.length !== 1 ? "s" : ""} saved
            {favoriteCount > 0 && ` · ${favoriteCount} favourite${favoriteCount !== 1 ? "s" : ""}`}
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => setSteamModalOpen(true)}
        >
          <span style={{ opacity: 0.85, fontSize: "0.9em" }}>🎮</span> Import from Steam
        </Button>
      </div>

      {/* ── Search + filters + manual add ── */}
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Input
            placeholder="Search your library…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Input
            placeholder="Add game by name…"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddGame()}
          />
          <Button variant="ghost" loading={addLoading} onClick={handleAddGame}>
            + Add
          </Button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 flex-wrap">
          {(
            [
              { key: "all",       label: `All (${games.length})` },
              { key: "favorites", label: `★ Favourites (${favoriteCount})` },
              { key: "steam",     label: `Steam (${steamCount})` },
              { key: "manual",    label: `Manual (${games.length - steamCount})` },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setLibraryFilter(key)}
              className="text-sm font-medium px-3 py-1.5 rounded-full border transition-all"
              style={{
                borderColor:
                  libraryFilter === key
                    ? "rgba(var(--color-primary-rgb),0.7)"
                    : "rgba(255,255,255,0.1)",
                background:
                  libraryFilter === key
                    ? "rgba(var(--color-primary-rgb),0.15)"
                    : "transparent",
                color:
                  libraryFilter === key
                    ? "rgb(var(--color-primary-rgb))"
                    : "rgb(var(--text-muted-rgb))",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Games grid ── */}
      {loading ? (
        <p className="text-sm text-center py-16" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          Loading…
        </p>
      ) : displayedGames.length === 0 ? (
        <div
          className="rounded-2xl flex flex-col items-center justify-center py-16 gap-4 text-center"
          style={{ border: "1.5px dashed rgba(255,255,255,0.1)" }}
        >
          <p className="text-2xl">🎮</p>
          <div>
            <p className="font-semibold">
              {games.length === 0
                ? "Your library is empty"
                : "No games match your search"}
            </p>
            <p className="text-sm mt-1" style={{ color: "rgb(var(--text-muted-rgb))" }}>
              {games.length === 0
                ? "Import from Steam or add games manually above."
                : "Try a different search or filter."}
            </p>
          </div>
          {games.length === 0 && (
            <Button variant="primary" onClick={() => setSteamModalOpen(true)}>
              Import from Steam
            </Button>
          )}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
            gap: "14px",
          }}
        >
          {displayedGames.map((game) => {
            const gameChallenges = challenges.filter((c) => c.game === game.normalized_key);
            return (
              <GameCard
                key={game.id}
                game={game}
                challengeCount={gameChallenges.length}
                onToggleFavorite={() => toggleFavorite(game.id)}
                onRemove={() => {
                  removeGame(game.id);
                  addToast(`Removed "${game.display_name}".`, "info");
                }}
                onClick={() => setDetailGame(game)}
              />
            );
          })}
        </div>
      )}

      {/* ── Steam import modal ── */}
      <SteamImportModal
        open={steamModalOpen}
        onClose={() => setSteamModalOpen(false)}
        existingKeys={existingKeys}
        onImport={bulkImport}
      />

      {/* ── Game detail modal ── */}
      {detailGame && (
        <GameDetailModal
          game={detailGame}
          challenges={challenges.filter((c) => c.game === detailGame.normalized_key)}
          onAddChallenge={() => {
            setAddChallengeGame(detailGame);
            setDetailGame(null);
          }}
          onRemoveChallenge={removeChallenge}
          onClose={() => setDetailGame(null)}
        />
      )}

      {/* ── Add challenge modal ── */}
      {addChallengeGame && (
        <Modal open onClose={() => setAddChallengeGame(null)}>
          <AddChallengeForm
            game={addChallengeGame}
            onAdd={handleAddChallenge}
            onClose={() => setAddChallengeGame(null)}
          />
        </Modal>
      )}
    </div>
  );
}
