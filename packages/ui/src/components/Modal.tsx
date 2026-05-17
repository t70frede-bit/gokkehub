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
      // items-start + overflow-y-auto so the whole modal can scroll when
      // content exceeds the viewport (the Create Room form on mobile
      // was being clipped — items-center clips the TOP of overflowing
      // children, since the negative-y portion is unreachable even with
      // an outer scrollbar). my-auto on the child re-centers when
      // content fits comfortably.
      //
      // overscroll-behavior contains scroll momentum to the modal so
      // dragging past the bottom doesn't bounce the underlying page.
      className="fixed inset-0 z-[9998] flex items-start justify-center p-4 overflow-y-auto overscroll-contain"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full rounded-xl p-6 sm:p-8 animate-fade-in my-auto"
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
