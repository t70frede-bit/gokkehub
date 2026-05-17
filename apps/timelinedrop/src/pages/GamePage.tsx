import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Modal, Panel } from "@gokkehub/ui";
import { useRoom } from "../hooks/useRoom";
import { useDJAudio, useListenerAudio } from "../hooks/useAudio";
import { useDJWebRTC, useListenerWebRTC } from "../hooks/useWebRTC";
import { supabase } from "../lib/supabase";
import type { TlTimelineEntry, SpotifyTrack, TlRound, TlPlayer, TlNote, JudgeMode, TlTeamToken } from "../lib/types";
import { DEFAULT_TL_SETTINGS, TIMER_DEFAULT_FALLBACK_SECONDS, SHOP_TOKEN_COSTS, STREAM_PROXY_URL } from "../lib/types";
import { TOKEN_CATALOG, CATEGORY_META, type TokenType, type TokenSpec, type TokenCategory } from "../lib/tokens";

function tokenSpec(type: string): TokenSpec {
  return TOKEN_CATALOG[type as TokenType] ?? {
    type: type as TokenType,
    category: "anytime",
    name:  type,
    short: type,
    description: "",
    icon: "🎟",
    implemented: false,
  };
}

// Team colour mapping by sort_order — matches LobbyPage.
type TeamColor = "red" | "blue" | "green" | "yellow";
const TEAM_PALETTE: TeamColor[] = ["red", "blue", "green", "yellow"];
function getTeamColor(sortOrder: number): TeamColor {
  return TEAM_PALETTE[sortOrder % TEAM_PALETTE.length];
}

// ── Timer ─────────────────────────────────────────────────────────────────────

// Pause-aware countdown. `totalSec === null` means "no timer" (used by the
// "none" mode); the hook returns null and never fires onExpire.
//
// Elapsed time is computed against playing_since / paused_at_ms so the timer
// matches the actual audio position — pauses freeze the countdown, resumes
// pick up where they left off. Bot mode and Spotify SDK both write these
// fields the same way (see onDJStateChange + bot's playRoundTrack).
function useTimer(
  totalSec:     number | null,
  playingSince: number | null,
  pausedAtMs:   number | null,
  onExpire:     () => void,
): number | null {
  const initial = totalSec ?? 0;
  const [remaining, setRemaining] = useState<number | null>(totalSec);
  const expiredRef = useRef(false);

  useEffect(() => {
    if (totalSec === null) { setRemaining(null); expiredRef.current = false; return; }
    if (playingSince === null && pausedAtMs === null) {
      setRemaining(totalSec); expiredRef.current = false; return;
    }
    expiredRef.current = false;
    const computeLeft = () => {
      const elapsed = playingSince !== null
        ? (Date.now() - playingSince) / 1000
        : (pausedAtMs ?? 0) / 1000;
      return Math.max(0, totalSec - elapsed);
    };
    const tick = () => {
      const left = computeLeft();
      setRemaining(left);
      if (left === 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpire();
      }
    };
    tick();
    // Only animate while playing; when paused, the value is frozen, no
    // interval needed.
    if (playingSince === null) return;
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [totalSec, playingSince, pausedAtMs, onExpire]);

  // Avoid an unused-var lint complaint on the SSR-default branch.
  void initial;
  return remaining;
}

// ── Timer ring SVG ────────────────────────────────────────────────────────────

// `remaining === null` means "no timer" (mode = "none"); render nothing.
// Otherwise show a shrinking ring. Below 20s we cross-fade to a danger
// state; below 10s the whole ring blinks faster to grab the captain's
// attention as the deadline approaches.
function TimerRing({ remaining, total }: { remaining: number | null; total: number }) {
  if (remaining === null) return null;
  const R = 18;
  const C = 2 * Math.PI * R;
  const dash = Math.min(1, total > 0 ? remaining / total : 0) * C;
  const danger    = remaining < 20;
  const critical  = remaining < 10;
  const blinkClass = critical ? "timer-blink-fast" : danger ? "timer-blink-slow" : "";

  return (
    <svg width="46" height="46" viewBox="0 0 46 46" className={blinkClass} style={{ flexShrink: 0 }}>
      <circle cx="23" cy="23" r={R} className="timer-ring-track" strokeWidth="2.5" />
      <circle cx="23" cy="23" r={R}
        className={`timer-ring-fill ${danger ? "danger" : ""}`}
        strokeWidth="2.5"
        style={{
          strokeDasharray: C,
          strokeDashoffset: C - dash,
          transform: "rotate(-90deg)",
          transformOrigin: "23px 23px",
        }}
      />
      <text x="23" y="27.5" textAnchor="middle"
        style={{ fontSize: "11px", fontWeight: 700, fill: danger ? "rgb(220,60,60)" : "rgb(var(--color-secondary-rgb))", fontFamily: "var(--font-mono)" }}>
        {Math.ceil(remaining)}
      </text>
    </svg>
  );
}

// ── Timeline component ────────────────────────────────────────────────────────

interface TimelinePing { id: number; year: number; player_name: string; player_id: string }

interface TimelineProps {
  entries:        TlTimelineEntry[];
  dragCard:       SpotifyTrack | null;
  coverRevealed?: boolean;       // cover_reveal token effect
  isCaptain:      boolean;
  isActive:       boolean;       // is this the active team's timeline?
  myPlayerId?:    string;
  stagedLeft:     number | null;
  stagedRight:    number | null;
  onStageGap:     (gapIdx: number | null, leftYear: number | null, rightYear: number | null) => void;
  onPingYear?:    (year: number) => void;
  onCardClick?:   (entry: TlTimelineEntry) => void;  // more-or-less etc
  cardClickHint?: string;
  pings?:         TimelinePing[];
  pending?:       SpotifyTrack[];
}

interface MergedItem {
  year:   number;
  track:  SpotifyTrack;
  locked: boolean;
}

function Timeline({
  entries, dragCard, coverRevealed, isCaptain, isActive, myPlayerId,
  stagedLeft, stagedRight, onStageGap, onPingYear,
  onCardClick, cardClickHint, pings = [], pending = [],
}: TimelineProps) {
  // Cards scale up when the rail is sparse and shrink as it fills. Counts
  // include the captain's mystery placeholder so the rest doesn't reflow when
  // they stage.
  const cardCount = entries.length + pending.length + (dragCard ? 1 : 0);
  const cardWidth =
    cardCount <= 3 ? 144 :
    cardCount <= 5 ? 124 :
    cardCount <= 7 ? 108 :
    cardCount <= 9 ? 96  :
    cardCount <= 12 ? 84 : 72;
  const [dragOver, setDragOver] = useState<number | null>(null);

  // Merge locked + pending into a single ordered list — pending cards form gaps too.
  const merged: MergedItem[] = [
    ...entries.map(e => ({ year: e.year, track: e.track, locked: true })),
    ...pending.map(p => ({ year: p.releaseYear, track: p, locked: false })),
  ].sort((a, b) => a.year - b.year);

  const gaps = merged.length + 1;

  function getYearsForGap(gapIdx: number): [number | null, number | null] {
    return [merged[gapIdx - 1]?.year ?? null, merged[gapIdx]?.year ?? null];
  }

  // Derive staged gap idx from the synced staged years (matches the gap whose boundaries align).
  let stagedGap: number | null = null;
  if (stagedLeft !== null || stagedRight !== null) {
    for (let i = 0; i < gaps; i++) {
      const [l, r] = getYearsForGap(i);
      if (l === stagedLeft && r === stagedRight) { stagedGap = i; break; }
    }
  }

  // Compute proportional gap weights (year span between siblings) for visual spacing.
  // Bookend gaps (before first / after last) always have at least a small drop zone.
  const minYear = merged.length ? merged[0].year : 1980;
  const maxYear = merged.length ? merged[merged.length - 1].year : 1980;
  const totalSpan = Math.max(1, maxYear - minYear);
  // 12% of the span (or 5y minimum) is reserved for each bookend gap.
  const bookendSpan = Math.max(5, Math.round(totalSpan * 0.12));

  function gapWeight(idx: number): number {
    if (merged.length === 0) return 1;
    if (idx === 0)               return bookendSpan;
    if (idx === merged.length)   return bookendSpan;
    return Math.max(1, merged[idx].year - merged[idx - 1].year);
  }

  function stageGap(gapIdx: number) {
    if (stagedGap === gapIdx) {
      // Toggle off
      onStageGap(null, null, null);
    } else {
      const [left, right] = getYearsForGap(gapIdx);
      onStageGap(gapIdx, left, right);
    }
  }

  function pingGap(gapIdx: number) {
    if (!onPingYear) return;
    const [l, r] = getYearsForGap(gapIdx);
    let year: number;
    // Use the raw midpoint (not rounded) so 1-year-wide gaps get .5 fractions
    // and don't collide with adjacent card years (which are always integers).
    if (l !== null && r !== null) year = (l + r) / 2;
    else if (l !== null) year = l + 5;
    else if (r !== null) year = r - 5;
    else year = new Date().getFullYear() - 25;
    onPingYear(year);
  }

  return (
    <div>
      {/* Timeline rail */}
      <div className="timeline-rail">

        {/* The mystery card is intentionally NOT shown alongside the rail.
            It only appears when the captain stages it into a specific gap. */}

        {Array.from({ length: gaps }).map((_, gapIdx) => {
          const item        = merged[gapIdx];
          const isOver      = dragOver === gapIdx;
          const isStaged    = stagedGap === gapIdx;
          // The gap area renders the mystery card UI when active+round, regardless of role.
          const hasCard     = !!dragCard && isActive;
          const weight      = gapWeight(gapIdx);

          // Same-year adjacent cards don't get a gap between them — they sit flush.
          const isSameYearGap =
            gapIdx > 0 && gapIdx < merged.length
            && merged[gapIdx - 1].year === merged[gapIdx].year;

          // Pings strictly inside this gap's year range — pings exactly on a
          // card's year belong to the card, not the gap, so we use exclusive
          // boundaries here to avoid the same ping rendering in 3 places.
          const [gapL, gapR] = getYearsForGap(gapIdx);
          const gapPings = pings.filter(p => {
            if (gapL !== null && p.year <= gapL) return false;
            if (gapR !== null && p.year >= gapR) return false;
            return true;
          });

          // Click handler depends on role:
          // - captain: stage this gap
          // - non-captain on active team: ping into this gap's year range
          // - else: nothing
          const handleClick = () => {
            if (isCaptain) stageGap(gapIdx);
            else if (onPingYear && isActive) pingGap(gapIdx);
          };

          return (
            <Fragment key={gapIdx}>
              {!isSameYearGap && (hasCard ? (
                <div
                  className={`tl-gap tl-gap-interactive ${isOver ? "dropping" : ""} ${isStaged ? "active" : ""}`}
                  style={{
                    flexGrow:   weight,
                    flexShrink: 1,
                    flexBasis:  0,
                    minWidth:   "2.5rem",
                    width:      "auto",
                    cursor:     (isCaptain || (onPingYear && isActive)) ? "pointer" : "default",
                    position:   "relative",
                  }}
                  onDragOver={isCaptain ? (e => { e.preventDefault(); setDragOver(gapIdx); }) : undefined}
                  onDragLeave={isCaptain ? (() => setDragOver(null)) : undefined}
                  onDrop={isCaptain ? (() => { setDragOver(null); stageGap(gapIdx); }) : undefined}
                  onClick={handleClick}
                  title={
                    isStaged
                      ? (isCaptain ? "Selected — click again to clear" : "Captain is considering this spot")
                      : isCaptain
                        ? "Click to place"
                        : (isActive ? "Click to suggest · click again to remove" : "")
                  }
                >
                  {isStaged && dragCard ? (
                    <div onClick={e => isCaptain && e.stopPropagation()} className="px-1">
                      <QuestionCard track={dragCard} coverRevealed={coverRevealed} width={cardWidth} />
                    </div>
                  ) : isOver ? (
                    <span style={{ color: "rgb(var(--color-primary-rgb))", fontSize: 16 }}>↓</span>
                  ) : (
                    <span className="tl-gap-dot" />
                  )}
                  {/* Bubbles render regardless of staged/over state so the
                      captain can see suggestions even while staging. */}
                  {gapPings.length > 0 && (
                    <PingBubbles
                      pings={gapPings}
                      myPlayerId={myPlayerId}
                    />
                  )}
                </div>
              ) : (
                <div className="tl-gap"
                  style={{
                    flexGrow:   weight,
                    flexShrink: 1,
                    flexBasis:  0,
                    minWidth:   "1.5rem",
                    width:      "auto",
                    cursor:     onPingYear ? "pointer" : "default",
                    position:   "relative",
                  }}
                  onClick={() => pingGap(gapIdx)}
                  title={onPingYear ? "Click to pin · click again to remove" : ""}
                >
                  <span className="tl-gap-dot" />
                  {gapPings.length > 0 && (
                    <PingBubbles
                      pings={gapPings}
                      myPlayerId={myPlayerId}
                    />
                  )}
                </div>
              ))}

              {/* Existing card (locked or pending) — clickable to ping the same
                  year (handy when the year is already filled). */}
              {item && (() => {
                const cardPings = pings.filter(p => p.year === item.year);
                const canCardPing = !!onPingYear && isActive && !isCaptain;
                const lockedEntry = item.locked ? entries.find(e => e.track_id === item.track.id) : null;
                // Allow card selection (Before/After token picker) on BOTH
                // locked AND pending cards. Spec: any card on the captain's
                // timeline except the one currently being placed (which
                // isn't in entries or pending yet — it lives on round.track).
                const canCardSelect = !!onCardClick;
                const cardClickable = canCardSelect || canCardPing;

                // Pending cards aren't in the tl_timeline table yet, so build
                // a synthetic TlTimelineEntry for the onCardClick callback.
                // Consumers only read track_id from the entry.
                const syntheticEntry: TlTimelineEntry = lockedEntry ?? {
                  team_id:        -1,
                  track_id:       item.track.id,
                  year:           item.year,
                  position:       0,
                  track:          item.track,
                  corrected_year: null,
                };
                const handleCardClick = () => {
                  if (canCardSelect && onCardClick) { onCardClick(syntheticEntry); return; }
                  if (canCardPing && onPingYear) onPingYear(item.year);
                };

                return (
                  <div
                    className="flex-shrink-0 relative"
                    onClick={cardClickable ? handleCardClick : undefined}
                    style={{
                      cursor:   cardClickable ? "pointer" : "default",
                      position: "relative",
                      outline:  canCardSelect ? "2px solid rgba(var(--color-primary-rgb), 0.7)" : undefined,
                      borderRadius: canCardSelect ? 8 : undefined,
                    }}
                    title={
                      canCardSelect ? (cardClickHint ?? "Click to pick this card")
                      : canCardPing  ? "Click to suggest this year · click again to remove"
                      : ""
                    }
                  >
                    {item.locked ? (
                      <TrackCard year={item.year} track={item.track} width={cardWidth} />
                    ) : (
                      <PendingCard year={item.year} track={item.track} width={cardWidth} />
                    )}
                    {cardPings.length > 0 && (
                      <PingBubbles
                        pings={cardPings}
                        myPlayerId={myPlayerId}
                      />
                    )}
                  </div>
                );
              })()}
            </Fragment>
          );
        })}

      </div>
    </div>
  );
}

// ── TokenStrip ─────────────────────────────────────────────────────────────
// Visual stack of typed-token icons for one team. Spotlight = larger, clickable
// when it's your team & you're the captain (opens the tray). Compact = small.
function TokenStrip({
  tokens, color, compact, onClick,
}: {
  tokens:   TlTeamToken[];
  color:    TeamColor | "spectator";
  compact?: boolean;
  onClick?: () => void;
}) {
  const ready   = tokens.filter(t => !t.pending);
  const pending = tokens.filter(t => t.pending);
  const sizePx  = compact ? 22 : 30;
  const titleSize = compact ? 12 : 16;

  if (ready.length === 0 && pending.length === 0) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        className="rounded-md transition-all disabled:cursor-default"
        style={{
          padding: compact ? "2px 8px" : "6px 10px",
          background: "transparent",
          border: `1px dashed rgba(var(--team-${color}-rgb), 0.35)`,
          color: "rgb(var(--text-muted-rgb))",
          fontSize: compact ? "var(--text-xs)" : "var(--text-sm)",
          letterSpacing: "0.05em",
          cursor: onClick ? "pointer" : "default",
        }}
        title="No tokens yet"
      >
        No tokens
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="flex items-center rounded-md transition-all disabled:cursor-default"
      style={{
        padding: compact ? "2px 6px" : "4px 8px",
        gap: compact ? 3 : 4,
        background: `rgba(var(--team-${color}-rgb), 0.08)`,
        border: `1px solid rgba(var(--team-${color}-rgb), 0.32)`,
        cursor: onClick ? "pointer" : "default",
      }}
      title={onClick ? "Spend a token" : "Tokens"}
    >
      {ready.map(t => (
        <span
          key={t.id}
          className="inline-flex items-center justify-center rounded-full"
          style={{
            width: sizePx,
            height: sizePx,
            fontSize: titleSize,
            background: `rgba(var(--team-${color}-rgb), 0.85)`,
            border: `1px solid rgba(var(--team-${color}-rgb), 1)`,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18)",
          }}
          title={tokenSpec(t.type).name}
        >
          {tokenSpec(t.type).icon}
        </span>
      ))}
      {pending.map(t => (
        <span
          key={t.id}
          className="inline-flex items-center justify-center rounded-full"
          style={{
            width: sizePx,
            height: sizePx,
            fontSize: titleSize,
            background: "transparent",
            border: `1px dashed rgba(var(--team-${color}-rgb), 0.55)`,
            color: "rgb(var(--text-muted-rgb))",
            opacity: 0.7,
          }}
          title={`${tokenSpec(t.type).name} (pending — ready next turn)`}
        >
          {tokenSpec(t.type).icon}
        </span>
      ))}
    </button>
  );
}

// Avatar row at the bottom of each team panel. Recent chat messages (last 12s)
// appear as speech bubbles directly above each player's avatar.
interface FooterNote { id: number; player_id: string; content: string; createdMs: number }

