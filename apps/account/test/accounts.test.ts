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
    return { data: rows().filter(match), error: null };
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

const { resolveLogin, buildSessionData, IdentityTakenError } = await import("./_accounts");

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

  it("refuses to link an account owned by someone else", async () => {
    await resolveLogin(env, spotify("abc"), null);
    await resolveLogin(env, discord("123"), null);
    const session = { userId: "123", email: null, displayName: null, avatarUrl: null, createdAt: 0, expiresAt: 0 };
    await expect(resolveLogin(env, spotify("abc"), session)).rejects.toBeInstanceOf(IdentityTakenError);
  });

  it("imports the old KV Last.fm link on first sign-in", async () => {
    kvStore.set("lastfm_link:123", "Freddy");
    await resolveLogin(env, discord("123"), null);
    const s = await buildSessionData(env, "123");
    expect(s.lastfm?.username).toBe("Freddy");
    expect(s.discord?.id).toBe("123");
  });
});
