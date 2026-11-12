// The favourites list (built-in presets until edited) and the flat Bookmarks menu.

import { loadAndExtractUrl, loadGenAiPrompt, loadImageSearch } from "./api.js";
import { bookmarksBtn, bookmarksMenu, urlInput } from "./dom.js";
import { setAddressFeedback, focusSceneCanvas, setStatus } from "./ui.js";
import { BookmarkKind, DEFAULT_BOOKMARKS, bookmarkTitle, pickStartBookmarks } from "../shared/bookmark-presets.js";
import { addFavourite } from "../shared/favourites.js";
import { t } from "./i18n.js";
import { isSubmissionsEnabled } from "./submissions.js";
import { openSubmitDialog } from "./submit-dialog.js";
import { openFavouritesDialog } from "./favourites-dialog.js";
import { settingsRequestHeaders } from "./settings.js";

let genAiBookmarksEnabled = false;
// Picked once per favourites list, and shared, so the flat start screen and the
// VR panel show the same three.
let startBookmarks = null;
// The effective list and whether the flat menu offers editing. Written only by
// setFavourites(). Editing follows /api/settings: off where settings are hidden
// (the public site), and there the list stays the built-ins.
let favourites = DEFAULT_BOOKMARKS;
let favouritesEditing = false;
// A save or a later load supersedes a load still in flight.
let favouritesGeneration = 0;
// () => { kind, value }: what "Add to favorites" would add. Set by main.js,
// which owns the omnibar mode.
let currentEntry = null;

function setFavourites(list, { editing = favouritesEditing } = {}) {
  favourites = list;
  favouritesEditing = editing;
  startBookmarks = null;
  renderBookmarksMenu();
  window.dispatchEvent(new CustomEvent("surface-browser:favourites-changed"));
}

function currentFavourites() {
  return favourites;
}

async function loadFavourites({ enabled }) {
  const generation = ++favouritesGeneration;
  if (!enabled) {
    setFavourites(DEFAULT_BOOKMARKS, { editing: false });
    return;
  }
  let list = null;
  try {
    const response = await fetch("/api/favourites");
    const payload = await response.json().catch(() => ({}));
    list = response.ok && Array.isArray(payload.favourites) ? payload.favourites : null;
  } catch {
    list = null;
  }
  if (generation !== favouritesGeneration) {
    return;
  }
  setFavourites(list || DEFAULT_BOOKMARKS, { editing: Boolean(list) });
}

// PUT the list, or DELETE it (back to the built-ins). Resolves { ok, error }.
async function writeFavourites(list, { reset = false } = {}) {
  let response;
  let payload;
  try {
    response = await fetch("/api/favourites", {
      method: reset ? "DELETE" : "PUT",
      headers: settingsRequestHeaders(),
      ...(reset ? {} : { body: JSON.stringify({ favourites: list }) })
    });
    payload = await response.json().catch(() => ({}));
  } catch (err) {
    return { ok: false, error: t("favorites.error", { message: err instanceof Error ? err.message : String(err) }) };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, error: t("favorites.readOnly") };
  }
  if (!response.ok || !Array.isArray(payload.favourites)) {
    return { ok: false, error: t("favorites.error", { message: payload.error || `HTTP ${response.status}` }) };
  }
  favouritesGeneration += 1;
  setFavourites(payload.favourites);
  return { ok: true };
}

async function addCurrentToFavourites() {
  const entry = currentEntry?.();
  if (!entry?.value) {
    return;
  }
  setBookmarksMenuOpen(false);
  let next;
  try {
    next = addFavourite(favourites, entry);
  } catch (err) {
    setStatus(t("favorites.error", { message: err.message }), "warning");
    return;
  }
  const result = await writeFavourites(next);
  setStatus(result.ok ? t("favorites.added") : result.error, result.ok ? true : "warning");
}

function startFavoriteBookmarks() {
  startBookmarks ??= pickStartBookmarks(favourites);
  return startBookmarks;
}

function bookmarkModeLabel(kind) {
  if (kind === BookmarkKind.IMAGE_SEARCH) {
    return t("vr.chip.search");
  }
  if (kind === BookmarkKind.GENAI_PROMPT) {
    return t("vr.mode.genai");
  }
  return t("vr.mode.web");
}

function setBookmarksMenuOpen(open) {
  if (!bookmarksBtn || !bookmarksMenu) {
    return;
  }
  bookmarksMenu.hidden = !open;
  bookmarksBtn.setAttribute("aria-expanded", open ? "true" : "false");
}

