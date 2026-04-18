import React, { createContext, useCallback, useContext, useRef, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ToastVariant = "info" | "success" | "error";

export interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
  visible: boolean;
}

export interface ToastContextValue {
  addToast: (message: string, variant?: ToastVariant) => void;
}

// ── Context ───────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const addToast = useCallback((message: string, variant: ToastVariant = "info") => {
    const id = crypto.randomUUID();

    // Mount invisible first, then make visible on next frame for CSS transition
    setToasts((prev) => [...prev, { id, message, variant, visible: false }]);

    requestAnimationFrame(() => {
      setToasts((prev) =>
        prev.map((t) => (t.id === id ? { ...t, visible: true } : t)),
      );
    });

    // Start dismiss timer
    const timer = setTimeout(() => {
      setToasts((prev) =>
        prev.map((t) => (t.id === id ? { ...t, visible: false } : t)),
      );
      // Remove from DOM after transition finishes
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 400);
    }, 4000);

    timers.current.set(id, timer);
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div
        className="fixed top-5 right-5 flex flex-col gap-2.5 z-[9999] pointer-events-none"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="max-w-xs px-4 py-3 rounded-xl text-sm text-white pointer-events-auto"
            style={{
              background: "rgba(var(--surface-base-rgb), 0.96)",
              border: `1px solid ${
                toast.variant === "error"
                  ? "rgba(220,38,38,0.7)"
                  : toast.variant === "success"
                  ? "rgba(34,197,94,0.7)"
                  : "rgba(var(--color-primary-rgb), 0.6)"
              }`,
              boxShadow: "var(--shadow-card)",
              opacity: toast.visible ? 1 : 0,
              transform: toast.visible ? "translateX(0)" : "translateX(40px)",
              transition: "opacity 0.35s ease, transform 0.35s ease",
            }}
            dangerouslySetInnerHTML={{ __html: toast.message }}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

export default ToastProvider;
