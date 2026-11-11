import assert from "node:assert/strict";
import test from "node:test";
import { HtmlParseError, parseHtmlForImagesOffThread } from "../server/html-parse-pool.js";

test("a page is parsed off the main thread", async () => {
  const html = '<title>T</title><a href="/a"><img src="/i.jpg" width="300" height="200"></a>';
  const parsed = await parseHtmlForImagesOffThread(html, "https://example.com/", 10);
  assert.equal(parsed.title, "T");
  assert.equal(parsed.items[0].imageUrl, "https://example.com/i.jpg");
  assert.equal(parsed.items[0].linkUrl, "https://example.com/a");
});

test("deeply nested HTML is cut off at the deadline without blocking the event loop", async () => {
  const html = "<div>".repeat(200_000);
  let worstGapMs = 0;
  let last = performance.now();
  const ticker = setInterval(() => {
    const now = performance.now();
    worstGapMs = Math.max(worstGapMs, now - last);
    last = now;
  }, 10);
  try {
    await assert.rejects(parseHtmlForImagesOffThread(html, "https://example.com/", 10), HtmlParseError);
  } finally {
    clearInterval(ticker);
  }
  assert.ok(worstGapMs < 250, `event loop blocked for ${Math.round(worstGapMs)} ms`);
  // The pool replaced the killed worker.
  const parsed = await parseHtmlForImagesOffThread("<title>after</title>", "https://example.com/", 10);
  assert.equal(parsed.title, "after");
});
