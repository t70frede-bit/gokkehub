export type ChallengeType = "single" | "group" | "versus";
export type GameSource = "steam" | "discord" | "manual";

export interface PlayerGame {
  id:             string;
  user_id:        string;
  display_name:   string;
  normalized_key: string;
  source:         GameSource;
  steam_app_id:   number | null;
  is_favorite:    boolean;
}

export interface PlayerChallenge {
  id:           string;
  user_id:      string;
  player_name:  string;
  text:         string;
  type:         ChallengeType;
  game:         string;
  upvote_count: number;
  created_at:   string;
}
