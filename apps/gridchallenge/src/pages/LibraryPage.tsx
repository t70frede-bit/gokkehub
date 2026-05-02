import { useState, useMemo, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Button, Modal, Toggle, useToast } from "@gokkehub/ui";
import { useSession } from "../hooks/useSession";
import { usePlayerGames } from "../hooks/usePlayerGames";
import { usePlayerChallenges } from "../hooks/usePlayerChallenges";
import { normalizeGameKey } from "../lib/gameKeys";
import type { ChallengeType, PlayerGame } from "../lib/types";

// ── Steam search result ───────────────────────────────────────────────────────

interface SteamSearchResult {
  appid: number;
  name:  string;
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
          background: "rgba(var(--color-primary-rgb), 0.18)",
          color:      "rgb(var(--color-primary-rgb))",
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
      onError={() => setStage((s) => (s === "portrait" ? "header" : "none"))}
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
      <div
        className="relative rounded-xl overflow-hidden flex-shrink-0"
        style={{ aspectRatio: "2/3" }}
      >
        <CoverImage steamAppId={game.steam_app_id} name={game.display_name} />

        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-all duration-150" />

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

        {challengeCount > 0 && (
          <div
            className="absolute bottom-1.5 left-1.5 text-xs font-bold px-1.5 py-0.5 rounded-full"
            style={{ background: "rgba(var(--color-primary-rgb),0.9)", color: "white" }}
          >
            {challengeCount}
          </div>
        )}

        {game.source === "steam" && (
          <div
            className="absolute bottom-1.5 right-1.5 text-xs font-bold px-1.5 py-0.5 rounded"
            style={{ background: "rgba(26,159,255,0.85)", color: "white" }}
          >
            Steam
          </div>
        )}
      </div>

      <p
        className="mt-1.5 text-xs font-semibold leading-tight line-clamp-2"
        style={{ color: "rgb(var(--text-primary-rgb))" }}
      >
        {game.display_name}
      </p>
    </div>
  );
}

// ── Steam search box + results ────────────────────────────────────────────────

