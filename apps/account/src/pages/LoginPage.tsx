import React, { useState, useRef, useLayoutEffect, useEffect, useCallback } from "react";
import { Button, Input, Panel, useToast } from "@gokkehub/ui";

type Mode = "login" | "register" | "forgot";

// ── Animated field slot — expands/collapses with fade ────────────────────────

function ExpandField({
  show,
  children,
  delay = 0,
}: {
  show: boolean;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: show ? "1fr" : "0fr",
        opacity: show ? 1 : 0,
        transform: show ? "translateY(0)" : "translateY(-6px)",
        transition: `grid-template-rows 0.3s cubic-bezier(0.4, 0, 0.2, 1) ${delay}ms, opacity 0.25s ease ${delay}ms, transform 0.25s ease ${delay}ms`,
        // marginBottom only when visible to keep spacing consistent
        marginBottom: show ? "0" : "0",
      }}
    >
      {/* Inner wrapper required for grid-rows trick */}
      <div style={{ overflow: "hidden" }}>
        <div style={{ paddingBottom: show ? "4px" : "0" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ── Reserve space for error message so layout doesn't jump ────────────────────

function FieldSlot({ error, children }: { error?: string; children: React.ReactNode }) {
  return (
    <div>
      {children}
      <div style={{ height: "18px", marginBottom: "4px" }}>
        {error && (
          <p className="text-xs" style={{ color: "rgb(220, 80, 80)", marginTop: "3px" }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const { addToast } = useToast();
  const [mode, setMode] = useState<Mode>("login");
  const [confirmed, setConfirmed] = useState(false);

  const formRef    = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState<number | undefined>(undefined);

  // Measure synchronously before the browser paints so we capture the
  // final layout height BEFORE CSS transitions start. Using rAF here would
  // fire mid-transition and read a partially-animated (wrong) height.
  const measure = useCallback(() => {
    const el = confirmed ? confirmRef.current : formRef.current;
    if (el) setPanelHeight(el.scrollHeight);
  }, [confirmed]);

  useLayoutEffect(() => {
    measure();
  }, [mode, confirmed, measure]);

  // Remeasure after errors appear/disappear (state change → next render → rAF)
  const onFormChange = () => requestAnimationFrame(() => measure());

  const switchMode = (m: Mode) => {
    setMode(m);
    setConfirmed(false);
  };

  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-5">

        <div className="text-center">
          <p className="text-sm" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            {mode === "login" ? "Sign in to continue"
              : mode === "register" ? "Create a new account"
              : "Reset your password"}
          </p>
        </div>

        {/* Tab switcher — hidden on forgot mode */}
        {mode !== "forgot" && (
          <div
            className="relative flex rounded-xl p-1"
            style={{
              background: "rgba(var(--surface-raised-rgb), 0.5)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div
              className="absolute top-1 bottom-1 rounded-lg"
              style={{
                left: "4px",
                width: "calc(50% - 4px)",
                background: "linear-gradient(135deg, rgb(var(--color-primary-rgb)), rgb(var(--color-secondary-rgb)))",
                boxShadow: "0 2px 12px rgba(var(--color-primary-rgb), 0.4)",
                transform: mode === "login" ? "translateX(0)" : "translateX(calc(100% + 4px))",
                transition: "transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            />
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                className="relative z-10 flex-1 py-2 text-sm font-semibold whitespace-nowrap transition-colors duration-200"
                style={{ color: mode === m ? "#fff" : "rgb(var(--text-muted-rgb))" }}
              >
                {m === "login" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>
        )}

        {/* Panel with animated height */}
        <Panel variant="bare" style={{ overflow: "hidden" }}>
          <div
            style={{
              height: panelHeight !== undefined ? panelHeight : "auto",
              transition: "height 0.32s cubic-bezier(0.4, 0, 0.2, 1)",
              overflow: "hidden",
              position: "relative",
            }}
          >
            {/* Shared login + register form */}
            <div
              ref={formRef}
              style={{
                padding: "28px 28px 24px",
                position: (confirmed || mode === "forgot") ? "absolute" : "relative",
                top: 0, left: 0, width: "100%",
                visibility: (confirmed || mode === "forgot") ? "hidden" : "visible",
                pointerEvents: (confirmed || mode === "forgot") ? "none" : "auto",
              }}
              onChange={onFormChange}
            >
              <UnifiedForm
                mode={mode === "forgot" ? "login" : mode}
                onLoginSuccess={() => window.location.replace("/profile")}
                onConfirmNeeded={() => setConfirmed(true)}
                onRegisterSuccess={() => window.location.replace("/profile")}
                onForgotPassword={() => switchMode("forgot")}
                addToast={addToast}
              />
            </div>

            {/* Email confirmation view */}
            <div
              ref={confirmRef}
              style={{
                padding: "28px 28px 24px",
                position: confirmed ? "relative" : "absolute",
                top: 0, left: 0, width: "100%",
                visibility: confirmed ? "visible" : "hidden",
                pointerEvents: confirmed ? "auto" : "none",
              }}
            >
              <ConfirmationMessage onBackToLogin={() => switchMode("login")} />
            </div>

            {/* Forgot password view */}
            <div
              style={{
                padding: "28px 28px 24px",
                position: mode === "forgot" ? "relative" : "absolute",
                top: 0, left: 0, width: "100%",
                visibility: mode === "forgot" ? "visible" : "hidden",
                pointerEvents: mode === "forgot" ? "auto" : "none",
              }}
            >
              <ForgotPasswordForm
                onBack={() => switchMode("login")}
                addToast={addToast}
              />
            </div>
          </div>
        </Panel>

        {/* Divider */}
        <div className="relative flex items-center gap-3">
          <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />
          <span className="text-xs uppercase tracking-widest" style={{ color: "rgb(var(--text-muted-rgb))" }}>or</span>
          <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />
        </div>

        <Button variant="ghost" fullWidth onClick={() => { window.location.href = "/auth/discord"; }}>
          <span className="flex items-center justify-center gap-2 w-full">
            <DiscordIcon />
            Continue with Discord
          </span>
        </Button>

      </div>
    </div>
  );
}

// ── Unified form — shared email/password fields, extra fields animate in ──────

function UnifiedForm({
  mode,
  onLoginSuccess,
  onConfirmNeeded,
  onRegisterSuccess,
  onForgotPassword,
  addToast,
}: {
  mode: "login" | "register";
  onLoginSuccess: () => void;
  onConfirmNeeded: () => void;
  onRegisterSuccess: () => void;
  onForgotPassword: () => void;
  addToast: (msg: string, v?: "info" | "success" | "error") => void;
}) {
  const isRegister = mode === "register";

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail]             = useState("");
  const [password, setPassword]       = useState("");
  const [confirm, setConfirm]         = useState("");
  const [loading, setLoading]         = useState(false);
  const [errors, setErrors]           = useState<{
    displayName?: string;
    email?: string;
    password?: string;
    confirm?: string;
  }>({});

  // Clear errors that belong to hidden fields when switching modes
  useEffect(() => {
    setErrors({});
  }, [mode]);

  const validate = () => {
    const e: typeof errors = {};
    if (isRegister) {
      if (!displayName.trim()) e.displayName = "Display name is required";
      else if (displayName.trim().length > 32) e.displayName = "Max 32 characters";
    }
    if (!email.trim()) e.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = "Enter a valid email";
    if (!password) e.password = "Password is required";
    else if (isRegister && password.length < 8) e.password = "At least 8 characters";
    if (isRegister && password !== confirm) e.confirm = "Passwords don't match";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setLoading(true);

    try {
      if (!isRegister) {
        // Login
        const res = await fetch("/auth/login", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        if (res.ok) { onLoginSuccess(); }
        else {
          const data = (await res.json()) as { error?: string };
          addToast(data.error ?? "Invalid email or password", "error");
        }
      } else {
        // Register
        const res = await fetch("/auth/register", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, displayName: displayName.trim() }),
        });
        if (res.status === 204) { onRegisterSuccess(); return; }
        const data = (await res.json()) as { confirm?: boolean; message?: string; error?: string };
        if (res.ok && data.confirm) { onConfirmNeeded(); return; }
        addToast(data.error ?? "Registration failed", "error");
      }
    } catch {
      addToast("Network error — please try again", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>

      {/* Display name — slides in from above email when switching to register */}
      <ExpandField show={isRegister} delay={0}>
        <FieldSlot error={errors.displayName}>
          <Input
            label="Display name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="How others will see you"
            error={errors.displayName}
            autoComplete="nickname"
            maxLength={32}
          />
        </FieldSlot>
      </ExpandField>

      {/* Email — always visible */}
      <FieldSlot error={errors.email}>
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          error={errors.email}
          autoComplete="email"
        />
      </FieldSlot>

      {/* Password — always visible */}
      <FieldSlot error={errors.password}>
        <Input
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={isRegister ? "Min. 8 characters" : "••••••••"}
          error={errors.password}
          autoComplete={isRegister ? "new-password" : "current-password"}
        />
      </FieldSlot>

      {/* Confirm password — fades in below password for register */}
      <ExpandField show={isRegister} delay={40}>
        <FieldSlot error={errors.confirm}>
          <Input
            label="Confirm password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            error={errors.confirm}
            autoComplete="new-password"
          />
        </FieldSlot>
      </ExpandField>

      {/* Forgot password — only in login mode */}
      {!isRegister && (
        <div className="flex justify-end" style={{ marginTop: "-4px", marginBottom: "8px" }}>
          <button
            type="button"
            onClick={onForgotPassword}
            className="text-xs"
            style={{ color: "rgb(var(--text-muted-rgb))" }}
          >
            Forgot password?
          </button>
        </div>
      )}

      <div className="pt-2">
        <Button type="submit" variant="primary" fullWidth loading={loading}>
          {isRegister ? "Create account" : "Sign in"}
        </Button>
      </div>
    </form>
  );
}

/* ── Forgot password form ── */
function ForgotPasswordForm({
  onBack,
  addToast,
}: {
  onBack: () => void;
  addToast: (msg: string, v?: "info" | "success" | "error") => void;
}) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!email.trim()) { setError("Email is required"); return; }
    setLoading(true);
    setError(undefined);
    try {
      await fetch("/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      // Always show success — don't leak whether the email exists
      setSent(true);
    } catch {
      addToast("Network error — please try again", "error");
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="text-center space-y-4 py-4">
        <div className="text-4xl">📬</div>
        <div>
          <p className="font-semibold" style={{ color: "rgb(var(--text-primary-rgb))" }}>
            Check your inbox
          </p>
          <p className="text-sm mt-1" style={{ color: "rgb(var(--text-muted-rgb))" }}>
            If an account exists for <strong>{email}</strong>, we've sent a reset link.
            It may take a minute to arrive.
          </p>
        </div>
        <button
          onClick={onBack}
          className="text-sm font-medium"
          style={{ color: "rgb(var(--color-primary-rgb))" }}
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <button
        type="button"
        onClick={onBack}
        className="text-xs mb-5 flex items-center gap-1"
        style={{ color: "rgb(var(--text-muted-rgb))" }}
      >
        ← Back to sign in
      </button>

      <p className="font-semibold mb-1" style={{ color: "rgb(var(--text-primary-rgb))" }}>
        Reset your password
      </p>
      <p className="text-sm mb-5" style={{ color: "rgb(var(--text-muted-rgb))" }}>
        Enter your email and we'll send a reset link.
      </p>

      <FieldSlot error={error}>
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(undefined); }}
          placeholder="you@example.com"
          error={error}
          autoComplete="email"
          autoFocus
        />
      </FieldSlot>

      <div className="pt-2">
        <Button type="submit" variant="primary" fullWidth loading={loading}>
          Send reset email
        </Button>
      </div>
    </form>
  );
}

/* ── Confirmation screen ── */
function ConfirmationMessage({ onBackToLogin }: { onBackToLogin: () => void }) {
  return (
    <div className="text-center space-y-4 py-4">
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
        className="text-sm font-medium"
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
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.033.055a19.89 19.89 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}
