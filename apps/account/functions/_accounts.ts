/**
 * GokkeHub accounts — the persistent identity behind a KV session.
 *
 *   gh_users       one row per person (id = the user id games store)
 *   gh_identities  one row per linked provider account
 *
 * Login resolves the provider account to a gh_users row (creating it on first
 * sign-in), then builds the KV SessionData from the database. Everything a
 * user links or edits is written here too, so nothing is lost on logout.
 *
 * Existing users keep their old id: a Discord sign-up's id is the Discord
 * snowflake and a Spotify sign-up's is "sp:<spotify id>", exactly what the
 * KV-only sessions used, so game data keyed by user id still matches.
 *
 * Service-role only (see apps/account/supabase-migration-001-accounts.sql).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@gokkehub/db/supabase";
import type { SessionData } from "@gokkehub/auth/types";
import { createSession, getSession, getSessionId, updateSession } from "@gokkehub/auth/session";
import { buildSessionCookie } from "@gokkehub/auth/cookie";
import type { Env } from "./_env";

export type Provider = "discord" | "google" | "spotify" | "steam" | "lastfm";

/** Providers you can sign in with. Steam and Last.fm are link-only. */
export const SIGN_IN_PROVIDERS: Provider[] = ["discord", "google", "spotify"];

export interface UserRow {
  id:           string;
  display_name: string | null;
  avatar_url:   string | null;
  email:        string | null;
  steam_id:     string | null;
}

export interface IdentityRow {
  provider:         Provider;
  provider_user_id: string;
  user_id:          string;
  display_name:     string | null;
  avatar_url:       string | null;
  refresh_token:    string | null;
  scope:            string | null;
}

export interface ProviderAccount {
  provider:       Provider;
  providerUserId: string;
  displayName:    string | null;
  avatarUrl:      string | null;
  email?:         string | null;
  refreshToken?:  string | null;
  scope?:         string | null;
}

export class IdentityTakenError extends Error {
  constructor(public provider: Provider) {
    super(`This ${provider} account is already linked to another GokkeHub account.`);
  }
}

export function db(env: Env): SupabaseClient {
  // The generated Database type doesn't know the gh_ tables yet.
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL || "";
  return createSupabaseAdminClient(url, env.SUPABASE_SERVICE_ROLE_KEY) as unknown as SupabaseClient;
}

async function findIdentity(sb: SupabaseClient, provider: Provider, providerUserId: string) {
  const { data, error } = await sb.from("gh_identities").select("*")
    .eq("provider", provider).eq("provider_user_id", providerUserId).maybeSingle();
  if (error) throw error;
  return data as IdentityRow | null;
}