function PlayerFooter({
  players, notes, color, myPlayerId, nowMs, onMakeCaptain, isHost,
  bare = false, compact = false,
}: {
  players:        TlPlayer[];
  notes:          FooterNote[];
  color:          TeamColor | "spectator";
  myPlayerId:     string | undefined;
  nowMs:          number;
  onMakeCaptain?: (p: TlPlayer) => void;
  isHost?:        boolean;
  /** Drop the dashed top border + outer padding. Use when the parent
   *  already provides them. */
  bare?:          boolean;
  /** Smaller avatars + no name labels (for the minimised opponent header). */
  compact?:       boolean;
}) {
  if (players.length === 0) return null;
  const avatarSize = compact ? 28 : 40;
  const tileWidth  = compact ? 36 : 56;
  return (
    <div
      className={`flex flex-wrap items-end ${compact ? "gap-1.5" : "gap-2 sm:gap-3"}`}
      style={bare ? undefined : {
        paddingTop: 8,
        marginTop:  4,
        borderTop:  `1px dashed rgba(var(--team-${color}-rgb), 0.18)`,
      }}
    >
      {players.map(p => {
        const mine = notes.filter(n => n.player_id === p.id && (nowMs - n.createdMs) < 12000).slice(-3);
        const isMe = p.id === myPlayerId;
        return (
          <div key={p.id} className="relative flex flex-col items-center min-w-0" style={{ width: tileWidth }}>
            {/* Speech bubbles stacked above the avatar — centred over the head */}
            {mine.length > 0 && (
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 flex flex-col gap-1.5 items-center pointer-events-none"
                style={{ width: 220 }}>
                {mine.map(n => {
                  const age = nowMs - n.createdMs;
                  const fade = age < 8000 ? 1 : Math.max(0, 1 - (age - 8000) / 4000);
                  return (
                    <div key={n.id}
                      className="text-sm font-semibold px-3 py-2 rounded-2xl whitespace-pre-wrap break-words text-center"
                      style={{
                        background: `rgba(var(--team-${color}-rgb), 0.92)`,
                        color:      "#fff",
                        boxShadow:  "0 2px 10px rgba(0,0,0,0.45)",
                        opacity:    fade,
                        maxWidth:   220,
                        lineHeight: 1.25,
                      }}
                    >
                      {n.content}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Avatar */}
            <button
              onClick={onMakeCaptain && isHost ? () => onMakeCaptain(p) : undefined}
              disabled={!onMakeCaptain || !isHost}
              title={isHost ? (p.is_captain ? "Click to remove captain" : "Make captain") : p.name}
              className="relative rounded-full flex items-center justify-center font-extrabold disabled:cursor-default"
              style={{
                width:      avatarSize,
                height:     avatarSize,
                fontSize:   compact ? 11 : 14,
                background: `rgba(var(--team-${color}-rgb), 0.55)`,
                color:      "#fff",
                border:     `2px solid rgba(var(--team-${color}-rgb), 0.85)`,
                cursor:     (onMakeCaptain && isHost) ? "pointer" : "default",
              }}
            >
              {(p.name.trim()[0] ?? "?").toUpperCase()}
              {p.is_captain && (
                <span className="absolute -top-1 -right-1"
                  style={{
                    background: "linear-gradient(135deg, #facc15, #b45309)",
                    width:      compact ? 13 : 18,
                    height:     compact ? 13 : 18,
                    fontSize:   compact ? 8  : 10,
                    borderRadius: "50%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    boxShadow: "0 0 6px rgba(250,204,21,0.55)",
                  }}>
                  👑
                </span>
              )}
            </button>
            {/* Name (hidden in compact) */}
            {!compact && (
              <span className="text-[10px] mt-0.5 truncate max-w-full"
                style={{ color: isMe ? "#fff" : "rgb(var(--text-muted-rgb))" }}>
                {p.name.split(" ")[0]}{isMe && " (you)"}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Persistent ping bubbles stacked above a gap or card. Styled to feel like
// physical push-pins: layered shadow gives elevation, subtle inner highlight,
// ── SuggestionField ───────────────────────────────────────────────────────
// Input + scrollable chip rail of teammate suggestions.
// - Duplicates collapse into one chip ("×3 Drake") and float to the top.
// - Click-to-fill is only enabled for the captain (onPick provided).
// - Read-only mode hides the input entirely (used for non-active viewers).
function SuggestionField({
  label, placeholder, value, onChange, suggestions, onPick, readOnly,
}: {
  label:       string;
  placeholder: string;
  value?:      string;
  onChange?:   (v: string) => void;
  suggestions: TlNote[];
  /** Captain-only. When undefined, chips are visible but not clickable. */
  onPick?:     (v: string) => void;
  /** Read-only mode — no input shown, chips only. */
  readOnly?:   boolean;
}) {
  // Group duplicates by case-insensitive content. Count suggestions and
  // remember which players suggested each value + the freshest timestamp
  // for tie-breaking.
  interface Group {
    content:    string;       // canonical casing (first occurrence)
    count:      number;
    players:    Set<string>;
    mostRecent: number;       // ms epoch
  }
  const grouped = new Map<string, Group>();
  for (const n of suggestions) {
    const key = n.content.trim().toLowerCase();
    if (!key) continue;
    const ts = Date.parse(n.created_at);
    const g  = grouped.get(key);
    if (g) {
      g.count++;
      g.players.add(n.player_name);
      if (!Number.isNaN(ts)) g.mostRecent = Math.max(g.mostRecent, ts);
    } else {
      grouped.set(key, {
        content:    n.content.trim(),
        count:      1,
        players:    new Set([n.player_name]),
        mostRecent: Number.isNaN(ts) ? 0 : ts,
      });
    }
  }
  // Sort: count desc, then mostRecent desc.
  const chips = [...grouped.values()].sort((a, b) =>
    b.count - a.count || b.mostRecent - a.mostRecent
  );

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium" style={{ color: "rgb(var(--text-secondary-rgb))" }}>
        {label}
      </label>

      {chips.length > 0 && (
        <div
          className="flex gap-1.5 overflow-x-auto pb-1"
          style={{ scrollbarWidth: "thin", maxHeight: 72 }}
        >
          {chips.map((g, i) => {
            const playerList = [...g.players].join(", ");
            const clickable  = !!onPick;
            return (
              <button
                key={i}
                type="button"
                onClick={clickable ? () => onPick!(g.content) : undefined}
                disabled={!clickable}
                title={`${g.count > 1 ? `${g.count}× — ` : ""}suggested by ${playerList}`}
                className="flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold transition-all disabled:cursor-default"
                style={{
                  background: clickable
                    ? "rgba(var(--color-primary-rgb), 0.18)"
                    : "rgba(var(--color-primary-rgb), 0.08)",
                  border:     `1px solid rgba(var(--color-primary-rgb), ${clickable ? 0.45 : 0.25})`,
                  color:      "rgb(var(--color-primary-rgb))",
                  cursor:     clickable ? "pointer" : "default",
                }}
              >
                {g.count > 1 && (
                  <span className="font-mono mr-1" style={{ opacity: 0.85 }}>
                    ×{g.count}
                  </span>
                )}
                <span>{g.content}</span>
                <span className="ml-1 opacity-55 font-normal">
                  · {[...g.players].slice(0, 2).map(p => p.split(" ")[0]).join(", ")}
                  {g.players.size > 2 && "…"}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {chips.length === 0 && readOnly && (
        <p className="text-xs italic" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          No suggestions yet.
        </p>
      )}

      {!readOnly && (
        <input
          value={value ?? ""}
          onChange={e => onChange?.(e.target.value)}
          placeholder={placeholder}
          maxLength={120}
          className="rounded-md px-3 py-2 text-sm outline-none"
          style={{
            background: "rgb(var(--surface-input-rgb))",
            border:     "1px solid rgb(var(--border-rgb))",
            color:      "inherit",
          }}
        />
      )}
    </div>
  );
}

// and a small triangular tail points down at the slot. The bubbles are
// pointer-events-none — players toggle their own pings by tapping the same
// slot a second time, not by clicking the bubble.
function PingBubbles({
  pings, myPlayerId,
}: {
  pings:        TimelinePing[];
  myPlayerId?:  string;
}) {
  const visible = pings.slice(-4);
  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 pointer-events-none"
      style={{
        // Anchor the BOTTOM of the column just above the slot so additional
        // bubbles stack upward (away from the card) instead of growing down
        // over it. zIndex keeps them above neighbouring cards.
        bottom: "calc(100% + 6px)",
        zIndex: 20,
      }}
    >
      {visible.map((p, idx) => {
        const isMine   = !!myPlayerId && p.player_id === myPlayerId;
        const isLast   = idx === visible.length - 1;
        const colorVar = isMine ? "--color-primary-rgb" : "--color-secondary-rgb";

        return (
          <div key={p.id} className="relative">
            <div
              className="text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap"
              style={{
                background: `linear-gradient(180deg, rgba(var(${colorVar}), 1) 0%, rgba(var(${colorVar}), 0.78) 100%)`,
                color:      "#fff",
                boxShadow: [
                  "0 1px 0 rgba(255,255,255,0.18) inset",
                  "0 1px 1px rgba(0,0,0,0.35)",
                  "0 6px 14px rgba(0,0,0,0.38)",
                ].join(", "),
                border:     `1px solid rgba(var(${colorVar}), 0.55)`,
                textShadow: "0 1px 1px rgba(0,0,0,0.35)",
              }}
              title={isMine ? `Your ping · tap the slot again to remove` : p.player_name}
            >
              📍 {p.player_name.split(" ")[0]}
            </div>

            {/* Tail — only on the bottom-most bubble so the stack points at one place */}
            {isLast && (
              <div
                className="absolute left-1/2 -translate-x-1/2"
                style={{
                  top:    "100%",
                  width:  0,
                  height: 0,
                  borderLeft:  "5px solid transparent",
                  borderRight: "5px solid transparent",
                  borderTop:   `5px solid rgba(var(${colorVar}), 0.85)`,
                  filter:      "drop-shadow(0 1px 1px rgba(0,0,0,0.35))",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function TrackCard({ year, track, width = 88 }: { year: number; track: SpotifyTrack; width?: number }) {
  return (
    <div className="flex flex-col items-center select-none" style={{ width }}>
      <p className="font-black mb-1.5 px-1.5 rounded whitespace-nowrap"
        style={{
          fontSize: "0.8rem",
          color:      "#fff",
          background: "rgba(var(--color-primary-rgb), 0.85)",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.5px",
        }}>
        {year}
      </p>
      <div className="track-card">
        <img src={track.coverUrl} alt="" draggable={false}
          className="w-full aspect-square object-cover pointer-events-none" />
      </div>
      <div className="mt-1 w-full text-center">
        <p className="text-xs font-semibold truncate" title={track.name}>{track.name}</p>
        <p className="text-[11px] truncate" style={{ color: "rgb(var(--text-muted-rgb))" }} title={track.artist}>
          {track.artist}
        </p>
      </div>
    </div>
  );
}

function PendingCard({ year, track, width = 88 }: { year: number; track: SpotifyTrack; width?: number }) {
  return (
    <div className="pending-card-wrap flex-shrink-0 flex flex-col items-center select-none" style={{ width }}>
      <p className="font-black mb-1.5 px-1.5 rounded whitespace-nowrap"
        style={{
          fontSize:   "0.8rem",
          color:      "#fff",
          background: "rgba(var(--color-secondary-rgb), 0.85)",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.5px",
        }}>
        {year}
      </p>
      <div className="track-card"
        style={{
          borderStyle: "dashed",
          borderWidth: "1.5px",
          borderColor: "rgba(var(--color-secondary-rgb), 0.5)",
          opacity: 0.85,
        }}>
        <img src={track.coverUrl} alt="" draggable={false}
          className="w-full aspect-square object-cover pointer-events-none"
          style={{ opacity: 0.6 }} />
      </div>
      <div className="mt-1 w-full text-center">
        <p className="text-xs font-semibold truncate opacity-80" title={track.name}>{track.name}</p>
        <p className="text-[10px] uppercase tracking-wider opacity-50">pending · {track.artist}</p>
      </div>
    </div>
  );
}

function QuestionCard({ track, coverRevealed, width }: { track: SpotifyTrack; coverRevealed?: boolean; width?: number }) {
  return (
    <div className="question-card select-none" style={width ? { width } : undefined}>
      {coverRevealed && track.coverUrl ? (
        <img
          src={track.coverUrl}
          alt=""
          draggable={false}
          className="w-full aspect-square object-cover pointer-events-none"
        />
      ) : (
        <div className="w-full aspect-square flex items-center justify-center pointer-events-none"
          style={{ background: "rgba(255,255,255,0.04)" }}>
          <span className="text-2xl">🎵</span>
        </div>
      )}
      <div className="p-1.5">
        <p className="text-sm font-black" style={{ color: "rgb(var(--color-primary-rgb))", fontFamily: "var(--font-mono)" }}>???</p>
        <p className="text-xs opacity-30">{coverRevealed ? "Cover revealed" : "Place your guess"}</p>
      </div>
    </div>
  );
}

// ── Audio Player ──────────────────────────────────────────────────────────────

interface AudioPlayerProps {
  isDJ:         boolean;
  isMyTurn:     boolean;
  trackUri:     string | null;
  playingSince: number | null;
  pausedAtMs:   number | null;
  djPlaying:    boolean;        // local SDK state — used for immediate DJ button feedback
  onPlay:       (uri: string) => void;
  onPause:      () => void;
  onSeek:       (ms: number) => void;
  volume:       number;
  onVolume:     (v: number) => void;
  durationMs:   number;
  positionMs:   number;
  djReady:      boolean;
  listenerConnected: boolean;
  /** When the active team has spent a Cover Reveal token, the bar swaps the
   *  music-note placeholder for the actual album art. */
  coverUrl?:    string | null;
  coverRevealed?: boolean;
}

// ── All-clients-stream audio (each browser plays its own <audio>) ─────────
// Used when settings.audioMode === "all-clients-stream". Pulls audio from
// the shared musix-bot HTTP proxy (STREAM_PROXY_URL constant). The bot
// resolves the Spotify track to a YouTube video and serves yt-dlp bytes.
//
// Sync mode (default): host's play/pause writes room.playing_since;
// clients hard-pause/play their <audio> in response. Initial seek
// catches late joiners up to current position.
//
// Independent mode: each player gets full controls and scrubs on their
// own; room.playing_since is ignored.
function AllClientsAudio({
  track, playingSince, syncMode, isHost, onHostTogglePlayback,
}: {
  track:                SpotifyTrack;
  playingSince:         number | null;
  syncMode:             "synchronized" | "independent";
  isHost:               boolean;
  onHostTogglePlayback: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastTrackRef = useRef<string | null>(null);
  // Surface the most common failure mode (bot 401 from leftover
  // STREAM_TOKEN) so the host can see what to fix instead of "nothing
  // is happening." Cleared when a new track starts loading.
  const [loadError, setLoadError] = useState<string | null>(null);

  // (Re)load audio when the track changes. Initial seek lets a late
  // joiner pick up mid-song. Only depends on track.id so transient
  // pause/resume doesn't re-fetch the whole stream.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (lastTrackRef.current === track.id) return;
    lastTrackRef.current = track.id;
    const params = new URLSearchParams({
      spotify_id: track.id,
      name:       track.name,
      artist:     track.artist,
    });
    if (syncMode === "synchronized" && playingSince) {
      const elapsedSec = Math.floor((Date.now() - playingSince) / 1000);
      if (elapsedSec > 1) params.set("seek", String(elapsedSec));
    }
    const src = `${STREAM_PROXY_URL.replace(/\/$/, "")}/stream-track?${params}`;
    el.src = src;
    el.load();
    setLoadError(null);
    if (syncMode === "synchronized" && playingSince !== null) {
      el.play().catch(() => { /* autoplay denied — user clicks the play control */ });
    }
    // Probe the URL with a HEAD request so we can show a specific
    // message on 401/404 instead of waiting for the <audio> error event
    // (which doesn't tell you why). Best-effort — network errors fall
    // back to a generic message.
    void fetch(src, { method: "HEAD" })
      .then(r => {
        if (r.ok) return;
        if (r.status === 401) {
          setLoadError("Audio proxy rejected the request (401). The bot's STREAM_TOKEN env is still set — operator needs to unset it and redeploy.");
        } else if (r.status === 404) {
          setLoadError("Audio proxy couldn't resolve this track on YouTube.");
        } else {
          setLoadError(`Audio proxy returned HTTP ${r.status}.`);
        }
      })
      .catch(() => {
        setLoadError(`Couldn't reach the audio proxy at ${STREAM_PROXY_URL}. Check it's online.`);
      });
  }, [track.id, track.name, track.artist, syncMode, playingSince]);

  // Sync mode: react to host's play/pause via playing_since transitions.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || syncMode !== "synchronized") return;
    if (playingSince !== null) {
      el.play().catch(() => { /* autoplay denied or already playing */ });
    } else {
      el.pause();
    }
  }, [playingSince, syncMode]);

  return (
    <div className="flex-shrink-0 flex flex-col gap-1.5">
    {loadError && (
      <div className="rounded-md p-2 text-xs"
        style={{
          background: "rgba(220,60,60,0.10)",
          border:     "1px solid rgba(220,60,60,0.40)",
          color:      "rgb(220,140,140)",
        }}>
        ⚠ {loadError}
      </div>
    )}
    <div className="rounded-md p-2 flex items-center gap-2"
      style={{ background: "rgb(var(--surface-raised-rgb))", border: "1px solid rgb(var(--border-rgb))" }}>
      {/* Host gets a play/pause toggle that writes to room.playing_since;
          in synced mode that's how every other player's audio gets
          controlled. Hidden in independent mode (each player runs their own). */}
      {isHost && syncMode === "synchronized" && (
        <button
          onClick={onHostTogglePlayback}
          className="px-2.5 py-1 rounded text-sm font-semibold transition-colors"
          style={{
            background: playingSince !== null
              ? "rgba(var(--color-primary-rgb),0.2)"
              : "rgba(40,180,60,0.18)",
            border: `1px solid ${playingSince !== null
              ? "rgba(var(--color-primary-rgb),0.5)"
              : "rgba(40,180,60,0.5)"}`,
            color: playingSince !== null
              ? "rgb(var(--color-primary-rgb))"
              : "rgb(40,180,60)",
            whiteSpace: "nowrap",
          }}
        >
          {playingSince !== null ? "⏸ Pause for all" : "▶ Play for all"}
        </button>
      )}
      <span style={{ fontSize: "var(--text-xs)", color: "rgb(var(--text-muted-rgb))", whiteSpace: "nowrap" }}>
        {syncMode === "synchronized"
          ? (isHost ? "🔗 Synced — you control" : "🔗 Synced playback")
          : "🎚️ Independent"}
      </span>
      <audio
        ref={audioRef}
        controls
        preload="auto"
        // Browser autoplay policies require some user gesture before the
        // audio actually plays; first click on the page (anywhere) unlocks it.
        style={{ flex: 1, height: 36, minWidth: 0 }}
      />
    </div>
    </div>
  );
}

function AudioPlayerUI(props: AudioPlayerProps) {
  const {
    isDJ, djPlaying, trackUri, onPlay, onPause, onSeek, volume, onVolume,
    durationMs, positionMs, djReady, listenerConnected,
    coverUrl, coverRevealed,
  } = props;

  // DJ uses the local SDK state for instant feedback; listeners derive from realtime room state.
  const playing = isDJ ? djPlaying : (props.playingSince !== null && props.pausedAtMs === null);
  const [volOpen, setVolOpen] = useState(false);
  // Pre-mute volume so clicking the icon toggles mute and back.
  const prevVolumeRef = useRef(volume > 0 ? volume : 0.7);
  // Slider popover hover timers (small delay so cursor can travel from icon
  // to slider without flicker, since the click action is now "mute" not
  // "open slider").
  const popoverEnterTimer = useRef<number | null>(null);
  const popoverLeaveTimer = useRef<number | null>(null);

  function toggleMute() {
    if (volume > 0) {
      prevVolumeRef.current = volume;
      onVolume(0);
    } else {
      onVolume(prevVolumeRef.current > 0 ? prevVolumeRef.current : 0.7);
    }
  }
  function openVolPopover() {
    if (popoverLeaveTimer.current) window.clearTimeout(popoverLeaveTimer.current);
    if (popoverEnterTimer.current) window.clearTimeout(popoverEnterTimer.current);
    popoverEnterTimer.current = window.setTimeout(() => setVolOpen(true), 180);
  }
  function scheduleVolClose() {
    if (popoverEnterTimer.current) window.clearTimeout(popoverEnterTimer.current);
    if (popoverLeaveTimer.current) window.clearTimeout(popoverLeaveTimer.current);
    popoverLeaveTimer.current = window.setTimeout(() => setVolOpen(false), 150);
  }

  function fmt(ms: number) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  const pct = durationMs > 0 ? (positionMs / durationMs) * 100 : 0;

  return (
    <div className="flex-shrink-0 flex items-center gap-3 px-3 py-2 rounded-md w-full"
      style={{
        background: "rgb(var(--surface-raised-rgb))",
        border:     "1px solid rgb(var(--border-rgb))",
      }}>

      {/* Now-playing label (left side, like Spotify's track info) */}
      <div className="flex items-center gap-2 flex-shrink-0 min-w-[120px]">
        {coverRevealed && coverUrl ? (
          <img
            src={coverUrl}
            alt="Album cover"
            draggable={false}
            className="w-9 h-9 rounded-md object-cover flex-shrink-0"
            style={{ border: "1px solid rgba(var(--color-primary-rgb), 0.5)" }}
          />
        ) : (
          <div className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(var(--color-primary-rgb), 0.15)", border: "1px solid rgba(var(--color-primary-rgb), 0.35)" }}>
            <span className="text-base">🎵</span>
          </div>
        )}
        <div className="hidden sm:block min-w-0">
          <p className="text-xs font-semibold opacity-80 truncate">
            {coverRevealed ? "Cover revealed" : "Now playing"}
          </p>
          <p className="text-[10px] opacity-50 truncate">{trackUri ? "Mystery track" : "—"}</p>
        </div>
      </div>

      {/* Play/pause (DJ) or wave/idle (listener) */}
      {isDJ ? (
        playing ? (
          <button onClick={onPause}
            className="w-9 h-9 rounded-full flex items-center justify-center text-base flex-shrink-0"
            style={{ background: "rgb(var(--color-primary-rgb))", color: "#000" }}>
            ⏸
          </button>
        ) : (
          <button onClick={() => trackUri && onPlay(trackUri)}
            disabled={!djReady || !trackUri}
            className="w-9 h-9 rounded-full flex items-center justify-center text-base flex-shrink-0 disabled:opacity-30"
            style={{ background: "rgb(var(--color-primary-rgb))", color: "#000" }}>
            ▶
          </button>
        )
      ) : playing ? (
        <div className="wave-bars flex-shrink-0">
          {Array.from({ length: 5 }).map((_, i) => <span key={i} className="wave-bar" />)}
        </div>
      ) : (
        <div className="w-9 h-9 flex items-center justify-center flex-shrink-0 opacity-40">
          <span className="text-sm">🎵</span>
        </div>
      )}

      {/* Progress bar */}
      <div className="flex-1 min-w-0 relative h-1.5 rounded-full overflow-hidden cursor-pointer"
        style={{ background: "rgba(255,255,255,0.08)" }}
        onClick={e => {
          if (!isDJ || durationMs === 0) return;
          const rect = e.currentTarget.getBoundingClientRect();
          onSeek(Math.floor(((e.clientX - rect.left) / rect.width) * durationMs));
        }}>
        <div className="absolute left-0 top-0 h-full rounded-full"
          style={{ width: `${pct}%`, background: "rgb(var(--color-primary-rgb))" }} />
      </div>

      {/* Time */}
      <span className="text-xs opacity-50 flex-shrink-0 font-mono whitespace-nowrap"
        style={{ fontVariantNumeric: "tabular-nums" }}>
        {fmt(positionMs)} / {fmt(durationMs)}
      </span>

      {/* Volume — click icon = mute toggle, hover = slider popover. */}
      <div
        className="relative flex-shrink-0"
        onMouseEnter={openVolPopover}
        onMouseLeave={scheduleVolClose}
      >
        <button
          onClick={toggleMute}
          className="w-7 h-7 flex items-center justify-center rounded opacity-60 hover:opacity-100"
          title={volume === 0 ? "Unmute" : "Mute"}
        >
          {volume === 0 ? "🔇" : volume < 0.5 ? "🔈" : "🔊"}
        </button>
        {volOpen && (
          <div
            className="absolute right-0 bottom-full mb-2 z-10 px-3 py-2 rounded-md flex items-center gap-2"
            style={{
              background: "rgb(var(--surface-overlay-rgb))",
              border:     "1px solid rgb(var(--border-rgb))",
              boxShadow:  "var(--shadow-card)",
            }}
            onMouseEnter={openVolPopover}
            onMouseLeave={scheduleVolClose}
          >
            <input type="range" min="0" max="1" step="0.05" value={volume}
              onChange={e => onVolume(Number(e.target.value))}
              className="orange-range w-32" />
          </div>
        )}
      </div>

      {!isDJ && !listenerConnected && (
        <span className="text-xs opacity-40 flex-shrink-0">…</span>
      )}
    </div>
  );
}

// ── Reveal overlay ────────────────────────────────────────────────────────────

interface RevealProps {
  round:                TlRound;
  judgeMode:            JudgeMode;
  voteTimerSeconds:     number;
  isActiveTeam:         boolean;
  isCaptain:            boolean;
  isJudgeEligible:      boolean;
  isHost:               boolean;
  isDiscordBot:         boolean;
  myPlayerId:           string;
  totalEligibleVoters:  number;
  pendingCount:         number;
  /** Pending tracks for the active team. Drives the Recovery picker on a
   *  wrong placement when round.recovery_armed is true. */
  pendingTracks:        SpotifyTrack[];
  onJudge:              (verdict: boolean) => Promise<void>;
  onFinalize:           () => Promise<void>;
  onStop:               () => void;
  onNext:               () => void;
  onProposeYear:        (year: number) => Promise<void>;
  onApproveYear:        (approve: boolean) => Promise<void>;
  onRecoveryPick:       (trackId: string) => Promise<void>;
  onReportVideo:        () => Promise<void>;
  onApproveVideoReport: (approve: boolean) => Promise<void>;
  onRedoRound:          () => Promise<void>;
}

function RevealOverlay({
  round, judgeMode, voteTimerSeconds, isCaptain, isJudgeEligible, isHost, isDiscordBot,
  myPlayerId, totalEligibleVoters, pendingCount, pendingTracks,
  onJudge, onFinalize, onStop, onNext, onProposeYear, onApproveYear,
  onRecoveryPick, onReportVideo, onApproveVideoReport, onRedoRound,
}: RevealProps) {
  const isCorrect      = round.outcome === "correct";
  // hasGuess: did the captain type any artist/song name with the placement?
  const hasGuess       = (round.artist_guess?.trim() ?? "") !== "" || (round.songname_guess?.trim() ?? "") !== "";
  const isVoteMode     = judgeMode === "vote-all";
  // Combined verdict: both artist & songname always move together — show finalized
  // once either field has a verdict (vote-all keeps its own finalize flag).
  const finalized      = !hasGuess
    ? true
    : (isVoteMode ? round.judging_finalized : (round.artist_correct !== null || round.songname_correct !== null));
  // The server's awardBonusIfEligible requires BOTH fields === true; mirror
  // that strictly here so the UI doesn't claim "bonus" when only one field
  // resolved positive (was a subtle ??-short-circuit bug).
  const combinedVerdict: boolean | null =
    round.artist_correct === true && round.songname_correct === true ? true
    : round.artist_correct === false || round.songname_correct === false ? false
    : null;
  const bonusEligible  = hasGuess && combinedVerdict === true;
  // Show whichever year is currently authoritative
  const displayYear    = round.corrected_year ?? round.track.releaseYear;

  // Vote timer (vote-all mode only): client-side countdown driven by judging_started_at.
  const startedAtMs = round.judging_started_at ? Date.parse(round.judging_started_at) : 0;
  const expiresAtMs = startedAtMs + voteTimerSeconds * 1000;
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    if (!isVoteMode || !startedAtMs || finalized) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [isVoteMode, startedAtMs, finalized]);
  const remainingSec = Math.max(0, Math.ceil((expiresAtMs - now) / 1000));

  // When the timer expires, fire finalize once (any client triggers; server is idempotent).
  const finalizeFiredRef = useRef(false);
  useEffect(() => {
    if (!isVoteMode || finalized || !startedAtMs) return;
    if (remainingSec === 0 && !finalizeFiredRef.current) {
      finalizeFiredRef.current = true;
      onFinalize();
    }
  }, [isVoteMode, finalized, startedAtMs, remainingSec, onFinalize]);

  // ── SKIPPED (Song Skipper token) ────────────────────────────────────────
  if (round.skipped) {
    return (
      <Backdrop>
        <div className="w-full max-w-sm text-center space-y-4">
          <img src={round.track.coverUrl} alt="" className="w-20 h-20 rounded-xl object-cover mx-auto" />

          <YearStamp year={displayYear} variant="right" />

          <div>
            <p className="font-bold text-lg">{round.track.name}</p>
            <p className="text-sm opacity-60">{round.track.artist}</p>
          </div>

          <YearCorrectionWidget
            round={round}
            isHost={isHost}
            myPlayerId={myPlayerId}
            onPropose={onProposeYear}
            onApprove={onApproveYear}
          />

          <VideoReportWidget
            round={round}
            isHost={isHost}
            isDiscordBot={isDiscordBot}
            myPlayerId={myPlayerId}
            onReport={onReportVideo}
            onApprove={onApproveVideoReport}
            onRedo={onRedoRound}
          />

          <div className="rounded-xl p-3"
            style={{ background: "rgba(212,160,74,0.10)", border: "1px solid rgba(212,160,74,0.4)" }}>
            <p className="text-sm font-semibold" style={{ color: "rgb(var(--color-primary-rgb))" }}>
              ⏭ Turn skipped — pending cards locked in.
            </p>
          </div>

          {isCaptain ? (
            <Button onClick={onStop} className="w-full">Continue → next team</Button>
          ) : (
            <p className="text-xs opacity-50">Waiting for captain to continue…</p>
          )}
        </div>
      </Backdrop>
    );
  }

  // ── INCORRECT placement ─────────────────────────────────────────────────────
  if (!isCorrect) {
    return (
      <Backdrop>
        <div className="w-full max-w-sm text-center space-y-4">
          <img src={round.track.coverUrl} alt="" className="w-20 h-20 rounded-xl object-cover mx-auto" style={{ opacity: 0.6 }} />

          <YearStamp year={displayYear} variant="wrong" />

          <div>
            <p className="font-bold text-lg">{round.track.name}</p>
            <p className="text-sm opacity-60">{round.track.artist}</p>
          </div>

          <YearCorrectionWidget
            round={round}
            isHost={isHost}
            myPlayerId={myPlayerId}
            onPropose={onProposeYear}
            onApprove={onApproveYear}
          />

          <VideoReportWidget
            round={round}
            isHost={isHost}
            isDiscordBot={isDiscordBot}
            myPlayerId={myPlayerId}
            onReport={onReportVideo}
            onApprove={onApproveVideoReport}
            onRedo={onRedoRound}
          />

          <div className="rounded-xl p-3"
            style={{ background: "rgba(220,60,60,0.1)", border: "1px solid rgba(220,60,60,0.2)" }}>
            <p className="text-sm font-semibold text-red-400">
              Wrong placement — {round.recovery_armed && pendingTracks.length > 0
                ? `pick one card to save (Recovery), the others are lost.`
                : (pendingCount > 0 ? `${pendingCount} pending card${pendingCount > 1 ? "s" : ""} lost. Turn ends.` : "Turn ends.")}
            </p>
          </div>

          {/* Recovery picker — only when token is armed, captain, and there's
              something to save. Picking burns the recovery and saves only the
              chosen card into the timeline. */}
          {isCaptain && round.recovery_armed && pendingTracks.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wider opacity-60">🛟 Pick a card to save</p>
              <div className="flex flex-col gap-2">
                {pendingTracks.map(t => (
                  <button
                    key={t.id}
                    onClick={() => onRecoveryPick(t.id)}
                    className="flex items-center gap-3 rounded-md p-2 text-left transition-transform active:scale-[0.98]"
                    style={{
                      background: "rgb(var(--surface-raised-rgb))",
                      border:     "1px solid rgba(var(--color-secondary-rgb), 0.45)",
                    }}
                  >
                    {t.coverUrl && (
                      <img
                        src={t.coverUrl}
                        alt=""
                        draggable={false}
                        style={{ display: "block", width: 32, height: 32, borderRadius: 4, objectFit: "cover" }}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{t.name}</p>
                      <p className="text-xs opacity-60 truncate">{t.artist} · {t.releaseYear}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {isCaptain ? (
            <Button onClick={onStop} className="w-full">
              {round.recovery_armed && pendingTracks.length > 0 ? "Skip recovery — end turn" : "Continue → next team"}
            </Button>
          ) : (
            <p className="text-xs opacity-50">Waiting for captain to continue…</p>
          )}
        </div>
      </Backdrop>
    );
  }

  // ── CORRECT placement: full reveal (+ judge if guesses were submitted) ─────
  return (
    <Backdrop>
      <div className="w-full max-w-md space-y-4">
        <div className="text-center space-y-3">
          <img src={round.track.coverUrl} alt="" className="w-20 h-20 rounded-xl object-cover mx-auto" />
          <YearStamp year={displayYear} variant="right" />
          <div>
            <p className="font-bold text-lg">{round.track.name}</p>
            <p className="text-sm opacity-60">{round.track.artist}</p>
          </div>
        </div>

        <YearCorrectionWidget
          round={round}
          isHost={isHost}
          myPlayerId={myPlayerId}
          onPropose={onProposeYear}
          onApprove={onApproveYear}
        />

        <VideoReportWidget
          round={round}
          isHost={isHost}
          isDiscordBot={isDiscordBot}
          myPlayerId={myPlayerId}
          onReport={onReportVideo}
          onApprove={onApproveVideoReport}
          onRedo={onRedoRound}
        />

        {hasGuess && (
          <Panel className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wider opacity-50">The guess</p>
              {isVoteMode && !finalized && startedAtMs > 0 && (
                <p className="text-xs font-mono"
                  style={{ color: remainingSec <= 5 ? "rgb(220,60,60)" : "rgb(var(--color-secondary-rgb))" }}>
                  ⏱ {remainingSec}s
                </p>
              )}
            </div>

            <CombinedJudgeRow
              songnameGuess={round.songname_guess ?? ""}
              artistGuess={round.artist_guess ?? ""}
              actualSongname={round.track.name}
              actualArtist={round.track.artist}
              verdict={combinedVerdict}
              canJudge={isJudgeEligible}
              onJudge={onJudge}
              voteMode={isVoteMode}
              finalized={finalized}
              votes={round.songname_votes}
              myPlayerId={myPlayerId}
              totalVoters={totalEligibleVoters}
            />

            {!isJudgeEligible && !finalized && (
              <p className="text-xs text-center opacity-50">{judgePendingMessage(judgeMode)}</p>
            )}
          </Panel>
        )}

        {finalized && bonusEligible && (
          <div className="text-center text-sm font-semibold py-2 rounded-md"
            style={{
              background: "rgba(var(--color-primary-rgb), 0.12)",
              border:     "1px solid rgba(var(--color-primary-rgb), 0.35)",
              color:      "rgb(var(--color-primary-rgb))",
            }}>
            🪙 +1 Token earned (ready next turn)
          </div>
        )}

        {isCaptain && (
          <div className="space-y-2">
            <p className="text-sm opacity-60 text-center">
              {pendingCount} pending card{pendingCount !== 1 ? "s" : ""} this turn
              {!finalized && <span className="text-xs opacity-60"> · Judging not finalized — no token bonus</span>}
            </p>
            {round.force_locked ? (
              <>
                <div
                  className="rounded-md px-3 py-2 text-sm text-center font-bold"
                  style={{
                    background: "rgba(var(--color-danger-rgb, 220,60,60), 0.18)",
                    border:     "1px solid rgba(var(--color-danger-rgb, 220,60,60), 0.6)",
                    color:      "rgb(var(--color-danger-rgb, 220,60,60))",
                  }}
                >
                  🔒 Force Locked — turn ends now
                </div>
                <Button onClick={onStop} className="w-full">
                  Lock pending & pass turn
                </Button>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Button onClick={onStop} variant="ghost" size="sm" className="flex-col gap-0.5 py-3">
                    <span className="text-lg">🛑</span>
                    <span className="text-xs">Stop & lock</span>
                  </Button>
                  <Button onClick={onNext} size="sm" className="flex-col gap-0.5 py-3">
                    <span className="text-lg">▶</span>
                    <span className="text-xs">Next song</span>
                  </Button>
                </div>
                <p className="text-xs opacity-40 text-center">
                  Next: risk losing all {pendingCount} card{pendingCount !== 1 ? "s" : ""} if you place wrong
                </p>
              </>
            )}
          </div>
        )}
        {!isCaptain && (
          <p className="text-xs opacity-50 text-center">Waiting for captain to choose…</p>
        )}
      </div>
    </Backdrop>
  );
}

function judgePendingMessage(mode: JudgeMode): string {
  if (mode === "host")              return "Waiting for the host to judge…";
  if (mode === "team-captain")      return "Waiting for your captain to judge…";
  if (mode === "next-team-captain") return "Waiting for the next team's captain to judge…";
  return "Cast your vote above (waiting on others)…";
}

function Backdrop({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(10px)" }}>
      {children}
    </div>
  );
}

function YearStamp({ year, variant }: { year: number; variant: "right" | "wrong" }) {
  const ok = variant === "right";
  return (
    <div className="stamp-in">
      <div className="inline-block px-6 py-3 rounded-xl"
        style={{
          background: ok ? "rgba(40,180,60,0.1)" : "rgba(220,60,60,0.1)",
          border:    `2px solid ${ok ? "rgba(40,180,60,0.5)" : "rgba(220,60,60,0.5)"}`,
        }}>
        <p style={{
          fontFamily: "var(--font-mono)", fontSize: 36, fontWeight: 700,
          color: ok ? "rgb(40,180,60)" : "rgb(220,60,60)", lineHeight: 1,
        }}>
          {year}
        </p>
      </div>
    </div>
  );
}

function CombinedJudgeRow({
  songnameGuess, artistGuess, actualSongname, actualArtist,
  verdict, canJudge, onJudge,
  voteMode = false, finalized = false, votes = {}, myPlayerId = "", totalVoters = 0,
}: {
  songnameGuess:   string;
  artistGuess:     string;
  actualSongname:  string;
  actualArtist:    string;
  verdict:         boolean | null;
  canJudge:        boolean;
  onJudge:         (v: boolean) => void;
  voteMode?:       boolean;
  finalized?:      boolean;
  votes?:          Record<string, boolean>;
  myPlayerId?:     string;
  totalVoters?:    number;
}) {
  // Vote-mode pre-finalize uses the songname channel as the single source — both
  // get set together server-side, so reading either is fine.
  let myVote: boolean | null = null;
  let yesCount = 0, noCount = 0;
  if (voteMode) {
    for (const v of Object.values(votes)) v ? yesCount++ : noCount++;
    if (myPlayerId in votes) myVote = votes[myPlayerId];
  }
  const showVerdict      = !voteMode || finalized;
  const highlightVerdict = showVerdict ? verdict : myVote;

  return (
    <div className="rounded-lg p-3 space-y-2"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-wider opacity-50 mb-0.5">Song name</p>
          <p className="text-sm">
            <span className="opacity-60">Guessed </span>
            <span className="font-semibold">{songnameGuess || <span className="opacity-40 italic">—</span>}</span>
          </p>
          <p className="text-xs">
            <span className="opacity-50">Actual </span>
            <span className="font-semibold" style={{ color: "rgb(var(--color-secondary-rgb))" }}>{actualSongname}</span>
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider opacity-50 mb-0.5">Artist</p>
          <p className="text-sm">
            <span className="opacity-60">Guessed </span>
            <span className="font-semibold">{artistGuess || <span className="opacity-40 italic">—</span>}</span>
          </p>
          <p className="text-xs">
            <span className="opacity-50">Actual </span>
            <span className="font-semibold" style={{ color: "rgb(var(--color-secondary-rgb))" }}>{actualArtist}</span>
          </p>
        </div>
      </div>
      <p className="text-[11px] opacity-50 text-center">Both must be right to earn the bonus 🪙</p>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => canJudge && onJudge(true)}
          disabled={!canJudge}
          className="text-sm font-bold py-2 rounded transition-all disabled:cursor-default flex items-center justify-center gap-1.5"
          style={{
            background: highlightVerdict === true ? "rgba(40,180,60,0.22)" : "transparent",
            border:    `1px solid ${highlightVerdict === true ? "rgba(40,180,60,0.65)" : "rgba(255,255,255,0.12)"}`,
            color:      highlightVerdict === true ? "rgb(40,180,60)" : "rgb(var(--text-muted-rgb))",
            opacity:    canJudge ? 1 : 0.7,
          }}
        >
          ✓ Both correct
          {voteMode && !finalized && <span className="opacity-60 font-mono text-xs">{yesCount}</span>}
        </button>
        <button
          onClick={() => canJudge && onJudge(false)}
          disabled={!canJudge}
          className="text-sm font-bold py-2 rounded transition-all disabled:cursor-default flex items-center justify-center gap-1.5"
          style={{
            background: highlightVerdict === false ? "rgba(220,60,60,0.22)" : "transparent",
            border:    `1px solid ${highlightVerdict === false ? "rgba(220,60,60,0.65)" : "rgba(255,255,255,0.12)"}`,
            color:      highlightVerdict === false ? "rgb(220,60,60)" : "rgb(var(--text-muted-rgb))",
            opacity:    canJudge ? 1 : 0.7,
          }}
        >
          ✗ Not quite
          {voteMode && !finalized && <span className="opacity-60 font-mono text-xs">{noCount}</span>}
        </button>
      </div>
      {voteMode && !finalized && totalVoters > 0 && (
        <p className="text-[10px] opacity-50 text-center">
          {yesCount + noCount}/{totalVoters} voted
        </p>
      )}
    </div>
  );
}

// Year correction: any player can propose, host approves. Host's own propose
// applies immediately (the server takes care of that). When a proposal is
// pending, the host sees an approve/reject banner.
function YearCorrectionWidget({
  round, isHost, myPlayerId, onPropose, onApprove,
}: {
  round:       TlRound;
  isHost:      boolean;
  myPlayerId:  string;
  onPropose:   (year: number) => Promise<void>;
  onApprove:   (approve: boolean) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState<string>(String(round.corrected_year ?? round.track.releaseYear));
  const [busy, setBusy]       = useState(false);

  const corrected = round.corrected_year !== null;
  const proposed  = round.year_correction_proposed !== null;
  const proposedByMe = round.year_correction_proposed_by === myPlayerId;

  // Host: pending approval banner
  if (proposed && isHost) {
    return (
      <div className="rounded-lg p-3 text-sm flex items-center gap-2 flex-wrap"
        style={{ background: "rgba(220,160,0,0.12)", border: "1px solid rgba(220,160,0,0.4)" }}>
        <span style={{ color: "rgb(220,160,0)" }}>
          ⚠️ <strong>{round.year_correction_proposed_name ?? "Someone"}</strong> proposes year{" "}
          <strong>{round.year_correction_proposed}</strong> instead of <strong>{round.track.releaseYear}</strong>
        </span>
        <div className="flex gap-2 ml-auto">
          <button
            onClick={async () => { setBusy(true); try { await onApprove(true); } finally { setBusy(false); } }}
            disabled={busy}
            className="text-xs font-bold px-3 py-1 rounded"
            style={{ background: "rgba(40,180,60,0.2)", color: "rgb(40,180,60)", border: "1px solid rgba(40,180,60,0.4)" }}
          >
            ✓ Approve
          </button>
          <button
            onClick={async () => { setBusy(true); try { await onApprove(false); } finally { setBusy(false); } }}
            disabled={busy}
            className="text-xs font-bold px-3 py-1 rounded"
            style={{ background: "rgba(220,60,60,0.18)", color: "rgb(220,60,60)", border: "1px solid rgba(220,60,60,0.4)" }}
          >
            ✗ Reject
          </button>
        </div>
      </div>
    );
  }

  // Non-host pending
  if (proposed) {
    return (
      <p className="text-xs text-center opacity-70" style={{ color: "rgb(220,160,0)" }}>
        ⏳ {proposedByMe ? "You" : (round.year_correction_proposed_name ?? "Someone")} proposed <strong>{round.year_correction_proposed}</strong> — waiting for host
      </p>
    );
  }

  // Approved correction badge
  if (corrected) {
    return (
      <p className="text-xs text-center opacity-70">
        ✓ Year corrected to <strong>{round.corrected_year}</strong> (was {round.track.releaseYear})
      </p>
    );
  }

  // Editor (open or trigger)
  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-xs opacity-50 hover:opacity-90 underline"
      >
        Year wrong? Propose a correction
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 justify-center flex-wrap">
      <span className="text-xs opacity-60">Correct year:</span>
      <input
        type="number"
        min={1900}
        max={2100}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        autoFocus
        className="w-20 rounded px-2 py-1 text-sm font-mono outline-none"
        style={{
          background: "rgba(var(--surface-raised-rgb),0.5)",
          border:     "1px solid rgba(255,255,255,0.15)",
          color:      "inherit",
        }}
      />
      <button
        onClick={async () => {
          const y = parseInt(draft, 10);
          if (!Number.isInteger(y) || y < 1900 || y > 2100) return;
          setBusy(true);
          try { await onPropose(y); setEditing(false); }
          finally { setBusy(false); }
        }}
        disabled={busy}
        className="text-xs font-bold px-3 py-1 rounded"
        style={{ background: "rgba(var(--color-primary-rgb),0.2)", color: "rgb(var(--color-primary-rgb))", border: "1px solid rgba(var(--color-primary-rgb),0.4)" }}
      >
        {isHost ? "Apply" : "Propose"}
      </button>
      <button
        onClick={() => setEditing(false)}
        className="text-xs opacity-50"
      >
        Cancel
      </button>
    </div>
  );
}

// ── Bad-YouTube-version widget ────────────────────────────────────────────────
// Mirrors YearCorrectionWidget's propose/approve cycle but for the bot's
// YouTube pick. Visible only when the room is in discord-bot audio mode
// (the report flow is meaningless in browser mode — the host's Spotify SDK
// IS the source of truth there).
function VideoReportWidget({
  round, isHost, isDiscordBot, myPlayerId,
  onReport, onApprove, onRedo,
}: {
  round:         TlRound;
  isHost:        boolean;
  isDiscordBot:  boolean;
  myPlayerId:    string;
  onReport:      () => Promise<void>;
  onApprove:     (approve: boolean) => Promise<void>;
  onRedo:        () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  if (!isDiscordBot) return null;
  if (!round.bot_video_id) return null;  // bot hasn't published a video yet (e.g. browser audio mode just switched)

  const proposed   = round.video_report_proposed;
  const proposedByMe = round.video_report_proposed_by === myPlayerId;
  const approved   = round.video_report_approved;

  // Host: pending approval banner
  if (proposed && isHost) {
    return (
      <div className="rounded-lg p-3 text-sm flex items-center gap-2 flex-wrap"
        style={{ background: "rgba(220,160,0,0.12)", border: "1px solid rgba(220,160,0,0.4)" }}>
        <span style={{ color: "rgb(220,160,0)" }}>
          👎 <strong>{round.video_report_proposed_name ?? "Someone"}</strong> says this is the wrong YouTube version (wrong song, bad audio, music video with long intro, etc.).
        </span>
        <div className="flex gap-2 ml-auto">
          <button
            onClick={async () => { setBusy(true); try { await onApprove(true); } finally { setBusy(false); } }}
            disabled={busy}
            className="text-xs font-bold px-3 py-1 rounded"
            style={{ background: "rgba(40,180,60,0.2)", color: "rgb(40,180,60)", border: "1px solid rgba(40,180,60,0.4)" }}
          >
            ✓ Approve
          </button>
          <button
            onClick={async () => { setBusy(true); try { await onApprove(false); } finally { setBusy(false); } }}
            disabled={busy}
            className="text-xs font-bold px-3 py-1 rounded"
            style={{ background: "rgba(220,60,60,0.18)", color: "rgb(220,60,60)", border: "1px solid rgba(220,60,60,0.4)" }}
          >
            ✗ Reject
          </button>
        </div>
      </div>
    );
  }

  // Non-host pending
  if (proposed) {
    return (
      <p className="text-xs text-center opacity-70" style={{ color: "rgb(220,160,0)" }}>
        ⏳ {proposedByMe ? "You" : (round.video_report_proposed_name ?? "Someone")} flagged the YouTube version — waiting for host
      </p>
    );
  }

  // Approved: surface the host's Redo button + a status line for everyone else
  if (approved && isHost) {
    return (
      <div className="rounded-lg p-3 text-sm flex items-center gap-2 flex-wrap"
        style={{ background: "rgba(40,180,60,0.10)", border: "1px solid rgba(40,180,60,0.35)" }}>
        <span style={{ color: "rgb(40,180,60)" }}>
          ✓ YouTube version flagged. The bot will try a different one next time this song comes up.
        </span>
        <button
          onClick={async () => { setBusy(true); try { await onRedo(); } finally { setBusy(false); } }}
          disabled={busy}
          className="text-xs font-bold px-3 py-1 rounded ml-auto"
          style={{ background: "rgba(var(--color-primary-rgb),0.18)", color: "rgb(var(--color-primary-rgb))", border: "1px solid rgba(var(--color-primary-rgb),0.4)" }}
        >
          🔁 Redo round
        </button>
      </div>
    );
  }
  if (approved) {
    return (
      <p className="text-xs text-center opacity-70" style={{ color: "rgb(40,180,60)" }}>
        ✓ Wrong-video report approved — host can redo this round if they want
      </p>
    );
  }

  // Default: trigger button (any player)
  return (
    <button
      onClick={async () => { setBusy(true); try { await onReport(); } finally { setBusy(false); } }}
      disabled={busy}
      className="text-xs opacity-50 hover:opacity-90 underline"
    >
      👎 Wrong song or bad YouTube version? Let us know
    </button>
  );
}

// ── Main GamePage ─────────────────────────────────────────────────────────────

export default function GamePage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate   = useNavigate();
  const myPlayerId = roomId ? localStorage.getItem(`tl_player_${roomId}`) ?? undefined : undefined;

  const { state, clearTokenActivation } = useRoom(roomId, myPlayerId);

  const [submitting, setSubmitting] = useState(false);

  // Lifted guess inputs so chat-pull buttons can write into them.
  const [guessArtist,   setGuessArtist]   = useState("");
  const [guessSongname, setGuessSongname] = useState("");

  // Anti-spam cooldown for pings (per-client, in-memory).
  const pingTimestampsRef = useRef<number[]>([]);

  // Host-only management menu.
  const [hostMenuOpen, setHostMenuOpen] = useState(false);

  // Player-leave notifications (transient).
  const [leaveToasts, setLeaveToasts] = useState<{ id: string; name: string }[]>([]);
  // Action-failure toasts — any /room/:id/round POST that comes back !ok
  // shows up here so the user actually SEES why nothing happened (the
  // entire game was silently swallowing 4xx/5xx responses before).
  const [actionErrors, setActionErrors] = useState<{ id: string; message: string }[]>([]);
  function showActionError(message: string) {
    const id = `err-${Date.now()}-${Math.random()}`;
    setActionErrors(t => [...t, { id, message }]);
    setTimeout(() => setActionErrors(t => t.filter(x => x.id !== id)), 6000);
  }
  // Wrap fetch with status + JSON-error surfacing. Returns true on 2xx,
  // false otherwise (caller can branch off that if they need to).
  async function runAction(label: string, p: Promise<Response>): Promise<boolean> {
    try {
      const res = await p;
      if (res.ok) return true;
      let detail = "";
      try {
        const body = await res.json() as { error?: string };
        if (body?.error) detail = `: ${body.error}`;
      } catch { /* not JSON */ }
      showActionError(`${label} failed (${res.status})${detail}`);
      console.warn(`[action] ${label} → HTTP ${res.status}${detail}`);
      return false;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showActionError(`${label}: ${msg}`);
      console.warn(`[action] ${label} threw:`, err);
      return false;
    }
  }

  // Token tray: open the menu of the captain's available tokens.
  const [tokenTrayOpen, setTokenTrayOpen] = useState(false);
  // Which team's tray is open. Active team's captain opens for during_listen
  // tokens; non-active team's captain opens for opponent_turn tokens (Force
  // Lock). The tray gates token buttons by category vs current phase.
  const [tokenTrayTeamId, setTokenTrayTeamId] = useState<number | null>(null);
  // More-or-less is interactive — once armed, the captain has to pick a card.
  const [moreOrLessArmed, setMoreOrLessArmed] = useState(false);
  // Card Remover arming — captain clicks the token, picks an opposing card
  // in the picker modal, then the POST burns the token + deletes the card.
  const [cardRemoverArmed, setCardRemoverArmed] = useState(false);
  // Cover-reveal floating thumbnail: click to enlarge.
  const [coverEnlarged, setCoverEnlarged] = useState(false);

  // Tick every 500ms so the recent-ping bubbles fade out and disappear after 5s.
  const [, setPingTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPingTick(n => n + 1), 500);
    return () => clearInterval(id);
  }, []);

  // Lock the body to the viewport while the game is mounted. The shared
  // base.css gives <body> a 20px padding which causes the page to scroll
  // past the audio bar; this useEffect zeroes that out for /game routes
  // only and restores on unmount.
  useEffect(() => {
    const body = document.body;
    const html = document.documentElement;
    const prev = {
      bodyPadding:    body.style.padding,
      bodyOverflow:   body.style.overflow,
      bodyHeight:     body.style.height,
      htmlOverflow:   html.style.overflow,
      htmlHeight:     html.style.height,
    };
    body.style.padding  = "0";
    body.style.overflow = "hidden";
    body.style.height   = "100dvh";
    html.style.overflow = "hidden";
    html.style.height   = "100dvh";
    return () => {
      body.style.padding  = prev.bodyPadding;
      body.style.overflow = prev.bodyOverflow;
      body.style.height   = prev.bodyHeight;
      html.style.overflow = prev.htmlOverflow;
      html.style.height   = prev.htmlHeight;
    };
  }, []);

  // Optimistic local staging so the captain sees instant feedback even if the server is slow.
  // Server-driven values (broadcast via realtime) are the source of truth for everyone else.
  const [optimisticStaged, setOptimisticStaged] = useState<{ left: number | null; right: number | null } | null>(null);
  // Clear optimistic state when round changes
  useEffect(() => { setOptimisticStaged(null); }, [state?.round?.id]);

  // Staging POSTs to the server; server pushes to all clients via realtime.
  async function stageGap(_gapIdx: number | null, leftYear: number | null, rightYear: number | null) {
    if (!state?.round) return;
    setOptimisticStaged({ left: leftYear, right: rightYear });
    try {
      const res = await fetch(`/room/${roomId}/round?action=stage`, {
        method:      "POST",
        headers:     { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          round_id:          state.round.id,
          player_id:         myPlayerId,
          staged_left_year:  leftYear,
          staged_right_year: rightYear,
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        console.error("[musix] stage failed:", res.status, txt);
      }
    } catch (err) {
      console.error("[musix] stage error:", err);
    }
  }

  const onDJStateChange = useCallback((playing: boolean, positionMs: number) => {
    if (!roomId) return;
    const newSince = playing ? Date.now() - positionMs : null;
    const paused   = playing ? null : positionMs;
    supabase.from("tl_rooms").update({ playing_since: newSince, paused_at_ms: paused }).eq("id", roomId);
  }, [roomId]);

  const djAudio     = useDJAudio(onDJStateChange);
  const listenAudio = useListenerAudio();

  const isDJ       = state?.myPlayer?.is_host ?? false;
  const isHost     = state?.myPlayer?.is_host ?? false;
  const singleScreen = !!state?.room.settings?.singleScreenMode;
  // Audio source — browser (Spotify Web SDK in this tab) vs discord-bot
  // (separate Node.js bot in the host's voice channel; see bots/musix-discord).
  // Default is browser to preserve the original behaviour.
  const audioMode  = state?.room.settings?.audioMode ?? "browser";
  const browserAudio = audioMode === "browser";

  // In all-clients-stream mode, no Spotify SDK and no Discord bot write
  // playing_since for us — the host's client has to. Auto-start playback
  // when a new round inserts so every client's <audio> starts playing
  // without manual host intervention. Skips if already playing
  // (idempotent) and only fires on round-id transitions, not on every
  // realtime echo.
  const lastAutoStartedRoundIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isHost || audioMode !== "all-clients-stream") return;
    const roundId = state?.round?.id ?? null;
    if (roundId === null) return;
    if (lastAutoStartedRoundIdRef.current === roundId) return;
    lastAutoStartedRoundIdRef.current = roundId;
    if (!roomId) return;
    void supabase
      .from("tl_rooms")
      .update({ playing_since: Date.now(), paused_at_ms: null })
      .eq("id", roomId);
  }, [isHost, audioMode, state?.round?.id, roomId]);
  // In single-screen mode the host stands in for whoever's playing. They get
  // captain powers on whatever team is currently active.
  const isMyTurn   = !!(state?.room.active_team_id && (
    state.myPlayer?.team_id === state.room.active_team_id
    || (singleScreen && isHost)
  ));
  const iAmCaptain = (state?.myPlayer?.is_captain ?? false)
    || (singleScreen && isHost && isMyTurn);

  async function kickPlayer(targetId: string) {
    if (!myPlayerId) return;
    await fetch(`/room/${roomId}/kick`, {
      method:      "POST",
      headers:     { "Content-Type": "application/json" },
      credentials: "include",
      body:        JSON.stringify({ player_id: myPlayerId, target_id: targetId }),
    });
  }

  async function makeCaptain(targetPlayer: { id: string; team_id: number | null; is_captain: boolean }) {
    if (!targetPlayer.team_id) return;
    if (targetPlayer.is_captain) {
      // Toggle off — useful for host to un-captain themselves.
      await supabase.from("tl_players").update({ is_captain: false }).eq("id", targetPlayer.id);
    } else {
      // Transfer: clear other captains on this team, then set target as captain.
      const teammates = state?.players.filter(p => p.team_id === targetPlayer.team_id) ?? [];
      for (const p of teammates) {
        if (p.is_captain) {
          await supabase.from("tl_players").update({ is_captain: false }).eq("id", p.id);
        }
      }
      await supabase.from("tl_players").update({ is_captain: true }).eq("id", targetPlayer.id);
    }
  }

  // WebRTC tab-share relay is parked — players use Discord for shared audio.
  // The hooks stay no-op (no MediaStream wired up) per the design decision.
  useDJWebRTC(undefined, undefined, null);
  useListenerWebRTC(undefined, undefined, listenAudio.setStream);

  useEffect(() => {
    if (state?.room.status === "finished") navigate(`/end/${roomId}`);
  }, [state?.room.status, roomId, navigate]);

  // Reset guess inputs whenever the round changes.
  useEffect(() => {
    setGuessArtist("");
    setGuessSongname("");
  }, [state?.round?.id]);

  // Detect player departures and surface a toast.
  const prevPlayersRef = useRef<TlPlayer[]>([]);
  useEffect(() => {
    const prev = prevPlayersRef.current;
    const curr = state?.players ?? [];
    if (prev.length > 0) {
      const left = prev.filter(p => !curr.some(c => c.id === p.id));
      for (const p of left) {
        const id = `${p.id}-${Date.now()}`;
        setLeaveToasts(t => [...t, { id, name: p.name }]);
        setTimeout(() => setLeaveToasts(t => t.filter(x => x.id !== id)), 4000);
      }
    }
    prevPlayersRef.current = curr;
  }, [state?.players]);

  // Auto-play the round's track on the DJ's side whenever a new placement-phase round starts.
  // Captain doesn't have to manually click play after Next song / Continue / token.
  const lastAutoPlayedRoundRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isDJ || !djAudio.ready) return;
    // In discord-bot mode the external bot handles playback — don't fire the
    // Spotify SDK at all, otherwise audio doubles up.
    if (!browserAudio) return;
    if (!state?.round || state.round.outcome !== null) return;
    if (state.room.status !== "playing") return;
    if (lastAutoPlayedRoundRef.current === state.round.id) return;
    lastAutoPlayedRoundRef.current = state.round.id;
    djAudio.play(state.round.track.uri).catch(err => {
      console.error("[musix] auto-play failed:", err);
    });
  }, [isDJ, djAudio.ready, browserAudio, state?.round?.id, state?.round?.outcome, state?.room.status]);

  // Song Limiter — opposing team's token cuts the active team's listening
  // window. Host-side auto-pause once positionMs crosses the threshold.
  // pause() is idempotent so re-firing on subsequent position ticks is fine.
  useEffect(() => {
    if (!isHost || !djAudio.playing) return;
    const limit = state?.round?.song_limit_seconds;
    if (!limit) return;
    if (djAudio.positionMs > limit * 1000) {
      djAudio.pause();
    }
  }, [isHost, djAudio.playing, djAudio.positionMs, state?.round?.song_limit_seconds]);

  const onTimerExpire = useCallback(async () => {
    if (!isMyTurn || !iAmCaptain || !state?.round || state.round.outcome !== null) return;
    // Submit whatever the captain has staged (if anything). If they never
    // dragged the card, both staged years are null and the server treats
    // that as an auto-fail (the both-null guard added to handlePlace).
    const r = state.round;
    await fetch(`/room/${roomId}/round?action=place`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({
        round_id:   r.id,
        left_year:  r.staged_left_year  ?? null,
        right_year: r.staged_right_year ?? null,
        player_id:  myPlayerId,
      }),
    });
  }, [isMyTurn, iAmCaptain, state?.round, roomId, myPlayerId]);

  // Compute the timer total based on the room's timer mode:
  //   - "none"        — totalSec = null → useTimer returns null, no expiry
  //   - "fixed"       — totalSec = settings.timerSeconds
  //   - "song-length" — totalSec = track durationMs / 1000 (Spotify-captured),
  //                     or browser-side djAudio.durationMs for legacy rounds
  //                     where track.durationMs is missing; ultimate fallback
  //                     is TIMER_DEFAULT_FALLBACK_SECONDS so the captain
  //                     isn't stranded with an unkillable timer.
  const timerMode    = (state?.room.settings?.timerMode ?? "song-length") as "song-length" | "fixed" | "none";
  const fixedSec     = state?.room.settings?.timerSeconds ?? 120;
  const trackDurMs   = state?.round?.track.durationMs;
  const audioDurMs   = djAudio.durationMs;
  const totalSec: number | null = timerMode === "none" ? null
    : timerMode === "fixed" ? fixedSec
    : (trackDurMs && trackDurMs > 0) ? (trackDurMs / 1000)
    : (audioDurMs > 0)               ? (audioDurMs / 1000)
    : TIMER_DEFAULT_FALLBACK_SECONDS;
  const playingSince = state?.room.playing_since ?? null;
  const pausedAtMs   = state?.room.paused_at_ms  ?? null;
  const remaining = useTimer(totalSec, playingSince, pausedAtMs, onTimerExpire);

  if (!state) return <div className="flex-1 flex items-center justify-center opacity-50">Loading…</div>;

  const { room, teams, round, timelines, notes, pings, myPlayer } = state;
  const activeTeam = teams.find(t => t.id === room.active_team_id);
  // One-token-per-song rule (server-enforced in token.ts + round.ts). The
  // UI disables the active team's token tray once any flag on the current
  // round indicates the team has burned a token. The rule is per-TEAM on
  // the server, but until opponent-turn tokens land we only need to gate
  // the active team's tray; all the flags below are set by active-team
  // tokens so the check stays correct.
  const tokenUsedThisRound = !!round && (
    round.skipped ||
    round.cover_revealed ||
    !!round.more_or_less_card_id ||
    round.recovery_armed ||
    (round.year_tolerance ?? 0) > 0
  );
  // Pings persist on the timeline until dismissed (right-click / × button).
  // Players can dismiss their own; captain & host can dismiss any.
  // Coerce year to Number — Supabase may serialise NUMERIC as a string.
  const persistentPings = pings.map(p => ({
    id: p.id, year: Number(p.year), player_name: p.player_name, player_id: p.player_id,
  }));
  // Speech-bubble chat above avatars retired in favour of structured
  // suggestions. PlayerFooter still accepts a notes prop for back-compat
  // but we feed it nothing.
  const chatTickMs = Date.now();
  const footerNotes: FooterNote[] = [];

  async function confirmGuess() {
    if (!round || submitting) return;
    // Prefer optimistic local stage (instant captain feedback) over the server-synced value
    // so confirms work even if the realtime/migration is lagging.
    const stagedL = optimisticStaged ? optimisticStaged.left  : (round.staged_left_year  ?? null);
    const stagedR = optimisticStaged ? optimisticStaged.right : (round.staged_right_year ?? null);
    if (stagedL === null && stagedR === null) return;
    setSubmitting(true);
    try {
      await fetch(`/room/${roomId}/round?action=place`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({
          round_id:       round.id,
          left_year:      stagedL,
          right_year:     stagedR,
          artist_guess:   guessArtist.trim(),
          songname_guess: guessSongname.trim(),
          player_id:      myPlayerId,
        }),
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function judge(verdict: boolean) {
    if (!round) return;
    await fetch(`/room/${roomId}/round?action=judge`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ round_id: round.id, player_id: myPlayerId, kind: "combined", verdict }),
    });
  }

  async function proposeYearCorrection(year: number) {
    if (!round) return;
    await fetch(`/room/${roomId}/round?action=propose-year`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ round_id: round.id, player_id: myPlayerId, year }),
    });
  }

  async function approveYearCorrection(approve: boolean) {
    if (!round) return;
    await fetch(`/room/${roomId}/round?action=approve-year`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ round_id: round.id, player_id: myPlayerId, approve }),
    });
  }

  // ── Bad-YouTube-version flow ──────────────────────────────────────────
  // Any player flags the bot's pick → host approves → host can optionally
  // click Redo to replay the round with a different YouTube video. The
  // musix-discord bot watches tl_rounds for video_report_approved +
  // redo_requested_at and reacts (reportVideo + re-resolve + re-play).
  async function reportVideo() {
    if (!round) return;
    await fetch(`/room/${roomId}/round?action=report-video`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ round_id: round.id, player_id: myPlayerId }),
    });
  }

  async function approveVideoReport(approve: boolean) {
    if (!round) return;
    await fetch(`/room/${roomId}/round?action=approve-video-report`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ round_id: round.id, player_id: myPlayerId, approve }),
    });
  }

  async function redoRound() {
    if (!round) return;
    await fetch(`/room/${roomId}/round?action=redo-round`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ round_id: round.id, player_id: myPlayerId }),
    });
  }

  async function buyToken(tokenType: string) {
    await fetch(`/room/${roomId}/round?action=buy-token`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ player_id: myPlayerId, token_type: tokenType }),
    });
    // realtime tl_team_tokens INSERT + tl_teams UPDATE handle the UI refresh
  }

  async function dismissPing(pingId: number) {
    if (!myPlayerId) return;
    try {
      const res = await fetch(`/room/${roomId}/ping`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ ping_id: pingId, player_id: myPlayerId }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error("[musix] ping dismiss failed:", res.status, text.slice(0, 200));
      }
    } catch (err) {
      console.error("[musix] ping dismiss error:", err);
    }
  }

  async function doTurnAction(action: "stop" | "next") {
    await runAction(
      action === "stop" ? "End turn" : "Next song",
      fetch(`/room/${roomId}/round?action=turn`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ action, player_id: myPlayerId }),
      }),
    );
  }

  async function useSongSkipperToken() {
    if (!round) return;
    await fetch(`/room/${roomId}/round?action=usetoken`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ round_id: round.id, player_id: myPlayerId }),
    });
  }

  // Use a typed token via the /token endpoint. Effects vary by type.
  async function useTypedToken(type: TokenType, payload?: Record<string, unknown>) {
    if (!round) return;
    if (type === "song_skipper") return useSongSkipperToken();
    if (type === "more_or_less") {
      // Two-phase: first click opens the "pick a card" mode, the actual POST
      // happens when the captain clicks a timeline card.
      if (!payload?.card_id) {
        setMoreOrLessArmed(true);
        setTokenTrayOpen(false);
        return;
      }
    }
    if (type === "card_remover") {
      // Two-phase like more_or_less. First click arms the picker modal;
      // the modal POSTs once the captain picks an opponent card.
      if (!payload?.target_team_id) {
        setCardRemoverArmed(true);
        setTokenTrayOpen(false);
        return;
      }
    }
    const apiType =
      type === "cover_reveal" ? "cover_reveal" :
      type === "more_or_less" ? "more_or_less" :
      type === "recovery"     ? "recovery_arm" :
      type;
    const res = await fetch(`/room/${roomId}/token`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ round_id: round.id, player_id: myPlayerId, type: apiType, payload }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[musix] token use failed:", res.status, text.slice(0, 200));
    }
    setTokenTrayOpen(false);
    setMoreOrLessArmed(false);
    setCardRemoverArmed(false);
  }

  async function finalizeJudgment() {
    if (!round) return;
    await fetch(`/room/${roomId}/round?action=finalize`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ round_id: round.id, player_id: myPlayerId }),
    });
  }

  // Recovery — after a wrong placement, captain picks one pending card to
  // save. The picked card locks into the timeline; the others are lost.
  // Server validates outcome=incorrect && recovery_armed.
  async function recoveryPick(track_id: string) {
    if (!round) return;
    const res = await fetch(`/room/${roomId}/round?action=recovery-pick`, {
      method:      "POST",
      headers:     { "Content-Type": "application/json" },
      credentials: "include",
      body:        JSON.stringify({ round_id: round.id, player_id: myPlayerId, track_id }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[musix] recovery-pick failed:", res.status, text.slice(0, 200));
    }
  }

  // Submit a structured suggestion (song name or artist) into tl_notes.
  // Captains use these chips to fill their own inputs — they do NOT submit
  // suggestions themselves; their typing only places the actual guess.
  async function sendSuggestion(kind: "song" | "artist", value: string) {
    const v = value.trim();
    if (!v || !round || !myPlayer) return;
    await supabase.from("tl_notes").insert({
      round_id:    round.id,
      player_id:   myPlayer.id,
      player_name: myPlayer.name,
      content:     v.slice(0, 120),
      kind,
    });
  }

  // Toggle a ping at a specific year. One ping per (player, year) per round —
  // clicking a slot you've already pinged removes it. Light 200ms dedupe so
  // double-clicks don't oscillate.
  function pingAtYear(year: number) {
    if (!round || !myPlayer) return;
    if (year < 1900 || year > 2030) return;

    const now = Date.now();
    pingTimestampsRef.current = pingTimestampsRef.current.filter(ts => now - ts < 5000);
    const lastTs = pingTimestampsRef.current[pingTimestampsRef.current.length - 1] ?? 0;
    if (now - lastTs < 200) return;
    pingTimestampsRef.current.push(now);

    // Already pinged this slot? → toggle off via the dismiss endpoint.
    // Use a small epsilon since gap-pings may carry .5 fractions.
    const existing = state?.pings.find(p =>
      p.player_id === myPlayer.id && Math.abs(Number(p.year) - year) < 0.01
    );
    if (existing) {
      dismissPing(existing.id);
      return;
    }

    supabase.from("tl_pings").insert({
      round_id: round.id, player_id: myPlayer.id, player_name: myPlayer.name, year,
    }).then(({ error }) => {
      if (error) console.error("[musix] ping insert failed:", error.message);
    });
  }

  return (
    <div
      className="flex flex-col p-2 gap-2 w-full"
      style={{
        // Account for the 56px shared GameHeader at the top. The body is
        // pinned to 100dvh by the effect above, so we never overflow.
        height: "calc(100dvh - var(--header-height, 56px))",
        minHeight: 0,
        overflow: "hidden",
      }}
    >

      {/* ── In-game sub-header: turn info · tokens · timer · host menu ──── */}
      {/* Room code + copy-invite live in the global GameHeader at the top. */}
      <div className="flex-shrink-0 flex items-center gap-3 rounded-md px-3 py-1.5 relative"
        style={{
          background: isMyTurn ? "rgba(var(--color-primary-rgb), 0.10)" : "rgb(var(--surface-raised-rgb))",
          border:     `1px solid ${isMyTurn ? "rgba(var(--color-primary-rgb), 0.35)" : "rgb(var(--border-rgb))"}`,
        }}>
        <div className="flex-shrink-0 min-w-0 flex items-center gap-3">
          <div className="min-w-0">
            <p className="leading-tight uppercase" style={{ fontSize: "var(--text-xs)", color: "rgb(var(--text-muted-rgb))", letterSpacing: "0.12em" }}>
              {isMyTurn ? "Your turn" : "Active"}
            </p>
            <p className="font-bold leading-tight truncate" style={{ fontSize: "var(--text-base)" }}>
              {activeTeam?.name ?? "—"}
            </p>
          </div>
          {/* Timer next to the active team's name — front-and-center so every
              player can see how much time the captain has left. */}
          {totalSec !== null && remaining !== null && (
            <TimerRing remaining={remaining} total={totalSec} />
          )}
        </div>

        <div className="flex items-center gap-3 flex-shrink-0 ml-auto">
          {/* Track-pool progress so players know how many songs are left.
              Optional-chain length because realtime payload.new can lag the
              full row briefly during turn transitions — we'd rather omit the
              widget than crash the whole game. */}
          {(room.track_pool?.length ?? 0) > 0 && (() => {
            const poolLen = room.track_pool?.length ?? 0;
            const cursor  = room.track_cursor ?? 0;
            return (
              <div
                className="flex items-baseline gap-1 px-2 py-1 rounded-md"
                title={`Song ${Math.min(cursor, poolLen)} of ${poolLen}`}
                style={{
                  background: "rgba(var(--color-primary-rgb), 0.10)",
                  border:     "1px solid rgba(var(--color-primary-rgb), 0.30)",
                  color:      "rgb(var(--color-primary-rgb))",
                  fontFamily: "var(--font-mono)",
                  fontSize:   "var(--text-xs)",
                  fontWeight: 700,
                  lineHeight: 1,
                }}
              >
                <span>♪</span>
                <span>{Math.min(cursor, poolLen)}</span>
                <span style={{ opacity: 0.55 }}>/{poolLen}</span>
              </div>
            );
          })()}
          {/* Timer moved to next to the team name (above). */}

          {/* Host management menu */}
          {isHost && (
            <div className="relative">
              <button
                onClick={() => setHostMenuOpen(v => !v)}
                className="text-sm px-2 py-1 rounded-lg flex items-center gap-1 transition-all"
                style={{
                  background: hostMenuOpen
                    ? "rgba(var(--color-primary-rgb),0.2)"
                    : "rgba(var(--surface-raised-rgb),0.5)",
                  border:     "1px solid rgba(var(--color-primary-rgb),0.3)",
                  color:      "rgb(var(--color-primary-rgb))",
                }}
                title="Host controls"
              >
                ⚙ Manage
              </button>
              {hostMenuOpen && (
                <>
                  {/* Click-outside closer */}
                  <div className="fixed inset-0 z-30" onClick={() => setHostMenuOpen(false)} />
                  <div className="absolute right-0 mt-1 z-40 rounded-md p-3 w-72 max-h-[60vh] overflow-y-auto scrollbar-hidden"
                    style={{
                      background: "rgb(var(--surface-overlay-rgb))",
                      border:     "1px solid rgb(var(--border-rgb))",
                      boxShadow:  "var(--shadow-elevated)",
                    }}>
                    <p className="text-xs uppercase tracking-wider opacity-50 mb-2">Captain transfer</p>
                    <div className="space-y-3">
                      {teams.map(team => {
                        const teammates = state.players.filter(p => p.team_id === team.id && !p.is_spectator);
                        return (
                          <div key={team.id}>
                            <p className="text-xs font-semibold mb-1.5 opacity-70">{team.name}</p>
                            {teammates.length === 0 ? (
                              <p className="text-xs italic opacity-40 pl-2">No players</p>
                            ) : (
                              <div className="space-y-1">
                                {teammates.map(p => (
                                  <div key={p.id} className="flex items-center justify-between gap-2">
                                    <span className="text-sm flex items-center gap-1.5">
                                      {p.is_captain && "👑"}
                                      {p.name}
                                      {p.is_host && <span className="text-[9px] opacity-50">(host)</span>}
                                    </span>
                                    <div className="flex gap-1 flex-shrink-0">
                                      <button
                                        onClick={() => makeCaptain(p)}
                                        className="text-[10px] px-2 py-0.5 rounded font-bold transition-colors"
                                        style={{
                                          background: p.is_captain ? "rgba(220,60,60,0.18)" : "rgba(var(--color-primary-rgb),0.18)",
                                          border:     `1px solid ${p.is_captain ? "rgba(220,60,60,0.4)" : "rgba(var(--color-primary-rgb),0.4)"}`,
                                          color:      p.is_captain ? "rgb(220,60,60)" : "rgb(var(--color-primary-rgb))",
                                        }}>
                                        {p.is_captain ? "Un-captain" : "Make captain"}
                                      </button>
                                      {!p.is_host && (
                                        <button
                                          onClick={() => kickPlayer(p.id)}
                                          className="text-[10px] px-2 py-0.5 rounded opacity-60 hover:opacity-100"
                                          style={{ border: "1px solid rgba(255,255,255,0.15)" }}>
                                          Kick
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Player-leave toasts (top-right, fade out) ─────────────────────── */}
      {(leaveToasts.length > 0 || actionErrors.length > 0) && (
        <div className="fixed top-3 right-3 z-50 flex flex-col gap-1 pointer-events-none max-w-sm">
          {leaveToasts.map(t => (
            <div key={t.id} className="text-sm px-3 py-1.5 rounded-lg shadow-lg animate-slide-in"
              style={{
                background: "rgba(220,60,60,0.18)",
                border:     "1px solid rgba(220,60,60,0.45)",
                color:      "rgb(255,200,200)",
                backdropFilter: "blur(8px)",
              }}>
              👋 <strong>{t.name}</strong> left the game
            </div>
          ))}
          {actionErrors.map(t => (
            <div key={t.id} className="text-sm px-3 py-2 rounded-lg shadow-lg animate-slide-in"
              style={{
                background: "rgba(220,80,40,0.22)",
                border:     "1px solid rgba(220,80,40,0.55)",
                color:      "rgb(255,210,180)",
                backdropFilter: "blur(8px)",
              }}>
              ⚠ {t.message}
            </div>
          ))}
        </div>
      )}

      {/* ── Teams' timelines: spotlight on the active team, others compact ─── */}
      {(() => {
        const myTeamId       = myPlayer?.team_id ?? null;
        // Spotlight = whoever's turn it is. Falls back to my team between rounds.
        const spotlightId    = room.active_team_id ?? myTeamId ?? teams[0]?.id ?? null;
        const spotlightTeam  = teams.find(t => t.id === spotlightId) ?? null;
        const compactTeams   = teams.filter(t => t.id !== spotlightId);

        const renderSpotlight = (team: typeof teams[number]) => {
          const tl           = timelines[team.id] ?? [];
          const isActive     = team.id === room.active_team_id;
          const pending      = team.pending_tracks ?? [];
          const showDragCard = isActive && round && round.outcome === null;
          const isMyTeam     = team.id === myTeamId;
          const color        = getTeamColor(team.sort_order);

          return (
            <Panel
              className="p-4 flex flex-col"
              style={{
                minWidth:     0,
                borderTop:    `3px solid rgb(var(--team-${color}-rgb))`,
                borderRight:  "1px solid rgb(var(--border-rgb))",
                borderLeft:   "1px solid rgb(var(--border-rgb))",
                borderBottom: "1px solid rgb(var(--border-rgb))",
                background:   "rgb(var(--surface-raised-rgb))",
                boxShadow:    "var(--shadow-card)",
              }}
            >
              {/* Spotlight header — three balanced sections so the centre stays
                  truly centred regardless of left/right content widths:
                  [flex-1 score-disc + name] · [shrink avatars] · [flex-1 tokens]. */}
              <div className="flex items-center gap-3 mb-3">
                {/* Left: score-disc + team name + badge */}
                <div className="flex-1 flex items-center gap-3 min-w-0">
                  <div
                    className="flex items-center justify-center font-extrabold flex-shrink-0"
                    title={`${tl.length} card${tl.length !== 1 ? "s" : ""}${pending.length > 0 ? ` (+${pending.length} pending)` : ""}`}
                    style={{
                      width:        40,
                      height:       40,
                      borderRadius: "50%",
                      background:   `rgb(var(--team-${color}-rgb))`,
                      color:        "#fff",
                      fontSize:     "var(--text-lg)",
                      fontFamily:   "var(--font-mono)",
                      boxShadow:    isActive
                        ? `inset 0 1px 0 rgba(255,255,255,0.18), 0 0 12px rgba(var(--team-${color}-rgb), 0.55)`
                        : "inset 0 1px 0 rgba(255,255,255,0.18), 0 1px 2px rgba(0,0,0,0.35)",
                    }}
                  >
                    {tl.length}
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-extrabold tracking-tight truncate"
                      style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-lg)" }}>
                      {team.name}
                    </h2>
                    <div className="flex items-center gap-1 mt-0.5">
                      {isActive ? (
                        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider animate-pulse"
                          style={{
                            background: `rgba(var(--team-${color}-rgb), 0.30)`,
                            color:      `rgb(var(--team-${color}-rgb))`,
                            border:     `1px solid rgba(var(--team-${color}-rgb), 0.7)`,
                          }}>
                          🎯 On the spot
                        </span>
                      ) : isMyTeam ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider opacity-70"
                          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}>
                          Your team
                        </span>
                      ) : null}
                      {pending.length > 0 && (
                        <span className="text-[10px]"
                          style={{ color: "rgb(var(--color-secondary-rgb))" }}>
                          +{pending.length} pending
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Centre: avatars w/ chat bubbles — natural width, truly centred */}
                <div className="flex-shrink-0">
                  <PlayerFooter
                    players={state.players.filter(p => p.team_id === team.id && !p.is_spectator)}
                    notes={footerNotes}
                    color={color}
                    myPlayerId={myPlayerId}
                    nowMs={chatTickMs}
                    onMakeCaptain={isHost ? makeCaptain : undefined}
                    isHost={isHost}
                    bare
                  />
                </div>

                {/* Right: cover reveal thumbnail (when token used) + tokens.
                    Clickable — opens the same enlarge modal as the bottom-
                    left floating thumbnail. */}
                <div className="flex-1 flex items-center justify-end gap-2 min-w-0">
                  {/* ±N years active — surfaces the year_span_5 token effect
                      so the captain knows the placement window is widened. */}
                  {isActive && round && (round.year_tolerance ?? 0) > 0 && (
                    <span
                      className="font-extrabold flex-shrink-0 px-2 py-1 rounded-md uppercase tracking-wider"
                      title={`Placement allows ±${round.year_tolerance} years either side`}
                      style={{
                        fontSize:   "var(--text-xs)",
                        fontFamily: "var(--font-mono)",
                        background: `rgba(var(--team-${color}-rgb), 0.18)`,
                        border:     `1px solid rgba(var(--team-${color}-rgb), 0.6)`,
                        color:      `rgb(var(--team-${color}-rgb))`,
                      }}
                    >
                      ± {round.year_tolerance}y
                    </span>
                  )}
                  {/* Song Limiter — opposing token has cut the active team's
                      listening window. Visible to everyone so the active
                      team knows time is short and observers see the sabotage. */}
                  {isActive && round && round.song_limit_seconds && (
                    <span
                      className="font-extrabold flex-shrink-0 px-2 py-1 rounded-md uppercase tracking-wider"
                      title={`Opposing team limited this song to ${round.song_limit_seconds} seconds`}
                      style={{
                        fontSize:   "var(--text-xs)",
                        fontFamily: "var(--font-mono)",
                        background: "rgba(var(--color-danger-rgb, 220,60,60), 0.18)",
                        border:     "1px solid rgba(var(--color-danger-rgb, 220,60,60), 0.6)",
                        color:      "rgb(var(--color-danger-rgb, 220,60,60))",
                      }}
                    >
                      ⏱ {round.song_limit_seconds}s
                    </span>
                  )}
                  {isActive && round && round.cover_revealed && round.track.coverUrl && (
                    <button
                      type="button"
                      onClick={() => setCoverEnlarged(true)}
                      className="rounded-md overflow-hidden flex-shrink-0 transition-transform active:scale-[0.94] cursor-zoom-in"
                      title="Tap to enlarge the cover"
                      style={{
                        width:  40,
                        height: 40,
                        padding:    0,
                        boxSizing:  "border-box",
                        border:     `1px solid rgba(var(--team-${color}-rgb), 0.55)`,
                        background: "transparent",
                      }}
                    >
                      <img
                        src={round.track.coverUrl}
                        alt="Album cover"
                        draggable={false}
                        style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    </button>
                  )}
                  <TokenStrip
                    tokens={state.tokens?.[team.id] ?? []}
                    color={color}
                    onClick={isMyTeam && iAmCaptain && isMyTurn && !tokenUsedThisRound ? () => { setTokenTrayTeamId(team.id); setTokenTrayOpen(true); } : undefined}
                  />
                </div>
              </div>

              {/* Timeline-rail handles horizontal clipping + bubble headroom
                  via the .timeline-rail class. Outer wrapper stays visible so
                  bubbles can escape upward when they stack. */}
              <div style={{ overflow: "visible" }}>
                {tl.length === 0 && !showDragCard ? (
                  <p className="text-sm opacity-40 italic text-center py-8">No cards on the timeline yet</p>
                ) : (
                  <Timeline
                    entries={tl}
                    dragCard={showDragCard && isActive ? round!.track : null}
                    coverRevealed={isActive && !!round?.cover_revealed}
                    isCaptain={iAmCaptain && isMyTeam && isActive}
                    isActive={isActive}
                    stagedLeft={isActive
                      ? (optimisticStaged ? optimisticStaged.left : (round?.staged_left_year ?? null))
                      : null}
                    stagedRight={isActive
                      ? (optimisticStaged ? optimisticStaged.right : (round?.staged_right_year ?? null))
                      : null}
                    onStageGap={stageGap}
                    onPingYear={isActive && isMyTeam ? pingAtYear : undefined}
                    onCardClick={isActive && isMyTeam && moreOrLessArmed ? (entry) => useTypedToken("more_or_less", { card_id: entry.track_id }) : undefined}
                    cardClickHint={moreOrLessArmed ? "Pick this card to compare years" : undefined}
                    myPlayerId={myPlayerId}
                    pings={isActive ? persistentPings : []}
                    pending={pending as SpotifyTrack[]}
                  />
                )}
              </div>

              {/* Tokens + avatars now live in the spotlight header above. */}
            </Panel>
          );
        };

        const renderCompact = (team: typeof teams[number]) => {
          const tl       = timelines[team.id] ?? [];
          const pending  = team.pending_tracks ?? [];
          const isMyTeam = team.id === myTeamId;
          const color    = getTeamColor(team.sort_order);
          const teamPlayers = state.players.filter(p => p.team_id === team.id && !p.is_spectator);

          // Opponents only show a summary — tokens, name, score, avatars in
          // one row. Cards are hidden until that team is on the spot.
          return (
            <Panel
              key={team.id}
              className="px-3 py-2 flex flex-col"
              style={{
                flex:         "1 1 0",
                minHeight:    0,
                minWidth:     0,
                borderTop:    `2px solid rgb(var(--team-${color}-rgb))`,
                borderRight:  "1px solid rgb(var(--border-rgb))",
                borderLeft:   "1px solid rgb(var(--border-rgb))",
                borderBottom: "1px solid rgb(var(--border-rgb))",
                background:   "rgb(var(--surface-raised-rgb))",
              }}
            >
              <div className="flex items-center gap-3 flex-shrink-0">
                {/* Left: score-disc + team name */}
                <div className="flex-1 flex items-center gap-3 min-w-0">
                  <div
                    className="flex items-center justify-center font-extrabold flex-shrink-0"
                    title={`${tl.length} card${tl.length !== 1 ? "s" : ""}${pending.length > 0 ? ` (+${pending.length} pending)` : ""}`}
                    style={{
                      width:        32,
                      height:       32,
                      borderRadius: "50%",
                      background:   `rgb(var(--team-${color}-rgb))`,
                      color:        "#fff",
                      fontSize:     "var(--text-base)",
                      fontFamily:   "var(--font-mono)",
                      boxShadow:    "inset 0 1px 0 rgba(255,255,255,0.18), 0 1px 2px rgba(0,0,0,0.35)",
                    }}
                  >
                    {tl.length}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold truncate" style={{ fontSize: "var(--text-sm)" }}>
                      {team.name}
                    </p>
                    {(isMyTeam || pending.length > 0) && (
                      <p className="leading-none mt-0.5" style={{ fontSize: 10, color: "rgb(var(--text-muted-rgb))" }}>
                        {isMyTeam && <span className="uppercase tracking-wider">you</span>}
                        {isMyTeam && pending.length > 0 && " · "}
                        {pending.length > 0 && <span>+{pending.length} pending</span>}
                      </p>
                    )}
                  </div>
                </div>

                {/* Centre: team avatars — natural width, truly centred between
                    equal-flex left and right sections */}
                <div className="flex-shrink-0">
                  <PlayerFooter
                    players={teamPlayers}
                    notes={footerNotes}
                    color={color}
                    myPlayerId={myPlayerId}
                    nowMs={chatTickMs}
                    bare
                    compact
                  />
                </div>

                {/* Right: tokens. Captain of THIS team (when it's not active)
                    can click to open the tray for opponent-turn tokens like
                    Force Lock. The tray filters by category vs phase. */}
                <div className="flex-1 flex items-center justify-end min-w-0">
                  <TokenStrip
                    tokens={state.tokens?.[team.id] ?? []}
                    color={color}
                    compact
                    onClick={isMyTeam && iAmCaptain && !!round && !round.force_locked ? () => { setTokenTrayTeamId(team.id); setTokenTrayOpen(true); } : undefined}
                  />
                </div>
              </div>
            </Panel>
          );
        };

        return (
          <>
            {/* Compact strip — opponent summaries (name + score + avatars) */}
            {compactTeams.length > 0 && (
              <div className="flex flex-row gap-2 flex-shrink-0">
                {compactTeams.map(t => renderCompact(t))}
              </div>
            )}

            {/* Spotlight team — fills the remaining vertical space and scrolls
                its inner content (Timeline + footer) if it exceeds height. */}
            {spotlightTeam && (
              <div className="flex flex-col flex-1 min-h-0" style={{ overflow: "visible" }}>
                {renderSpotlight(spotlightTeam)}
              </div>
            )}
          </>
        );
      })()}

      {/* ── Bottom panel: role-gated guess inputs + suggestion chips ─────
           - Active captain: fills inputs from chips; submits placement.
           - Active non-captain: submits suggestions; cannot click chips.
           - Everyone else (opponent / spectator): chips view-only, no input. */}
      {round && round.outcome === null && (() => {
        const songSuggestions   = notes.filter(n => n.kind === "song");
        const artistSuggestions = notes.filter(n => n.kind === "artist");
        // Reference Point notes — surface the most recent one as a hint chip
        // above the suggestion fields. Same anchor song from the same year.
        const referenceNote     = [...notes].reverse().find(n => n.kind === "reference");

        const iAmActiveTeam      = !!myPlayer && myPlayer.team_id === room.active_team_id;
        const isCaptainHere      = iAmCaptain && isMyTurn;
        const isActiveTeammate   = iAmActiveTeam && !isCaptainHere;
        const isObserver         = !iAmActiveTeam;

        const stagedL = optimisticStaged ? optimisticStaged.left  : (round?.staged_left_year  ?? null);
        const stagedR = optimisticStaged ? optimisticStaged.right : (round?.staged_right_year ?? null);
        const isStaged = stagedL !== null || stagedR !== null;

        const sendBoth = async () => {
          if (guessSongname.trim()) await sendSuggestion("song",   guessSongname);
          if (guessArtist.trim())   await sendSuggestion("artist", guessArtist);
          setGuessSongname("");
          setGuessArtist("");
        };

        return (
          <Panel
            className="flex-shrink-0 p-3 space-y-2"
            style={{
              borderColor: isCaptainHere
                ? "rgba(var(--color-primary-rgb), 0.35)"
                : undefined,
            }}
          >
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wider opacity-50">
                {isCaptainHere    ? "Your guess"
                  : isActiveTeammate ? "Suggest to your captain"
                  : "Suggestions"}
              </p>
              {persistentPings.length > 0 && (
                <span className="text-[11px] opacity-50">📍 {persistentPings.length}</span>
              )}
            </div>

            {/* Reference Point hint — same-year anchor song surfaced by the
                token. Visible to everyone; the active team is the one that
                paid for it, but others seeing it doesn't change gameplay. */}
            {referenceNote && (
              <div
                className="flex items-center gap-2 px-3 py-1.5 rounded-md"
                style={{
                  background: "rgba(var(--color-secondary-rgb), 0.10)",
                  border:     "1px solid rgba(var(--color-secondary-rgb), 0.35)",
                  color:      "rgb(var(--color-secondary-rgb))",
                  fontSize:   "var(--text-sm)",
                }}
                title="Reference from the same year — use it to anchor your guess"
              >
                <span>📍</span>
                <span className="opacity-75 uppercase tracking-wider text-[10px]">Same year:</span>
                <span className="font-semibold truncate">{referenceNote.content}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <SuggestionField
                label="Song name"
                placeholder="What's it called?"
                value={isCaptainHere || isActiveTeammate ? guessSongname : undefined}
                onChange={isCaptainHere || isActiveTeammate ? setGuessSongname : undefined}
                suggestions={songSuggestions}
                onPick={isCaptainHere ? (v) => setGuessSongname(v) : undefined}
                readOnly={isObserver}
              />
              <SuggestionField
                label="Artist"
                placeholder="Who's playing?"
                value={isCaptainHere || isActiveTeammate ? guessArtist : undefined}
                onChange={isCaptainHere || isActiveTeammate ? setGuessArtist : undefined}
                suggestions={artistSuggestions}
                onPick={isCaptainHere ? (v) => setGuessArtist(v) : undefined}
                readOnly={isObserver}
              />
            </div>

            <div className="flex gap-2 flex-wrap">
              {isCaptainHere && (
                <>
                  <Button
                    onClick={confirmGuess}
                    loading={submitting}
                    disabled={!isStaged}
                    className="flex-1 min-w-[160px]"
                  >
                    {!isStaged ? "Click a gap to place the card" : "✓ Confirm guess"}
                  </Button>
                  {(() => {
                    const tokens = (activeTeam ? state.tokens?.[activeTeam.id] : []) ?? [];
                    const ready  = tokens.filter(t => !t.pending);
                    if (ready.length === 0) return null;
                    return (
                      <Button
                        onClick={() => { if (activeTeam) setTokenTrayTeamId(activeTeam.id); setTokenTrayOpen(true); }}
                        variant="ghost"
                        size="sm"
                        className="flex-shrink-0"
                        disabled={tokenUsedThisRound}
                        title={tokenUsedThisRound ? "Only one token per song" : "Use a token"}
                      >
                        🎟 Tokens ({ready.length})
                      </Button>
                    );
                  })()}
                </>
              )}
              {isActiveTeammate && (
                <Button
                  onClick={sendBoth}
                  disabled={!guessSongname.trim() && !guessArtist.trim()}
                  className="flex-1 min-w-[160px]"
                >
                  Send to captain
                </Button>
              )}
            </div>

            {isCaptainHere && (
              <p className="text-[11px] opacity-40">
                Click a gap to place the year. Both fields right earns a 🪙 token bonus — no penalty if wrong.
              </p>
            )}
            {isObserver && (
              <p className="text-[11px] opacity-40">
                Waiting for the active team to guess.
              </p>
            )}
          </Panel>
        );
      })()}

      {/* ── Discord-bot mode banner ────────────────────────────────────────
          When the host has chosen discord-bot audio mode, surface a small
          status chip in the same place the audio bar would normally live
          so it's clear playback is happening elsewhere. */}
      {isHost && !browserAudio && (
        <div
          className="flex-shrink-0 px-3 py-2 flex items-center justify-center gap-2 text-sm"
          style={{
            background: "rgba(var(--color-secondary-rgb), 0.10)",
            borderTop:  "1px solid rgba(var(--color-secondary-rgb), 0.30)",
            color:      "rgb(var(--color-secondary-rgb))",
          }}
          title="The Discord bot is handling playback; the browser SDK is disabled."
        >
          <span>🤖</span>
          <span>Discord bot mode — playback handled in your voice channel.</span>
        </div>
      )}

      {/* ── Spotify-style audio bar at the very bottom (HOST only) ─────────
          The host is the one running Spotify; everybody else is hearing the
          room audio via whatever the host plays. Non-host captains don't
          need playback controls and the strip + its embedded cover are
          irrelevant noise for them. Also hidden when discord-bot mode is
          active — the bot handles playback, browser controls are noise. */}
      {/* All-clients-stream mode: every player runs their own <audio>
          pointed at the bot's HTTP proxy. Shown to ALL players (not just
          host) since each plays for themselves. Sync mode follows
          room.playing_since for host-driven play/pause; independent mode
          gives each player full controls. */}
      {audioMode === "all-clients-stream" && round?.track && (
        <AllClientsAudio
          track={round.track}
          playingSince={room.playing_since}
          syncMode={(state?.room.settings?.streamSyncMode ?? "synchronized") as "synchronized" | "independent"}
          isHost={isHost}
          onHostTogglePlayback={async () => {
            if (!roomId) return;
            const now = Date.now();
            // Toggle: if currently playing, pause (playing_since=null,
            // paused_at_ms=elapsed). If paused, resume (playing_since=
            // now-paused_at_ms so client elapsed stays consistent).
            if (room.playing_since !== null) {
              const positionMs = now - room.playing_since;
              await supabase
                .from("tl_rooms")
                .update({ playing_since: null, paused_at_ms: positionMs })
                .eq("id", roomId);
            } else {
              const resumeFrom = room.paused_at_ms ?? 0;
              await supabase
                .from("tl_rooms")
                .update({ playing_since: now - resumeFrom, paused_at_ms: null })
                .eq("id", roomId);
            }
          }}
        />
      )}

      {isHost && browserAudio && (
        <AudioPlayerUI
          isDJ={isDJ}
          isMyTurn={isMyTurn}
          trackUri={round?.track.uri ?? null}
          playingSince={room.playing_since}
          pausedAtMs={room.paused_at_ms}
          djPlaying={djAudio.playing}
          onPlay={djAudio.play}
          onPause={djAudio.pause}
          onSeek={djAudio.seek}
          volume={isDJ ? djAudio.volume : listenAudio.volume}
          onVolume={isDJ ? djAudio.setVolume : listenAudio.setVolume}
          durationMs={djAudio.durationMs}
          positionMs={djAudio.positionMs}
          djReady={djAudio.ready}
          listenerConnected={listenAudio.connected}
          coverUrl={round?.track.coverUrl ?? null}
          coverRevealed={!!round?.cover_revealed}
        />
      )}

      {/* Reveal overlay — driven by round.outcome OR round.skipped (realtime) */}
      {round && (round.outcome !== null || round.skipped) && (() => {
        const settings  = { ...DEFAULT_TL_SETTINGS, ...(room.settings ?? {}) };
        const judgeMode: JudgeMode = settings.judgeMode;

        // Determine if this viewer is eligible to judge under the current mode
        let isJudgeEligible = false;
        if (myPlayer && !myPlayer.is_spectator) {
          if (judgeMode === "host")              isJudgeEligible = myPlayer.id === room.host_id;
          else if (judgeMode === "team-captain") isJudgeEligible = myPlayer.is_captain && myPlayer.team_id === room.active_team_id;
          else if (judgeMode === "next-team-captain") {
            const sorted   = [...teams].sort((a, b) => a.sort_order - b.sort_order);
            const activeIx = sorted.findIndex(t => t.id === room.active_team_id);
            if (activeIx !== -1) {
              const nextTeam = sorted[(activeIx + 1) % sorted.length];
              isJudgeEligible = myPlayer.is_captain && myPlayer.team_id === nextTeam.id;
            }
          }
          else if (judgeMode === "vote-all") isJudgeEligible = true;
        }

        const totalEligibleVoters = state.players.filter(p => !p.is_spectator).length;

        return (
          <RevealOverlay
            round={round}
            judgeMode={judgeMode}
            voteTimerSeconds={settings.voteTimerSeconds}
            isActiveTeam={isMyTurn}
            isCaptain={iAmCaptain && isMyTurn}
            isJudgeEligible={isJudgeEligible}
            isHost={isHost}
            isDiscordBot={settings.audioMode === "discord-bot"}
            myPlayerId={myPlayerId ?? ""}
            totalEligibleVoters={totalEligibleVoters}
            pendingCount={activeTeam?.pending_tracks?.length ?? 0}
            pendingTracks={(activeTeam?.pending_tracks ?? []) as SpotifyTrack[]}
            onJudge={judge}
            onFinalize={finalizeJudgment}
            onStop={() => doTurnAction("stop")}
            onNext={() => doTurnAction("next")}
            onProposeYear={proposeYearCorrection}
            onApproveYear={approveYearCorrection}
            onRecoveryPick={recoveryPick}
            onReportVideo={reportVideo}
            onApproveVideoReport={approveVideoReport}
            onRedoRound={redoRound}
          />
        );
      })()}

      {/* Hidden audio element — required for WebRTC stream playback on listener clients */}
      {!isDJ && <audio ref={listenAudio.audioRef} style={{ display: "none" }} />}

      {/* ── Token tray ─────────────────────────────────────────────────── */}
      {tokenTrayOpen && tokenTrayTeamId !== null && (() => {
        const trayTeamId = tokenTrayTeamId;
        const phase: "active" | "opponent" =
          trayTeamId === room.active_team_id ? "active" : "opponent";
        const settings = { ...DEFAULT_TL_SETTINGS, ...(room.settings ?? {}) };
        const trayTeam = teams.find(t => t.id === trayTeamId);
        return (
          <TokenTray
            tokens={(state.tokens?.[trayTeamId] ?? []).filter(t => !t.pending)}
            phase={phase}
            forceLocked={!!round?.force_locked}
            songNotStarted={room.playing_since === null}
            shopEnabled={settings.tokenEconomy === "shop"}
            points={trayTeam?.points ?? 0}
            onBuy={buyToken}
            onClose={() => setTokenTrayOpen(false)}
            onUse={(t) => useTypedToken(t.type as TokenType)}
          />
        );
      })()}

      {/* ── Cover Reveal floating thumbnail (bottom-left) ───────────────── */}
      {/* Visible to every active-team member (the audio bar is captain-only,
          and the spotlight header thumbnail can scroll out of view). */}
      {round && round.cover_revealed && round.track.coverUrl && isMyTurn && (
        <button
          type="button"
          onClick={() => setCoverEnlarged(true)}
          className="fixed z-30 rounded-md overflow-hidden transition-all active:scale-[0.96]"
          style={{
            left:         16,
            bottom:       16,
            width:        56,
            height:       56,
            padding:      0,                       // strip default <button> padding so the image fills
            boxSizing:    "border-box",            // 1px border doesn't grow the square
            border:       "1px solid rgba(var(--color-primary-rgb), 0.55)",
            boxShadow:    "0 6px 18px rgba(0,0,0,0.55)",
            background:   "rgb(var(--surface-overlay-rgb))",
            cursor:       "pointer",
          }}
          title="Tap to enlarge the cover"
        >
          <img
            src={round.track.coverUrl}
            alt="Album cover (tap to enlarge)"
            draggable={false}
            style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
          />
        </button>
      )}

      {/* Enlarge modal — renders for ANYONE who triggered coverEnlarged,
          not just active-team members. The spotlight-header thumbnail is
          visible to spectators and opponents too, and they should be able
          to enlarge it the same way. */}
      {coverEnlarged && round && round.cover_revealed && round.track.coverUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6 cursor-zoom-out"
          style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(6px)" }}
          onClick={() => setCoverEnlarged(false)}
        >
          <img
            src={round.track.coverUrl}
            alt="Album cover"
            draggable={false}
            onClick={() => setCoverEnlarged(false)}
            style={{
              maxWidth:  "min(80vw, 80vh)",
              maxHeight: "min(80vw, 80vh)",
              borderRadius: 12,
              boxShadow: "0 24px 60px rgba(0,0,0,0.7)",
              border:    "2px solid rgba(var(--color-primary-rgb), 0.6)",
            }}
          />
        </div>
      )}

      {/* ── Before-or-After hint (after the captain picks a card) ──────── */}
      {round && round.more_or_less_card_id && (() => {
        // The picked card might be locked (in tl_timeline) OR pending
        // (earned this turn, lives on the team row).
        const lockedTarget = (timelines[activeTeam?.id ?? -1] ?? [])
          .find(e => e.track_id === round.more_or_less_card_id);
        const pendingTarget = lockedTarget
          ? null
          : ((activeTeam?.pending_tracks ?? []) as SpotifyTrack[])
              .find(p => p.id === round.more_or_less_card_id);
        if (!lockedTarget && !pendingTarget) return null;
        const cardYear = lockedTarget
          ? (lockedTarget.corrected_year ?? lockedTarget.year)
          : (pendingTarget as SpotifyTrack).releaseYear;
        const songYear = round.corrected_year ?? round.track.releaseYear;
        const verdict = songYear < cardYear ? "before" : "after";
        return (
          <div
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-md flex items-center gap-2 animate-fade-in"
            style={{
              background: "rgb(var(--surface-overlay-rgb))",
              border:     "1px solid rgba(var(--color-primary-rgb), 0.4)",
              fontSize:   "var(--text-sm)",
              boxShadow:  "var(--shadow-elevated)",
            }}
          >
            <span>↕️</span>
            <span>
              This song is from{" "}
              <strong style={{ color: "rgb(var(--color-primary-rgb))" }}>{verdict} {cardYear}</strong>
            </span>
          </div>
        );
      })()}

      {/* ── More-or-less arming overlay ────────────────────────────────── */}
      {moreOrLessArmed && (
        <div
          className="fixed top-1/4 left-1/2 -translate-x-1/2 z-40 px-4 py-3 rounded-md animate-fade-in"
          style={{
            background: "rgb(var(--surface-overlay-rgb))",
            border:     "1px solid rgba(var(--color-primary-rgb), 0.55)",
            boxShadow:  "var(--shadow-elevated)",
          }}
        >
          <p className="text-sm" style={{ color: "rgb(var(--text-primary-rgb))" }}>
            ↕️ Pick a card on your timeline to compare years.
          </p>
          <button
            onClick={() => setMoreOrLessArmed(false)}
            className="mt-1 text-xs underline"
            style={{ color: "rgb(var(--text-muted-rgb))" }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* ── Card Remover picker ────────────────────────────────────────── */}
      {cardRemoverArmed && (
        <Modal open onClose={() => setCardRemoverArmed(false)} maxWidth="520px">
          <h2
            className="font-extrabold mb-1"
            style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-2xl)" }}
          >
            🗑️ Pick an opponent's card to remove
          </h2>
          <p
            className="mb-4"
            style={{ color: "rgb(var(--text-muted-rgb))", fontSize: "var(--text-sm)" }}
          >
            The card disappears from their timeline. Their score drops with it.
          </p>
          <div className="flex flex-col gap-4">
            {teams
              .filter(t => t.id !== room.active_team_id)
              .map(t => {
                const c = getTeamColor(t.sort_order);
                const cards = timelines[t.id] ?? [];
                return (
                  <div key={t.id}>
                    <p
                      className="font-bold mb-2 flex items-center gap-2"
                      style={{
                        fontSize: "var(--text-sm)",
                        color:    `rgb(var(--team-${c}-rgb))`,
                      }}
                    >
                      <span
                        style={{
                          display:      "inline-block",
                          width:        10,
                          height:       10,
                          borderRadius: "50%",
                          background:   `rgb(var(--team-${c}-rgb))`,
                        }}
                      />
                      {t.name}
                      <span className="ml-auto text-[10px] opacity-50 uppercase tracking-wider">
                        {cards.length} card{cards.length !== 1 ? "s" : ""}
                      </span>
                    </p>
                    {cards.length === 0 ? (
                      <p className="text-xs opacity-40 italic">No cards yet — nothing to remove.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {cards.map(entry => (
                          <button
                            key={entry.track_id}
                            onClick={() => useTypedToken("card_remover", { target_team_id: t.id, track_id: entry.track_id })}
                            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-transform active:scale-[0.97]"
                            style={{
                              background: "rgb(var(--surface-raised-rgb))",
                              border:     `1px solid rgba(var(--team-${c}-rgb), 0.45)`,
                            }}
                            title={`Remove from ${t.name}`}
                          >
                            {entry.track.coverUrl && (
                              <img
                                src={entry.track.coverUrl}
                                alt=""
                                draggable={false}
                                style={{ display: "block", width: 28, height: 28, borderRadius: 3, objectFit: "cover" }}
                              />
                            )}
                            <div className="min-w-0 max-w-[180px]">
                              <p className="font-semibold text-xs truncate">{entry.track.name}</p>
                              <p className="text-[10px] opacity-60 truncate">{entry.track.artist} · {entry.corrected_year ?? entry.year}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
          <button
            onClick={() => setCardRemoverArmed(false)}
            className="mt-4 w-full text-center"
            style={{ fontSize: "var(--text-sm)", color: "rgb(var(--text-muted-rgb))" }}
          >
            Cancel — keep the token
          </button>
        </Modal>
      )}

      {/* ── Token activation cinematic ─────────────────────────────────── */}
      {state.tokenActivation && (() => {
        const act        = state.tokenActivation;
        const actTeam    = state.teams.find(t => t.id === act.teamId);
        if (!actTeam) return null;
        const actColor   = getTeamColor(actTeam.sort_order);
        const myTeam     = myPlayer?.team_id ?? null;
        const myCounter  = !!(myTeam && (state.tokens?.[myTeam] ?? [])
          .some(t => !t.pending && t.type === "token_counter"));
        // Any non-activator team holding a ready counter extends the window to
        // 10s so the reaction is actually playable.
        const someoneCanCounter = state.teams.some(t =>
          t.id !== act.teamId &&
          (state.tokens?.[t.id] ?? []).some(tk => !tk.pending && tk.type === "token_counter"),
        );
        // Cover-reveal tokens chain into a big centred-cover phase after the
        // counter window. We only pass the URL — the cover IS the hint, so
        // title/artist must not appear in the cinematic.
        const isCoverReveal = act.tokenType === "cover_reveal" || act.tokenType === "cover_reveal_before";
        const revealMedia   = isCoverReveal && round?.track?.coverUrl
          ? { coverUrl: round.track.coverUrl }
          : undefined;
        return (
          <TokenActivationOverlay
            activation={act}
            teamName={actTeam.name}
            teamColor={actColor}
            hasCounter={myCounter && actTeam.id !== myTeam}
            counterAvailable={someoneCanCounter}
            revealMedia={revealMedia}
            onDismiss={clearTokenActivation}
          />
        );
      })()}
    </div>
  );
}

// ── Token tray modal ──────────────────────────────────────────────────────
// phase = "active" when MY team is on the spot (during_listen tokens enabled)
//       = "opponent" when MY team is OFF the spot (opponent_turn enabled)
// forceLocked is hint from the current round so we can disable duplicate
// Force Lock attempts (only opponent_turn token in Tier 1).
function TokenTray({
  tokens, onClose, onUse, phase, forceLocked, songNotStarted,
  shopEnabled, points, onBuy,
}: {
  tokens:         TlTeamToken[];
  onClose:        () => void;
  onUse:          (token: TlTeamToken) => void;
  phase:          "active" | "opponent";
  forceLocked:    boolean;
  songNotStarted: boolean;  // gates before_song tokens — once audio rolls they're locked out
  shopEnabled:    boolean;  // tokenEconomy === "shop"
  points:         number;
  onBuy:          (tokenType: string) => Promise<void>;
}) {
  const [buying, setBuying] = useState<string | null>(null);
  // Group by category for a clearer layout.
  const groups: Record<string, TlTeamToken[]> = {};
  for (const t of tokens) {
    const spec = TOKEN_CATALOG[t.type as TokenType];
    const cat = spec?.category ?? "anytime";
    (groups[cat] ?? (groups[cat] = [])).push(t);
  }
  const order: Array<keyof typeof groups> = ["before_song", "during_listen", "before_pass", "opponent_turn", "anytime"];

  return (
    <Modal open onClose={onClose} maxWidth="440px">
      <h2
        className="font-extrabold mb-1"
        style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-2xl)" }}
      >
        Your tokens
      </h2>
      <p
        className="mb-4"
        style={{ color: "rgb(var(--text-muted-rgb))", fontSize: "var(--text-sm)" }}
      >
        Tokens are earned by getting both song name + artist right. Pick one to spend.
      </p>
      {tokens.length === 0 ? (
        <p style={{ color: "rgb(var(--text-muted-rgb))", fontSize: "var(--text-sm)" }}>
          No tokens to spend yet.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {order.flatMap(cat => {
            const list = groups[cat];
            if (!list?.length) return [];
            const meta = CATEGORY_META[cat as TokenCategory];
            return [(
              <div key={cat}>
                <p
                  className="uppercase mb-1 flex items-center gap-1.5"
                  style={{
                    fontSize: "var(--text-xs)",
                    letterSpacing: "0.15em",
                    color: "rgb(var(--text-muted-rgb))",
                  }}
                >
                  <span>{meta.icon}</span>
                  {meta.label}
                </p>
                <div className="flex flex-col gap-2">
                  {list.map(t => {
                    const spec = TOKEN_CATALOG[t.type as TokenType];
                    if (!spec) return null;
                    // Phase gate: during_listen + before_pass only enabled
                    // when MY team is the active one; opponent_turn only when
                    // we're off-spot; anytime always; before_song requires
                    // active team AND the song hasn't started yet.
                    const phaseOk =
                      spec.category === "anytime"      ? true :
                      spec.category === "during_listen" || spec.category === "before_pass" ? phase === "active" :
                      spec.category === "opponent_turn" ? phase === "opponent" :
                      spec.category === "before_song"   ? phase === "active" && songNotStarted :
                      false;
                    // Force Lock is the only opponent_turn token; once
                    // round.force_locked is set, no team can play another.
                    const alreadyForceLocked = spec.type === "force_lock" && forceLocked;
                    const canUse = spec.implemented && phaseOk && !alreadyForceLocked;
                    const reason = !spec.implemented      ? "soon" :
                                   !phaseOk               ? (spec.category === "before_song" ? "too late" : "wrong phase") :
                                   alreadyForceLocked     ? "used"  :
                                   null;
                    return (
                      <button
                        key={t.id}
                        onClick={() => canUse && onUse(t)}
                        disabled={!canUse}
                        className="text-left rounded-md p-3 transition-all disabled:cursor-not-allowed"
                        title={reason === "wrong phase" ? "Only playable in a different turn phase" : undefined}
                        style={{
                          background: canUse ? "rgb(var(--surface-raised-rgb))" : "transparent",
                          border:     `1px solid rgba(var(--color-primary-rgb), ${canUse ? 0.4 : 0.15})`,
                          opacity:    canUse ? 1 : 0.55,
                        }}
                      >
                        <p className="font-bold flex items-center gap-2" style={{ fontSize: "var(--text-base)" }}>
                          <span>{spec.icon}</span> {spec.name}
                          {reason && (
                            <span
                              className="ml-auto text-[10px] uppercase tracking-wider"
                              style={{ color: "rgb(var(--text-muted-rgb))" }}
                            >
                              {reason}
                            </span>
                          )}
                        </p>
                        <p style={{ fontSize: "var(--text-sm)", color: "rgb(var(--text-secondary-rgb))" }}>
                          {spec.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )];
          })}
        </div>
      )}
      {/* ── Shop (visible in shop tokenEconomy) ─────────────────────
          Captain spends points to buy specific tokens. Only the active
          captain in shop mode can buy; opponent-phase or non-active
          shows a disabled view so others can preview what's available. */}
      {shopEnabled && (
        <div className="mt-5 pt-4" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="font-bold" style={{ fontSize: "var(--text-base)" }}>🏪 Shop</h3>
            <span style={{
              fontSize:   "var(--text-sm)",
              fontFamily: "var(--font-mono)",
              color:      "rgb(var(--color-primary-rgb))",
            }}>
              {points} {points === 1 ? "point" : "points"}
            </span>
          </div>
          <p className="mb-3" style={{ color: "rgb(var(--text-muted-rgb))", fontSize: "var(--text-xs)" }}>
            Earn +1 point per correct artist or song name. Spend them here.
          </p>
          <div className="flex flex-col gap-1.5">
            {Object.entries(SHOP_TOKEN_COSTS)
              .sort((a, b) => a[1] - b[1])
              .map(([type, cost]) => {
                const spec = TOKEN_CATALOG[type as TokenType];
                if (!spec) return null;
                const affordable = points >= cost;
                const canBuy     = phase === "active" && affordable && !buying;
                return (
                  <button
                    key={type}
                    onClick={async () => {
                      if (!canBuy) return;
                      setBuying(type);
                      try { await onBuy(type); } finally { setBuying(null); }
                    }}
                    disabled={!canBuy}
                    className="text-left rounded-md p-2 transition-all disabled:cursor-not-allowed flex items-center gap-2"
                    style={{
                      background: canBuy ? "rgba(var(--color-primary-rgb),0.10)" : "transparent",
                      border:     `1px solid rgba(var(--color-primary-rgb), ${canBuy ? 0.35 : 0.12})`,
                      opacity:    canBuy ? 1 : 0.55,
                    }}
                    title={
                      phase !== "active" ? "Only the active team's captain can buy"
                      : !affordable      ? `Need ${cost - points} more point${(cost - points) === 1 ? "" : "s"}`
                      : undefined
                    }
                  >
                    <span style={{ fontSize: "var(--text-base)" }}>{spec.icon}</span>
                    <span className="flex-1 truncate" style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>{spec.name}</span>
                    <span style={{
                      fontSize:   "var(--text-xs)",
                      fontFamily: "var(--font-mono)",
                      color:      affordable ? "rgb(var(--color-primary-rgb))" : "rgb(var(--text-muted-rgb))",
                    }}>
                      {cost} pt{cost === 1 ? "" : "s"}
                    </span>
                  </button>
                );
              })}
          </div>
        </div>
      )}
      <button
        onClick={onClose}
        className="mt-4 w-full text-center"
        style={{ fontSize: "var(--text-sm)", color: "rgb(var(--text-muted-rgb))" }}
      >
        Close
      </button>
    </Modal>
  );
}

// ── Token activation overlay ──────────────────────────────────────────────
// Full-screen cinematic when any team plays a token. Every client gets the
// same TokenActivation via realtime (see useRoom), so the animation is
// synchronous-enough for shared situational awareness.
//
// Phases:
//   0–1100ms    coin flips end-over-end (rotateX) along a parabolic arc, lands
//   1100ms+     name + description rise into view; counter-window countdown
//   counter end auto-dismiss (or chain into cover reveal for Cover Reveal tokens)
//
// Counter window is 3s by default, extended to 10s when at least one other
// team can actually counter — reaction time on an opaque CSS animation needs
// breathing room when the choice is meaningful.
const COVER_REVEAL_TOKENS = new Set<string>(["cover_reveal", "cover_reveal_before"]);

function TokenActivationOverlay({
  activation, teamName, teamColor, hasCounter, counterAvailable, onCounter, onDismiss,
  revealMedia,
}: {
  activation: { tokenId: number; tokenType: string; teamId: number; triggeredAt: number };
  teamName:   string;
  teamColor:  TeamColor | "spectator";
  hasCounter: boolean;          // I (my team) hold a token_counter — shows the Counter button
  counterAvailable: boolean;    // ANY non-activator team holds a counter — extends the window
  onCounter?: () => void;
  onDismiss:  () => void;
  /** When the token is a Cover Reveal AND the round track is known, pass the
   *  cover here. After the counter window expires (and no counter fires),
   *  the coin fades out and the cover scales up centre-screen for a moment.
   *  We intentionally DO NOT pass title/artist — the cover is the hint; the
   *  song identity is still the question the captain has to answer. */
  revealMedia?: { coverUrl: string };
}) {
  const spec = tokenSpec(activation.tokenType);
  const LAND_MS           = 1100;
  const COUNTER_WINDOW_MS = counterAvailable ? 10000 : 3000;
  const REVEAL_HOLD_MS    = 3500;
  const canReveal         = COVER_REVEAL_TOKENS.has(activation.tokenType) && !!revealMedia?.coverUrl;
  const [phase, setPhase] = useState<"flying" | "landed" | "revealed">("flying");
  const [remainingMs, setRemainingMs] = useState(COUNTER_WINDOW_MS);

  useEffect(() => {
    const timers: number[] = [];
    timers.push(window.setTimeout(() => setPhase("landed"), LAND_MS));
    const counterStart = Date.now() + LAND_MS;
    const tick = window.setInterval(() => {
      const left = COUNTER_WINDOW_MS - (Date.now() - counterStart);
      setRemainingMs(Math.max(0, left));
    }, 80);
    if (canReveal) {
      timers.push(window.setTimeout(() => setPhase("revealed"), LAND_MS + COUNTER_WINDOW_MS));
      timers.push(window.setTimeout(onDismiss, LAND_MS + COUNTER_WINDOW_MS + REVEAL_HOLD_MS));
    } else {
      timers.push(window.setTimeout(onDismiss, LAND_MS + COUNTER_WINDOW_MS));
    }
    return () => {
      for (const id of timers) window.clearTimeout(id);
      window.clearInterval(tick);
    };
    // Re-run on a new activation (different tokenId).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activation.tokenId, canReveal, COUNTER_WINDOW_MS]);

  const ringPct = phase === "landed"
    ? Math.max(0, Math.min(100, (remainingMs / COUNTER_WINDOW_MS) * 100))
    : 100;
  const inReveal = phase === "revealed";

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center"
      style={{
        background:      "rgba(0,0,0,0.62)",
        backdropFilter:  "blur(6px)",
        animation:       "tokenOverlayFade 220ms ease-out",
      }}
      // Click anywhere outside the token disc to dismiss early. The disc itself
      // doesn't dismiss because the Counter button lives next to it.
      onClick={onDismiss}
    >
      {/* Coin — two-faced, X-axis flip, arcs from behind the screen plane
          (negative translateZ → small) to in front of it (positive
          translateZ → larger). Material is layered radial gradients +
          inset highlight/shadow + rim line for a polished-metal look.
          See .token-coin / .token-coin-face in styles.css. */}
      {!inReveal && (
        <div
          className="token-coin-stage"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="token-coin"
            style={{
              animation: phase === "flying"
                ? "coinFlip 1100ms cubic-bezier(0.33, 0.0, 0.4, 1) forwards"
                : "coinSettle 560ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
            }}
          >
            <div
              className="token-coin-face token-coin-front"
              style={{
                background: [
                  // top-left specular highlight (sells the metallic sheen)
                  "radial-gradient(circle at 28% 22%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 30%)",
                  // bottom-right falloff so the coin reads as a solid disc
                  "radial-gradient(circle at 75% 80%, rgba(0,0,0,0.30) 0%, rgba(0,0,0,0) 45%)",
                  // main body — team colour with a slight inner brightening
                  `radial-gradient(circle at 50% 45%, rgba(var(--team-${teamColor}-rgb), 1) 0%, rgba(var(--team-${teamColor}-rgb), 0.85) 60%, rgba(var(--team-${teamColor}-rgb), 0.6) 100%)`,
                ].join(", "),
                border:     `2px solid rgba(var(--team-${teamColor}-rgb), 1)`,
                boxShadow:  [
                  "inset 0 -14px 20px rgba(0,0,0,0.30)",     // lower-half core shadow
                  "inset 0 10px 14px rgba(255,255,255,0.22)", // upper-half sheen
                  "inset 0 0 0 4px rgba(255,255,255,0.08)",   // inner ring (engraving)
                  "inset 0 0 0 5px rgba(0,0,0,0.22)",         // rim line
                  `0 0 0 3px rgba(var(--team-${teamColor}-rgb), 0.30)`,
                  "0 28px 60px rgba(0,0,0,0.65)",
                ].join(", "),
              }}
            >
              <span className="token-coin-icon">{spec.icon}</span>
            </div>
            <div
              className="token-coin-face token-coin-back"
              style={{
                background: [
                  "radial-gradient(circle at 28% 22%, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0) 30%)",
                  "radial-gradient(circle at 75% 80%, rgba(0,0,0,0.40) 0%, rgba(0,0,0,0) 45%)",
                  `radial-gradient(circle at 50% 45%, rgba(var(--team-${teamColor}-rgb), 0.85) 0%, rgba(var(--team-${teamColor}-rgb), 0.55) 60%, rgba(var(--team-${teamColor}-rgb), 0.35) 100%)`,
                ].join(", "),
                border:     `2px solid rgba(var(--team-${teamColor}-rgb), 0.85)`,
                boxShadow:  [
                  "inset 0 -14px 20px rgba(0,0,0,0.40)",
                  "inset 0 10px 14px rgba(255,255,255,0.10)",
                  "inset 0 0 0 4px rgba(255,255,255,0.05)",
                  "inset 0 0 0 5px rgba(0,0,0,0.28)",
                ].join(", "),
              }}
            >
              <span className="token-coin-back-mark">♪</span>
            </div>
          </div>
          <div className="token-coin-ground-shadow" />
        </div>
      )}

      {/* Cover reveal — only after the counter window, never with title/artist
          (the cover is the hint; identifying the song stays the captain's job) */}
      {inReveal && revealMedia && (
        <img
          src={revealMedia.coverUrl}
          alt="Album cover"
          draggable={false}
          onClick={(e) => e.stopPropagation()}
          style={{
            width:        "min(70vw, 70vh)",
            height:       "min(70vw, 70vh)",
            maxWidth:     520,
            maxHeight:    520,
            borderRadius: 16,
            objectFit:    "cover",
            border:       `3px solid rgba(var(--team-${teamColor}-rgb), 0.85)`,
            boxShadow:    `0 0 0 8px rgba(var(--team-${teamColor}-rgb), 0.22), 0 32px 80px rgba(0,0,0,0.7)`,
            animation:    "coverReveal 520ms cubic-bezier(0.22, 1.02, 0.36, 1) forwards",
          }}
        />
      )}

      {/* Caption — name + description, rises in once the token lands. Hidden
          during the cover reveal so the art has the stage. */}
      <div
        className="mt-14 text-center px-6"
        style={{
          maxWidth:  480,
          opacity:   phase === "landed" ? 1 : 0,
          transform: phase === "landed" ? "translateY(0)" : "translateY(18px)",
          transition: "opacity 280ms ease-out, transform 280ms ease-out",
          display:   inReveal ? "none" : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <p
          className="uppercase tracking-[0.18em]"
          style={{
            fontSize: "var(--text-xs)",
            color:    `rgb(var(--team-${teamColor}-rgb))`,
            fontFamily: "var(--font-mono)",
          }}
        >
          {teamName} played
        </p>
        <h2
          className="font-extrabold mt-1"
          style={{
            fontFamily: "var(--font-display)",
            fontSize:   "var(--text-2xl)",
            color:      "rgb(var(--text-primary-rgb))",
          }}
        >
          {spec.name}
        </h2>
        <p
          className="mt-2"
          style={{
            fontSize: "var(--text-sm)",
            color:    "rgb(var(--text-muted-rgb))",
            lineHeight: 1.45,
          }}
        >
          {spec.description}
        </p>

        {/* Counter-window: linear shrinking bar + optional Counter button.
            When token_counter ships this becomes the live reaction window. */}
        {phase === "landed" && (
          <div className="mt-5 flex flex-col items-center gap-2">
            <div
              style={{
                width:        180,
                height:       3,
                borderRadius: 2,
                background:   "rgba(255,255,255,0.08)",
                overflow:     "hidden",
              }}
            >
              <div
                style={{
                  width:      `${ringPct}%`,
                  height:     "100%",
                  background: `rgb(var(--team-${teamColor}-rgb))`,
                  transition: "width 80ms linear",
                }}
              />
            </div>
            {hasCounter && onCounter ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onCounter(); }}
                className="px-3 py-1.5 rounded-md font-bold transition-all active:scale-[0.97]"
                style={{
                  fontSize:   "var(--text-xs)",
                  background: "rgba(var(--color-secondary-rgb), 0.18)",
                  border:     "1px solid rgba(var(--color-secondary-rgb), 0.6)",
                  color:      "rgb(var(--color-secondary-rgb))",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                🛡 Counter ({Math.ceil(remainingMs / 1000)}s)
              </button>
            ) : (
              <p
                style={{
                  fontSize: "var(--text-xs)",
                  color:    "rgb(var(--text-muted-rgb))",
                  letterSpacing: "0.05em",
                }}
              >
                {Math.ceil(remainingMs / 1000)}s
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

