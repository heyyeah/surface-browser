// Editable favourites: the shared validation and list edits, the server's file
// storage, and the /api/favourites routes and their gate.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer } from "./contract_helpers.mjs";
import { BookmarkKind, DEFAULT_BOOKMARKS, pickStartBookmarks } from "../shared/bookmark-presets.js";
import {
  FAVOURITES_MAX,
  FAVOURITE_TITLE_MAX,
  FAVOURITE_VALUE_MAX,
  addFavourite,
  moveFavourite,
  normalizeFavourite,
  removeFavourite,
  validateFavourites
} from "../shared/favourites.js";
import { loadFavourites, resetFavourites, saveFavourites } from "../server/favourites.js";

const web = (value, extra = {}) => ({ kind: BookmarkKind.WEB_PAGE, value, ...extra });

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surface-browser-favourites-")), "favourites.json");
}

test("the built-ins pass validation unchanged", () => {
  assert.deepEqual(validateFavourites(DEFAULT_BOOKMARKS), DEFAULT_BOOKMARKS.map((entry) => ({ ...entry })));
});

test("normalizeFavourite: kinds, values, titles, start", () => {
  assert.deepEqual(normalizeFavourite({ kind: 1, value: "  wild river ", title: " River ", start: true }),
    { kind: 1, value: "wild river", title: "River", start: true });
  // Blank title and a non-true start are dropped, not stored as noise.
  assert.deepEqual(normalizeFavourite({ kind: 2, value: "otters", title: "  ", start: "yes" }), { kind: 2, value: "otters" });
  assert.throws(() => normalizeFavourite({ kind: 7, value: "x" }), /kind/);
  assert.throws(() => normalizeFavourite({ kind: 1, value: "   " }), /value/);
  assert.throws(() => normalizeFavourite({ kind: 1, value: 42 }), /value/);
  assert.throws(() => normalizeFavourite({ kind: 1, value: "x".repeat(FAVOURITE_VALUE_MAX + 1) }), /at most/);
  assert.throws(() => normalizeFavourite({ kind: 1, value: "x", title: "t".repeat(FAVOURITE_TITLE_MAX + 1) }), /at most/);
  assert.throws(() => normalizeFavourite(null), /object/);
  assert.throws(() => normalizeFavourite([]), /object/);
});

test("web favourites must be http(s); a bare host gets https://", () => {
  assert.equal(normalizeFavourite(web("example.com/gallery")).value, "https://example.com/gallery");
  assert.equal(normalizeFavourite(web("http://example.com")).value, "http://example.com");
  for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "ftp://example.com", "not a url", "IMG_0376.jpg"]) {
    assert.throws(() => normalizeFavourite(web(bad)), /http\(s\)/, bad);
  }
  // Only web values are URL-checked: a GenAI prompt may look like a file name.
  assert.equal(normalizeFavourite({ kind: BookmarkKind.GENAI_PROMPT, value: "IMG_0376.jpg" }).value, "IMG_0376.jpg");
});

test("validateFavourites caps the list and rejects non-lists", () => {
  assert.throws(() => validateFavourites({}), /list/);
  assert.deepEqual(validateFavourites([]), []);
  const full = Array.from({ length: FAVOURITES_MAX }, (_, i) => ({ kind: 1, value: `q${i}` }));
  assert.equal(validateFavourites(full).length, FAVOURITES_MAX);
  assert.throws(() => validateFavourites([...full, { kind: 1, value: "one more" }]), /At most/);
});

test("list edits: add defaults to start, move swaps within bounds, remove drops one", () => {
  const list = [web("https://a.example"), web("https://b.example"), web("https://c.example")];
  const added = addFavourite(list, { kind: BookmarkKind.IMAGE_SEARCH, value: "ocean" });
  assert.equal(added.length, 4);
  assert.deepEqual(added[3], { kind: 1, value: "ocean", start: true });
  assert.equal(list.length, 3, "edits never mutate the input");
  assert.throws(() => addFavourite(list, { kind: 0, value: "" }));

  assert.deepEqual(moveFavourite(list, 0, 1).map((e) => e.value), ["https://b.example", "https://a.example", "https://c.example"]);
  assert.deepEqual(moveFavourite(list, 2, -1).map((e) => e.value), ["https://a.example", "https://c.example", "https://b.example"]);
  assert.equal(moveFavourite(list, 0, -1), list);
  assert.equal(moveFavourite(list, 2, 1), list);
  assert.deepEqual(removeFavourite(list, 1).map((e) => e.value), ["https://a.example", "https://c.example"]);
});

