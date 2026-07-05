import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { JpGame, JpPlayer, JpRoom, JpTeam } from "../lib/types";

// Device identity for a room, same scheme as timelinedrop's tl_player_ keys.
export function getStoredPlayerId(roomId: string): string | null {
  return localStorage.getItem(`jp_player_${roomId}`);
}
export function storePlayerId(roomId: string, playerId: string): void {
  localStorage.setItem(`jp_player_${roomId}`, playerId);
}

interface RoomState {
  room:    JpRoom | null;
  game:    JpGame | null;
  teams:   JpTeam[];
  players: JpPlayer[];
  loading: boolean;
  error:   string | null;
}

// One channel per room; live state flows through postgres_changes on the
// jp_* tables (mirrors timelinedrop's useRoom). The room row carries
// board_state; teams/players are refetched on change — they're tiny.
export function useRoom(roomId: string | undefined): RoomState {
  const [state, setState] = useState<RoomState>({
    room: null, game: null, teams: [], players: [], loading: true, error: null,
  });

  useEffect(() => {
    if (!roomId) {
      setState(s => ({ ...s, loading: false, error: "No room code" }));
      return;
    }
    let cancelled = false;

    const fetchTeams = async () => {
      const { data } = await supabase.from("jp_teams").select("*")
        .eq("room_id", roomId).order("sort_order", { ascending: true });
      if (!cancelled && data) setState(s => ({ ...s, teams: data as JpTeam[] }));
    };
    const fetchPlayers = async () => {
      const { data } = await supabase.from("jp_players").select("*").eq("room_id", roomId);
      if (!cancelled && data) setState(s => ({ ...s, players: data as JpPlayer[] }));
    };

    (async () => {
      const { data: room, error } = await supabase.from("jp_rooms").select("*")
        .eq("id", roomId).maybeSingle();
      if (cancelled) return;
      if (error || !room) {
        setState(s => ({ ...s, loading: false, error: "Room not found" }));
        return;
      }
      const r = room as JpRoom;
      const [{ data: game }] = await Promise.all([
        supabase.from("jp_games").select("*").eq("id", r.game_id).maybeSingle(),
        fetchTeams(),
        fetchPlayers(),
      ]);
      if (cancelled) return;
      setState(s => ({
        ...s,
        room:    r,
        game:    (game as JpGame) ?? null,
        loading: false,
        error:   game ? null : "Game config missing",
      }));
    })();

    const channel = supabase
      .channel(`room:${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "jp_rooms", filter: `id=eq.${roomId}` },
        payload => {
          if (payload.eventType === "UPDATE" || payload.eventType === "INSERT") {
            setState(s => ({ ...s, room: payload.new as JpRoom }));
          }
        })
      .on("postgres_changes", { event: "*", schema: "public", table: "jp_teams", filter: `room_id=eq.${roomId}` },
        () => { void fetchTeams(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "jp_players", filter: `room_id=eq.${roomId}` },
        () => { void fetchPlayers(); })
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [roomId]);

  return state;
}
