// The VR menu's bookmark grid: two lines always fit, the rest scrolls.

import test from "node:test";
import assert from "node:assert/strict";

import { BOOKMARK_CELL_MIN_H, bookmarkGridLayout, bookmarkUrlLine } from "../src/vrpanel-grid.js";

const PANEL = { height: 400, gap: 18 };

test("16 web bookmarks keep two-line cells and scroll", () => {
  const layout = bookmarkGridLayout({ count: 16, ...PANEL });
  assert.ok(layout.cellH >= BOOKMARK_CELL_MIN_H);
  assert.equal(layout.cols, 2);
  assert.equal(layout.visibleRows, 4);
  assert.equal(layout.maxScrollRow, 4);
  assert.deepEqual([layout.firstIndex, layout.endIndex], [0, 8]);
});

test("scrolling shows later rows and stops at the end", () => {
  const scrolled = bookmarkGridLayout({ count: 16, ...PANEL, scrollRow: 2 });
  assert.deepEqual([scrolled.firstIndex, scrolled.endIndex], [4, 12]);
  const past = bookmarkGridLayout({ count: 15, ...PANEL, scrollRow: 99 });
  assert.equal(past.firstRow, past.maxScrollRow);
  assert.equal(past.endIndex, 15);
});

test("a short list does not scroll or grow into huge cells", () => {
  const layout = bookmarkGridLayout({ count: 5, ...PANEL });
  assert.equal(layout.maxScrollRow, 0);
  assert.deepEqual([layout.firstIndex, layout.endIndex], [0, 5]);
  assert.ok(layout.cellH <= 112);
});

test("a shorter panel (status bar showing) still has room for one row", () => {
  const layout = bookmarkGridLayout({ count: 16, height: 60, gap: 18 });
  assert.equal(layout.visibleRows, 1);
  assert.equal(bookmarkGridLayout({ count: 0, ...PANEL }).endIndex, 0);
});

test("the url line drops the scheme and www, and never repeats the title", () => {
  assert.equal(bookmarkUrlLine("https://www.boxc.net/browserfood.html", "Browser Food"), "boxc.net/browserfood.html");
  assert.equal(bookmarkUrlLine("https://edition.cnn.com", "edition.cnn.com"), null);
  assert.equal(bookmarkUrlLine("https://www.theverge.com/", "www.theverge.com"), null);
});
