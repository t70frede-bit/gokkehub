import { useState } from "react";
import { Button, Input, Panel } from "@gokkehub/ui";

// Soft one-time access gate. A brand-new visitor must enter the shared code
// once; we remember it on this device and never ask again. This is a UX lock
// (it can be bypassed via devtools) — real protection is the Discord login +
// row-level security behind it. Fine for a closed friend group.
const CODE = (import.meta.env.VITE_SITE_CODE as string) || "PokernightAtGokkes";
const STORAGE_KEY = "poker_site_unlocked_v1";

export default function SiteGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(
    () => typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "yes",
  );
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);

  if (unlocked) return <>{children}</>;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim() === CODE) {
      localStorage.setItem(STORAGE_KEY, "yes");
      setUnlocked(true);
    } else {
      setError(true);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-5"
      style={{ background: "var(--bg-tint-1)" }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="font-display text-3xl font-bold" style={{ color: "rgb(var(--text-primary-rgb))" }}>
            Gokke<span style={{ color: "rgb(var(--color-primary-rgb))" }}>Poker</span>
          </h1>
          <p className="text-sm mt-1" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            🔒 This site is locked.
          </p>
        </div>

        <Panel>
          <form onSubmit={submit} className="space-y-4">
            <Input
              label="Access code"
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              value={value}
              onChange={(e) => { setValue(e.target.value); setError(false); }}
              error={error ? "Wrong code." : undefined}
            />
            <Button type="submit" fullWidth disabled={!value.trim()}>Unlock</Button>
          </form>
          <p className="text-center text-xs mt-4" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            Ask the house for the code. You’ll only enter it once on this device.
          </p>
        </Panel>
      </div>
    </div>
  );
}
