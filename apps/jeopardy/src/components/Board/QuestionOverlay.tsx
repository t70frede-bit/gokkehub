import type { ReactNode } from "react";
import type { JpBlock, JpBuzzDisplayMode } from "../../lib/types";
import TypewriterText from "../TypewriterText";
import ImageReveal from "../ImageReveal";

interface QuestionOverlayProps {
  category: string;
  value:    number;
  blocks:   JpBlock[];
  /** How the question behaves once someone buzzes. */
  displayMode: JpBuzzDisplayMode;
  buzzed:      boolean;
  /** Buzz banner / timer etc., rendered under the question. */
  children?: ReactNode;
}

export default function QuestionOverlay({
  category, value, blocks, displayMode, buzzed, children,
}: QuestionOverlayProps) {
  const hidden = displayMode === "disappear" && buzzed;
  return (
    <div className="jp-overlay absolute inset-0 z-10 flex flex-col items-center justify-center gap-6 p-6 sm:p-12"
      style={{ background: "rgba(var(--bg-rgb), 0.96)" }}
    >
      <div className="text-sm sm:text-lg font-bold uppercase tracking-widest"
        style={{ color: "rgb(var(--text-secondary-rgb))" }}
      >
        {category} — {value}
      </div>
      {!hidden && (
        <div className="flex flex-col items-center gap-4 max-w-4xl text-center">
          {blocks.map(block => block.type === "text" ? (
            displayMode === "typewriter" ? (
              <TypewriterText key={block.id} text={block.text} frozen={buzzed}
                className="text-2xl sm:text-5xl font-bold leading-snug"
                style={{ color: "rgb(var(--text-primary-rgb))" }} />
            ) : (
              <p key={block.id} className="text-2xl sm:text-5xl font-bold leading-snug"
                style={{ color: "rgb(var(--text-primary-rgb))" }}
              >
                {block.text}
              </p>
            )
          ) : (
            <ImageReveal key={block.id} url={block.url} mode={block.revealMode ?? "off"}
              frozen={buzzed} className="max-h-[45vh] rounded-lg object-contain" />
          ))}
        </div>
      )}
      {hidden && (
        <p className="text-3xl font-black uppercase tracking-widest"
          style={{ color: "rgba(var(--text-secondary-rgb), 0.5)" }}
        >
          · · ·
        </p>
      )}
      {children}
    </div>
  );
}
