import React, { useState } from "react";
import { Button, Input, Panel, useToast } from "@gokkehub/ui";

export default function ResetPasswordPage() {
  const { addToast } = useToast();

  const recoveryToken = (() => {
    const token = sessionStorage.getItem("recoveryToken") ?? "";
    if (token) sessionStorage.removeItem("recoveryToken");
    return token;
  })();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});

  if (!recoveryToken) {
    // No token — redirect to login via hard reload so session state is fresh
    window.location.replace("/login");
    return null;
  }

  const validate = () => {
    const e: typeof errors = {};
    if (!password) e.password = "Password is required";
    else if (password.length < 8) e.password = "At least 8 characters";
    if (password !== confirm) e.confirm = "Passwords don't match";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const res = await fetch("/auth/reset-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: recoveryToken, password }),
      });
      if (res.ok) {
        setDone(true);
        addToast("Password updated — you're now signed in!", "success");
        // Hard reload to /profile so the new KV session cookie is picked up
        setTimeout(() => window.location.replace("/profile"), 1200);
      } else {
        const data = (await res.json()) as { error?: string };
        addToast(data.error ?? "Failed to reset password", "error");
      }
    } catch {
      addToast("Network error — please try again", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-5">

        <div className="text-center space-y-1">
          <h2 className="text-xl font-bold" style={{ color: "rgb(var(--text-primary-rgb))" }}>
            Set new password
          </h2>
          <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            Choose a strong password for your account
          </p>
        </div>

        <Panel variant="bare" style={{ overflow: "hidden" }}>
          {done ? (
            <div className="text-center space-y-3 py-6 px-7">
              <div className="text-4xl">✅</div>
              <p className="font-semibold" style={{ color: "rgb(var(--text-primary-rgb))" }}>
                Password updated
              </p>
              <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>
                Signing you in…
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ padding: "28px 28px 24px" }}>
              <div className="space-y-1">
                <div>
                  <Input
                    label="New password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min. 8 characters"
                    error={errors.password}
                    autoComplete="new-password"
                    autoFocus
                  />
                  {!errors.password && <div style={{ height: "18px" }} />}
                </div>
                <div>
                  <Input
                    label="Confirm password"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    error={errors.confirm}
                    autoComplete="new-password"
                  />
                  {!errors.confirm && <div style={{ height: "18px" }} />}
                </div>
                <div className="pt-2">
                  <Button type="submit" variant="primary" fullWidth loading={loading}>
                    Set new password
                  </Button>
                </div>
              </div>
            </form>
          )}
        </Panel>

      </div>
    </div>
  );
}
