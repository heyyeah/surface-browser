// Draws background.png and background@2x.png for the DMG window (660 x 400 points).
// Run from desktop/: node build-resources/make-dmg-background.mjs
// sharp is a dependency of the web app one level up, not of desktop/.
import { createRequire } from "node:module";
const sharp = createRequire(new URL("../../package.json", import.meta.url))("sharp");

const W = 660;
const H = 400;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f6f7fb"/>
      <stop offset="1" stop-color="#e4e8f2"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <text x="${W / 2}" y="62" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="22" font-weight="600" fill="#1d2433">Surface Browser</text>
  <text x="${W / 2}" y="92" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="15" fill="#4a5468">Drag the app to Applications to install it</text>
  <g fill="none" stroke="#7a86a0" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M262 200 H392"/>
    <path d="M374 182 L396 200 L374 218"/>
  </g>
</svg>`;

for (const [scale, name] of [[1, "background.png"], [2, "background@2x.png"]]) {
  await sharp(Buffer.from(svg), { density: 72 * scale })
    .resize(W * scale, H * scale)
    .png()
    .toFile(new URL(name, import.meta.url).pathname);
}
console.log("wrote background.png and background@2x.png");