async function ensureUser(sb: SupabaseClient, id: string, seed: Partial<UserRow>) {
  const { error } = await sb.from("gh_users")
    .upsert({ id, ...seed }, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw error;
}

/**
 * Attach a provider account to `userId`, replacing that user's previous
 * account for the same provider. Throws IdentityTakenError if the provider
 * account belongs to someone else.
 */
export async function linkIdentity(sb: SupabaseClient, userId: string, acct: ProviderAccount) {
  const existing = await findIdentity(sb, acct.provider, acct.providerUserId);
  if (existing && existing.user_id !== userId) throw new IdentityTakenError(acct.provider);

  if (!existing) {
    const { error } = await sb.from("gh_identities").delete()
      .eq("user_id", userId).eq("provider", acct.provider);
    if (error) throw error;
  }

  const row: Record<string, unknown> = {
    provider:         acct.provider,
    provider_user_id: acct.providerUserId,
    user_id:          userId,
    display_name:     acct.displayName,
    avatar_url:       acct.avatarUrl,
    updated_at:       new Date().toISOString(),
  };
  // Keep a stored refresh token unless a new one came with this login.
  if (acct.refreshToken) row.refresh_token = acct.refreshToken;
  if (acct.scope)        row.scope = acct.scope;

  const { error } = await sb.from("gh_identities").upsert(row, { onConflict: "provider,provider_user_id" });
  if (error) throw error;
}

export async function unlinkIdentity(sb: SupabaseClient, userId: string, provider: Provider) {
  const { error } = await sb.from("gh_identities").delete()
    .eq("user_id", userId).eq("provider", provider);
  if (error) throw error;
}

/** Number of sign-in methods left after removing `provider`. */
export async function signInMethodsWithout(sb: SupabaseClient, userId: string, provider: Provider) {
  const { data, error } = await sb.from("gh_identities").select("provider").eq("user_id", userId);
  if (error) throw error;
  return (data as { provider: Provider }[])
    .filter((r) => r.provider !== provider && SIGN_IN_PROVIDERS.includes(r.provider)).length;
}

export async function updateUser(sb: SupabaseClient, userId: string, fields: Partial<Omit<UserRow, "id">>) {
  const { error } = await sb.from("gh_users")
    .update({ ...fields, updated_at: new Date().toISOString() }).eq("id", userId);
  if (error) throw error;
}

/**
 * Make sure a signed-in session's user exists in gh_users. Sessions created
 * before accounts existed have no row yet; seed it from the session.
 */
export async function ensureSessionUser(sb: SupabaseClient, session: SessionData) {
  await ensureUser(sb, session.userId, {
    display_name: session.displayName,
    avatar_url:   session.avatarUrl,
    email:        session.email,
    steam_id:     session.steamId ?? null,
  });
}

function newUserId(acct: ProviderAccount): string {
  if (acct.provider === "discord") return acct.providerUserId;
  if (acct.provider === "spotify") return `sp:${acct.providerUserId}`;
  return crypto.randomUUID();
}

/**
 * One-time import of the pre-accounts KV "restore" keys for a user who is
 * signing in for the first time since accounts launched.
 */
async function importLegacyLinks(env: Env, sb: SupabaseClient, userId: string) {
  const lastfm = await env.SESSIONS.get(`lastfm_link:${userId}`);
  if (lastfm) {
    await linkIdentity(sb, userId, {
      provider: "lastfm", providerUserId: lastfm.toLowerCase(), displayName: lastfm, avatarUrl: null,
    }).catch(() => { /* already someone else's — skip */ });
  }

  const spotifyRaw = await env.SESSIONS.get(`spotify_link:${userId}`);
  if (spotifyRaw) {
    try {
      const s = JSON.parse(spotifyRaw) as { id: string; refreshToken: string; displayName: string | null; scope: string };
      await linkIdentity(sb, userId, {
        provider: "spotify", providerUserId: s.id, displayName: s.displayName, avatarUrl: null,
        refreshToken: s.refreshToken, scope: s.scope,
      });
    } catch { /* malformed or taken — skip */ }
  }
}

/**
 * Resolve a provider login to a GokkeHub user id.
 *
 * - Signed in already (`current`): link the account to the current user.
 * - Known account: that account's user.
 * - New account: create a user for it.
 */
export async function resolveLogin(
  env: Env,
  acct: ProviderAccount,
  current: SessionData | null,
): Promise<string> {
  const sb = db(env);

  if (current) {
    await ensureSessionUser(sb, current);
    await linkIdentity(sb, current.userId, acct);
    return current.userId;
  }

  const known = await findIdentity(sb, acct.provider, acct.providerUserId);
  if (known) {
    await linkIdentity(sb, known.user_id, acct);
    return known.user_id;
  }

  const userId = newUserId(acct);
  await ensureUser(sb, userId, {
    display_name: acct.displayName,
    avatar_url:   acct.avatarUrl,
    email:        acct.email ?? null,
  });
  await linkIdentity(sb, userId, acct);
  await importLegacyLinks(env, sb, userId);
  return userId;
}

export async function refreshSpotifyAccess(env: Env, refreshToken: string) {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type":  "application/x-www-form-urlencoded",
      "Authorization": `Basic ${btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`)}`,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  if (!res.ok) return null;
  return res.json<{ access_token: string; expires_in: number; refresh_token?: string }>();
}

/**
 * Build the KV session for `userId` from the database.
 * `fresh` carries tokens obtained in this request (they win over stored ones).
 */
export async function buildSessionData(
  env: Env,
  userId: string,
  fresh: Pick<SessionData, "discord" | "spotify"> = {},
): Promise<Omit<SessionData, "createdAt" | "expiresAt">> {
  const sb = db(env);
  const [{ data: user, error: userErr }, { data: idents, error: identErr }] = await Promise.all([
    sb.from("gh_users").select("*").eq("id", userId).single(),
    sb.from("gh_identities").select("*").eq("user_id", userId),
  ]);
  if (userErr) throw userErr;
  if (identErr) throw identErr;

  const u = user as UserRow;
  const byProvider = new Map((idents as IdentityRow[]).map((i) => [i.provider, i]));
  const session: Omit<SessionData, "createdAt" | "expiresAt"> = {
    userId,
    email:       u.email,
    displayName: u.display_name,
    avatarUrl:   u.avatar_url,
    steamId:     u.steam_id,
  };

  const discord = byProvider.get("discord");
  if (fresh.discord) session.discord = fresh.discord;
  else if (discord) {
    session.discord = { id: discord.provider_user_id, username: discord.display_name ?? "", avatarUrl: discord.avatar_url };
  }

  const spotify = byProvider.get("spotify");
  if (fresh.spotify) session.spotify = fresh.spotify;
  else if (spotify?.refresh_token) {
    const refreshed = await refreshSpotifyAccess(env, spotify.refresh_token);
    if (refreshed) {
      session.spotify = {
        id:           spotify.provider_user_id,
        accessToken:  refreshed.access_token,
        refreshToken: refreshed.refresh_token ?? spotify.refresh_token,
        expiresAt:    Date.now() + refreshed.expires_in * 1000,
        displayName:  spotify.display_name,
        imageUrl:     spotify.avatar_url,
        scope:        spotify.scope ?? undefined,
      };
    }
  }

  const google = byProvider.get("google");
  if (google) {
    session.google = { id: google.provider_user_id, email: null, displayName: google.display_name, avatarUrl: google.avatar_url };
  }

  const steam = byProvider.get("steam");
  if (steam) {
    session.steam = { steamId: steam.provider_user_id, displayName: steam.display_name, avatarUrl: steam.avatar_url };
  }

  const lastfm = byProvider.get("lastfm");
  if (lastfm) session.lastfm = { username: lastfm.display_name ?? lastfm.provider_user_id, linkedAt: Date.now() };

  // The active buzzer sound stays in permanent KV (see profile/buzzer-sound.ts).
  session.buzzerSound = await env.SESSIONS.get(`buzzer_sound:${userId}`);

  return session;
}

/**
 * Finish a sign-in-provider OAuth callback: resolve the account, then either
 * refresh the current session (linking while signed in) or create a new one.
 * Returns the Set-Cookie value for a new session, or null when the existing
 * session was updated.
 */
export async function completeLogin(
  env: Env,
  request: Request,
  acct: ProviderAccount,
  fresh: Pick<SessionData, "discord" | "spotify">,
): Promise<string | null> {
  const existing = await getSession(env.SESSIONS, request);
  let data: Omit<SessionData, "createdAt" | "expiresAt">;
  try {
    const userId = await resolveLogin(env, acct, existing);
    data = await buildSessionData(env, userId, fresh);
  } catch (err) {
    if (err instanceof IdentityTakenError) throw err;
    // A Google sign-up's id only exists in the database — no stable fallback.
    if (!existing && acct.provider === "google") throw err;
    // Never lock people out because the database is unreachable: fall back
    // to a session-only login like before accounts existed.
    console.error("[accounts] database unavailable, session-only login", err);
    data = existing
      ? { ...existing, ...fresh }
      : {
          userId:      newUserId(acct),
          email:       acct.email ?? null,
          displayName: acct.displayName,
          avatarUrl:   acct.avatarUrl,
          ...fresh,
        };
  }

  if (existing) {
    await updateSession(env.SESSIONS, getSessionId(request)!, data);
    return null;
  }
  const sessionId = await createSession(env.SESSIONS, data);
  return buildSessionCookie(sessionId, env.COOKIE_DOMAIN);
}

/** Rebuild the caller's KV session from the database after a profile change. */
export async function refreshSession(env: Env, request: Request, userId: string) {
  const sessionId = getSessionId(request);
  if (!sessionId) return;
  const current = await getSession(env.SESSIONS, request);
  const data = await buildSessionData(env, userId, {
    discord: current?.discord?.accessToken ? current.discord : undefined,
    spotify: current?.spotify,
  });
  await updateSession(env.SESSIONS, sessionId, data);
}

/**
 * DELETE /auth/<provider> — unlink a provider from the signed-in user and
 * refresh the session. Refuses to remove the last sign-in method.
 */
export async function unlinkProvider(env: Env, request: Request, session: SessionData, provider: Provider) {
  const sb = db(env);
  await ensureSessionUser(sb, session);
  if (SIGN_IN_PROVIDERS.includes(provider) && (await signInMethodsWithout(sb, session.userId, provider)) === 0) {
    // Legacy sessions may have no identity rows yet; only block when this
    // provider really is linked in the database.
    const { data } = await sb.from("gh_identities").select("provider")
      .eq("user_id", session.userId).eq("provider", provider).maybeSingle();
    if (data) {
      return Response.json(
        { error: "This is your only way to sign in. Link another sign-in method first." },
        { status: 409 },
      );
    }
  }
  await unlinkIdentity(sb, session.userId, provider);
  await refreshSession(env, request, session.userId);
  return new Response(null, { status: 204 });
}

/** Save profile fields for the signed-in user and refresh their session. */
export async function saveProfile(
  env: Env,
  request: Request,
  session: SessionData,
  fields: Partial<Omit<UserRow, "id">>,
) {
  const sb = db(env);
  await ensureSessionUser(sb, session);
  await updateUser(sb, session.userId, fields);
  await refreshSession(env, request, session.userId);
}
