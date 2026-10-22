import { useEffect, useRef, useState } from "react";
import type { TlNote } from "../lib/types";

// Shared by the timeline game's search guess mode and Music Bingo's
// "song search" check mode. Moved out of GamePage.tsx unchanged apart from
// `suggestions` becoming optional.
// ── Search guess mode: pick a track instead of typing ───────────────────────
//
// One combined field. The picked track carries BOTH an artist and a title,
// which the server grades independently — so "wrong song, right artist" and
// "right song, wrong artist" each still earn their single shop coin. A
// player who only recognises the band searches the band name and picks any
// of their songs.
//
// Results deliberately show no release year: the whole game is placing the
// song on a timeline, so a year in this dropdown would hand over the answer.
// The endpoint doesn't send one — see functions/track-search.ts.
export interface TrackSearchResult {
  id:         string;
  title:      string;
  artist:     string;
  coverUrl:   string | null;
  spotifyId?: string;
}

const SEARCH_DEBOUNCE_MS = 250;

export function TrackSearchField({
  label, pick, onPick, suggestions = [], readOnly,
}: {
  label:  string;
  pick:   TrackSearchResult | null;
  onPick: (t: TrackSearchResult | null) => void;
  /** Teammate suggestions. Clicking one loads it into the search box rather
   *  than committing it — the picker is still the only way to commit, so a
   *  teammate's typo can't become the captain's answer. */
  suggestions?: TlNote[];
  readOnly?:   boolean;
}) {
  const [query,   setQuery]   = useState("");
  const [results, setResults] = useState<TrackSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open,    setOpen]    = useState(false);
  const [active,  setActive]  = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Guards against an older, slower request overwriting a newer one's
  // results — the classic typeahead race.
  const seqRef = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const seq = ++seqRef.current;
    const t = setTimeout(async () => {
      try {
        const res  = await fetch(`/track-search?q=${encodeURIComponent(q)}`, { credentials: "include" });
        const data = await res.json() as { items?: TrackSearchResult[] };
        if (seq !== seqRef.current) return;
        setResults(data.items ?? []);
        setActive(0);
      } catch {
        if (seq === seqRef.current) setResults([]);
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // Close the dropdown on outside click so it doesn't hover over the
  // timeline while the captain is choosing a gap.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function choose(t: TrackSearchResult) {
    onPick(t);
    setQuery("");
    setResults([]);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(i => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === "Enter")   { e.preventDefault(); choose(results[active]); }
    else if (e.key === "Escape")  { setOpen(false); }
  }

  const chips = suggestions.slice(-6).reverse();

  return (
    <div className="flex flex-col gap-1.5" ref={boxRef}>
      <label className="text-sm font-medium" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
        {label}
      </label>

      {chips.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: "thin", maxHeight: 72 }}>
          {chips.map((n, i) => (
            <button
              key={i}
              onClick={readOnly ? undefined : () => { setQuery(n.content); setOpen(true); }}
              disabled={readOnly}
              className="flex-shrink-0 px-2 py-1 rounded-md text-xs whitespace-nowrap"
              style={{
                background: "rgba(var(--color-secondary-rgb),0.12)",
                border:     "1px solid rgba(var(--color-secondary-rgb),0.3)",
                cursor:     readOnly ? "default" : "pointer",
              }}
              title={readOnly ? `${n.player_name} suggests` : `${n.player_name} suggests — click to search it`}
            >
              {n.content}
            </button>
          ))}
        </div>
      )}

      {/* Chosen track — replaces the input until cleared. */}
      {pick ? (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-md"
          style={{
            background: "rgba(var(--color-primary-rgb),0.12)",
            border:     "1px solid rgba(var(--color-primary-rgb),0.4)",
          }}
        >
          {pick.coverUrl && (
            <img src={pick.coverUrl} alt="" width={32} height={32} className="rounded flex-shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">{pick.title}</p>
            <p className="text-xs opacity-60 truncate">{pick.artist}</p>
          </div>
          {!readOnly && (
            <button
              onClick={() => onPick(null)}
              className="text-xs opacity-60 hover:opacity-100 px-1"
              title="Choose a different track"
            >
              ✕
            </button>
          )}
        </div>
      ) : readOnly ? (
        <p className="text-xs opacity-40 italic py-2">Waiting for the active team to pick…</p>
      ) : (
        <div className="relative">
          <input
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Search a song or artist…"
            className="w-full px-3 py-2 rounded-md text-sm"
            style={{
              background: "rgba(255,255,255,0.05)",
              border:     "1px solid rgba(255,255,255,0.15)",
              color:      "rgb(var(--text-primary-rgb))",
            }}
          />
          {open && query.trim().length >= 2 && (
            <div
              className="absolute z-30 left-0 right-0 mt-1 rounded-md overflow-y-auto"
              style={{
                maxHeight:  260,
                background: "rgb(var(--surface-raised-rgb, 30 30 34))",
                border:     "1px solid rgba(255,255,255,0.15)",
                boxShadow:  "0 8px 24px rgba(0,0,0,0.45)",
              }}
            >
              {loading && results.length === 0 && (
                <p className="text-xs opacity-50 px-3 py-2">Searching…</p>
              )}
              {!loading && results.length === 0 && (
                <p className="text-xs opacity-50 px-3 py-2">No matches — try fewer words.</p>
              )}
              {results.map((r, i) => (
                <button
                  key={r.id}
                  onClick={() => choose(r)}
                  onMouseEnter={() => setActive(i)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left"
                  style={{ background: i === active ? "rgba(var(--color-primary-rgb),0.16)" : "transparent" }}
                >
                  {r.coverUrl
                    ? <img src={r.coverUrl} alt="" width={28} height={28} className="rounded flex-shrink-0" />
                    : <div className="w-7 h-7 rounded flex-shrink-0" style={{ background: "rgba(255,255,255,0.08)" }} />}
                  <div className="min-w-0">
                    <p className="text-sm truncate">{r.title}</p>
                    <p className="text-xs opacity-60 truncate">{r.artist}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
