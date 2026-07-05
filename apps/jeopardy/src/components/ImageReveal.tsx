import type { JpRevealMode } from "../lib/types";

interface ImageRevealProps {
  url:       string;
  mode:      JpRevealMode;
  /** Buzz happened: the animated sharpen pauses where it is. */
  frozen:    boolean;
  /** Question resolved: show the image plainly regardless of mode. */
  revealed?: boolean;
  className?: string;
}

const MODE_CLASS: Record<JpRevealMode, string> = {
  off:        "",
  silhouette: "jp-img-silhouette",
  pixelated:  "jp-img-pixelated",
  animated:   "jp-img-animated",
};

export default function ImageReveal({ url, mode, frozen, revealed = false, className = "" }: ImageRevealProps) {
  const cls = [
    MODE_CLASS[mode],
    mode === "animated" && frozen ? "jp-img-frozen" : "",
    revealed ? "jp-img-revealed" : "",
    className,
  ].filter(Boolean).join(" ");
  return <img src={url} alt="" className={cls} />;
}
