import { PLACEHOLDER_IMAGE_NAME } from "./image-url-filters.js";
import {
  CARD_LINK_MAX_DEPTH,
  MAX_LINKS_PER_IMAGE,
  RENDER_MAX_TEXT_CHARS,
  RENDER_MAX_URL_CHARS,
  imageLabel,
  isAllowedImageUrl,
  isAllowedLink,
  passesDimensionHeuristic
} from "./html-images.js";
import { parseHtmlForImagesOffThread } from "./html-parse-pool.js";
import { hasNavigableUrlShape } from "../shared/url-shape.js";
import { clampNumber, parseNonNegativeInteger, parsePositiveInteger } from "./env.js";
import { RequestPolicyError, sendPolicyError } from "./errors.js";
import {
  MAX_RESPONSE_BYTES,
  REQUEST_TIMEOUT_MS,
  browserUserAgent,
  fetchWithTimeout,
  normalizeAndAssertTargetUrl,
  readResponseBuffer
} from "./net-policy.js";
import { logApiQuery } from "./query-log.js";
import { DEFAULT_LIMIT } from "./settings.js";
import {
  CHROMIUM_LAUNCH_OPTIONS,
  CONTEXT_LOCKDOWN_OPTIONS,
  createSharedBrowser,
  routeContextThroughNode,
  withRenderDeadline
} from "./playwright-render.js";

const DEFAULT_THRESHOLD = 5;

// Browser renders are 3–12 s of CPU and 200–400 MB each on a 2-CPU box. Over the
// limit a page waits up to PLAYWRIGHT_WAIT_MS for a render (at most
// PLAYWRIGHT_WAIT_MAX waiting), then falls back to its plain-HTML result.
const PLAYWRIGHT_CONCURRENCY_MAX = parseNonNegativeInteger(process.env.PLAYWRIGHT_CONCURRENCY_MAX, 1);
const PLAYWRIGHT_WAIT_MS = parseNonNegativeInteger(process.env.PLAYWRIGHT_WAIT_MS, 8000);
const PLAYWRIGHT_WAIT_MAX = parseNonNegativeInteger(process.env.PLAYWRIGHT_WAIT_MAX, 3);
let activeRenders = 0;
const renderWaiters = [];

// Resolves true once the caller holds a render slot; false on timeout, a full
// wait list, or the visitor leaving.
function acquireRenderSlot(res) {
  if (PLAYWRIGHT_CONCURRENCY_MAX === 0 || activeRenders < PLAYWRIGHT_CONCURRENCY_MAX) {
    activeRenders += 1;
    return Promise.resolve(true);
  }
  if (!PLAYWRIGHT_WAIT_MS || renderWaiters.length >= PLAYWRIGHT_WAIT_MAX) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const settle = (granted) => {
      clearTimeout(timer);
      res.off("close", onClose);
      const index = renderWaiters.indexOf(settle);
      if (index >= 0) {
        renderWaiters.splice(index, 1);
      }
      resolve(granted);
    };
    const onClose = () => settle(false);
    const timer = setTimeout(() => settle(false), PLAYWRIGHT_WAIT_MS);
    res.once("close", onClose);
    renderWaiters.push(settle);
  });
}

// Hands the slot straight to the next waiter, so a new arrival cannot take it
// between the release and the waiter waking.
function releaseRenderSlot() {
  const next = renderWaiters.shift();
  if (next) {
    next(true);
  } else {
    activeRenders = Math.max(0, activeRenders - 1);
  }
}

// Every extracted page is cached, typed URLs included, so a news page can be up
// to EXTRACT_CACHE_TTL_MS stale. 0 disables. In memory, so a restart empties it;
// `fallback=force` always fetches fresh.
const EXTRACT_CACHE_TTL_MS = parseNonNegativeInteger(process.env.EXTRACT_CACHE_TTL_MS, 24 * 60 * 60 * 1000);
const EXTRACT_CACHE_MAX_ENTRIES = parsePositiveInteger(process.env.EXTRACT_CACHE_MAX_ENTRIES, 500);
// Bounded by bytes too: a page's title and URLs are its author's to make huge,
// and 500 entries of 10 MB each would exhaust memory. An ordinary result is a
// few KB.
const EXTRACT_CACHE_MAX_ENTRY_BYTES = 256 * 1024;
const EXTRACT_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const extractCache = new Map();
let extractCacheBytes = 0;

