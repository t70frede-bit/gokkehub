import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import type {
  TlRoom, TlTeam, TlPlayer, TlRound,
  TlTimelineEntry, TlNote, TlPing, GameState,
} from "../lib/types";

export function useRoom(roomId: string | undefined, myPlayerId: string | undefined) {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

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
      const timelineRes = await supabase
        .from("tl_timeline")
        .select("*")
        .in("team_id", teamIds)
        .order("position");

      const timelines: Record<number, TlTimelineEntry[]> = {};
      for (const t of teamIds) timelines[t] = [];
      for (const entry of (timelineRes.data ?? []) as TlTimelineEntry[]) {
        timelines[entry.team_id] = [...(timelines[entry.team_id] ?? []), entry];
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
        myPlayer: ((playersRes.data ?? []) as TlPlayer[]).find(p => p.id === myPlayerId) ?? null,
      });
    }

    loadAll();

    // Realtime subscriptions
    const channel = supabase
      .channel(`room:${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tl_rooms",   filter: `id=eq.${roomId}` },
        (payload) => setState(s => s ? { ...s, room: payload.new as TlRoom } : s))
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
        (payload) => setState(s => s ? { ...s, notes: [...s.notes, payload.new as TlNote] } : s))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "tl_pings" },
        (payload) => setState(s => s ? { ...s, pings: [...s.pings, payload.new as TlPing] } : s))
      .subscribe();

    channelRef.current = channel;

    return () => {
      cancelled = true;
      channel.unsubscribe();
    };
  }, [roomId, myPlayerId]);

  return { state, error };
}
