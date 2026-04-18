import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input, Panel, useToast } from "@gokkehub/ui";

type Mode = "login" | "register";

export default function LoginPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [mode, setMode] = useState<Mode>("login");
  const [confirmed, setConfirmed] = useState(false);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-5">

        {/* Logo / heading */}
        <div className="text-center space-y-1 mb-2">
          <h1 className="text-3xl font-bold" style={{ color: "rgb(var(--text-primary-rgb))" }}>
            Gokke<span className="text-gradient">Hub</span>
          </h1>
          <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            {mode === "login" ? "Sign in to your account" : "Create a new account"}
          </p>
        </div>

        {/* Mode toggle */}
        <div
          className="flex rounded-xl p-1 gap-1"
          style={{ background: "rgba(var(--surface-raised-rgb), 0.5)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          {(["login", "register"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setConfirmed(false); }}
              className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all"
              style={mode === m ? {
                background: "linear-gradient(135deg, rgb(var(--color-primary-rgb)), rgb(var(--color-secondary-rgb)))",
                color: "#fff",
                boxShadow: "0 2px 10px rgba(var(--color-primary-rgb), 0.35)",
              } : {
                color: "rgb(var(--text-muted-rgb))",
                background: "transparent",
              }}
            >
              {m === "login" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>

        {/* Form panel */}
        <Panel>
          {confirmed ? (
            <ConfirmationMessage onBackToLogin={() => { setMode("login"); setConfirmed(false); }} />
          ) : mode === "login" ? (
            <LoginForm onSuccess={() => navigate("/profile", { replace: true })} addToast={addToast} />
          ) : (
            <RegisterForm onConfirmNeeded={() => setConfirmed(true)} onSuccess={() => navigate("/profile", { replace: true })} addToast={addToast} />
          )}
        </Panel>

        {/* Divider */}
        <div className="relative flex items-center gap-3">
          <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />
          <span className="text-xs uppercase tracking-widest" style={{ color: "rgb(var(--text-muted-rgb))" }}>or</span>
          <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />
        </div>

        {/* Discord OAuth */}
        <Button variant="ghost" fullWidth onClick={() => { window.location.href = "/auth/discord"; }}>
          <DiscordIcon />
          Continue with Discord
        </Button>

      </div>
    </div>
  );
}

/* ── Sign-in form ── */

function LoginForm({ onSuccess, addToast }: { onSuccess: () => void; addToast: (msg: string, v?: "info" | "success" | "error") => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  const validate = () => {
    const e: typeof errors = {};
    if (!email.trim()) e.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = "Enter a valid email";
    if (!password) e.password = "Password is required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const res = await fetch("/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        onSuccess();
      } else {
        const data = (await res.json()) as { error?: string };
        addToast(data.error ?? "Invalid email or password", "error");
      }
    } catch {
      addToast("Network error — please try again", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com" error={errors.email} autoComplete="email" />
      <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
        placeholder="••••••••" error={errors.password} autoComplete="current-password" />
      <Button type="submit" variant="primary" fullWidth loading={loading}>Sign in</Button>
    </form>
  );
}

/* ── Create account form ── */

function RegisterForm({
  onConfirmNeeded,
  onSuccess,
  addToast,
}: {
  onConfirmNeeded: () => void;
  onSuccess: () => void;
  addToast: (msg: string, v?: "info" | "success" | "error") => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ displayName?: string; email?: string; password?: string; confirm?: string }>({});

  const validate = () => {
    const e: typeof errors = {};
    if (!displayName.trim()) e.displayName = "Display name is required";
    else if (displayName.trim().length > 32) e.displayName = "Max 32 characters";
    if (!email.trim()) e.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = "Enter a valid email";
    if (!password) e.password = "Password is required";
    else if (password.length < 8) e.password = "Must be at least 8 characters";
    if (password !== confirm) e.confirm = "Passwords don't match";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const res = await fetch("/auth/register", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, displayName: displayName.trim() }),
      });

      if (res.status === 204) {
        // Email confirmation disabled — logged in immediately
        onSuccess();
        return;
      }

      const data = (await res.json()) as { confirm?: boolean; message?: string; error?: string };

      if (res.ok && data.confirm) {
        // Email confirmation required
        onConfirmNeeded();
        return;
      }

      addToast(data.error ?? "Registration failed", "error");
    } catch {
      addToast("Network error — please try again", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="Display name" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
        placeholder="How others will see you" error={errors.displayName} autoComplete="nickname" maxLength={32} />
      <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com" error={errors.email} autoComplete="email" />
      <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
        placeholder="Min. 8 characters" error={errors.password} autoComplete="new-password" />
      <Input label="Confirm password" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
        placeholder="••••••••" error={errors.confirm} autoComplete="new-password" />
      <Button type="submit" variant="primary" fullWidth loading={loading}>Create account</Button>
    </form>
  );
}

/* ── Email confirmation message ── */

function ConfirmationMessage({ onBackToLogin }: { onBackToLogin: () => void }) {
  return (
    <div className="text-center space-y-4 py-2">
      <div className="text-4xl">📬</div>
      <div>
        <p className="font-semibold" style={{ color: "rgb(var(--text-primary-rgb))" }}>
          Check your inbox
        </p>
        <p className="text-sm mt-1" style={{ color: "rgb(var(--text-muted-rgb))" }}>
          We sent a confirmation link to your email. Click it to activate your account, then sign in.
        </p>
      </div>
      <button
        onClick={onBackToLogin}
        className="text-sm font-medium transition-colors"
        style={{ color: "rgb(var(--color-primary-rgb))" }}
      >
        Back to sign in
      </button>
    </div>
  );
}

/* ── Discord icon ── */

function DiscordIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: "6px" }}>
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.033.055a19.89 19.89 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}