export function extractCacheKey(sourceUrl, query) {
  const fallbackMode = normalizeFallback(query.fallback);
  if (!sourceUrl || EXTRACT_CACHE_TTL_MS <= 0 || fallbackMode === "force") {
    return null;
  }
  const limit = clampNumber(query.limit, 1, DEFAULT_LIMIT, DEFAULT_LIMIT);
  const threshold = clampNumber(query.threshold, 1, 30, DEFAULT_THRESHOLD);
  return `${sourceUrl}|${limit}|${threshold}|${fallbackMode}`;
}

export function readCachedExtract(key) {
  const hit = extractCache.get(key);
  if (!hit) {
    return null;
  }
  if (hit.expiresAt <= Date.now()) {
    dropCachedExtract(key);
    return null;
  }
  return hit.body;
}

function dropCachedExtract(key) {
  const hit = extractCache.get(key);
  if (hit) {
    extractCache.delete(key);
    extractCacheBytes -= hit.bytes;
  }
}

function writeCachedExtract(key, body) {
  const bytes = Buffer.byteLength(JSON.stringify(body));
  if (bytes > EXTRACT_CACHE_MAX_ENTRY_BYTES) {
    return;
  }
  dropCachedExtract(key);
  extractCache.set(key, { expiresAt: Date.now() + EXTRACT_CACHE_TTL_MS, body, bytes });
  extractCacheBytes += bytes;
  while (extractCache.size > EXTRACT_CACHE_MAX_ENTRIES || extractCacheBytes > EXTRACT_CACHE_MAX_BYTES) {
    dropCachedExtract(extractCache.keys().next().value);
  }
}

// Render when the HTML has too few linked images, once: a page whose static
// HTML yields fewer than this many linked images is also rendered in a browser
// (if Playwright is available). A render that did not improve on the HTML is
// remembered for an hour so visitors do not re-render the same page.
const MIN_LINKED_BEFORE_RENDER = 3;
const RENDER_NO_GAIN_TTL_MS = 60 * 60 * 1000;
const RENDER_NO_GAIN_MAX_ENTRIES = 200;
const renderNoGain = new Map();

function renderRecentlyUseless(url) {
  const until = renderNoGain.get(url);
  if (!until) {
    return false;
  }
  if (until <= Date.now()) {
    renderNoGain.delete(url);
    return false;
  }
  return true;
}

function rememberRenderUseless(url) {
  renderNoGain.delete(url);
  renderNoGain.set(url, Date.now() + RENDER_NO_GAIN_TTL_MS);
  while (renderNoGain.size > RENDER_NO_GAIN_MAX_ENTRIES) {
    renderNoGain.delete(renderNoGain.keys().next().value);
  }
}

// The last good render of each page, kept after its extract-cache entry expires,
// for when the renderer is busy: a week-old render beats the plain-HTML result
// the visitor would otherwise get. In memory only (Tim, 2026-11-11).
const RENDER_KEEP_TTL_MS = parseNonNegativeInteger(process.env.RENDER_KEEP_TTL_MS, 7 * 24 * 60 * 60 * 1000);
const RENDER_KEEP_MAX_ENTRIES = 300;
const RENDER_KEEP_MAX_BYTES = 16 * 1024 * 1024;
const keptRenders = new Map();
let keptRenderBytes = 0;

function dropKeptRender(url) {
  const kept = keptRenders.get(url);
  if (kept) {
    keptRenders.delete(url);
    keptRenderBytes -= kept.bytes;
  }
}

function keepRender(url, result) {
  if (!RENDER_KEEP_TTL_MS || !result?.items.length) {
    return;
  }
  const bytes = Buffer.byteLength(JSON.stringify(result));
  if (bytes > EXTRACT_CACHE_MAX_ENTRY_BYTES) {
    return;
  }
  dropKeptRender(url);
  keptRenders.set(url, { result, bytes, renderedAt: Date.now() });
  keptRenderBytes += bytes;
  while (keptRenders.size > RENDER_KEEP_MAX_ENTRIES || keptRenderBytes > RENDER_KEEP_MAX_BYTES) {
    dropKeptRender(keptRenders.keys().next().value);
  }
}

