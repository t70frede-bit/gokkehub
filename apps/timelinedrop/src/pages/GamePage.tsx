import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Input, Modal, Panel } from "@gokkehub/ui";
import { useRoom } from "../hooks/useRoom";
import { useDJAudio, useListenerAudio } from "../hooks/useAudio";
import { useDJWebRTC, useListenerWebRTC } from "../hooks/useWebRTC";
import { supabase } from "../lib/supabase";
import type { TlTimelineEntry, SpotifyTrack, TlRound, TlPlayer, JudgeMode, TlTeamToken } from "../lib/types";
import { DEFAULT_TL_SETTINGS } from "../lib/types";
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

function useTimer(startedAt: number | null, onExpire: () => void) {
  const [remaining, setRemaining] = useState(90);
  const expiredRef = useRef(false);

  useEffect(() => {
    if (!startedAt) { setRemaining(90); expiredRef.current = false; return; }
    expiredRef.current = false;
    const tick = () => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const left = Math.max(0, 90 - elapsed);
      setRemaining(left);
      if (left === 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpire();
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [startedAt, onExpire]);

  return remaining;
}

// ── Timer ring SVG ────────────────────────────────────────────────────────────

function TimerRing({ remaining, total = 90 }: { remaining: number; total?: number }) {
  const R = 18;
  const C = 2 * Math.PI * R;
  const dash = Math.min(1, remaining / total) * C;
  const danger = remaining < 20;

  return (
    <svg width="46" height="46" viewBox="0 0 46 46" style={{ flexShrink: 0 }}>
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
  isHost?:        boolean;
  myPlayerId?:    string;
  stagedLeft:     number | null;
  stagedRight:    number | null;
  onStageGap:     (gapIdx: number | null, leftYear: number | null, rightYear: number | null) => void;
  onPingYear?:    (year: number) => void;
  onDismissPing?: (pingId: number) => void;   // server enforces: captain, host, or ping author
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
  entries, dragCard, coverRevealed, isCaptain, isActive, isHost = false, myPlayerId,
  stagedLeft, stagedRight, onStageGap, onPingYear, onDismissPing,
  onCardClick, cardClickHint, pings = [], pending = [],
}: TimelineProps) {
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
          // Right-click: remove a ping authored by ME inside this gap's range.
          // Captains/host can right-click any ping.
          const handleRightClick = (e: React.MouseEvent) => {
            if (!onDismissPing) return;
            const removable = gapPings.filter(p => isCaptain || isHost || p.player_id === myPlayerId);
            if (removable.length === 0) return;
            e.preventDefault();
            // Newest first — drop the most recent removable ping
            const target = removable[removable.length - 1];
            onDismissPing(target.id);
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
                  onContextMenu={handleRightClick}
                  title={
                    isStaged
                      ? (isCaptain ? "Selected — click again to clear" : "Captain is considering this spot")
                      : isCaptain
                        ? "Click to place · right-click to clear pings"
                        : (isActive ? "Click to suggest · right-click to clear yours" : "")
                  }
                >
                  {isStaged && dragCard ? (
                    <div onClick={e => isCaptain && e.stopPropagation()} className="px-1">
                      <QuestionCard track={dragCard} coverRevealed={coverRevealed} />
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
                      canDismissAny={isCaptain || isHost}
                      onDismiss={onDismissPing}
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
                  onContextMenu={handleRightClick}
                  title={onPingYear ? "Click to pin · right-click to clear yours" : ""}
                >
                  <span className="tl-gap-dot" />
                  {gapPings.length > 0 && (
                    <PingBubbles
                      pings={gapPings}
                      myPlayerId={myPlayerId}
                      canDismissAny={isCaptain || isHost}
                      onDismiss={onDismissPing}
                    />
                  )}
                </div>
              ))}

              {/* Existing card (locked or pending) — clickable to ping the same
                  year (handy when the year is already filled). */}
              {item && (() => {
                const cardPings = pings.filter(p => p.year === item.year);
                const canCardPing = !!onPingYear && isActive && !isCaptain;
                const canCardDismiss = !!onDismissPing && cardPings.some(p =>
                  isCaptain || isHost || p.player_id === myPlayerId
                );
                const lockedEntry = item.locked ? entries.find(e => e.track_id === item.track.id) : null;
                const canCardSelect = !!onCardClick && !!lockedEntry;
                const cardClickable = canCardSelect || canCardPing || canCardDismiss;

                const handleCardClick = () => {
                  if (canCardSelect && lockedEntry && onCardClick) { onCardClick(lockedEntry); return; }
                  if (canCardPing && onPingYear) onPingYear(item.year);
                };
                const handleCardRightClick = (e: React.MouseEvent) => {
                  if (!onDismissPing) return;
                  const removable = cardPings.filter(p =>
                    isCaptain || isHost || p.player_id === myPlayerId
                  );
                  if (removable.length === 0) return;
                  e.preventDefault();
                  onDismissPing(removable[removable.length - 1].id);
                };

                return (
                  <div
                    className="flex-shrink-0 relative"
                    onClick={cardClickable ? handleCardClick : undefined}
                    onContextMenu={canCardDismiss ? handleCardRightClick : undefined}
                    style={{
                      cursor: cardClickable ? "pointer" : "default",
                      position: "relative",
                      outline: canCardSelect ? "2px solid rgba(var(--color-primary-rgb), 0.7)" : undefined,
                      borderRadius: canCardSelect ? 8 : undefined,
                    }}
                    title={
                      canCardSelect ? (cardClickHint ?? "Click to pick this card")
                      : canCardPing  ? "Click to suggest this year · right-click to clear yours"
                      : ""
                    }
                  >
                    {item.locked ? (
                      <TrackCard year={item.year} track={item.track} />
                    ) : (
                      <PendingCard year={item.year} track={item.track} />
                    )}
                    {cardPings.length > 0 && (
                      <PingBubbles
                        pings={cardPings}
                        myPlayerId={myPlayerId}
                        canDismissAny={isCaptain || isHost}
                        onDismiss={onDismissPing}
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

// Persistent ping bubbles stacked above a gap. Styled to feel like physical
// push-pins: layered shadow gives elevation, subtle inner highlight on top,
// and a small triangular tail points down at the gap.
//
// Each bubble shows × when the viewer is allowed to remove it: own pings are
// always removable, captain/host can remove any. Right-click also dismisses.
function PingBubbles({
  pings, myPlayerId, canDismissAny, onDismiss,
}: {
  pings:          TimelinePing[];
  myPlayerId?:    string;
  canDismissAny?: boolean;
  onDismiss?:     (id: number) => void;
}) {
  const visible = pings.slice(-4);
  return (
    <div className="absolute -top-9 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1"
      style={{ pointerEvents: onDismiss ? "auto" : "none" }}>
      {visible.map((p, idx) => {
        const isMine    = !!myPlayerId && p.player_id === myPlayerId;
        const canRemove = !!onDismiss && (isMine || !!canDismissAny);
        const isLast    = idx === visible.length - 1;
        const colorVar  = isMine ? "--color-primary-rgb" : "--color-secondary-rgb";

        return (
          <div key={p.id} className="relative">
            <div
              className="text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap flex items-center gap-1.5"
              style={{
                background: `linear-gradient(180deg, rgba(var(${colorVar}), 1) 0%, rgba(var(${colorVar}), 0.78) 100%)`,
                color:      "#fff",
                // Layered shadow: 1px crisp drop + diffuse below = "lifted off the rail"
                boxShadow: [
                  "0 1px 0 rgba(255,255,255,0.18) inset",     // top inner highlight
                  "0 1px 1px rgba(0,0,0,0.35)",               // crisp 1px ground line
                  "0 6px 14px rgba(0,0,0,0.38)",              // diffuse halo
                ].join(", "),
                border:     `1px solid rgba(var(${colorVar}), 0.55)`,
                cursor:     canRemove ? "pointer" : "default",
                textShadow: "0 1px 1px rgba(0,0,0,0.35)",
              }}
              title={canRemove ? `${p.player_name} · right-click to remove` : p.player_name}
              onContextMenu={canRemove ? ((e) => { e.preventDefault(); e.stopPropagation(); onDismiss!(p.id); }) : undefined}
            >
              <span>📍 {p.player_name.split(" ")[0]}</span>
              {canRemove && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDismiss!(p.id); }}
                  className="text-sm leading-none -mr-0.5 hover:text-red-200"
                  title="Dismiss"
                  style={{ opacity: 0.85 }}
                >
                  ×
                </button>
              )}
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
                  pointerEvents: "none",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function TrackCard({ year, track }: { year: number; track: SpotifyTrack }) {
  return (
    <div className="flex flex-col items-center select-none" style={{ width: 88 }}>
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

function PendingCard({ year, track }: { year: number; track: SpotifyTrack }) {
  return (
    <div className="pending-card-wrap flex-shrink-0 flex flex-col items-center select-none" style={{ width: 88 }}>
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

function QuestionCard({ track, coverRevealed }: { track: SpotifyTrack; coverRevealed?: boolean }) {
  return (
    <div className="question-card select-none">
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
}

function AudioPlayerUI(props: AudioPlayerProps) {
  const {
    isDJ, djPlaying, trackUri, onPlay, onPause, onSeek, volume, onVolume,
    durationMs, positionMs, djReady, listenerConnected,
  } = props;

  // DJ uses the local SDK state for instant feedback; listeners derive from realtime room state.
  const playing = isDJ ? djPlaying : (props.playingSince !== null && props.pausedAtMs === null);
  const [volOpen, setVolOpen] = useState(false);

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
        <div className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0"
          style={{ background: "rgba(var(--color-primary-rgb), 0.15)", border: "1px solid rgba(var(--color-primary-rgb), 0.35)" }}>
          <span className="text-base">🎵</span>
        </div>
        <div className="hidden sm:block min-w-0">
          <p className="text-xs font-semibold opacity-80 truncate">Now playing</p>
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

      {/* Volume — collapsed behind icon */}
      <div className="relative flex-shrink-0">
        <button
          onClick={() => setVolOpen(v => !v)}
          className="w-7 h-7 flex items-center justify-center rounded opacity-60 hover:opacity-100"
          title="Volume"
        >
          {volume === 0 ? "🔇" : volume < 0.5 ? "🔈" : "🔊"}
        </button>
        {volOpen && (
          <div className="absolute right-0 bottom-full mb-2 z-10 px-3 py-2 rounded-md flex items-center gap-2"
            style={{
              background: "rgb(var(--surface-overlay-rgb))",
              border:     "1px solid rgb(var(--border-rgb))",
              boxShadow:  "var(--shadow-card)",
            }}>
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
  myPlayerId:           string;
  totalEligibleVoters:  number;
  pendingCount:         number;
  onJudge:              (verdict: boolean) => Promise<void>;
  onFinalize:           () => Promise<void>;
  onStop:               () => void;
  onNext:               () => void;
  onProposeYear:        (year: number) => Promise<void>;
  onApproveYear:        (approve: boolean) => Promise<void>;
}

function RevealOverlay({
  round, judgeMode, voteTimerSeconds, isCaptain, isJudgeEligible, isHost,
  myPlayerId, totalEligibleVoters, pendingCount,
  onJudge, onFinalize, onStop, onNext, onProposeYear, onApproveYear,
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
  const combinedVerdict: boolean | null = round.artist_correct ?? round.songname_correct ?? null;
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

          <div className="rounded-xl p-3"
            style={{ background: "rgba(220,60,60,0.1)", border: "1px solid rgba(220,60,60,0.2)" }}>
            <p className="text-sm font-semibold text-red-400">
              Wrong placement — {pendingCount > 0 ? `${pendingCount} pending card${pendingCount > 1 ? "s" : ""} lost. Turn ends.` : "Turn ends."}
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

// ── Main GamePage ─────────────────────────────────────────────────────────────

export default function GamePage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate   = useNavigate();
  const myPlayerId = roomId ? localStorage.getItem(`tl_player_${roomId}`) ?? undefined : undefined;

  const { state } = useRoom(roomId, myPlayerId);

  const [noteText,   setNoteText]   = useState("");
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

  // Token tray: open the menu of the captain's available tokens.
  const [tokenTrayOpen, setTokenTrayOpen] = useState(false);
  // More-or-less is interactive — once armed, the captain has to pick a card.
  const [moreOrLessArmed, setMoreOrLessArmed] = useState(false);

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
    if (!state?.round || state.round.outcome !== null) return;
    if (state.room.status !== "playing") return;
    if (lastAutoPlayedRoundRef.current === state.round.id) return;
    lastAutoPlayedRoundRef.current = state.round.id;
    djAudio.play(state.round.track.uri).catch(err => {
      console.error("[musix] auto-play failed:", err);
    });
  }, [isDJ, djAudio.ready, state?.round?.id, state?.round?.outcome, state?.room.status]);

  const onTimerExpire = useCallback(async () => {
    if (!isMyTurn || !iAmCaptain || !state?.round || state.round.outcome !== null) return;
    await fetch(`/room/${roomId}/round?action=place`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ round_id: state.round.id, left_year: null, right_year: null, player_id: myPlayerId }),
    });
  }, [isMyTurn, iAmCaptain, state?.round, roomId, myPlayerId]);

  const timerStartedAt = state?.room.playing_since ?? null;
  const remaining = useTimer(timerStartedAt, onTimerExpire);

  if (!state) return <div className="flex-1 flex items-center justify-center opacity-50">Loading…</div>;

  const { room, teams, round, timelines, notes, pings, myPlayer } = state;
  const activeTeam = teams.find(t => t.id === room.active_team_id);
  // Pings persist on the timeline until dismissed (right-click / × button).
  // Players can dismiss their own; captain & host can dismiss any.
  // Coerce year to Number — Supabase may serialise NUMERIC as a string.
  const persistentPings = pings.map(p => ({
    id: p.id, year: Number(p.year), player_name: p.player_name, player_id: p.player_id,
  }));
  // Notes for the per-player speech bubbles (last 12s) — feeds PlayerFooter.
  const chatTickMs = Date.now();
  const footerNotes: FooterNote[] = notes
    .map(n => ({ id: n.id, player_id: n.player_id, content: n.content, createdMs: Date.parse(n.created_at) }))
    .filter(n => !Number.isNaN(n.createdMs) && (chatTickMs - n.createdMs) < 12000);

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
    await fetch(`/room/${roomId}/round?action=turn`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ action, player_id: myPlayerId }),
    });
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
  }

  async function finalizeJudgment() {
    if (!round) return;
    await fetch(`/room/${roomId}/round?action=finalize`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
      body: JSON.stringify({ round_id: round.id, player_id: myPlayerId }),
    });
  }

  async function sendNote() {
    if (!noteText.trim() || !round || !myPlayer) return;
    await supabase.from("tl_notes").insert({
      round_id: round.id, player_id: myPlayer.id, player_name: myPlayer.name, content: noteText.trim(),
    });
    setNoteText("");
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
        <div className="flex-shrink-0 min-w-0">
          <p className="leading-tight uppercase" style={{ fontSize: "var(--text-xs)", color: "rgb(var(--text-muted-rgb))", letterSpacing: "0.12em" }}>
            {isMyTurn ? "Your turn" : "Active"}
          </p>
          <p className="font-bold leading-tight truncate" style={{ fontSize: "var(--text-base)" }}>
            {activeTeam?.name ?? "—"}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0 ml-auto">
          {/* Token overview moved to each team panel — sub-header keeps only
              turn info, timer, and the host menu so it stays compact. */}
          {timerStartedAt && <TimerRing remaining={remaining} />}

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
      {leaveToasts.length > 0 && (
        <div className="fixed top-3 right-3 z-50 flex flex-col gap-1 pointer-events-none">
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
              {/* Spotlight header */}
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{
                    background: `rgb(var(--team-${color}-rgb))`,
                    boxShadow:  isActive ? `0 0 12px rgba(var(--team-${color}-rgb), 0.85)` : "none",
                  }}
                />
                <h2 className="font-extrabold text-base sm:text-lg tracking-tight">
                  {team.name}
                </h2>
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
                <span className="text-xs opacity-50 ml-auto">
                  {tl.length} card{tl.length !== 1 ? "s" : ""}
                  {pending.length > 0 && (
                    <span style={{ color: "rgb(var(--color-secondary-rgb))" }}> · +{pending.length} pending</span>
                  )}
                </span>
              </div>

              {/* The big timeline — horizontally scrollable when many cards;
                  vertically auto-sized so the panel matches its content. */}
              <div className="overflow-x-auto overflow-y-hidden pt-1">
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
                    onPingYear={isActive ? pingAtYear : undefined}
                    onDismissPing={isActive ? dismissPing : undefined}
                    onCardClick={isActive && isMyTeam && moreOrLessArmed ? (entry) => useTypedToken("more_or_less", { card_id: entry.track_id }) : undefined}
                    cardClickHint={moreOrLessArmed ? "Pick this card to compare years" : undefined}
                    isHost={isHost}
                    myPlayerId={myPlayerId}
                    pings={isActive ? persistentPings : []}
                    pending={pending as SpotifyTrack[]}
                  />
                )}
              </div>

              {/* Bottom row: tokens (left) + player avatars (right) */}
              <div
                className="flex items-end gap-3 pt-2 mt-1"
                style={{ borderTop: `1px dashed rgba(var(--team-${color}-rgb), 0.18)` }}
              >
                <TokenStrip
                  tokens={state.tokens?.[team.id] ?? []}
                  color={color}
                  onClick={isMyTeam && iAmCaptain && isMyTurn ? () => setTokenTrayOpen(true) : undefined}
                />
                <div className="ml-auto">
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
              </div>
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
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Tokens at the very left */}
                <TokenStrip
                  tokens={state.tokens?.[team.id] ?? []}
                  color={color}
                  compact
                />

                {/* Team name + you badge */}
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ background: `rgb(var(--team-${color}-rgb))` }}
                />
                <p className="font-bold truncate" style={{ fontSize: "var(--text-sm)" }}>{team.name}</p>
                {isMyTeam && (
                  <span className="font-bold uppercase opacity-60 px-1.5 rounded"
                    style={{ background: "rgba(255,255,255,0.08)", fontSize: 9, letterSpacing: "0.06em" }}>
                    you
                  </span>
                )}

                {/* Score */}
                <span
                  className="whitespace-nowrap font-mono font-bold"
                  style={{
                    fontSize: "var(--text-base)",
                    color:    `rgb(var(--team-${color}-rgb))`,
                  }}
                >
                  {tl.length}
                  {pending.length > 0 && (
                    <span style={{ color: "rgb(var(--text-muted-rgb))", fontSize: "var(--text-xs)" }}>
                      {" +"}{pending.length}
                    </span>
                  )}
                </span>

                {/* Avatars at the right */}
                <div className="ml-auto">
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
              <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
                {renderSpotlight(spotlightTeam)}
              </div>
            )}
          </>
        );
      })()}

      {/* ── Bottom panel: guess form for active captain, chat for everyone else ── */}
      {iAmCaptain && isMyTurn && round && round.outcome === null ? (
        <Panel className="flex-shrink-0 p-3 space-y-2"
          style={{ borderColor: "rgba(var(--color-primary-rgb), 0.35)" }}>
          <p className="text-xs uppercase tracking-wider opacity-50">Your guess</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input
              label="Song name"
              value={guessSongname}
              onChange={e => setGuessSongname(e.target.value)}
              placeholder="What's it called?"
              maxLength={120}
            />
            <Input
              label="Artist"
              value={guessArtist}
              onChange={e => setGuessArtist(e.target.value)}
              placeholder="Who's playing?"
              maxLength={120}
            />
          </div>
          <p className="text-[11px] opacity-40">
            Click a gap to place the year. Artist & song are optional — get both right for a 🪙 token bonus. No penalty if wrong.
          </p>
          <div className="flex gap-2 flex-wrap">
            {(() => {
              const stagedL = optimisticStaged ? optimisticStaged.left  : (round?.staged_left_year  ?? null);
              const stagedR = optimisticStaged ? optimisticStaged.right : (round?.staged_right_year ?? null);
              const isStaged = stagedL !== null || stagedR !== null;
              return (
                <Button
                  onClick={confirmGuess}
                  loading={submitting}
                  disabled={!isStaged}
                  className="flex-1 min-w-[160px]"
                >
                  {!isStaged ? "Click a gap to place the card" : "✓ Confirm guess"}
                </Button>
              );
            })()}
            {(() => {
              const tokens = (activeTeam ? state.tokens?.[activeTeam.id] : []) ?? [];
              const ready  = tokens.filter(t => !t.pending);
              if (ready.length === 0) return null;
              return (
                <Button
                  onClick={() => setTokenTrayOpen(true)}
                  variant="ghost"
                  size="sm"
                  className="flex-shrink-0"
                  title="Use a token"
                >
                  🎟 Tokens ({ready.length})
                </Button>
              );
            })()}
          </div>
        </Panel>
      ) : (
      <Panel className="flex-shrink-0 p-2 flex items-center gap-2">
        <span className="text-base flex-shrink-0">💬</span>
        <input
          value={noteText}
          onChange={e => setNoteText(e.target.value)}
          onKeyDown={e => e.key === "Enter" && sendNote()}
          placeholder="Say something — it'll pop above your head"
          maxLength={100}
          className="flex-1 min-w-0 rounded-lg px-3 py-1.5 text-sm outline-none"
          style={{
            background: "rgba(var(--surface-raised-rgb),0.5)",
            border:     "1px solid rgba(255,255,255,0.1)",
            color:      "inherit",
          }}
        />
        <button onClick={sendNote}
          disabled={!noteText.trim()}
          className="px-3 py-1.5 rounded-lg text-sm font-medium flex-shrink-0 disabled:opacity-40"
          style={{ background: "rgba(var(--color-primary-rgb),0.2)", color: "rgb(var(--color-primary-rgb))" }}>
          Send
        </button>
        {persistentPings.length > 0 && (
          <span className="text-[11px] opacity-50 flex-shrink-0 ml-1">📍 {persistentPings.length}</span>
        )}
      </Panel>
      )}

      {/* ── Spotify-style audio bar at the very bottom (captain only) ──────── */}
      {iAmCaptain && (
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
            myPlayerId={myPlayerId ?? ""}
            totalEligibleVoters={totalEligibleVoters}
            pendingCount={activeTeam?.pending_tracks?.length ?? 0}
            onJudge={judge}
            onFinalize={finalizeJudgment}
            onStop={() => doTurnAction("stop")}
            onNext={() => doTurnAction("next")}
            onProposeYear={proposeYearCorrection}
            onApproveYear={approveYearCorrection}
          />
        );
      })()}

      {/* Hidden audio element — required for WebRTC stream playback on listener clients */}
      {!isDJ && <audio ref={listenAudio.audioRef} style={{ display: "none" }} />}

      {/* ── Token tray ─────────────────────────────────────────────────── */}
      {tokenTrayOpen && activeTeam && (
        <TokenTray
          tokens={(state.tokens?.[activeTeam.id] ?? []).filter(t => !t.pending)}
          onClose={() => setTokenTrayOpen(false)}
          onUse={(t) => useTypedToken(t.type as TokenType)}
        />
      )}

      {/* ── Before-or-After hint (after the captain picks a card) ──────── */}
      {round && round.more_or_less_card_id && (() => {
        const target = (timelines[activeTeam?.id ?? -1] ?? [])
          .find(e => e.track_id === round.more_or_less_card_id);
        if (!target) return null;
        const cardYear = target.corrected_year ?? target.year;
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
    </div>
  );
}

// ── Token tray modal ──────────────────────────────────────────────────────
function TokenTray({
  tokens, onClose, onUse,
}: {
  tokens: TlTeamToken[];
  onClose: () => void;
  onUse:   (token: TlTeamToken) => void;
}) {
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
                    return (
                      <button
                        key={t.id}
                        onClick={() => spec.implemented && onUse(t)}
                        disabled={!spec.implemented}
                        className="text-left rounded-md p-3 transition-all disabled:cursor-not-allowed"
                        style={{
                          background: spec.implemented ? "rgb(var(--surface-raised-rgb))" : "transparent",
                          border:     `1px solid rgba(var(--color-primary-rgb), ${spec.implemented ? 0.4 : 0.15})`,
                          opacity:    spec.implemented ? 1 : 0.55,
                        }}
                      >
                        <p className="font-bold flex items-center gap-2" style={{ fontSize: "var(--text-base)" }}>
                          <span>{spec.icon}</span> {spec.name}
                          {!spec.implemented && (
                            <span
                              className="ml-auto text-[10px] uppercase tracking-wider"
                              style={{ color: "rgb(var(--text-muted-rgb))" }}
                            >
                              soon
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

