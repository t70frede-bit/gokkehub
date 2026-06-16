// Shared TypeScript shapes mirroring the poker_* tables and RPC return types.

export type Role = "player" | "admin";

export type TxType = "deposit" | "withdrawal" | "buy_in" | "cash_out" | "rebuy";
export type TxStatus = "pending" | "confirmed" | "rejected" | "cancelled";
export type SessionStatus = "lobby" | "active" | "finished";
export type EventType = "player_joined" | "rebuy" | "cashout" | "session_ended";

export type MemberStatus = "active" | "pending" | "rejected";

export interface PokerUser {
  id: string;
  username: string;
  email: string | null;
  created_at: string;
  active_group_id: string | null;
  // legacy single-tenant columns (kept on the row but superseded by membership)
  role?: Role;
  balance?: number;
}

export type PaymentType = "mobilepay_box" | "swish" | "paypal" | "revolut" | "vipps" | "other";

/** One of the current user's group memberships (from poker_my_groups). */
export interface MyGroup {
  group_id: string;
  name: string;
  role: Role;
  status: MemberStatus;
  is_active: boolean;
  balance: number;
  payment_type: PaymentType;
  payment_value: string | null;
  invite_token: string;
}

/** A row in a group's member list (admin view, from poker_group_member_list). */
export interface GroupMemberRow {
  member_id: string;
  user_id: string;
  username: string;
  role: Role;
  status: MemberStatus;
  balance: number;
}

export interface Transaction {
  id: string;
  user_id: string;
  group_id: string;
  amount: number;
  type: TxType;
  status: TxStatus;
  tracking_code: string | null;
  note: string | null;
  confirmed_by: string | null;
  session_id: string | null;
  created_at: string;
}

export interface GameSession {
  id: string;
  host_id: string;
  group_id: string;
  status: SessionStatus;
  min_buyin: number;
  max_buyin: number;
  rebuys_enabled: boolean;
  created_at: string;
  finished_at: string | null;
}

export interface GamePlayer {
  id: string;
  session_id: string;
  group_id: string;
  user_id: string;
  total_buyin: number;
  cashout_value: number | null;
  net_result: number | null;
  chip_stack_photo_url: string | null;
  joined_at: string;
  cashed_out_at: string | null;
}

export interface GameEvent {
  id: string;
  session_id: string;
  group_id: string;
  type: EventType;
  user_id: string | null;
  amount: number | null;
  created_at: string;
}

export interface PlayerStats {
  user_id: string;
  username: string;
  created_at: string;
  games_played: number;
  total_won: number;
  total_lost: number;
  net_result: number;
  best_game: number | null;
  worst_game: number | null;
}

export interface LeaderboardRow {
  user_id: string;
  username: string;
  games_played: number;
  total_won: number;
  net_result: number;
  biggest_win: number;
  biggest_loss: number;
}

export interface HistoryRow {
  session_id: string;
  finished_at: string | null;
  status: SessionStatus;
  total_buyin: number;
  cashout_value: number | null;
  net_result: number | null;
}
