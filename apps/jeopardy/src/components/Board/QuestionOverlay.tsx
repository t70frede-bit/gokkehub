import type { ReactNode } from "react";
import type { JpBlock, JpBuzzDisplayMode, JpMediaBlock, JpRevealOrder } from "../../lib/types";
import TypewriterText from "../TypewriterText";
import ImageReveal from "../ImageReveal";
import MediaPlayer from "../MediaPlayer";

interface QuestionOverlayProps {
  category: string;
  value:    number;
  blocks:   JpBlock[];
  /** When false, the question content is hidden (pre-reveal step). */
  questionRevealed?: boolean;
  /** How the question behaves once someone buzzes. */
  displayMode: JpBuzzDisplayMode;
  buzzed:      boolean;
  /** Replay counter + audio unlock, for audio/video blocks. */
  mediaNonce:  number;
  soundOn:     boolean;
  /** Staged reveal: which group shows first, and how far along we are. */
  revealOrder?: JpRevealOrder;
  revealStage?: number;
  /** Buzz banner / timer etc., rendered under the question. */
  children?: ReactNode;
}

export default function QuestionOverlay({
  category, value, blocks, questionRevealed = true, displayMode, buzzed, mediaNonce, soundOn,
  revealOrder = "together", revealStage, children,
}: QuestionOverlayProps) {
  const hidden = displayMode === "disappear" && buzzed;
  // Staged reveal groups: text vs everything visual/audible (image/audio/video).
  const stageDone = (revealStage ?? 1) >= 1;
  const showText  = stageDone || revealOrder !== "mediaFirst";
  const showMedia = stageDone || revealOrder !== "textFirst";
  const media  = (questionRevealed && showMedia)
    ? blocks.filter(b => b.type === "audio" || b.type === "video") as JpMediaBlock[]
    : [];
  const visual = questionRevealed
    ? blocks.filter(b =>
        (b.type === "text" && showText) || (b.type === "image" && showMedia))
    : [];

  return (
    <div className="jp-overlay absolute inset-0 z-10 flex flex-col items-center justify-center gap-6 p-6 sm:p-12"
      style={{ background: "rgba(var(--bg-rgb), 0.96)" }}
    >
      <div className="text-sm sm:text-lg font-bold uppercase tracking-widest"
        style={{ color: "rgb(var(--text-secondary-rgb))" }}
      >
        {category} — {value}
      </div>

      {questionRevealed && (!hidden ? (
        <div className="flex flex-col items-center gap-4 max-w-4xl text-center">
          {visual.map(block => block.type === "text" ? (
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
          ) : block.type === "image" ? (
            <ImageReveal key={block.id} url={block.url} mode={block.revealMode ?? "off"}
              frozen={buzzed} className="max-h-[45vh] rounded-lg object-contain" />
          ) : null)}
        </div>
      ) : (
        <p className="text-3xl font-black uppercase tracking-widest"
          style={{ color: "rgba(var(--text-secondary-rgb), 0.5)" }}
        >
          · · ·
        </p>
      ))}

      {/* Media stays mounted only when revealed (avoids premature autoplay). */}
      {media.map(block => (
        <MediaPlayer key={block.id} block={block} buzzed={buzzed}
          nonce={mediaNonce} soundOn={soundOn} />
      ))}
      {children}
    </div>
  );
}