function readKeptRender(url) {
  const kept = keptRenders.get(url);
  if (!kept) {
    return null;
  }
  if (Date.now() - kept.renderedAt > RENDER_KEEP_TTL_MS) {
    dropKeptRender(url);
    return null;
  }
  return kept;
}

function linkedItemCount(result) {
  return result ? result.items.filter((item) => item.linkUrl).length : 0;
}

export async function handleExtract(req, res) {
  let sourceUrl;
  try {
    if (!hasNavigableUrlShape(req.query.url)) {
      throw new RequestPolicyError("URL must include http(s), a web host, or a path");
    }
    sourceUrl = await normalizeAndAssertTargetUrl(req.query.url, "url query parameter");
  } catch (err) {
    sendPolicyError(res, err, "Missing or invalid url query parameter");
    return;
  }

  const limit = clampNumber(req.query.limit, 1, DEFAULT_LIMIT, DEFAULT_LIMIT);
  const threshold = clampNumber(req.query.threshold, 1, 30, DEFAULT_THRESHOLD);
  const fallbackMode = normalizeFallback(req.query.fallback);
  const startedAt = Date.now();
  // Looked up ahead of the slot pool (see the app.get above the guards).
  let cacheKey = extractCacheKey(sourceUrl, req.query);

  const warnings = [];
  let primary = null;
  let fallback = null;
  // Set when the site itself refused us (401/403/429), so an empty result can
  // say "blocked" rather than "no images".
  let blockedBy = null;

  try {
    primary = await extractViaHtmlFetch(sourceUrl, limit);
  } catch (err) {
    if (sendPolicyError(res, err)) {
      return;
    }
    if (/^HTTP (401|403|429)$/.test(err.message)) {
      blockedBy = new URL(sourceUrl).hostname.replace(/^www\./, "");
    }
    warnings.push(`Primary extraction failed: ${err.message}`);
  }

  const shouldFallback = fallbackMode === "force"
    || (fallbackMode === "auto"
      && (!primary || primary.items.length < threshold || linkedItemCount(primary) < MIN_LINKED_BEFORE_RENDER)
      && !renderRecentlyUseless(sourceUrl));

  let rendering = false;
  if (shouldFallback) {
    // The render has its own limit (activeRenders); holding a page-load slot for
    // its wait and 4-25 s as well would leave other visitors 2 slots for
    // second-long loads.
    res.locals.releaseConcurrencySlot?.();
    rendering = await acquireRenderSlot(res);
    if (!rendering) {
      // A day of the HTML-only (or kept) result is the wrong thing to remember.
      cacheKey = null;
      const kept = fallbackMode === "auto" ? readKeptRender(sourceUrl) : null;
      if (kept) {
        fallback = kept.result;
        warnings.push(`Renderer busy: using a render from ${Math.round((Date.now() - kept.renderedAt) / 60000)} min ago`);
      } else {
        warnings.push("Render skipped: the renderer is busy");
      }
      logApiQuery("extract.renderBusy", { url: sourceUrl, kept: Boolean(kept) });
    }
  }
  if (rendering) {
    try {
      fallback = await extractViaPlaywright(sourceUrl, limit);
      if (chooseResult(primary, fallback) === fallback) {
        keepRender(sourceUrl, fallback);
        warnings.push(primary ? "Using fallback extraction result" : "Primary unavailable; using fallback extraction");
      } else {
        warnings.push("Fallback extraction was no better; keeping primary result");
      }
    } catch (err) {
      if (sendPolicyError(res, err)) {
        return;
      }
      warnings.push(`Fallback extraction unavailable: ${err.message}`);
    } finally {
      releaseRenderSlot();
    }
    if (fallbackMode === "auto" && chooseResult(primary, fallback) !== fallback) {
      rememberRenderUseless(sourceUrl);
    }
  }

  const selected = chooseResult(primary, fallback);
  if (blockedBy && !selected?.items.length) {
    logApiQuery("extract.blocked", { url: sourceUrl, durationMs: Date.now() - startedAt });
    res.status(502).json({
      error: `${blockedBy} blocks requests from this server`,
      code: "blocked",
      meta: { warnings }
    });
    return;
  }
  if (!selected) {
    logApiQuery("extract.failed", {
      url: sourceUrl,
      limit,
      fallback: fallbackMode,
      durationMs: Date.now() - startedAt,
      error: "No extraction result available"
    });
    res.status(502).json({
      error: "No extraction result available",
      meta: { warnings }
    });
    return;
  }

  logApiQuery("extract.complete", {
    url: sourceUrl,
    limit,
    fallback: fallbackMode,
    method: selected.method,
    items: selected.items.length,
    durationMs: Date.now() - startedAt
  });
  const body = {
    sourceUrl,
    title: selected.title,
    // An image with no link of its own links back to its page (as the original Java
    // ImageLoader did). Done last, so the linked/unlinked filters above still apply.
    items: selected.items.slice(0, limit).map((item) => (item.linkUrl ? item : { ...item, linkUrl: sourceUrl })),
    meta: {
      method: selected.method,
      warnings
    }
  };
  if (cacheKey && body.items.length > 0) {
    writeCachedExtract(cacheKey, body);
  }
  res.json(body);
}

