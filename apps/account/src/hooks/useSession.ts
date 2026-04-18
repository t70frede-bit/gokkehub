import { useState, useEffect } from "react";
import type { PublicSessionData } from "@gokkehub/auth/types";

interface UseSessionResult {
  session: PublicSessionData | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useSession(): UseSessionResult {
  const [session, setSession] = useState<PublicSessionData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSession = async () => {
    try {
      const res = await fetch("/auth/me", { credentials: "include" });
      if (res.ok) {
        const data = (await res.json()) as PublicSessionData;
        setSession(data);
      } else {
        setSession(null);
      }
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSession();
  }, []);

  return { session, loading, refresh: fetchSession };
}
