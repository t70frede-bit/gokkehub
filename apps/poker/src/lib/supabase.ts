import { createClient } from "@supabase/supabase-js";

// NOTE: unlike the shared @gokkehub/db factory (persistSession:false, built for
// stateless game rooms), the poker app is auth-first — we WANT the Supabase
// session persisted in localStorage and auto-refreshed so players stay logged
// in. So this app keeps its own client.
const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !key) {
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
}

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: "gokkehub-poker-auth",
  },
  realtime: { params: { eventsPerSecond: 10 } },
});
