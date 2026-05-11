import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import type {
  TlRoom, TlTeam, TlPlayer, TlRound,
  TlTimelineEntry, TlNote, TlPing, TlTeamToken, GameState,
} from "../lib/types";

export function useRoom(roomId: string | undefined, myPlayerId: string | undefined) {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Consumer calls this once it has finished rendering the activation animation
  // so the same record won't replay if state is reloaded.
  const clearTokenActivation = useCallback(() => {
    setState(s => s && s.tokenActivation ? { ...s, tokenActivation: null } : s);
  }, []);

  useEffect(() => {
    if (!roomId) return;

    let cancelled = false;

    async function loadAll() {
      const [roomRes, teamsRes, playersRes] = await Promise.all([
        supabase.from("tl_rooms").select("*").eq("id", roomId).single(),
        supabase.from("tl_teams").select("*").eq("room_id", roomId).order("sort_order"),
        supabase.from("tl_players").select("*").eq("room_id", roomId),
      ]);

      if (roomRes.error) { setError(roomRes.error.message); return; }
      const room = roomRes.data as TlRoom;

      // Load timeline for all teams
      const teamIds = (teamsRes.data as TlTeam[]).map(t => t.id);
      const [timelineRes, tokensRes] = await Promise.all([
        supabase.from("tl_timeline").select("*").in("team_id", teamIds).order("position"),
        supabase.from("tl_team_tokens").select("*").eq("room_id", roomId).is("used_at", null),
      ]);

      const timelines: Record<number, TlTimelineEntry[]> = {};
      for (const t of teamIds) timelines[t] = [];
      for (const entry of (timelineRes.data ?? []) as TlTimelineEntry[]) {
        timelines[entry.team_id] = [...(timelines[entry.team_id] ?? []), entry];
      }

      const tokens: Record<number, TlTeamToken[]> = {};
      for (const t of teamIds) tokens[t] = [];
      for (const tk of (tokensRes.data ?? []) as TlTeamToken[]) {
        tokens[tk.team_id] = [...(tokens[tk.team_id] ?? []), tk];
      }

      // Load current round
      let round: TlRound | null = null;
      if (room.current_round_id) {
        const roundRes = await supabase.from("tl_rounds").select("*").eq("id", room.current_round_id).single();
        round = (roundRes.data as TlRound) ?? null;
      }

      // Load notes + pings for current round
      let notes: TlNote[] = [];
      let pings: TlPing[] = [];
      if (round) {
        const [notesRes, pingsRes] = await Promise.all([
          supabase.from("tl_notes").select("*").eq("round_id", round.id).order("created_at"),
          supabase.from("tl_pings").select("*").eq("round_id", round.id).order("created_at"),
        ]);
        notes = (notesRes.data ?? []) as TlNote[];
        pings = (pingsRes.data ?? []) as TlPing[];
      }

      if (cancelled) return;

      setState({
        room,
        teams:    (teamsRes.data ?? []) as TlTeam[],
        players:  (playersRes.data ?? []) as TlPlayer[],
        round,
        timelines,
        notes,
        pings,
        tokens,
        myPlayer: ((playersRes.data ?? []) as TlPlayer[]).find(p => p.id === myPlayerId) ?? null,
        tokenActivation: null,
      });
    }

    loadAll();

    // Tokens that have already animated this session. Postgres only fires
    // UPDATE events for changes after we subscribe, but the same row can be
    // re-emitted on reconnect — dedupe by id so the animation never replays.
    const seenActivations = new Set<number>();

    // Realtime subscriptions
    const channel = supabase
      .channel(`room:${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tl_rooms",   filter: `id=eq.${roomId}` },
        (payload) => {
          const newRoom = payload.new as TlRoom;
          setState(s => {
            if (!s) return s;
            // CRITICAL: if the room has advanced to a new round but state.round
            // still points at the previous (resolved, outcome="correct") one,
            // we MUST clear state.round in the same render — otherwise the
            // RevealOverlay (which renders on state.round.outcome) stays
            // mounted on top of the page until the round refetch resolves.
            // If that refetch is slow or fails, the screen stays "blacked out"
            // until the user reloads. Clearing state.round here lets the page
            // render normally (timelines visible, empty audio bar) while we
            // fetch the new round in the background.
            const advancedPastCurrentRound =
              typeof newRoom.current_round_id === "number" &&
              newRoom.current_round_id !== (s.round?.id ?? null);
            if (advancedPastCurrentRound) {
              supabase.from("tl_rounds").select("*").eq("id", newRoom.current_round_id).single()
                .then(r => {
                  if (r.error) {
                    console.warn("[musix] fallback round fetch failed:", r.error.message);
                    return;
                  }
                  if (!r.data) return;
                  const fetched = r.data as TlRound;
                  setState(s2 => {
                    if (!s2) return s2;
                    const wm = Math.max(s2.room.current_round_id ?? 0, s2.round?.id ?? 0);
                    if (fetched.id < wm) return s2;
                    return { ...s2, round: fetched };
                  });
                });
            }
            return {
              ...s,
              room: newRoom,
              // Clear the stale round so the resolved reveal overlay dismounts
              // immediately. Will be repopulated by the refetch above (or by
              // the tl_rounds INSERT event if it arrives first).
              round: advancedPastCurrentRound ? null : s.round,
            };
          });
        })
      .on("postgres_changes", { event: "*", schema: "public", table: "tl_teams",   filter: `room_id=eq.${roomId}` },
        () => supabase.from("tl_teams").select("*").eq("room_id", roomId).order("sort_order")
          .then(r => setState(s => s ? { ...s, teams: (r.data ?? []) as TlTeam[] } : s)))
      .on("postgres_changes", { event: "*", schema: "public", table: "tl_players", filter: `room_id=eq.${roomId}` },
        () => supabase.from("tl_players").select("*").eq("room_id", roomId)
          .then(r => setState(s => s ? {
            ...s,
            players:  (r.data ?? []) as TlPlayer[],
            myPlayer: ((r.data ?? []) as TlPlayer[]).find(p => p.id === myPlayerId) ?? s.myPlayer,
          } : s)))
      .on("postgres_changes", { event: "*", schema: "public", table: "tl_rounds",  filter: `room_id=eq.${roomId}` },
        (payload) => {
          const newRound = payload.new as TlRound;
          setState(s => {
            if (!s) return s;
            // Server-side update flow on a turn change is:
            //   UPDATE old round (bonus_awarded) → INSERT new round → UPDATE tl_rooms.
            // Realtime delivery is NOT ordered across tables, so the UPDATE for
            // the old round can land AFTER the INSERT for the new one. If we
            // only checked against state.room.current_round_id we'd accept the
            // stale UPDATE (current_round_id hasn't propagated yet → its id
            // still equals current) and overwrite state.round with a row whose
            // outcome="correct" — the reveal modal stays mounted (black-screen
            // bug).
            //
            // Watermark on the highest round id we've ever accepted instead.
            // Once we've seen R2, no UPDATE on R1 can replace it.
            const watermark = Math.max(
              s.room.current_round_id ?? 0,
              s.round?.id              ?? 0,
            );
            if (newRound.id < watermark) return s;
            // If new round ID, reload notes/pings
            if (newRound.id !== s.round?.id) {
              supabase.from("tl_notes").select("*").eq("round_id", newRound.id).order("created_at")
                .then(r => setState(s2 => s2 ? { ...s2, notes: (r.data ?? []) as TlNote[] } : s2));
              supabase.from("tl_pings").select("*").eq("round_id", newRound.id).order("created_at")
                .then(r => setState(s2 => s2 ? { ...s2, pings: (r.data ?? []) as TlPing[] } : s2));
            }
            return { ...s, round: newRound };
          });
        })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "tl_timeline" },
        (payload) => {
          const inserted = payload.new as TlTimelineEntry;
          setState(s => {
            if (!s) return s;
            const teamIds = s.teams.map(t => t.id);
            // Ignore inserts from other rooms
            if (!teamIds.includes(inserted.team_id)) return s;
            // Reload timelines for this room's teams only
            supabase.from("tl_timeline")
              .select("*")
              .in("team_id", teamIds)
              .order("position")
              .then(r => {
                const timelines: Record<number, TlTimelineEntry[]> = {};
                for (const id of teamIds) timelines[id] = [];
                for (const entry of (r.data ?? []) as TlTimelineEntry[]) {
                  timelines[entry.team_id] = [...(timelines[entry.team_id] ?? []), entry];
                }
                setState(s2 => s2 ? { ...s2, timelines } : s2);
              });
            return s;
          });
        })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "tl_notes" },
        (payload) => setState(s => {
          if (!s) return s;
          const note = payload.new as TlNote;
          // Only accept notes for the round we're currently displaying
          if (s.round && note.round_id !== s.round.id) return s;
          // Avoid duplicate inserts (some realtime drivers re-emit on reconnect)
          if (s.notes.some(n => n.id === note.id)) return s;
          return { ...s, notes: [...s.notes, note] };
        }))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "tl_pings" },
        (payload) => setState(s => {
          if (!s) return s;
          const ping = payload.new as TlPing;
          if (s.round && ping.round_id !== s.round.id) return s;
          if (s.pings.some(p => p.id === ping.id)) return s;
          return { ...s, pings: [...s.pings, ping] };
        }))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "tl_pings" },
        (payload) => setState(s => {
          if (!s) return s;
          // payload.old has at least the primary key under REPLICA IDENTITY DEFAULT
          const removedId = (payload.old as { id?: number }).id;
          if (typeof removedId !== "number") return s;
          return { ...s, pings: s.pings.filter(p => p.id !== removedId) };
        }))
      .on("postgres_changes", { event: "*", schema: "public", table: "tl_team_tokens", filter: `room_id=eq.${roomId}` },
        (payload) => {
          // Detect activation: an UPDATE whose new.used_at is set. used_at is
          // a one-way flag (granted → used, never reverted), so any UPDATE
          // with used_at populated represents a fresh activation. The default
          // REPLICA IDENTITY only returns the PK on old, so we can't compare
          // old.used_at — dedupe by token id instead.
          if (payload.eventType === "UPDATE") {
            const row = payload.new as TlTeamToken;
            if (row.used_at && !seenActivations.has(row.id)) {
              seenActivations.add(row.id);
              setState(s => s ? {
                ...s,
                tokenActivation: {
                  tokenId:     row.id,
                  tokenType:   row.type,
                  teamId:      row.team_id,
                  triggeredAt: Date.now(),
                },
              } : s);
            }
          }
          supabase.from("tl_team_tokens").select("*").eq("room_id", roomId).is("used_at", null)
            .then(r => setState(s => {
              if (!s) return s;
              const tokens: Record<number, TlTeamToken[]> = {};
              for (const t of s.teams) tokens[t.id] = [];
              for (const tk of (r.data ?? []) as TlTeamToken[]) {
                tokens[tk.team_id] = [...(tokens[tk.team_id] ?? []), tk];
              }
              return { ...s, tokens };
            }));
        })
      .subscribe();

    channelRef.current = channel;

    return () => {
      cancelled = true;
      channel.unsubscribe();
    };
  }, [roomId, myPlayerId]);

  return { state, error, clearTokenActivation };
}
