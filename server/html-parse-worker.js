// Runs parseHtmlForImages for html-parse-pool.js, which terminates this thread
// when a parse overruns: a stuck synchronous parse cannot be stopped from inside.
import { parentPort } from "node:worker_threads";
import { parseHtmlForImages } from "./html-images.js";

parentPort.on("message", ({ id, html, sourceUrl, limit }) => {
  try {
    parentPort.postMessage({ id, result: parseHtmlForImages(html, sourceUrl, limit) });
  } catch (err) {
    parentPort.postMessage({ id, error: err?.message || String(err) });
  }
});
