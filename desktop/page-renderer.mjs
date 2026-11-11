// Renders a page that needs JavaScript in a hidden Electron window, for the
// extract fallback. The desktop counterpart of the Playwright path in
// server/extract.js, with the same rules (see server/playwright-render.js):
//
// - Node does all the networking. Every http(s) request in the render session
//   is answered by fetchUpstream, which validates and pins each hop, so the page
//   cannot reach the user's LAN, localhost or this app's server.
// - Anything that escapes that handler (WebSockets, preconnects, WebRTC over
//   TCP) is sent to a proxy that does not exist, and so fails.
// - GET/HEAD only, no permissions, popups or downloads, sandboxed renderer.
// - Images are collected in an isolated world, where page scripts cannot patch
//   the built-ins the collector uses.

import { BrowserWindow, session } from "electron";

const PARTITION = "surface-render"; // no "persist:" prefix: memory only
const SETTLE_QUIET_MS = 500;
const ISOLATED_WORLD = 1001;
const DEAD_PROXY = "http://127.0.0.1:9";
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

export function createElectronPageRenderer({
  collectRenderedImages,
  renderCollectArgs,
  requestHeadersForUpstream,
  responseHeadersForFulfil,
  timings, // RENDER_TIMINGS in server/extract.js
  skippedResourceTypes, // RENDER_SKIPPED_RESOURCE_TYPES in server/playwright-render.js
  userAgent
}) {
  let current = null; // the render in progress; renders run one at a time
  let queue = Promise.resolve();
  let renderSession = null;

  function setUpSession() {
    if (renderSession) {
      return renderSession;
    }
    const ses = session.fromPartition(PARTITION, { cache: false });
    void ses.setProxy({ proxyRules: DEAD_PROXY, proxyBypassRules: "<-loopback>" });
    ses.setUserAgent(userAgent);
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on("will-download", (event) => event.preventDefault());
    ses.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !/^(https?|data|blob|about):/i.test(details.url) || skippedResourceTypes.has(details.resourceType) });
    });
    for (const scheme of ["http", "https"]) {
      ses.protocol.handle(scheme, (request) => answer(request));
    }
    renderSession = ses;
    return ses;
  }

  async function answer(request) {
    const render = current;
    if (!render || render.closed) {
      return Response.error();
    }
    // Replaying a page's POSTs would make this app a relay for what it submits.
    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response(null, { status: 405 });
    }
    const kept = render.redirected.get(withoutHash(request.url));
    if (kept) {
      render.redirected.delete(withoutHash(request.url));
      return toResponse(kept);
    }
    render.inFlight += 1;
    try {
      const result = await render.limit(() => {
        if (render.closed) {
          throw new Error("Render closed");
        }
        return render.fetchUpstream(request.url, {
          method: request.method,
          headers: requestHeadersForUpstream(Object.fromEntries(request.headers))
        });
      });
      // Node followed the redirects. Send the page to the final URL, so its base
      // URL is right, and answer that request from this response.
      if (result.url && withoutHash(result.url) !== withoutHash(request.url)) {
        render.redirected.set(withoutHash(result.url), result);
        return new Response(null, { status: 302, headers: { location: result.url } });
      }
      return toResponse(result);
    } catch {
      return Response.error();
    } finally {
      render.inFlight -= 1;
      render.lastActivity = Date.now();
    }
  }

  function toResponse(result) {
    const status = result.status >= 200 && result.status <= 599 ? result.status : 502;
    const headers = Object.entries(responseHeadersForFulfil(result.headers))
      .flatMap(([name, value]) => String(value).split("\n").map((part) => [name, part]));
    const body = NULL_BODY_STATUS.has(status) ? null : result.body;
    return new Response(body, { status, headers });
  }

  async function renderOnce(sourceUrl, { limit, fetchUpstream }) {
    const ses = setUpSession();
    const render = {
      fetchUpstream,
      limit: createLimiter(timings.maxInFlight),
      redirected: new Map(),
      inFlight: 0,
      lastActivity: Date.now(),
      closed: false
    };
    current = render;
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        spellcheck: false,
        // alert()/confirm()/print() would show a native dialog from the app and
        // stall the render until the deadline.
        disableDialogs: true
      }
    });
    const contents = win.webContents;
    contents.setAudioMuted(true);
    // WebRTC dials STUN/TURN directly; with this policy and the dead proxy it
    // cannot connect at all.
    contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
    contents.setWindowOpenHandler(() => ({ action: "deny" }));

    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Render timed out")), timings.deadlineMs);
    });
    try {
      return await Promise.race([deadline, collect()]);
    } finally {
      clearTimeout(timer);
      render.closed = true;
      if (current === render) {
        current = null;
      }
      win.destroy();
      await ses.clearStorageData().catch(() => {});
      await ses.clearCache().catch(() => {});
    }

    async function collect() {
      await loadPage(contents, sourceUrl);
      const run = (code) => contents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [{ code }]);
      // Lazy loaders only fill in images that come near the viewport.
      for (let i = 0; i < timings.scrollSteps; i += 1) {
        await run("window.scrollBy(0, window.innerHeight)");
        await sleep(timings.scrollWaitMs);
      }
      await run("window.scrollTo(0, 0)");
      await settle(render, timings.settleMaxMs);
      return run(`(() => {
        const apply = Reflect.apply;
        const slice = String.prototype.slice;
        const clip = (value, max) => (typeof value === "string" ? (value.length > max ? apply(slice, value, [0, max]) : value) : "");
        Object.defineProperty(window, "__sbClip", { value: Object.freeze(clip) });
        return (${collectRenderedImages.toString()})(${JSON.stringify(renderCollectArgs(limit))});
      })()`);
    }
  }

  return (sourceUrl, options) => {
    const run = queue.then(() => renderOnce(sourceUrl, options));
    queue = run.catch(() => {});
    return run;
  };
}

// Resolves at DOMContentLoaded of the final page, like the Playwright path;
// rejects if the navigation fails.
function loadPage(contents, url) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      contents.off("dom-ready", onReady);
      contents.off("did-fail-load", onFail);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onFail = (_event, code, description, _url, isMainFrame) => {
      // -3 is ERR_ABORTED: the redirect to the final URL replacing the first load.
      if (isMainFrame && code !== -3) {
        cleanup();
        reject(new Error(`Render failed: ${description}`));
      }
    };
    contents.on("dom-ready", onReady);
    contents.on("did-fail-load", onFail);
    contents.loadURL(url).catch(() => {});
  });
}

// Like Playwright's networkidle wait: quiet for a moment, or give up.
async function settle(render, maxMs) {
  const giveUp = Date.now() + maxMs;
  while (Date.now() < giveUp) {
    if (render.inFlight === 0 && Date.now() - render.lastActivity >= SETTLE_QUIET_MS) {
      return;
    }
    await sleep(100);
  }
}

function createLimiter(max) {
  let active = 0;
  const waiting = [];
  return async (task) => {
    if (active >= max) {
      await new Promise((resolve) => waiting.push(resolve));
    }
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

function withoutHash(url) {
  const at = url.indexOf("#");
  return at === -1 ? url : url.slice(0, at);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
