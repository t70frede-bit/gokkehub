import { describe, it, expect } from "vitest";
import { beginOAuth, finishOAuth, OAUTH_STATE_COOKIE } from "./oauth-state.ts";

function memoryKv() {
  const store = new Map<string, string>();
  return {
    store,
    kv: {
      get:    async (k: string) => store.get(k) ?? null,
      put:    async (k: string, v: string) => { store.set(k, v); },
      delete: async (k: string) => { store.delete(k); },
    } as unknown as KVNamespace,
  };
}

const callback = (state: string | null, cookie: string | null) =>
  new Request(
    `https://account.gokkehub.com/auth/discord/callback?code=c${state ? `&state=${state}` : ""}`,
    { headers: cookie ? { Cookie: cookie } : {} },
  );

describe("oauth state", () => {
  it("round-trips the return URL once, in the same browser", async () => {
    const { kv } = memoryKv();
    const { state, cookie } = await beginOAuth(kv, "https://musix.gokkehub.com/lobby/x");
    expect(cookie).toContain(`${OAUTH_STATE_COOKIE}=${state}`);
    expect(cookie).toContain("HttpOnly");

    const cookieHeader = `gh_session=abc; ${OAUTH_STATE_COOKIE}=${state}`;
    expect(await finishOAuth(kv, callback(state, cookieHeader)))
      .toEqual({ ok: true, returnTo: "https://musix.gokkehub.com/lobby/x" });

    // single use
    expect(await finishOAuth(kv, callback(state, cookieHeader))).toEqual({ ok: false });
  });

  it("stores no return URL for an unsafe one", async () => {
    const { kv } = memoryKv();
    const { state } = await beginOAuth(kv, "https://evil.com/");
    expect(await finishOAuth(kv, callback(state, `${OAUTH_STATE_COOKIE}=${state}`)))
      .toEqual({ ok: true, returnTo: null });
  });

  it("rejects a missing or mismatched state (login CSRF)", async () => {
    const { kv } = memoryKv();
    const { state } = await beginOAuth(kv, null);
    expect(await finishOAuth(kv, callback(null, `${OAUTH_STATE_COOKIE}=${state}`))).toEqual({ ok: false });
    expect(await finishOAuth(kv, callback(state, null))).toEqual({ ok: false });
    // attacker's own valid state, but the victim's browser has no matching cookie
    expect(await finishOAuth(kv, callback(state, `${OAUTH_STATE_COOKIE}=other`))).toEqual({ ok: false });
  });
});
