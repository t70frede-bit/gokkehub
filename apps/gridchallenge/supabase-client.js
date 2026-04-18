// Supabase client initialization
// Values are read from environment variables — NEVER hardcode them here.
//
// Static file (current): create a local env.js (gitignored) that sets window.__ENV__
// Vite app (Step 4 migration): use import.meta.env.VITE_SUPABASE_URL etc.
//
// See .env.example for required variable names.
const SUPABASE_URL =
  (typeof process !== "undefined" && process.env?.SUPABASE_URL) ||
  window.__ENV__?.SUPABASE_URL ||
  "";
const SUPABASE_ANON_KEY =
  (typeof process !== "undefined" && process.env?.SUPABASE_ANON_KEY) ||
  window.__ENV__?.SUPABASE_ANON_KEY ||
  "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    "[supabase-client] SUPABASE_URL or SUPABASE_ANON_KEY is not set. " +
    "Copy .env.example → env.js and fill in your values (never commit env.js)."
  );
}

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
