// The desktop app's update notices (desktop/preload.cjs), shown as a toast
// instead of system notifications or dialogs. Absent in the browser.
import { t } from "./i18n.js";

const KINDS = new Set(["available", "downloading", "latest", "error", "failed", "checking", "unsupported"]);
// These stay up: one waits for an answer, the other ends in a restart.
const STICKY = new Set(["available", "downloading"]);
const AUTO_HIDE_MS = 6000;

export function setupDesktopUpdates() {
  const bridge = window.surfaceDesktop;
  const toast = document.querySelector("#update-toast");
  if (!bridge || !toast) {
    return;
  }
  let hideTimer = 0;
  const hide = () => {
    clearTimeout(hideTimer);
    toast.hidden = true;
  };
  const button = (label, onClick) => {
    const el = document.createElement("button");
    el.type = "button";
    el.textContent = label;
    el.addEventListener("click", onClick);
    return el;
  };
  bridge.onUpdateNotice(({ kind, version } = {}) => {
    if (!KINDS.has(kind)) {
      return;
    }
    clearTimeout(hideTimer);
    const text = document.createElement("span");
    text.textContent = t(`update.${kind}`, { version: version || "" });
    toast.replaceChildren(text);
    if (kind === "available") {
      const update = button(t("update.update"), () => bridge.downloadUpdate());
      update.className = "primary";
      toast.append(update, button(t("update.later"), hide));
    } else if (!STICKY.has(kind)) {
      hideTimer = setTimeout(hide, AUTO_HIDE_MS);
    }
    toast.hidden = false;
  });
}