function SteamSearchAdd({
  existingKeys,
  onAdd,
}: {
  existingKeys: Set<string>;
  onAdd:        (name: string, appid: number) => Promise<void>;
}) {
  const [query, setQuery]       = useState("");
  const [results, setResults]   = useState<SteamSearchResult[]>([]);
  const [loading, setLoading]   = useState(false);
  const [open, setOpen]         = useState(false);
  const [adding, setAdding]     = useState<number | null>(null);
  const debounceRef             = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef            = useRef<HTMLDivElement>(null);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) { setResults([]); setOpen(false); return; }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/steam/search?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as { items?: SteamSearchResult[]; error?: string };
        setResults(data.items ?? []);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 320);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function handleAdd(item: SteamSearchResult) {
    setAdding(item.appid);
    await onAdd(item.name, item.appid);
    setAdding(null);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  const alreadyOwned = (item: SteamSearchResult) =>
    existingKeys.has(normalizeGameKey(item.name));

  return (
    <div ref={containerRef} className="relative flex-1">
      <div className="relative">
        {/* Search icon */}
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          width="15" height="15" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{ color: "rgba(26,159,255,0.7)" }}
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search Steam for a game to add…"
          className="w-full pl-9 pr-4 py-3 rounded-md font-sans text-base outline-none transition-all duration-200 placeholder:opacity-60"
          style={{
            background: "rgba(var(--surface-input-rgb), 0.9)",
            border: "1px solid rgba(26,159,255,0.5)",
            color: "rgb(var(--text-primary-rgb))",
          }}
        />

        {/* Loading spinner */}
        {loading && (
          <svg
            className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin"
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5"
            style={{ color: "rgba(26,159,255,0.6)" }}
          >
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
        )}
      </div>

      {/* Dropdown */}
      {open && results.length > 0 && (
        <div
          className="absolute z-50 left-0 right-0 mt-1 rounded-xl overflow-hidden"
          style={{
            background: "rgba(var(--surface-raised-rgb), 0.98)",
            border: "1.5px solid rgba(26,159,255,0.25)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            backdropFilter: "blur(16px)",
          }}
        >
          {results.map((item) => {
            const owned = alreadyOwned(item);
            const isAdding = adding === item.appid;
            return (
              <div
                key={item.appid}
                className="flex items-center gap-3 px-3 py-2 transition-colors"
                style={{
                  cursor: owned ? "default" : "pointer",
                  background: "transparent",
                  opacity: owned ? 0.5 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!owned) e.currentTarget.style.background = "rgba(26,159,255,0.08)";
                }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                onClick={() => !owned && !isAdding && handleAdd(item)}
              >
                {/* Mini cover */}
                <div
                  className="flex-shrink-0 rounded-md overflow-hidden"
                  style={{ width: 32, height: 48 }}
                >
                  <CoverImage steamAppId={item.appid} name={item.name} />
                </div>

                <span
                  className="flex-1 text-sm font-medium truncate"
                  style={{ color: "rgb(var(--text-primary-rgb))" }}
                >
                  {item.name}
                </span>

                {owned ? (
                  <span className="text-xs flex-shrink-0" style={{ color: "rgba(34,197,94,0.7)" }}>
                    In library
                  </span>
                ) : isAdding ? (
                  <svg className="animate-spin flex-shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: "rgba(26,159,255,0.8)" }}>
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                ) : (
                  <span className="text-xs flex-shrink-0 font-semibold" style={{ color: "rgba(26,159,255,0.8)" }}>
                    + Add
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Add challenge form ────────────────────────────────────────────────────────

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

      <input
        className="input w-full"
        placeholder="e.g. Win a match without dying"
        value={text}
        onChange={(e) => { setText(e.target.value); setError(null); }}
        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        autoFocus
      />
      {error && <p className="text-sm -mt-2" style={{ color: "rgb(var(--color-danger-rgb))" }}>{error}</p>}

      <div className="flex gap-2">
        <Button variant="ghost" fullWidth onClick={onClose}>Cancel</Button>
        <Button variant="primary" fullWidth loading={loading} onClick={handleSubmit}>Add</Button>
      </div>
    </div>
  );
}

// ── Game detail modal ─────────────────────────────────────────────────────────

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
  const TYPE_ICONS: Record<string, string> = { single: "👤", group: "👥", versus: "⚔️" };

  return (
    <Modal open onClose={onClose}>
      <div className="flex flex-col gap-4" style={{ minWidth: "min(80vw, 420px)" }}>
        <div className="flex gap-4 items-start">
          <div className="rounded-xl overflow-hidden flex-shrink-0" style={{ width: 72, aspectRatio: "2/3" }}>
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

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="font-semibold text-sm">
              Challenges <span style={{ color: "rgb(var(--text-muted-rgb))" }}>({challenges.length})</span>
            </p>
            <Button size="sm" variant="ghost" onClick={onAddChallenge}>+ Add</Button>
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
  const { games, loading: gamesLoading, addGame, removeGame, toggleFavorite } =
    usePlayerGames(session);
  const { challenges, loading: challengesLoading, addChallenge, removeChallenge } =
    usePlayerChallenges(session);
  const { addToast } = useToast();

  const [search, setSearch]               = useState("");
  const [libraryFilter, setLibraryFilter] = useState<"all" | "favorites" | "steam" | "manual">("all");
  const [detailGame, setDetailGame]       = useState<PlayerGame | null>(null);
  const [addChallengeGame, setAddChallengeGame] = useState<PlayerGame | null>(null);

  const loading = sessionLoading || gamesLoading || challengesLoading;

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

  async function handleAddSteamGame(name: string, appid: number) {
    const error = await addGame(name, "steam", appid);
    if (error) {
      addToast("Failed to add game: " + error.message, "error");
    } else {
      addToast(`Added "${name}" to your library.`, "success");
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
      <div>
        <Link to="/" className="text-sm flex items-center gap-1 mb-2" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          ← Back
        </Link>
        <h1 className="font-extrabold text-2xl tracking-tight">Game Library</h1>
        <p className="text-sm mt-0.5" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          {games.length} game{games.length !== 1 ? "s" : ""} saved
          {favoriteCount > 0 && ` · ${favoriteCount} favourite${favoriteCount !== 1 ? "s" : ""}`}
        </p>
      </div>

      {/* ── Add from Steam search ── */}
      <div
        className="rounded-xl p-4 flex flex-col gap-3"
        style={{
          background: "rgba(26,159,255,0.06)",
          border: "1.5px solid rgba(26,159,255,0.2)",
        }}
      >
        <p className="text-sm font-semibold" style={{ color: "rgba(26,159,255,0.9)" }}>
          🎮 Add games from Steam
        </p>
        <SteamSearchAdd existingKeys={existingKeys} onAdd={handleAddSteamGame} />
      </div>

      {/* ── Library search + filters ── */}
      <div className="flex flex-col gap-3">
        <input
          type="text"
          placeholder="Search your library…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-4 py-3 rounded-md font-sans text-base outline-none transition-all duration-200 placeholder:opacity-60"
          style={{
            background: "rgba(var(--surface-input-rgb), 0.9)",
            border: "1px solid rgba(var(--color-primary-rgb), 0.7)",
            color: "rgb(var(--text-primary-rgb))",
          }}
        />

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
                borderColor: libraryFilter === key ? "rgba(var(--color-primary-rgb),0.7)" : "rgba(255,255,255,0.1)",
                background:  libraryFilter === key ? "rgba(var(--color-primary-rgb),0.15)" : "transparent",
                color:       libraryFilter === key ? "rgb(var(--color-primary-rgb))" : "rgb(var(--text-muted-rgb))",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Games grid ── */}
      {loading ? (
        <p className="text-sm text-center py-16" style={{ color: "rgb(var(--text-muted-rgb))" }}>Loading…</p>
      ) : displayedGames.length === 0 ? (
        <div
          className="rounded-2xl flex flex-col items-center justify-center py-16 gap-4 text-center"
          style={{ border: "1.5px dashed rgba(255,255,255,0.1)" }}
        >
          <p className="text-2xl">🎮</p>
          <div>
            <p className="font-semibold">
              {games.length === 0 ? "Your library is empty" : "No games match your search"}
            </p>
            <p className="text-sm mt-1" style={{ color: "rgb(var(--text-muted-rgb))" }}>
              {games.length === 0
                ? "Search for a game above to add it to your library."
                : "Try a different search term or filter."}
            </p>
          </div>
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
                onRemove={() => { removeGame(game.id); addToast(`Removed "${game.display_name}".`, "info"); }}
                onClick={() => setDetailGame(game)}
              />
            );
          })}
        </div>
      )}

      {/* ── Game detail modal ── */}
      {detailGame && (
        <GameDetailModal
          game={detailGame}
          challenges={challenges.filter((c) => c.game === detailGame.normalized_key)}
          onAddChallenge={() => { setAddChallengeGame(detailGame); setDetailGame(null); }}
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
