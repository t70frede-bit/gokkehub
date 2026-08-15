import { describe, it, expect } from "vitest";
import { buildSessionCookie, clearSessionCookie, parseSessionId } from "./cookie.ts";
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "./types.ts";

const DOMAIN = ".gokkehub.com";

describe("buildSessionCookie", () => {
  it("carries all the load-bearing security flags", () => {
    const c = buildSessionCookie("sid-123", DOMAIN);
    expect(c).toContain(`${SESSION_COOKIE_NAME}=sid-123`);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Secure");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain(`Domain=${DOMAIN}`);
    expect(c).toContain(`Max-Age=${SESSION_TTL_SECONDS}`);
    expect(c).toContain("Path=/");
  });

  it("honours a custom max-age", () => {
    expect(buildSessionCookie("sid", DOMAIN, 60)).toContain("Max-Age=60");
  });
});

describe("clearSessionCookie", () => {
  it("expires the cookie immediately (Max-Age=0) with an empty value", () => {
    const c = clearSessionCookie(DOMAIN);
    expect(c).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(c).toContain("Max-Age=0");
    expect(c).toContain(`Domain=${DOMAIN}`);
  });
});

describe("parseSessionId", () => {
  it("round-trips the id out of a built cookie", () => {
    // A Set-Cookie is not a Cookie header, but the name=value pair parses the same.
    const header = buildSessionCookie("round-trip-id", DOMAIN).split(";")[0];
    expect(parseSessionId(header)).toBe("round-trip-id");
  });

  it("finds the session id among other cookies", () => {
    expect(parseSessionId(`foo=bar; ${SESSION_COOKIE_NAME}=abc; baz=qux`)).toBe("abc");
  });

  it("returns null when absent, empty, or the header is null", () => {
    expect(parseSessionId(null)).toBeNull();
    expect(parseSessionId("foo=bar")).toBeNull();
    expect(parseSessionId(`${SESSION_COOKIE_NAME}=`)).toBeNull();
  });
});