test("the start screen picks from the edited list, one per kind", () => {
  const list = [
    web("https://a.example", { start: true }),
    web("https://b.example"),
    { kind: 1, value: "river", start: true },
    { kind: 2, value: "otters" }
  ];
  assert.deepEqual(pickStartBookmarks(list, () => 0).map((e) => e.value), ["https://a.example", "river"]);
  assert.deepEqual(pickStartBookmarks([], () => 0), []);
});

test("storage: built-ins until saved, round trip, reset deletes the file", () => {
  const file = tempFile();
  assert.deepEqual(loadFavourites(file), { favourites: DEFAULT_BOOKMARKS, custom: false });

  const saved = saveFavourites([{ kind: 1, value: "ocean", start: true }, web("example.com")], file);
  assert.equal(saved.custom, true);
  assert.deepEqual(loadFavourites(file), {
    favourites: [{ kind: 1, value: "ocean", start: true }, { kind: 0, value: "https://example.com" }],
    custom: true
  });

  assert.throws(() => saveFavourites([web("javascript:alert(1)")], file));
  assert.equal(loadFavourites(file).favourites.length, 2, "a rejected save leaves the file alone");

  assert.deepEqual(resetFavourites(file), { favourites: DEFAULT_BOOKMARKS, custom: false });
  assert.equal(fs.existsSync(file), false);
  resetFavourites(file);
});

test("storage: a corrupt or invalid file falls back to the built-ins", () => {
  const file = tempFile();
  fs.writeFileSync(file, "{ not json");
  assert.equal(loadFavourites(file).custom, false);
  fs.writeFileSync(file, JSON.stringify([{ kind: 9, value: "x" }]));
  assert.deepEqual(loadFavourites(file), { favourites: DEFAULT_BOOKMARKS, custom: false });
});

test("/api/favourites: read, save, reject, reset", async () => {
  const server = await startServer();
  const put = (favourites, headers = {}) => fetch(`${server.base}/api/favourites`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ favourites })
  });
  try {
    let json = await (await fetch(`${server.base}/api/favourites`)).json();
    assert.equal(json.custom, false);
    assert.equal(json.favourites.length, DEFAULT_BOOKMARKS.length);

    let res = await put([{ kind: 2, value: "otters", start: true }]);
    assert.equal(res.status, 200);
    json = await (await fetch(`${server.base}/api/favourites`)).json();
    assert.deepEqual(json, { ok: true, favourites: [{ kind: 2, value: "otters", start: true }], custom: true });

    res = await put([web("file:///etc/passwd")]);
    assert.equal(res.status, 400);
    res = await put("not a list");
    assert.equal(res.status, 400);

    // A client the Vite proxy names as remote is not local: no write.
    res = await put([], { "x-surface-dev-client": "203.0.113.9" });
    assert.equal(res.status, 403);

    res = await fetch(`${server.base}/api/favourites`, { method: "DELETE" });
    assert.equal(res.status, 200);
    json = await (await fetch(`${server.base}/api/favourites`)).json();
    assert.equal(json.custom, false);
  } finally {
    await server.stop();
  }
});

test("/api/favourites is absent where settings are hidden", async () => {
  const server = await startServer({ HIDE_SETTINGS: "1" });
  try {
    assert.equal((await fetch(`${server.base}/api/favourites`)).status, 404);
    const res = await fetch(`${server.base}/api/favourites`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ favourites: [] })
    });
    assert.equal(res.status, 404);
    assert.equal((await fetch(`${server.base}/api/favourites`, { method: "DELETE" })).status, 404);
  } finally {
    await server.stop();
  }
});
