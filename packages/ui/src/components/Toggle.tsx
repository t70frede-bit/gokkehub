import React from "react";

export interface ToggleOption<T extends string = string> {
  value: T;
  label: string;
}

export interface ToggleProps<T extends string = string> {
  options: ToggleOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export default function Toggle<T extends string = string>({
  options,
  value,
  onChange,
  className = "",
}: ToggleProps<T>) {
  return (
    <div
      className={`flex rounded-xl overflow-hidden ${className}`}
      style={{ background: "rgba(255, 255, 255, 0.07)" }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className="flex-1 px-4 py-2.5 text-sm font-semibold transition-all duration-200 border-none cursor-pointer"
            style={
              active
                ? {
                    background:
                      "linear-gradient(135deg, rgba(var(--color-primary-rgb), 0.75), rgba(var(--color-secondary-rgb), 0.75))",
                    color: "#fff",
                  }
                : {
                    background: "transparent",
                    color: "rgb(var(--text-secondary-rgb))",
                  }
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
