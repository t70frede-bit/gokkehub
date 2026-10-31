import { describe, it, expect } from "vitest";
import { toPublicSession } from "./session.ts";
import type { SessionData } from "./types.ts";

// A fully-populated session with real OAuth tokens in every provider block.
const fullSession: SessionData = {
  userId: "user-1",
  email: "player@example.com",
  displayName: "Player One",
  avatarUrl: "https://cdn/avatar.png",
  steamId: "7656119",
  buzzerSound: "preset:airhorn",
  spotify: {
    id: "sp-1",
    accessToken: "SPOTIFY_ACCESS_SECRET",
    refreshToken: "SPOTIFY_REFRESH_SECRET",
    expiresAt: 1_700_000_000_000,
    displayName: "sp name",
    imageUrl: null,
    scope: "user-read-email playlist-read-private",
  },
  discord: {
    id: "dc-1",
    accessToken: "DISCORD_ACCESS_SECRET",
    refreshToken: "DISCORD_REFRESH_SECRET",
    expiresAt: 1_700_000_000_000,
    username: "player#1",
    avatarUrl: null,
  },
  steam: { steamId: "7656119", displayName: "steam name", avatarUrl: null },
  lastfm: { username: "lfm_player", linkedAt: 1_690_000_000_000 },
  createdAt: 1,
  expiresAt: 2,
};

describe("toPublicSession (security: never leak tokens)", () => {
  const pub = toPublicSession(fullSession);
  const serialized = JSON.stringify(pub);

  it("never includes any access or refresh token", () => {
    expect(serialized).not.toContain("ACCESS_SECRET");
    expect(serialized).not.toContain("REFRESH_SECRET");
    // and no raw provider blocks survive
    expect((pub as Record<string, unknown>).spotify).toBeUndefined();
    expect((pub as Record<string, unknown>).discord).toBeUndefined();
  });

  it("exposes only the safe subset", () => {
    expect(pub.userId).toBe("user-1");
    expect(pub.email).toBe("player@example.com");
    expect(pub.spotifyScopes).toBe("user-read-email playlist-read-private");
    expect(pub.lastfmUsername).toBe("lfm_player");
    expect(pub.linked).toEqual({ spotify: true, discord: true, google: false, steam: true, lastfm: true });
  });

  it("prefers the linked Steam account over a typed Steam ID", () => {
    const p = toPublicSession({ ...fullSession, steamId: "typed-vanity" });
    expect(p.steamId).toBe("7656119");
    const typedOnly = toPublicSession({ ...fullSession, steam: undefined, steamId: "typed-vanity" });
    expect(typedOnly.steamId).toBe("typed-vanity");
  });

  it("reports linked:false for absent providers", () => {
    const bare: SessionData = {
      userId: "u",
      email: null,
      displayName: null,
      avatarUrl: null,
      createdAt: 1,
      expiresAt: 2,
    };
    const p = toPublicSession(bare);
    expect(p.linked).toEqual({ spotify: false, discord: false, google: false, steam: false, lastfm: false });
    expect(p.lastfmUsername).toBeNull();
  });
});
