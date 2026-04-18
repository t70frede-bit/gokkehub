import React, { useEffect } from "react";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
}

export default function Modal({
  open,
  onClose,
  children,
  maxWidth = "480px",
}: ModalProps) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(6px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full rounded-2xl p-8 animate-fade-in"
        style={{
          maxWidth,
          background: "linear-gradient(135deg, rgba(var(--surface-raised-rgb, 30 30 50), 0.96), rgba(var(--surface-overlay-rgb, 50 20 60), 0.96))",
          border: "1.5px solid rgba(var(--color-primary-rgb, 130 60 200), 0.45)",
          boxShadow: "0 8px 40px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
