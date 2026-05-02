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
      className={`flex rounded-md overflow-hidden ${className}`}
      style={{
        background: "rgb(var(--surface-raised-rgb))",
        border:     "1px solid rgb(var(--border-rgb))",
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className="flex-1 px-4 py-2 text-sm font-bold transition-all duration-150 border-none cursor-pointer"
            style={
              active
                ? {
                    background: "rgba(var(--color-primary-rgb), 0.18)",
                    color:      "rgb(var(--color-primary-rgb))",
                  }
                : {
                    background: "transparent",
                    color:      "rgb(var(--text-secondary-rgb))",
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
