// The flat favourites editor, on the .settings-overlay / .settings-dialog modal.
// Edits a draft; nothing reaches the server until Save. Reset swaps in the
// built-ins and, if saved untouched, deletes the stored list.

import { BookmarkKind } from "../shared/bookmark-presets.js";
import { moveFavourite, normalizeFavourite, removeFavourite } from "../shared/favourites.js";
import { t } from "./i18n.js";

const KIND_LABELS = [
  [BookmarkKind.WEB_PAGE, "vr.mode.web"],
  [BookmarkKind.IMAGE_SEARCH, "vr.mode.image"],
  [BookmarkKind.GENAI_PROMPT, "vr.mode.genai"]
];

let overlay = null;
let lastFocused = null;

function closeFavouritesDialog() {
  overlay?.remove();
  overlay = null;
  lastFocused?.focus?.();
  lastFocused = null;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function iconButton(glyph, labelKey, onClick, disabled = false) {
  const button = el("button", "secondary favorites-icon-btn", glyph);
  button.type = "button";
  button.ariaLabel = t(labelKey);
  button.title = t(labelKey);
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

// save(list, { reset }) resolves { ok, error }; bookmarks.js owns the request.
function openFavouritesDialog({ favourites, defaults, save }) {
  closeFavouritesDialog();
  lastFocused = document.activeElement;
  let draft = favourites.map((entry) => ({ ...entry }));
  // True only while the draft is exactly the built-ins Reset put there.
  let resetPending = false;

  overlay = el("div", "settings-overlay");
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) {
      closeFavouritesDialog();
    }
  });
  const dialog = el("div", "settings-dialog favorites-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "favorites-title");
  overlay.appendChild(dialog);

  const header = el("div", "settings-header");
  const heading = el("h2", null, t("favorites.title"));
  heading.id = "favorites-title";
  header.appendChild(heading);
  const close = el("button", "settings-close secondary", "✕");
  close.type = "button";
  close.ariaLabel = t("submit.close");
  close.addEventListener("click", closeFavouritesDialog);
  header.appendChild(close);
  dialog.appendChild(header);

  const list = el("div", "favorites-list");
  dialog.appendChild(list);

  const status = el("div", "settings-status");

  function edited() {
    resetPending = false;
    status.textContent = "";
    status.className = "settings-status";
  }

  function renderRows() {
    list.textContent = "";
    if (!draft.length) {
      list.appendChild(el("p", "favorites-empty", t("favorites.empty")));
    }
    draft.forEach((entry, index) => {
      const row = el("div", "favorites-row");

      const kind = el("select");
      kind.ariaLabel = t("submit.type");
      for (const [value, labelKey] of KIND_LABELS) {
        const option = el("option", null, t(labelKey));
        option.value = String(value);
        kind.appendChild(option);
      }
      kind.value = String(entry.kind);
      kind.addEventListener("change", () => {
        entry.kind = Number(kind.value);
        edited();
      });

      const title = el("input");
      title.type = "text";
      title.placeholder = t("submit.name");
      title.ariaLabel = t("submit.name");
      title.value = entry.title || "";
      title.addEventListener("input", () => {
        entry.title = title.value;
        edited();
      });

      const value = el("input");
      value.type = "text";
      value.placeholder = t("submit.query");
      value.ariaLabel = t("submit.query");
      value.value = entry.value;
      value.addEventListener("input", () => {
        entry.value = value.value;
        edited();
      });

      const startLabel = el("label", "settings-checkbox favorites-start");
      const start = el("input");
      start.type = "checkbox";
      start.checked = entry.start === true;
      start.addEventListener("change", () => {
        entry.start = start.checked;
        edited();
      });
      startLabel.append(start, t("favorites.start"));

      const restructure = (next) => {
        draft = next;
        edited();
        renderRows();
      };
      const actions = el("div", "favorites-actions");
      actions.append(
        iconButton("↑", "favorites.up", () => restructure(moveFavourite(draft, index, -1)), index === 0),
        iconButton("↓", "favorites.down", () => restructure(moveFavourite(draft, index, 1)), index === draft.length - 1),
        iconButton("✕", "favorites.delete", () => restructure(removeFavourite(draft, index)))
      );

      row.append(kind, title, value, startLabel, actions);
      list.appendChild(row);
    });
  }

  const tools = el("div", "favorites-tools");
  const addBtn = el("button", "secondary", t("favorites.addRow"));
  addBtn.type = "button";
  addBtn.addEventListener("click", () => {
    // A blank row to fill in; validated on Save.
    draft = [...draft, { kind: BookmarkKind.WEB_PAGE, value: "", title: "", start: true }];
    edited();
    renderRows();
    list.lastElementChild?.querySelector("input[type=text]:last-of-type")?.focus();
  });
  const resetBtn = el("button", "secondary", t("favorites.reset"));
  resetBtn.type = "button";
  resetBtn.addEventListener("click", () => {
    draft = defaults.map((entry) => ({ ...entry }));
    edited();
    resetPending = true;
    renderRows();
  });
  tools.append(addBtn, resetBtn);
  dialog.appendChild(tools);

  const footer = el("div", "settings-footer");
  const cancel = el("button", "secondary", t("submit.cancel"));
  cancel.type = "button";
  cancel.addEventListener("click", closeFavouritesDialog);
  const saveBtn = el("button", null, t("favorites.save"));
  saveBtn.type = "button";
  saveBtn.addEventListener("click", async () => {
    let clean = null;
    if (!resetPending) {
      try {
        clean = draft.map((entry, index) => {
          try {
            return normalizeFavourite(entry);
          } catch (err) {
            throw new Error(`${index + 1}: ${err.message}`);
          }
        });
      } catch (err) {
        status.textContent = t("favorites.error", { message: err.message });
        status.className = "settings-status error";
        return;
      }
    }
    saveBtn.disabled = true;
    const result = await save(clean, { reset: resetPending });
    saveBtn.disabled = false;
    if (!overlay) {
      return;
    }
    if (result.ok) {
      closeFavouritesDialog();
      return;
    }
    status.textContent = result.error;
    status.className = "settings-status error";
  });
  footer.append(status, cancel, saveBtn);
  dialog.appendChild(footer);

  // Escape closes; other keys stay in the dialog rather than steering the scene.
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeFavouritesDialog();
      return;
    }
    event.stopPropagation();
  });

  renderRows();
  document.body.appendChild(overlay);
  list.querySelector("select, input")?.focus();
}

export { openFavouritesDialog };
