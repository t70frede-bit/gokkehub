import type { ReactNode } from "react";
import type { JpBlock, JpBuzzDisplayMode, JpMediaBlock } from "../../lib/types";
import TypewriterText from "../TypewriterText";
import ImageReveal from "../ImageReveal";
import MediaPlayer from "../MediaPlayer";

interface QuestionOverlayProps {
  category: string;
  value:    number;
  blocks:   JpBlock[];
  /** How the question behaves once someone buzzes. */
  displayMode: JpBuzzDisplayMode;
  buzzed:      boolean;
  /** Replay counter + audio unlock, for audio/video blocks. */
  mediaNonce:  number;
  soundOn:     boolean;
  /** Buzz banner / timer etc., rendered under the question. */
  children?: ReactNode;
}

export default function QuestionOverlay({
  category, value, blocks, displayMode, buzzed, mediaNonce, soundOn, children,
}: QuestionOverlayProps) {
  const hidden = displayMode === "disappear" && buzzed;
  const media  = blocks.filter(b => b.type === "audio" || b.type === "video") as JpMediaBlock[];
  const visual = blocks.filter(b => b.type === "text" || b.type === "image");

  return (
    <div className="jp-overlay absolute inset-0 z-10 flex flex-col items-center justify-center gap-6 p-6 sm:p-12"
      style={{ background: "rgba(var(--bg-rgb), 0.96)" }}
    >
      <div className="text-sm sm:text-lg font-bold uppercase tracking-widest"
        style={{ color: "rgb(var(--text-secondary-rgb))" }}
      >
        {category} — {value}
      </div>
      {!hidden ? (
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
      )}
      {/* Media stays mounted even when the question "disappears" — its own
          on-buzz setting (stop / fade / freeze / continue) governs playback. */}
      {media.map(block => (
        <MediaPlayer key={block.id} block={block} buzzed={buzzed}
          nonce={mediaNonce} soundOn={soundOn} />
      ))}
      {children}
    </div>
  );
}
