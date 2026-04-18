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
        className="fixed bottom-5 right-5 flex flex-col-reverse gap-2.5 z-[9999] pointer-events-none"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="max-w-xs px-4 py-3 rounded-xl text-sm text-white pointer-events-auto"
            style={{
              background: "rgba(var(--surface-raised-rgb, 30 30 50), 0.97)",
              border: `1px solid ${
                toast.variant === "error"
                  ? "rgba(220,38,38,0.7)"
                  : toast.variant === "success"
                  ? "rgba(34,197,94,0.7)"
                  : "rgba(var(--color-primary-rgb), 0.6)"
              }`,
              boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              opacity: toast.visible ? 1 : 0,
              transform: toast.visible ? "translateY(0)" : "translateY(16px)",
              transition: "opacity 0.3s ease, transform 0.3s ease",
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
