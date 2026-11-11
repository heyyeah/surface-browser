// Finds a page's images in its HTML. Pure and synchronous, so it can run in the
// parse worker (html-parse-worker.js): parse5 and cheerio are quadratic on deeply
// nested tags, and a hostile page would otherwise freeze the event loop.
import { load as loadHtml } from "cheerio";
import { TINY_DECLARED_EDGE_PX, declaredImageEdge, isPlaceholderImageUrl, isStandInImageSource } from "./image-url-filters.js";

const EXCLUDED_CONTENT_EXTENSIONS = new Set([
  ".asf", ".avi", ".flv", ".m4v", ".mkv", ".mov", ".mp4", ".mpg", ".mpeg", ".swf", ".webm", ".wmv",
  ".atom", ".feed", ".rss", ".xml",
  ".csv", ".doc", ".docx", ".epub", ".odt", ".pdf", ".ppt", ".pptx", ".rtf", ".txt", ".xls", ".xlsx",
  ".7z", ".gz", ".rar", ".tar", ".zip",
  ".css", ".js", ".json", ".sql", ".yaml", ".yml",
  ".dll", ".exe", ".ico", ".iso", ".msi"
]);

export function parseHtmlForImages(html, sourceUrl, limit) {
  const $ = loadHtml(html);
  const title = $("title").first().text().trim() || sourceUrl;
  const items = [];
  const seenImages = new Map();

  $("img").each((_, img) => {
    if (items.length >= limit * 3) {
      return false;
    }

    const srcCandidate = pickImageSource($, img);
    if (!srcCandidate) {
      return;
    }

    const imageUrl = resolveUrl(srcCandidate, sourceUrl);
    if (!imageUrl || !isAllowedImageUrl(imageUrl)) {
      return;
    }

    const linkHref = $(img).closest("a").attr("href");
    const resolvedLink = linkHref
      ? resolveUrl(linkHref, sourceUrl)
      : cardLinkFor($, img, sourceUrl);
    const linkUrl = resolvedLink && isAllowedLink(resolvedLink) ? resolvedLink : null;
    const width = parseDimension($(img).attr("width"));
    const height = parseDimension($(img).attr("height"));

    if (isDuplicateImageReference(imageUrl, linkUrl, seenImages)) {
      return;
    }

    if (!passesDimensionHeuristic(imageUrl, linkUrl, width, height)) {
      return;
    }

    const anchor = $(img).closest("a");
    items.push({
      imageUrl,
      linkUrl,
      width,
      height,
      alt: imageLabel($(img).attr("alt") || anchor.attr("title") || anchor.attr("aria-label"))
    });
  });

  return { title, items: items.slice(0, limit) };
}

// The card link: many sites put the image beside the story link and stretch
// that link over the whole card with CSS, so the image has no <a> ancestor even
// though clicking it follows the story. Walk up a few levels to the nearest
// container holding exactly one distinct link and use it; a container with
// several different links is a list of stories, not a card, so the walk stops
// there. Mirrored in extractViaPlaywright().
export const CARD_LINK_MAX_DEPTH = 4;
// What a render may hand back per string. Longer URLs are dropped, not cut: a
// cut URL would fetch something else.
export const RENDER_MAX_URL_CHARS = 4096;
export const RENDER_MAX_TEXT_CHARS = 1000;

// A page's alt text is its author's to make huge; this is a caption.
export function imageLabel(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 160);
}

function cardLinkFor($, img, sourceUrl) {
  let el = $(img).parent();
  for (let depth = 0; depth < CARD_LINK_MAX_DEPTH && el.length; depth += 1) {
    const links = new Set();
    el.find("a[href]").each((_, a) => {
      const href = $(a).attr("href");
      if (href && !href.startsWith("#")) {
        const resolved = resolveUrl(href, sourceUrl);
        if (resolved) {
          links.add(resolved);
        }
      }
    });
    if (links.size === 1) {
      return links.values().next().value;
    }
    if (links.size > 1) {
      return null;
    }
    el = el.parent();
  }
  return null;
}

// Lazy-loading pages put a stand-in (a grey PNG, a 1px GIF, a data: URI) in
// `src` and the real image in data-src or srcset, so a stand-in loses to them.
function pickImageSource($, img) {
  const srcSet = $(img).attr("srcset");
  const candidates = [$(img).attr("src"), $(img).attr("data-src"), srcSet?.split(",")[0]?.trim().split(" ")[0]]
    .map((value) => value?.trim())
    .filter(Boolean);
  return candidates.find((value) => !isStandInImageSource(value)) || candidates[0] || null;
}

export function parseDimension(value) {
  if (!value) {
    return null;
  }
  const parsed = Number(String(value).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.round(parsed);
}

function resolveUrl(candidate, baseUrl) {
  if (!candidate) {
    return null;
  }
  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return null;
  }
}

export function isAllowedImageUrl(imageUrl) {
  try {
    const parsed = new URL(imageUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    const ext = fileExtension(parsed.pathname);
    if (ext && EXCLUDED_CONTENT_EXTENSIONS.has(ext)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function isAllowedLink(linkUrl) {
  try {
    const parsed = new URL(linkUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    const ext = fileExtension(parsed.pathname);
    return !(ext && EXCLUDED_CONTENT_EXTENSIONS.has(ext));
  } catch {
    return false;
  }
}

function fileExtension(pathname) {
  const idx = pathname.lastIndexOf(".");
  if (idx < 0) {
    return null;
  }
  return pathname.slice(idx).toLowerCase();
}

export function passesDimensionHeuristic(imageUrl, linkUrl, width, height) {
  const linked = Boolean(linkUrl) && linkUrl !== imageUrl;
  if (isLikelyFaviconUrl(imageUrl) || isPlaceholderImageUrl(imageUrl)) {
    return false;
  }
  const declared = declaredImageEdge(imageUrl);
  if (declared !== null && declared <= TINY_DECLARED_EDGE_PX) {
    return false;
  }
  if (width === null || height === null) {
    // An unlinked SVG with no size is almost always a CSS-sized library icon. A
    // linked one may be navigation; the proxy refuses it if its own size is
    // icon-small (SVG_MIN_EDGE_PX in images.js).
    return linked || !isSvgUrl(imageUrl);
  }
  const minDim = linked ? 24 : 128;
  return width > minDim && height > minDim;
}

function isSvgUrl(imageUrl) {
  try {
    return /\.svgz?$/i.test(new URL(imageUrl).pathname) || /^data:image\/svg/i.test(imageUrl);
  } catch {
    return false;
  }
}

function isLikelyFaviconUrl(imageUrl) {
  try {
    const parsed = new URL(imageUrl);
    return /(^|\/)favicon(?:[-_.][^/]*)?\.(?:ico|png|gif|jpe?g|webp)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

// As the Java original: an image repeated under different links (a nav icon,
// a "more" arrow) is kept for its first MAX_LINKS_PER_IMAGE links only.
export const MAX_LINKS_PER_IMAGE = 2;

export function isDuplicateImageReference(imageUrl, linkUrl, seenImages) {
  const linked = Boolean(linkUrl) && linkUrl !== imageUrl;
  let seen = seenImages.get(imageUrl);
  if (!seen) {
    seen = { unlinked: false, links: new Set() };
    seenImages.set(imageUrl, seen);
  }
  if (!linked) {
    if (seen.unlinked) {
      return true;
    }
    seen.unlinked = true;
    return false;
  }
  if (seen.links.has(linkUrl) || seen.links.size >= MAX_LINKS_PER_IMAGE) {
    return true;
  }
  seen.links.add(linkUrl);
  return false;
}
