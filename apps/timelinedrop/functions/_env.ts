import type { KVNamespace } from "@cloudflare/workers-types";

export interface Env {
  SESSIONS:                KVNamespace;
  SUPABASE_URL:            string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SPOTIFY_CLIENT_ID:       string;
  SPOTIFY_CLIENT_SECRET:   string;
  COOKIE_DOMAIN:           string;
}
