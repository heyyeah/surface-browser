// Editable favourites: validation and list edits, shared by the server (which
// stores the list) and the flat editor. Pure data, no DOM, no fs.

import { BookmarkKind } from "./bookmark-presets.js";
import { hasNavigableUrlShape } from "./url-shape.js";

export const FAVOURITES_MAX = 100;
export const FAVOURITE_VALUE_MAX = 2048;
export const FAVOURITE_TITLE_MAX = 120;

const KINDS = new Set(Object.values(BookmarkKind));

// A bare host typed in URL mode ("example.com") is stored as https://, the
// same coercion the omnibar applies when it loads one.
function normalizeWebValue(value) {
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) || !hasNavigableUrlShape(value)
    ? value
    : `https://${value}`;
  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    parsed = null;
  }
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    throw new Error("A web favourite must be an http(s) address");
  }
  return withScheme;
}

// One entry in, a clean copy out, or a thrown Error naming the problem.
export function normalizeFavourite(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Each favourite must be an object");
  }
  const kind = Number(raw.kind);
  if (!KINDS.has(kind)) {
    throw new Error("Unknown favourite kind");
  }
  let value = typeof raw.value === "string" ? raw.value.trim() : "";
  if (!value) {
    throw new Error("A favourite needs a value");
  }
  if (value.length > FAVOURITE_VALUE_MAX) {
    throw new Error(`A favourite's value must be at most ${FAVOURITE_VALUE_MAX} characters`);
  }
  if (kind === BookmarkKind.WEB_PAGE) {
    value = normalizeWebValue(value);
  }
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (title.length > FAVOURITE_TITLE_MAX) {
    throw new Error(`A favourite's title must be at most ${FAVOURITE_TITLE_MAX} characters`);
  }
  return {
    kind,
    value,
    ...(title ? { title } : {}),
    ...(raw.start === true ? { start: true } : {})
  };
}

export function validateFavourites(raw) {
  if (!Array.isArray(raw)) {
    throw new Error("Favourites must be a list");
  }
  if (raw.length > FAVOURITES_MAX) {
    throw new Error(`At most ${FAVOURITES_MAX} favourites`);
  }
  return raw.map(normalizeFavourite);
}

// New favourites join the start-screen rotation unless told otherwise.
export function addFavourite(list, { kind, value, title = "", start = true }) {
  return [...list, normalizeFavourite({ kind, value, title, start })];
}

export function moveFavourite(list, index, delta) {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) {
    return list;
  }
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function removeFavourite(list, index) {
  return list.filter((_, i) => i !== index);
}
