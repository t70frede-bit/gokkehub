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
        rounded-xl
        ${variant === "default" ? "p-6 sm:p-8" : ""}
        ${className}
      `.trim()}
      style={{
        background: "rgb(var(--surface-raised-rgb))",
        border: "1px solid rgb(var(--border-rgb))",
        boxShadow: "var(--shadow-card)",
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}
