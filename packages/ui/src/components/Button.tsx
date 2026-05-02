import React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
  loading?: boolean;
  children: React.ReactNode;
}

const sizeStyles: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "px-3 py-1.5 text-sm gap-1.5",
  md: "px-4 py-2.5 text-base gap-2",
  lg: "px-6 py-3.5 text-lg gap-2.5",
};

const variantStyles: Record<NonNullable<ButtonProps["variant"]>, React.CSSProperties> = {
  primary: {
    background: "rgb(var(--color-primary-rgb))",
    color: "rgb(var(--bg-rgb))",
    border: "1px solid transparent",
  },
  ghost: {
    background: "transparent",
    color: "rgb(var(--text-primary-rgb))",
    border: "1px solid rgb(var(--border-rgb))",
  },
  danger: {
    background: "transparent",
    color: "rgb(var(--color-danger-rgb))",
    border: "1px solid rgba(var(--color-danger-rgb), 0.55)",
  },
};

const Spinner = () => (
  <svg
    style={{ width: "1em", height: "1em", animation: "spin 0.75s linear infinite" }}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
  >
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
  </svg>
);

export default function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  loading = false,
  disabled,
  children,
  style,
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={`
        inline-flex items-center justify-center font-bold rounded-md
        cursor-pointer select-none transition-all duration-100
        active:scale-[0.98]
        disabled:opacity-45 disabled:cursor-not-allowed
        ${sizeStyles[size]}
        ${fullWidth ? "w-full" : ""}
        ${className}
      `.trim()}
      style={{ letterSpacing: "0.01em", ...variantStyles[variant], ...style }}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
