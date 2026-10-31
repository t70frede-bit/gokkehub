import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Minimal in-memory stand-in for the supabase-js query builder ────────────
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};

function query(table: string) {
  const rows = () => (tables[table] ??= []);
  const filters: [string, unknown][] = [];
  let op: "select" | "delete" | "update" = "select";
  let patch: Row = {};
  const match = (r: Row) => filters.every(([k, v]) => r[k] === v);
  const run = () => {
    if (op === "delete") tables[table] = rows().filter((r) => !match(r));
    if (op === "update") rows().filter(match).forEach((r) => Object.assign(r, patch));
    const data = rows().filter(match);
    return { data, error: null, count: data.length };
  };
  const b = {
    select: () => b,
    delete: () => { op = "delete"; return b; },
    update: (p: Row) => { op = "update"; patch = p; return b; },
    eq: (k: string, v: unknown) => { filters.push([k, v]); return b; },
    maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
    single: async () => ({ data: run().data[0], error: null }),
    then: (res: (v: unknown) => void) => res(run()),
    upsert: async (row: Row, opts: { onConflict: string; ignoreDuplicates?: boolean }) => {
      const keys = opts.onConflict.split(",");
      const hit = rows().find((r) => keys.every((k) => r[k] === row[k]));
      if (hit) { if (!opts.ignoreDuplicates) Object.assign(hit, row); }
      else rows().push({ ...row });
      return { error: null };
    },
  };
  return b;
}

vi.mock("@gokkehub/db/supabase", () => ({
  createSupabaseAdminClient: () => ({ from: query }),
}));

const { resolveLogin, buildSessionData, IdentityTakenError } = await import("../functions/_accounts");

const kvStore = new Map<string, string>();
const env = {
  SESSIONS: {
    get: async (k: string) => kvStore.get(k) ?? null,
    put: async (k: string, v: string) => { kvStore.set(k, v); },
    delete: async (k: string) => { kvStore.delete(k); },
  },
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "k",
} as never;

const discord = (id: string) => ({ provider: "discord" as const, providerUserId: id, displayName: `d${id}`, avatarUrl: null });
const spotify = (id: string) => ({ provider: "spotify" as const, providerUserId: id, displayName: `s${id}`, avatarUrl: null });

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  kvStore.clear();
});

describe("resolveLogin", () => {
  it("keeps the legacy id for a first Discord / Spotify sign-in", async () => {
    expect(await resolveLogin(env, discord("123"), null)).toBe("123");
    expect(await resolveLogin(env, spotify("abc"), null)).toBe("sp:abc");
    expect(tables.gh_users.map((u) => u.id)).toEqual(["123", "sp:abc"]);
  });

  it("returns the same user on the next sign-in", async () => {
    await resolveLogin(env, discord("123"), null);
    expect(await resolveLogin(env, discord("123"), null)).toBe("123");
    expect(tables.gh_users).toHaveLength(1);
  });

  it("links a second provider while signed in, then signs in through it", async () => {
    await resolveLogin(env, discord("123"), null);
    const session = { userId: "123", email: null, displayName: "d123", avatarUrl: null, createdAt: 0, expiresAt: 0 };
    expect(await resolveLogin(env, spotify("abc"), session)).toBe("123");
    expect(await resolveLogin(env, spotify("abc"), null)).toBe("123");
  });

  it("refuses to join two accounts that both have game data", async () => {
    await resolveLogin(env, spotify("abc"), null);
    await resolveLogin(env, discord("123"), null);
    tables.player_games = [{ user_id: "sp:abc" }, { user_id: "123" }];
    const session = { userId: "123", email: null, displayName: null, avatarUrl: null, createdAt: 0, expiresAt: 0 };
    await expect(resolveLogin(env, spotify("abc"), session)).rejects.toBeInstanceOf(IdentityTakenError);
  });

  it("folds a new empty Google account into the Discord one", async () => {
    await resolveLogin(env, discord("123"), null);
    tables.player_games = [{ user_id: "123" }];
    const google = { provider: "google" as const, providerUserId: "g1", displayName: "G", avatarUrl: "pic" };
    const gid = await resolveLogin(env, google, null);
    // Signed in with Google, now links Discord → joins into the Discord account.
    const session = { userId: gid, email: null, displayName: "G", avatarUrl: "pic", createdAt: 0, expiresAt: 0 };
    expect(await resolveLogin(env, discord("123"), session)).toBe("123");
    expect(tables.gh_users.map((u) => u.id)).toEqual(["123"]);
    expect(await resolveLogin(env, google, null)).toBe("123");
    expect(tables.gh_users[0].avatar_url).toBe("pic");
  });

  it("folds the other account in when the current one has the data", async () => {
    await resolveLogin(env, spotify("abc"), null);           // empty sp:abc
    await resolveLogin(env, discord("123"), null);
    tables.player_games = [{ user_id: "123" }];
    const session = { userId: "123", email: null, displayName: null, avatarUrl: null, createdAt: 0, expiresAt: 0 };
    expect(await resolveLogin(env, spotify("abc"), session)).toBe("123");
    expect(tables.gh_users.map((u) => u.id)).toEqual(["123"]);
  });

  it("gives a Google sign-up a new uuid and finds it again", async () => {
    const google = { provider: "google" as const, providerUserId: "g-sub-1", displayName: "G", avatarUrl: null };
    const id = await resolveLogin(env, google, null);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await resolveLogin(env, google, null)).toBe(id);
    expect((await buildSessionData(env, id)).google?.id).toBe("g-sub-1");
  });

  it("imports the old KV Last.fm link on first sign-in", async () => {
    kvStore.set("lastfm_link:123", "Freddy");
    await resolveLogin(env, discord("123"), null);
    const s = await buildSessionData(env, "123");
    expect(s.lastfm?.username).toBe("Freddy");
    expect(s.discord?.id).toBe("123");
  });
});
