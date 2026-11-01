// Built-in bookmark presets for the browser/VR MVP.

import { loadAndExtractUrl, loadGenAiPrompt, loadImageSearch } from "./api.js";
import { bookmarksBtn, bookmarksMenu, urlInput } from "./dom.js";
import { setAddressFeedback, focusSceneCanvas } from "./ui.js";
import { BookmarkKind, DEFAULT_BOOKMARKS, bookmarkTitle, pickStartBookmarks } from "../shared/bookmark-presets.js";
import { t } from "./i18n.js";
import { isSubmissionsEnabled } from "./submissions.js";
import { openSubmitDialog } from "./submit-dialog.js";

let genAiBookmarksEnabled = false;
// Picked once per page load, and shared, so the flat start screen and the VR
// panel show the same three.
let startBookmarks = null;

function startFavoriteBookmarks() {
  startBookmarks ??= pickStartBookmarks();
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
  setBookmarksMenuOpen(Boolean(bookmarksMenu?.hidden));
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

function renderBookmarksMenu(bookmarks = DEFAULT_BOOKMARKS) {
  if (!bookmarksMenu) {
    return;
  }
  bookmarksMenu.textContent = "";
  for (const bookmark of bookmarks) {
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
    const chip = t("submit.menuChip");
    const label = t("submit.menuRow");
    bookmarksMenu.appendChild(menuRow(chip, "", label, `${chip} ${label}`, label, () => {
      setBookmarksMenuOpen(false);
      openSubmitDialog({ menuKind: BookmarkKind.WEB_PAGE, genAiEnabled: genAiBookmarksEnabled });
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

function setupBookmarks() {
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
  isGenAiBookmarksEnabled,
  setBookmarksMenuOpen,
  setGenAiBookmarksEnabled,
  setupBookmarks,
  startFavoriteBookmarks
};
