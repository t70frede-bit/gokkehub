import type { ReactNode } from "react";
import type { JpBlock } from "../../lib/types";

interface QuestionOverlayProps {
  category: string;
  value:    number;
  blocks:   JpBlock[];
  /** Buzz banner / timer etc., rendered under the question. */
  children?: ReactNode;
}

export default function QuestionOverlay({ category, value, blocks, children }: QuestionOverlayProps) {
  return (
    <div className="jp-overlay absolute inset-0 z-10 flex flex-col items-center justify-center gap-6 p-6 sm:p-12"
      style={{ background: "rgba(var(--bg-rgb), 0.96)" }}
    >
      <div className="text-sm sm:text-lg font-bold uppercase tracking-widest"
        style={{ color: "rgb(var(--text-secondary-rgb))" }}
      >
        {category} — {value}
      </div>
      <div className="flex flex-col gap-4 max-w-4xl text-center">
        {blocks.map(block => (
          <p key={block.id} className="text-2xl sm:text-5xl font-bold leading-snug"
            style={{ color: "rgb(var(--text-primary-rgb))" }}
          >
            {block.text}
          </p>
        ))}
      </div>
      {children}
    </div>
  );
}
