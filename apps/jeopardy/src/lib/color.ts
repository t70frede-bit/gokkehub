/**
 * Contrast helpers for team colours.
 *
 * A team colour is arbitrary (a captain picks it), so anything painted ON one —
 * the buzzer label above all — can't assume a fixed text colour. The palette
 * alone spans cyan and green, which need dark text, and blue and purple, which
 * need white. These return literal colours rather than theme tokens on purpose:
 * the text has to contrast with the team's colour, not with the page.
 */

/** #rrggbb → channels. Anything unparseable is treated as mid-grey. */
function channels(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours, 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export const INK   = "#0B0C0E";
export const PAPER = "#FFFFFF";

/** Whichever of near-black / white reads better on `background`. */
export function readableTextOn(background: string): string {
  return contrastRatio(background, INK) >= contrastRatio(background, PAPER) ? INK : PAPER;
}
