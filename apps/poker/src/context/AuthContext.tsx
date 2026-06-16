import {
  createContext, useCallback, useContext, useEffect, useState,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { MyGroup, PokerUser } from "@/lib/types";

interface AuthValue {
  session: Session | null;
  profile: PokerUser | null;
  /** All of the user's memberships (active + pending). */
  groups: MyGroup[];
  /** The group the user is currently acting in (active membership), or null. */
  activeGroup: MyGroup | null;
  /** Spendable balance in the active group. */
  balance: number;
  /** Admin of the active group? */
  isAdmin: boolean;
  loading: boolean;
  loginWithDiscord: () => Promise<void>;
  logout: () => Promise<void>;
  setActiveGroup: (groupId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<PokerUser | null>(null);
  const [groups, setGroups] = useState<MyGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const loadGroups = useCallback(async () => {
    const { data } = await supabase.rpc("poker_my_groups");
    setGroups((data as MyGroup[]) ?? []);
  }, []);

  const ensureAndLoad = useCallback(async () => {
    const { data, error } = await supabase.rpc("poker_ensure_profile");
    if (error) { console.error("ensure profile failed", error); setProfile(null); return; }
    setProfile((data as PokerUser) ?? null);
    await loadGroups();
  }, [loadGroups]);

  // Track the Supabase session (incl. the OAuth redirect-back).
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) { setProfile(null); setGroups([]); setLoading(false); }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) return;
    const uid = session.user.id;
    let active = true;
    (async () => { await ensureAndLoad(); if (active) setLoading(false); })();

    // Membership changes (balance, role, new groups) + active-group switches.
    const channel = supabase
      .channel(`poker_me_${uid}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "poker_group_members", filter: `user_id=eq.${uid}` },
        loadGroups)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "poker_users", filter: `id=eq.${uid}` },
        (payload) => { setProfile(payload.new as PokerUser); loadGroups(); })
      .subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, [session, ensureAndLoad, loadGroups]);

  const activeGroup =
    groups.find((g) => g.is_active && g.status === "active") ?? null;

  const loginWithDiscord = useCallback(async () => {
    await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo: window.location.origin },
    });
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setGroups([]);
  }, []);

  const setActiveGroup = useCallback(async (groupId: string) => {
    const { error } = await supabase.rpc("poker_set_active_group", { p_group: groupId });
    if (error) throw new Error(error.message);
    await ensureAndLoad();
  }, [ensureAndLoad]);

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        groups,
        activeGroup,
        balance: activeGroup?.balance ?? 0,
        isAdmin: activeGroup?.role === "admin",
        loading,
        loginWithDiscord,
        logout,
        setActiveGroup,
        refresh: ensureAndLoad,
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
