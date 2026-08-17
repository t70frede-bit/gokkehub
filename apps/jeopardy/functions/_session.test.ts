import { describe, it, expect } from "vitest";
import { readSession } from "./_session";
import type { Env } from "./_env";

// The local dev identity bypasses the real session cookie, so its two gates
// are security-critical: it must be impossible to reach on a deployed host,
// and impossible to reach without the .dev.vars-only DEV_USER_ID.

const emptyKv = { get: async () => null } as unknown as Env["SESSIONS"];

function env(overrides: Partial<Env> = {}): Env {
  return {
    SESSIONS:                  emptyKv,
    SUPABASE_URL:              "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "not-a-real-key",
    ...overrides,
  };
}

const req = (url: string) => new Request(url, { headers: { Cookie: "gh_session=whatever" } });

describe("readSession — local dev identity", () => {
  it("returns the dev user on localhost when DEV_USER_ID is set", async () => {
    const s = await readSession(env({ DEV_USER_ID: "123", DEV_USER_NAME: "Tester" }), req("http://localhost:8788/game/create"));
    expect(s?.userId).toBe("123");
    expect(s?.displayName).toBe("Tester");
  });

  it("also accepts 127.0.0.1", async () => {
    const s = await readSession(env({ DEV_USER_ID: "123" }), req("http://127.0.0.1:8788/game/create"));
    expect(s?.userId).toBe("123");
  });

  it("refuses on a deployed host even if DEV_USER_ID somehow leaked into prod", async () => {
    const s = await readSession(env({ DEV_USER_ID: "123" }), req("https://jeopardy.gokkehub.com/game/create"));
    expect(s).toBeNull();
  });

  it("refuses on a lookalike hostname", async () => {
    const s = await readSession(env({ DEV_USER_ID: "123" }), req("https://localhost.evil.com/game/create"));
    expect(s).toBeNull();
  });

  it("falls through to the real session when DEV_USER_ID is unset", async () => {
    const s = await readSession(env(), req("http://localhost:8788/game/create"));
    expect(s).toBeNull();
  });
});
