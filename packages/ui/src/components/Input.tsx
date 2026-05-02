import React from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export default function Input({
  label,
  error,
  id,
  className = "",
  style,
  ...props
}: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="flex flex-col gap-2">
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm font-semibold"
          style={{ color: "rgb(var(--text-secondary-rgb))" }}
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`w-full px-4 py-2.5 rounded-md font-sans text-base
          outline-none transition-all duration-150
          focus:ring-2
          placeholder:opacity-60
          ${className}`.trim()}
        style={{
          background: "rgb(var(--surface-input-rgb))",
          border: error
            ? "1px solid rgba(var(--color-danger-rgb), 0.6)"
            : "1px solid rgb(var(--border-rgb))",
          color: "rgb(var(--text-primary-rgb))",
          // @ts-expect-error css vars
          "--tw-ring-color": "rgba(var(--color-primary-rgb), 0.18)",
          ...style,
        }}
        {...props}
      />
      {error && (
        <p
          className="text-sm"
          style={{ color: "rgb(var(--color-danger-rgb))" }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