function chooseResult(primary, fallback) {
  if (!primary && !fallback) {
    return null;
  }
  if (!fallback) {
    return primary;
  }
  if (!primary) {
    return fallback;
  }
  // More LINKED images wins, provided the render did not collapse the set
  // (a handful of linked images is not better than a full tunnel of them).
  const fallbackLinked = linkedItemCount(fallback);
  const primaryLinked = linkedItemCount(primary);
  if (fallbackLinked !== primaryLinked) {
    const enough = fallback.items.length >= Math.min(primary.items.length, DEFAULT_THRESHOLD);
    if (fallbackLinked > primaryLinked && enough) {
      return fallback;
    }
    if (primaryLinked > fallbackLinked) {
      return primary;
    }
  }
  return fallback.items.length >= primary.items.length ? fallback : primary;
}

function normalizeFallback(raw) {
  const value = String(raw || "auto").toLowerCase();
  if (value === "force" || value === "none") {
    return value;
  }
  return "auto";
}

async function extractViaHtmlFetch(sourceUrl, limit) {
  const response = await fetchWithTimeout(sourceUrl, {
    headers: {
      "user-agent": browserUserAgent(),
      "accept": "text/html,application/xhtml+xml"
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const html = (await readResponseBuffer(response)).toString("utf8");
  const parsed = await parseHtmlForImagesOffThread(html, sourceUrl, limit);
  return {
    title: parsed.title,
    items: parsed.items,
    method: "html_fetch"
  };
}

const PLAYWRIGHT_SCROLL_STEPS = 4;
const PLAYWRIGHT_SCROLL_WAIT_MS = 400;
const PLAYWRIGHT_SETTLE_MS = 3000;
// Covers context creation, navigation, scrolling and collection together.
const PLAYWRIGHT_RENDER_DEADLINE_MS = 25000;
const PLAYWRIGHT_IDLE_CLOSE_MS = 60000;
// Each sub-request is buffered in Node (up to MAX_RESPONSE_BYTES) before it is
// fulfilled, and a page can fire hundreds at once.
const PLAYWRIGHT_UPSTREAM_CONCURRENCY = 6;

// The desktop app's renderer (desktop/page-renderer.mjs) uses these too, so both
// render paths scroll, wait and give up alike.
export const RENDER_TIMINGS = Object.freeze({
  scrollSteps: PLAYWRIGHT_SCROLL_STEPS,
  scrollWaitMs: PLAYWRIGHT_SCROLL_WAIT_MS,
  settleMaxMs: PLAYWRIGHT_SETTLE_MS,
  deadlineMs: PLAYWRIGHT_RENDER_DEADLINE_MS,
  maxInFlight: PLAYWRIGHT_UPSTREAM_CONCURRENCY
});

export function isPlaywrightEnabled() {
  return process.env.PLAYWRIGHT_ENABLED !== "0";
}

const sharedChromium = createSharedBrowser({
  idleMs: PLAYWRIGHT_IDLE_CLOSE_MS,
  launch: async () => {
    let playwright;
    try {
      playwright = await import("playwright");
    } catch {
      throw new Error("playwright package is not installed");
    }
    return playwright.chromium.launch(CHROMIUM_LAUNCH_OPTIONS);
  }
});

// Chromium's network, served from Node: fetchWithTimeout validates and pins
// every redirect hop, and the HTML fetch's timeout and size caps apply.
async function fetchForRender(url, { method, headers, body }) {
  const response = await fetchWithTimeout(url, { method, headers, body }, REQUEST_TIMEOUT_MS);
  const buffer = await readResponseBuffer(response, MAX_RESPONSE_BYTES);
  return { url: response.url || url, status: response.status, headers: response.headers, body: buffer };
}

async function extractViaPlaywright(sourceUrl, limit) {
  if (!isPlaywrightEnabled()) {
    throw new Error("PLAYWRIGHT_ENABLED=0");
  }
  if (externalPageRenderer) {
    const { title, items } = await externalPageRenderer(sourceUrl, { limit, fetchUpstream: fetchForRender });
    return finishRenderedExtraction(sourceUrl, limit, title, items);
  }

  const browser = await sharedChromium.acquire();
  let context = null;
  try {
    return await withRenderDeadline(
      (deadline) => renderWithContext(deadline),
      PLAYWRIGHT_RENDER_DEADLINE_MS,
      () => context?.close()
    );
  } finally {
    await context?.close().catch(() => {});
    sharedChromium.release();
  }

  async function renderWithContext(deadline) {
    const created = await browser.newContext({
      ...CONTEXT_LOCKDOWN_OPTIONS,
      userAgent: browserUserAgent()
    });
    if (deadline.expired) {
      await created.close().catch(() => {});
      throw new Error("Render timed out");
    }
    context = created;
    const routing = await routeContextThroughNode(context, {
      fetchUpstream: fetchForRender,
      maxInFlight: PLAYWRIGHT_UPSTREAM_CONCURRENCY
    });
    const page = await context.newPage();

    // Node already followed any redirect chain; a second goto() puts the page
    // on the final URL and is answered from the kept response.
    let target = sourceUrl;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      routing.expectGoto();
      let gotoError = null;
      try {
        await page.goto(target, { waitUntil: "domcontentloaded", timeout: REQUEST_TIMEOUT_MS });
      } catch (err) {
        gotoError = err;
      }
      if (routing.navigationError instanceof RequestPolicyError) {
        throw routing.navigationError;
      }
      if (routing.redirectTo && attempt === 0) {
        target = routing.redirectTo;
        continue;
      }
      if (gotoError) {
        // Node's error ("Request timed out") says more than ERR_BLOCKED_BY_CLIENT.
        throw routing.navigationError || gotoError;
      }
      break;
    }
    // Scroll a few screens and back: lazy loaders only fill in images that have
    // come near the viewport.
    for (let i = 0; i < PLAYWRIGHT_SCROLL_STEPS; i += 1) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await page.waitForTimeout(PLAYWRIGHT_SCROLL_WAIT_MS);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    // Collect only once the lazy images have loaded: an unloaded image has no natural
    // size and fails the size filter, which made the count vary with network timing.
    await page.waitForLoadState("networkidle", { timeout: PLAYWRIGHT_SETTLE_MS }).catch(() => {});

    const { title, items } = await page.evaluate(collectRenderedImages, renderCollectArgs(limit));
    return finishRenderedExtraction(sourceUrl, limit, title, items);
  }
}

// Plugged in by a host that renders pages itself (the desktop app's Electron
// window) instead of Playwright: (sourceUrl, { limit, fetchUpstream }) resolves
// to the raw { title, items } of collectRenderedImages(). It must route every
// request through fetchUpstream, as routeContextThroughNode() does.
let externalPageRenderer = null;
export {
  isAllowedImageUrl,
  isAllowedLink,
  isDuplicateImageReference,
  parseDimension,
  passesDimensionHeuristic
} from "./html-images.js";

export function setPageRenderer(renderer) {
  externalPageRenderer = renderer;
}

export function renderCollectArgs(limit) {
  return {
    cap: limit,
    maxDepth: CARD_LINK_MAX_DEPTH,
    maxLinksPerImage: MAX_LINKS_PER_IMAGE,
    maxUrl: RENDER_MAX_URL_CHARS,
    maxText: RENDER_MAX_TEXT_CHARS,
    standInSource: PLACEHOLDER_IMAGE_NAME.source
  };
}

function finishRenderedExtraction(sourceUrl, limit, title, items) {
  const sanitized = (Array.isArray(items) ? items : [])
    .filter((item) => isAllowedImageUrl(item.imageUrl))
    .filter((item) => !item.linkUrl || isAllowedLink(item.linkUrl))
    .filter((item) => passesDimensionHeuristic(item.imageUrl, item.linkUrl, item.width, item.height))
    .slice(0, limit)
    .map((item) => ({ ...item, alt: imageLabel(item.alt) }));
  return {
    title: title || sourceUrl,
    items: sanitized,
    method: "playwright_fallback"
  };
}

// Runs IN THE PAGE (serialised by page.evaluate or the desktop renderer), so it
// may use nothing from this module. Every string goes through window.__sbClip.
export function collectRenderedImages({ cap, maxDepth, maxLinksPerImage, maxUrl, maxText, standInSource }) {
  // Every string goes through the init script's clip (playwright-render.js),
  // and `out` grows by index, not push: the page may have patched both.
  const clip = window.__sbClip;
  if (typeof clip !== "function") {
    return { title: "", items: [] };
  }
  // A page could patch RegExp; the worst it gets is its own stand-in chosen,
  // which passesDimensionHeuristic() then drops.
  const standIn = new RegExp(standInSource, "i");
  const url = (value) => (clip(value, maxUrl + 1).length > maxUrl ? "" : clip(value, maxUrl));
  // cardLinkFor(), in the page.
  const cardLink = (img) => {
    let el = img.parentElement;
    for (let depth = 0; depth < maxDepth && el; depth += 1) {
      const links = new Set();
      for (const a of el.querySelectorAll("a[href]")) {
        if (!clip(a.getAttribute("href"), 1).startsWith("#")) {
          links.add(url(a.href));
        }
      }
      if (links.size === 1) {
        return [...links][0];
      }
      if (links.size > 1) {
        return null;
      }
      el = el.parentElement;
    }
    return null;
  };
  const out = [];
  const seen = new Set();
  const linkCounts = new Map();
  for (const img of document.querySelectorAll("img")) {
    if (out.length >= cap * 3) {
      break;
    }

    // As pickImageSource(): a lazy page's stand-in loses to the real image.
    const sources = [img.currentSrc, img.src, img.getAttribute("src"), img.getAttribute("data-src")].map(url).filter(Boolean);
    const imageUrl = sources.find((value) => !standIn.test(value.split(/[?#]/)[0].split("/").pop())) || sources[0];
    if (!imageUrl) {
      continue;
    }

    const anchor = img.closest("a");
    const linkUrl = url(anchor?.href) || url(cardLink(img));
    // Unary + rather than Number(), which the page can replace.
    const width = +(img.naturalWidth || img.getAttribute("width")) || null;
    const height = +(img.naturalHeight || img.getAttribute("height")) || null;
    const linked = Boolean(linkUrl) && linkUrl !== imageUrl;
    const key = linked ? `${imageUrl}::${linkUrl}` : imageUrl;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (linked) {
      const links = (linkCounts.get(imageUrl) || 0) + 1;
      if (links > maxLinksPerImage) {
        continue;
      }
      linkCounts.set(imageUrl, links);
    }

    const alt = clip(img.getAttribute("alt"), maxText) || clip(anchor?.getAttribute("title"), maxText)
      || clip(anchor?.getAttribute("aria-label"), maxText);
    out[out.length] = { imageUrl, linkUrl: linkUrl || null, width, height, alt };
  }
  return {
    title: clip(document.title, maxText) || url(document.location.href),
    items: out
  };
}

