import type { Env } from "./_env";
import { updateTeam, updateRoom, logEvent } from "./_supabase";
import type {
  JpBoardConfig, JpGameConfig, JpPowerupType, JpRoom, JpSpecialTile,
  JpSpecialTiles, JpTeam,
} from "../src/lib/types";
import { boardCount, getBoard } from "../src/lib/types";

export function tileValue(board: JpBoardConfig | null, tileKey: string): number {
  const row = Number(tileKey.split("-")[1]);
  return board?.pointValues[row] ?? 0;
}

export function getSpecial(
  secrets: JpSpecialTiles, boardIndex: number, tileKey: string
): JpSpecialTile | null {
  return secrets[`board${boardIndex}`]?.[tileKey] ?? null;
}

export function specialPowerup(special: JpSpecialTile | null): JpPowerupType | null {
  if (special === "powerup_sniper")       return "sniper";
  if (special === "powerup_buffer")       return "buffer";
  if (special === "powerup_secondChance") return "secondChance";
  return null;
}

/**
 * Random special-tile assignment at launch. Each enabled power-up gets one
 * filled tile per board within its row range; Buzzed gets `count` tiles.
 * Tiles look identical to players — the map lives in jp_room_secrets.
 */
export function assignSpecialTiles(config: JpGameConfig): JpSpecialTiles {
  const out: JpSpecialTiles = {};
  for (let b = 0; b < boardCount(config); b++) {
    const board = getBoard(config, b);
    if (!board) continue;
    const used     = new Set<string>();
    const boardKey = `board${b}`;
    out[boardKey]  = {};

    const pickRandom = (rowRange: [number, number]): string | null => {
      const candidates = Object.keys(board.tiles).filter(key => {
        const row = Number(key.split("-")[1]);
        return row >= rowRange[0] && row <= rowRange[1] && !used.has(key);
      });
      if (!candidates.length) return null;
      const key = candidates[Math.floor(Math.random() * candidates.length)];
      used.add(key);
      return key;
    };

    const p = config.powerups;
    if (p?.sniper.enabled) {
      const k = pickRandom(p.sniper.rowRange);
      if (k) out[boardKey][k] = "powerup_sniper";
    }
    if (p?.buffer.enabled) {
      const k = pickRandom(p.buffer.rowRange);
      if (k) out[boardKey][k] = "powerup_buffer";
    }
    if (p?.secondChance.enabled) {
      const k = pickRandom(p.secondChance.rowRange);
      if (k) out[boardKey][k] = "powerup_secondChance";
    }
    const dz = config.dangerous?.buzzed;
    if (dz?.enabled) {
      for (let i = 0; i < dz.count; i++) {
        const k = pickRandom(dz.rowRange);
        if (k) out[boardKey][k] = "buzzed";
      }
    }
  }
  return out;
}

/**
 * Resolve the public take-points-or-claim-power-up choice. Shared by the
 * player endpoint (powerup-choice.ts) and the host force action.
 */
export async function resolvePowerupChoice(
  env: Env, room: JpRoom, teams: JpTeam[], choice: "points" | "powerup"
): Promise<{ error?: string }> {
  const prompt = room.board_state.powerupPrompt;
  if (!prompt) return { error: "No power-up choice pending" };

  const team = teams.find(t => t.id === prompt.teamId);
  if (!team) return { error: "Team missing" };

  if (choice === "points") {
    await updateTeam(env, team.id, { score: team.score + prompt.value });
    await logEvent(env, room.id, "powerup_declined", {
      team_id: team.id,
      payload: { powerupType: prompt.powerupType, tookPoints: prompt.value, tileKey: prompt.tileKey },
    });
    await logEvent(env, room.id, "answer_correct", {
      team_id: team.id,
      payload: { tileKey: prompt.tileKey, pointsDelta: prompt.value },
    });
  } else {
    const swapped = team.powerup !== null;
    await updateTeam(env, team.id, { powerup: prompt.powerupType });
    await logEvent(env, room.id, swapped ? "powerup_swapped" : "powerup_claimed", {
      team_id: team.id,
      payload: { powerupType: prompt.powerupType, replaced: team.powerup, tileKey: prompt.tileKey },
    });
    await logEvent(env, room.id, "answer_correct", {
      team_id: team.id,
      payload: { tileKey: prompt.tileKey, pointsDelta: 0, claimedPowerup: prompt.powerupType },
    });
  }

  await updateRoom(env, room.id, {
    board_state: { ...room.board_state, powerupPrompt: null },
  });
  return {};
}
