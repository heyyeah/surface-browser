// What the Submit form starts with and how it sends, for the flat dialog and the
// VR panel alike.

import { BookmarkKind } from "../shared/bookmark-presets.js";

const SUBMISSION_NAME_MAX_CHARS = 80;

const MODE_FOR_KIND = Object.freeze({
  [BookmarkKind.WEB_PAGE]: "url",
  [BookmarkKind.IMAGE_SEARCH]: "image_search",
  [BookmarkKind.GENAI_PROMPT]: "genai"
});

const KIND_FOR_MODE = Object.freeze({
  url: BookmarkKind.WEB_PAGE,
  image_search: BookmarkKind.IMAGE_SEARCH,
  genai: BookmarkKind.GENAI_PROMPT
});

let submissionsEnabled = false;

function setSubmissionsEnabled(enabled) {
  submissionsEnabled = Boolean(enabled);
}

function isSubmissionsEnabled() {
  return submissionsEnabled;
}

function defaultSubmissionName(mode, query) {
  if (mode === "url") {
    try {
      const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(query) ? query : `https://${query}`);
      return url.hostname.replace(/^www\./, "");
    } catch {
      // Not a URL after all: the query names itself.
    }
  }
  return query.slice(0, SUBMISSION_NAME_MAX_CHARS);
}

// The last query if there is one, its mode included; otherwise the menu it was
// opened from sets the type and the rest is blank.
function submissionDefaults({ lastLoad = null, menuKind = BookmarkKind.WEB_PAGE } = {}) {
  const query = String(lastLoad?.query || "").trim();
  if (query && lastLoad.mode in KIND_FOR_MODE) {
    return { kind: KIND_FOR_MODE[lastLoad.mode], query, name: defaultSubmissionName(lastLoad.mode, query) };
  }
  return { kind: menuKind, query: "", name: "" };
}

// Resolves to "sent", "limited" or "error"; never throws.
async function sendSubmission({ kind, query, name }) {
  try {
    const response = await fetch("/api/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: MODE_FOR_KIND[kind], query, name })
    });
    if (response.ok) {
      return "sent";
    }
    return response.status === 429 ? "limited" : "error";
  } catch {
    return "error";
  }
}

export {
  defaultSubmissionName,
  isSubmissionsEnabled,
  sendSubmission,
  setSubmissionsEnabled,
  submissionDefaults
};
