import React from "react";

export interface PanelProps {
  variant?: "default" | "bare";
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  as?: React.ElementType;
}

export default function Panel({
  variant = "default",
  className = "",
  style,
  children,
  as: Tag = "div",
}: PanelProps) {
  return (
    <Tag
      className={`
        rounded-xl backdrop-blur-[10px]
        ${variant === "default" ? "p-6 sm:p-8" : ""}
        ${className}
      `.trim()}
      style={{
        background: "linear-gradient(135deg, rgba(var(--surface-raised-rgb), 0.8), rgba(var(--surface-overlay-rgb), 0.8))",
        border: "2px solid rgba(var(--color-primary-rgb), var(--border-opacity))",
        boxShadow: "var(--shadow-card)",
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}
