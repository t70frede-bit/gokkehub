// Generates the PWA / home-screen app icons from an inline SVG.
// Run from the repo root with sharp available:
//   npm i sharp --no-save && node apps/poker/scripts/gen-icons.mjs
// Outputs PNGs into apps/poker/public/. iOS needs a PNG apple-touch-icon
// (it ignores SVG); Android/PWA needs 192 + 512 (incl. maskable).

import sharp from "sharp";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = resolve(__dirname, "../public");

// Amber spade (from the favicon) centred on a warm-charcoal square. The spade
// sits well within ~60% of the canvas, so the same art is safe as a maskable
// icon (Android crops to ~80%).
const spade =
  "M32 14 C 22 24, 14 30, 14 38 a 8 8 0 0 0 15 3 c -1 5, -3 7, -6 9 h 18 " +
  "c -3 -2, -5 -4, -6 -9 a 8 8 0 0 0 15 -3 c 0 -8, -8 -14, -18 -24 z";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="#1A1614"/>
  <g transform="scale(16)"><path d="${spade}" fill="#D4A04A"/></g>
</svg>`;

const sizes = [180, 192, 512];
for (const size of sizes) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`${out}/icon-${size}.png`);
  console.log(`wrote icon-${size}.png`);
}
