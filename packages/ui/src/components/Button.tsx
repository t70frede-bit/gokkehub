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
    background: "linear-gradient(135deg, rgb(var(--color-primary-rgb)), rgb(var(--color-secondary-rgb)))",
    color: "#fff",
    border: "none",
    boxShadow: "0 4px 15px rgba(var(--color-primary-rgb), 0.4)",
  },
  ghost: {
    background: "rgba(var(--color-primary-rgb), 0.12)",
    color: "rgb(var(--text-secondary-rgb))",
    border: "2px solid rgba(var(--color-primary-rgb), 0.5)",
  },
  danger: {
    background: "rgba(var(--color-danger-rgb), 0.15)",
    color: "rgb(var(--color-danger-rgb))",
    border: "2px solid rgba(var(--color-danger-rgb), 0.5)",
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
        inline-flex items-center justify-center font-semibold rounded-md
        cursor-pointer select-none transition-all duration-150
        hover:-translate-y-0.5 active:translate-y-0
        disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none
        ${sizeStyles[size]}
        ${fullWidth ? "w-full" : ""}
        ${className}
      `.trim()}
      style={{ ...variantStyles[variant], ...style }}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
