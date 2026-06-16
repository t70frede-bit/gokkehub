import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Panel } from "@gokkehub/ui";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";

// Handles /join/:token invite links — joins the group, then drops you in.
export default function JoinInvitePage() {
  const { token } = useParams<{ token: string }>();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current || !token) return;
    ran.current = true;
    localStorage.removeItem("poker_pending_invite"); // consumed — don't loop
    (async () => {
      const { error } = await supabase.rpc("poker_join_by_invite", { p_token: token });
      if (error) { setError(error.message); return; }
      await refresh();
      navigate("/", { replace: true });
    })();
  }, [token, refresh, navigate]);

  return (
    <div className="pwa-safe-top min-h-screen flex items-center justify-center p-5" style={{ background: "var(--bg-tint-1)" }}>
      <div className="w-full max-w-sm">
        <Panel>
          {error ? (
            <>
              <p className="font-semibold" style={{ color: "rgb(var(--color-danger-rgb))" }}>Couldn’t join</p>
              <p className="text-sm mt-1" style={{ color: "rgb(var(--text-muted-rgb))" }}>{error}</p>
              <div className="mt-4"><Button fullWidth onClick={() => navigate("/")}>Continue</Button></div>
            </>
          ) : (
            <p className="text-sm text-center" style={{ color: "rgb(var(--text-muted-rgb))" }}>Joining group…</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
