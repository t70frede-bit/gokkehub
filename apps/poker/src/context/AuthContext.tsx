import {
  createContext, useCallback, useContext, useEffect, useState,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { PokerUser } from "@/lib/types";

interface AuthValue {
  session: Session | null;
  profile: PokerUser | null;
  loading: boolean;
  isAdmin: boolean;
  /** Start the Discord OAuth flow (redirects away and back). */
  loginWithDiscord: () => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<PokerUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Provision (first login) or fetch the poker profile for the current Discord
  // identity. poker_ensure_profile is idempotent and sets admin for goksi0501.
  const ensureProfile = useCallback(async () => {
    const { data, error } = await supabase.rpc("poker_ensure_profile");
    if (error) { console.error("ensure profile failed", error); setProfile(null); return; }
    setProfile((data as PokerUser) ?? null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session?.user) await ensureProfile();
  }, [session, ensureProfile]);

  // Track the Supabase session (incl. the OAuth redirect-back).
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) { setProfile(null); setLoading(false); }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // On a live session: provision/fetch profile, then live-subscribe the row so
  // balance updates push in real time.
  useEffect(() => {
    if (!session?.user) return;
    const uid = session.user.id;
    let active = true;

    (async () => {
      await ensureProfile();
      if (active) setLoading(false);
    })();

    const channel = supabase
      .channel(`poker_me_${uid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "poker_users", filter: `id=eq.${uid}` },
        (payload) => setProfile(payload.new as PokerUser),
      )
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, [session, ensureProfile]);

  const loginWithDiscord = useCallback(async () => {
    await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo: window.location.origin },
    });
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        loading,
        isAdmin: profile?.role === "admin",
        loginWithDiscord,
        logout,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
