// The flat Submit form. Built on .settings-overlay / .settings-dialog, the app's
// one modal language. The VR panel draws its own (vrpanel.js).

import { BookmarkKind } from "../shared/bookmark-presets.js";
import { state } from "./state.js";
import { t } from "./i18n.js";
import { sendSubmission, submissionDefaults } from "./submissions.js";

let overlay = null;

function closeSubmitDialog() {
  overlay?.remove();
  overlay = null;
}

function field(labelText, control) {
  const label = document.createElement("label");
  label.className = "submit-field";
  label.textContent = labelText;
  label.appendChild(control);
  return label;
}

function openSubmitDialog({ menuKind, genAiEnabled }) {
  closeSubmitDialog();
  const defaults = submissionDefaults({ lastLoad: state.menuLoad, menuKind });

  overlay = document.createElement("div");
  overlay.className = "settings-overlay vr-unavailable-overlay";
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeSubmitDialog();
    }
  });

  const dialog = document.createElement("form");
  dialog.className = "settings-dialog vr-unavailable-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "submit-title");
  overlay.appendChild(dialog);

  const header = document.createElement("div");
  header.className = "settings-header";
  const heading = document.createElement("h2");
  heading.id = "submit-title";
  heading.textContent = t("submit.title");
  header.appendChild(heading);
  dialog.appendChild(header);

  const type = document.createElement("select");
  const options = [
    [BookmarkKind.WEB_PAGE, "vr.mode.web"],
    [BookmarkKind.IMAGE_SEARCH, "vr.mode.image"],
    ...(genAiEnabled ? [[BookmarkKind.GENAI_PROMPT, "vr.mode.genai"]] : [])
  ];
  for (const [kind, labelKey] of options) {
    const option = document.createElement("option");
    option.value = String(kind);
    option.textContent = t(labelKey);
    type.appendChild(option);
  }
  type.value = String(defaults.kind);

  const query = document.createElement("input");
  query.type = "text";
  query.required = true;
  query.maxLength = 1000;
  query.value = defaults.query;

  const name = document.createElement("input");
  name.type = "text";
  name.maxLength = 80;
  name.value = defaults.name;

  dialog.append(field(t("submit.type"), type), field(t("submit.query"), query), field(t("submit.name"), name));

  const message = document.createElement("p");
  message.className = "submit-message";
  message.setAttribute("role", "status");
  dialog.appendChild(message);

  const footer = document.createElement("div");
  footer.className = "settings-footer";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "secondary";
  cancel.textContent = t("submit.cancel");
  cancel.addEventListener("click", closeSubmitDialog);
  const send = document.createElement("button");
  send.type = "submit";
  send.textContent = t("submit.send");
  footer.append(cancel, send);
  dialog.appendChild(footer);

  dialog.addEventListener("submit", async (event) => {
    event.preventDefault();
    send.disabled = true;
    const result = await sendSubmission({ kind: Number(type.value), query: query.value, name: name.value });
    message.textContent = t(`submit.result.${result}`);
    if (result === "sent") {
      send.hidden = true;
      cancel.textContent = t("submit.close");
    } else {
      send.disabled = false;
    }
  });

  // Keys typed here are not scene controls.
  overlay.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      closeSubmitDialog();
    }
  });
  document.body.appendChild(overlay);
  (defaults.query ? name : query).focus();
}

export { openSubmitDialog };
