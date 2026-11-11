// The render window's lockdown, in a real Electron:
//   electron test/renderer-e2e.mjs   (npm run test:renderer)
// A hostile page is served through a stub fetchUpstream. Everything it tries to
// load must reach the stub (Node's checked path) or nothing at all: a local TCP
// listener stands in for the user's LAN and this app's server, and must never
// see a connection. Exits 0 when every check passes.

import { app } from "electron";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElectronPageRenderer } from "../page-renderer.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
};

// No main window here: closing the render window must not quit the test.
app.on("window-all-closed", () => {});

app.whenReady().then(async () => {
  let directHits = 0;
  const listener = net.createServer((socket) => {
    directHits += 1;
    socket.destroy();
  });
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;

  const extract = await load("server/extract.js");
  const render = await load("server/playwright-render.js");
  const renderer = createElectronPageRenderer({
    collectRenderedImages: extract.collectRenderedImages,
    renderCollectArgs: extract.renderCollectArgs,
    requestHeadersForUpstream: render.requestHeadersForUpstream,
    responseHeadersForFulfil: render.responseHeadersForFulfil,
    timings: extract.RENDER_TIMINGS,
    skippedResourceTypes: render.RENDER_SKIPPED_RESOURCE_TYPES,
    userAgent: "test"
  });

  const page = `<!doctype html><title>${"T".repeat(5000)}</title>
    <style>@font-face { font-family: f; src: url("https://site.test/f.woff2"); } body { font-family: f; }</style><body>
    <video src="https://site.test/v.mp4" autoplay muted></video>
    <img src="https://site.test/a.png" width="400" height="300" alt="first">
    <a href="https://site.test/item"><img src="https://site.test/b.png" width="400" height="300"></a>
    <img src="http://127.0.0.1:${port}/direct.png">
    <script>
      alert("a native dialog would stall the render");
      String.prototype.slice = () => "patched";
      const img = document.createElement("img");
      img.src = "https://site.test/scripted.png"; img.width = 500; img.height = 400;
      document.body.appendChild(img);
      try { new WebSocket("ws://127.0.0.1:${port}/"); } catch {}
      fetch("https://site.test/post", { method: "POST", body: "x" }).catch(() => {});
      fetch("http://127.0.0.1:${port}/api").catch(() => {});
      try { const pc = new RTCPeerConnection({ iceServers: [{ urls: "turn:127.0.0.1:${port}?transport=tcp", username: "u", credential: "c" }] });
        pc.createDataChannel("x"); pc.createOffer().then((o) => pc.setLocalDescription(o)); } catch {}
    </script></body>`;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgAAACAAFUok9dAAAAAElFTkSuQmCC", "base64"); // 1x1 PNG
  const seen = [];
  const fetchUpstream = async (url, { method }) => {
    seen.push(`${method} ${url}`);
    if (url === "https://site.test/start") {
      return { url: "https://site.test/final", status: 200, headers: { "content-type": "text/html" }, body: Buffer.from(page) };
    }
    if (/^https:\/\/site\.test\/.*\.png$/.test(url)) {
      return { url, status: 200, headers: { "content-type": "image/png" }, body: png };
    }
    throw new Error("blocked by policy");
  };

  try {
    const startedAt = Date.now();
    const result = await renderer("https://site.test/start", { limit: 20, fetchUpstream });
    check(Date.now() - startedAt < 15000, "alert() does not stall the render");
    check(!seen.some((s) => /\.(woff2|mp4)$/.test(s)), "fonts and media are not fetched");
    const urls = result.items.map((item) => item.imageUrl);
    check(seen.filter((s) => s === "GET https://site.test/start").length === 1, "the page is fetched once, through Node");
    check(!seen.some((s) => s.includes("/final")), "the redirect target is answered from the kept response");
    check(urls.includes("https://site.test/a.png") && urls.includes("https://site.test/scripted.png"), "static and scripted images are collected");
    check(result.items.some((item) => item.linkUrl === "https://site.test/item"), "image links are collected");
    check(result.title.length <= 2000 && result.title !== "patched", "the collector's clip survives the page patching String.prototype");
    check(!seen.some((s) => s.startsWith("POST")), "a POST never leaves");
    check(seen.includes(`GET http://127.0.0.1:${port}/direct.png`), "a loopback image goes to Node's policy, not the network");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    check(directHits === 0, `nothing connects directly (WebSocket, WebRTC, loopback): ${directHits} connection(s)`);
  } catch (err) {
    check(false, `render threw: ${err.message}`);
  }
  listener.close();
  app.exit(failures.length ? 1 : 0);
});
