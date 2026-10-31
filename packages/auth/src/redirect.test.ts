import { describe, it, expect } from "vitest";
import { safeReturnUrl, loginUrl, linkSteamUrl } from "./redirect.ts";

describe("safeReturnUrl", () => {
  it("accepts https gokkehub.com and its subdomains", () => {
    expect(safeReturnUrl("https://gokkehub.com/join?room=AB12")).toBe("https://gokkehub.com/join?room=AB12");
    expect(safeReturnUrl("https://musix.gokkehub.com/lobby/xyz")).toBe("https://musix.gokkehub.com/lobby/xyz");
    expect(safeReturnUrl("https://partybingo.gokkehub.com/")).toBe("https://partybingo.gokkehub.com/");
  });

  it("rejects other hosts and look-alikes", () => {
    expect(safeReturnUrl("https://evil.com/")).toBeNull();
    expect(safeReturnUrl("https://gokkehub.com.evil.com/")).toBeNull();
    expect(safeReturnUrl("https://evilgokkehub.com/")).toBeNull();
    expect(safeReturnUrl("https://gokkehub.com@evil.com/")).toBeNull();
  });

  it("rejects non-https, credentials, ports, relative and junk input", () => {
    expect(safeReturnUrl("http://musix.gokkehub.com/")).toBeNull();
    expect(safeReturnUrl("javascript:alert(1)")).toBeNull();
    expect(safeReturnUrl("https://user:pw@musix.gokkehub.com/")).toBeNull();
    expect(safeReturnUrl("https://musix.gokkehub.com:8443/")).toBeNull();
    expect(safeReturnUrl("/profile")).toBeNull();
    expect(safeReturnUrl("//evil.com")).toBeNull();
    expect(safeReturnUrl("")).toBeNull();
    expect(safeReturnUrl(null)).toBeNull();
    expect(safeReturnUrl(`https://gokkehub.com/${"a".repeat(3000)}`)).toBeNull();
  });
});

describe("loginUrl", () => {
  it("carries a safe return URL", () => {
    expect(loginUrl("https://musix.gokkehub.com/lobby/x")).toBe(
      "https://account.gokkehub.com/login?redirect=https%3A%2F%2Fmusix.gokkehub.com%2Flobby%2Fx",
    );
  });

  it("drops an unsafe return URL", () => {
    expect(loginUrl("https://evil.com/")).toBe("https://account.gokkehub.com/login");
    expect(loginUrl()).toBe("https://account.gokkehub.com/login");
  });
});

describe("linkSteamUrl", () => {
  it("carries a safe return URL", () => {
    expect(linkSteamUrl("https://partybingo.gokkehub.com/lobby/abc")).toBe(
      "https://account.gokkehub.com/auth/steam?redirect=https%3A%2F%2Fpartybingo.gokkehub.com%2Flobby%2Fabc",
    );
  });

  it("drops an unsafe return URL", () => {
    expect(linkSteamUrl("https://evil.com/")).toBe("https://account.gokkehub.com/auth/steam");
  });
});