function toggleBookmarksMenu() {
  const opening = Boolean(bookmarksMenu?.hidden);
  if (opening) {
    // "Add to favorites" reads the address bar as it is now.
    renderBookmarksMenu();
  }
  setBookmarksMenuOpen(opening);
}

async function activateBookmark(bookmark) {
  setBookmarksMenuOpen(false);
  urlInput.value = bookmark.value;
  setAddressFeedback(null);
  window.dispatchEvent(new CustomEvent("surface-browser:bookmark-activated", {
    detail: { kind: bookmark.kind }
  }));

  if (bookmark.kind === BookmarkKind.IMAGE_SEARCH) {
    await loadImageSearch({ query: bookmark.value });
    focusSceneCanvas();
    return;
  }

  if (bookmark.kind === BookmarkKind.GENAI_PROMPT) {
    await loadGenAiPrompt({ query: bookmark.value });
    focusSceneCanvas();
    return;
  }

  await loadAndExtractUrl({ query: bookmark.value });
  focusSceneCanvas();
}

function menuRow(modeText, modeClass, titleText, ariaLabel, tooltip, onClick) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "bookmark-menu-item";
  item.role = "menuitem";
  item.ariaLabel = ariaLabel;
  item.title = tooltip;

  const mode = document.createElement("span");
  mode.className = `bookmark-mode ${modeClass}`;
  mode.textContent = modeText;
  item.appendChild(mode);

  const title = document.createElement("span");
  title.className = "bookmark-title";
  title.textContent = titleText;
  item.appendChild(title);

  item.addEventListener("click", onClick);
  return item;
}

function actionRow(chipKey, labelKey, onClick) {
  const chip = t(chipKey);
  const label = t(labelKey);
  return menuRow(chip, "", label, `${chip} ${label}`, label, onClick);
}

function renderBookmarksMenu() {
  if (!bookmarksMenu) {
    return;
  }
  bookmarksMenu.textContent = "";
  for (const bookmark of favourites) {
    if (bookmark.kind === BookmarkKind.GENAI_PROMPT && !genAiBookmarksEnabled) {
      continue;
    }
    bookmarksMenu.appendChild(menuRow(
      bookmarkModeLabel(bookmark.kind),
      `bookmark-mode-${bookmark.kind}`,
      bookmarkTitle(bookmark),
      `${bookmarkModeLabel(bookmark.kind)} ${bookmark.value}`,
      bookmark.value,
      () => { void activateBookmark(bookmark); }
    ));
  }
  if (isSubmissionsEnabled()) {
    bookmarksMenu.appendChild(actionRow("submit.menuChip", "submit.menuRow", () => {
      setBookmarksMenuOpen(false);
      openSubmitDialog({ menuKind: BookmarkKind.WEB_PAGE, genAiEnabled: genAiBookmarksEnabled });
    }));
  }
  if (favouritesEditing) {
    const add = actionRow("favorites.menuChip.add", "favorites.menuRow.add", () => { void addCurrentToFavourites(); });
    add.disabled = !currentEntry?.()?.value;
    bookmarksMenu.appendChild(add);
    bookmarksMenu.appendChild(actionRow("favorites.menuChip.edit", "favorites.menuRow.edit", () => {
      setBookmarksMenuOpen(false);
      openFavouritesDialog({ favourites, defaults: DEFAULT_BOOKMARKS, save: writeFavourites });
    }));
  }
}

function setGenAiBookmarksEnabled(enabled) {
  genAiBookmarksEnabled = Boolean(enabled);
  renderBookmarksMenu();
}

function isGenAiBookmarksEnabled() {
  return genAiBookmarksEnabled;
}

function setupBookmarks({ getCurrentEntry = null } = {}) {
  currentEntry = getCurrentEntry;
  if (!bookmarksBtn || !bookmarksMenu) {
    return;
  }

  renderBookmarksMenu();
  bookmarksBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleBookmarksMenu();
  });

  bookmarksMenu.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  window.addEventListener("click", () => {
    setBookmarksMenuOpen(false);
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !bookmarksMenu.hidden) {
      setBookmarksMenuOpen(false);
      bookmarksBtn.focus();
    }
  });
}

export {
  BookmarkKind,
  DEFAULT_BOOKMARKS,
  activateBookmark,
  bookmarkModeLabel,
  bookmarkTitle,
  currentFavourites,
  isGenAiBookmarksEnabled,
  loadFavourites,
  setBookmarksMenuOpen,
  setGenAiBookmarksEnabled,
  setupBookmarks,
  startFavoriteBookmarks
};
