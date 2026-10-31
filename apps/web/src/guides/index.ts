import type { GameGuide } from "./types";
import { musixGuide } from "./content/musix";
import { gridchallengeGuide } from "./content/gridchallenge";
import { pokerGuide } from "./content/poker";
import { jeopardyGuide } from "./content/jeopardy";

export type { GameGuide } from "./types";
export { GuidePage } from "./GuidePage";

/**
 * How-to-play guides, keyed by the game's catalogue slug. A game card shows a
 * "How to play" link and gets a /games/<slug> page when its slug is here.
 * Only live games get a guide — "coming soon" games stay concept-only.
 */
export const GUIDES: Record<string, GameGuide> = {
  gridchallenge: gridchallengeGuide,
  musix:         musixGuide,
  poker:         pokerGuide,
  jeopardy:      jeopardyGuide,
};
