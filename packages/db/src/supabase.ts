/**
 * Supabase client factory — @gokkehub/db/supabase
 * ================================================
 * Call createSupabaseClient() with the anon key for browser/client use.
 * Call createSupabaseAdminClient() with the service role key for server-side
 * Workers only — NEVER import this in client-side code.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types/index.ts";

export type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * Client-side Supabase client.
 * Safe to call in React components and browser code.
 * Uses the anon key — restricted by RLS policies.
 */
export function createSupabaseClient(
  url: string,
  anonKey: string,
): TypedSupabaseClient {
  return createClient<Database>(url, anonKey, {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 10 } },
  });
}

/**
 * Server-side admin client.
 * ONLY use in /functions/ (Cloudflare Workers / Pages Functions).
 * Uses the service role key — bypasses RLS, full DB access.
 * NEVER import this in any file that runs in the browser.
 */
export function createSupabaseAdminClient(
  url: string,
  serviceRoleKey: string,
): TypedSupabaseClient {
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
