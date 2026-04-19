// Supabase client — ES module (Vite build)
// Credentials come from VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env.local
// Never commit .env.local — see .env.example for the required variable names.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL     = import.meta.env.VITE_SUPABASE_URL     ?? "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    "[supabase-client] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is not set.\n" +
    "Copy .env.example → .env.local and fill in your values (never commit .env.local)."
  );
}

export const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
