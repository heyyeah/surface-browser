// One SVG render per process, for rasterizeSvg (images.js), which kills this
// process at the deadline: librsvg cannot be interrupted mid-tile.
import { ImageFormatError, renderSanitizedSvg, sanitizeSvg } from "./images.js";

process.once("message", async ({ svg, maxEdgePx }) => {
  try {
    const clean = Buffer.from(sanitizeSvg(Buffer.from(svg).toString("utf8")));
    const png = await renderSanitizedSvg(clean, maxEdgePx);
    process.send({ png });
  } catch (err) {
    process.send({ formatError: err instanceof ImageFormatError, message: err?.message || String(err) });
  }
});
