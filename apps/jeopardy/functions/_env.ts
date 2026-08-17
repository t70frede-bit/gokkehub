import type { KVNamespace } from "@cloudflare/workers-types";

export interface Env {
  SESSIONS:                  KVNamespace;
  SUPABASE_URL:              string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** Local dev only — set in the gitignored .dev.vars, never as a Pages secret.
   *  See functions/_session.ts for the two gates that keep this off production. */
  DEV_USER_ID?:              string;
  DEV_USER_NAME?:            string;
}
