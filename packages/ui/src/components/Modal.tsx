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
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full rounded-xl p-6 sm:p-8 animate-fade-in"
        style={{
          maxWidth,
          background: "rgb(var(--surface-overlay-rgb))",
          border: "1px solid rgb(var(--border-rgb))",
          boxShadow: "var(--shadow-elevated)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
