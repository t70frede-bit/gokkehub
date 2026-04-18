import type { KVNamespace, R2Bucket } from "@cloudflare/workers-types";

/** Cloudflare Pages environment bindings for apps/account */
export interface Env {
  // KV namespace for sessions
  SESSIONS: KVNamespace;

  // R2 bucket for user avatars
  AVATARS: R2Bucket;

  // Supabase
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;

  // Cookie domain
  COOKIE_DOMAIN: string;

  // Discord OAuth
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;

  // Spotify OAuth
  SPOTIFY_CLIENT_ID: string;
  SPOTIFY_CLIENT_SECRET: string;

  // Steam Web API
  STEAM_API_KEY: string;
}
