// Bookmark suggestions from visitors. The app only appends to a file; sending
// them on is left to the host.

import fs from "node:fs";
import path from "node:path";

const KINDS = new Set(["url", "image_search", "genai"]);
const MAX_QUERY_CHARS = 1000;
const MAX_NAME_CHARS = 80;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function cleanText(value, maxChars) {
  if (typeof value !== "string") {
    return "";
  }
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, maxChars).toWellFormed();
}

function normalizeSubmission(body) {
  const kind = String(body?.kind || "");
  const query = cleanText(body?.query, MAX_QUERY_CHARS);
  if (!KINDS.has(kind) || !query) {
    return null;
  }
  return { kind, query, name: cleanText(body?.name, MAX_NAME_CHARS) };
}

// An open form that ends in an inbox: the overall cap is what bounds the mail
// and the file, whoever is sending. Held in memory, so a restart forgives it.
function createSubmissionQuota({ perClientPerHour = 5, perDay = 30, maxTrackedClients = 1000, now = Date.now } = {}) {
  const clients = new Map();
  let day = { count: 0, resetAt: 0 };

  return function take(client) {
    const at = now();
    if (at >= day.resetAt) {
      day = { count: 0, resetAt: at + DAY_MS };
    }
    let bucket = clients.get(client);
    if (!bucket || at >= bucket.resetAt) {
      if (!bucket && clients.size >= maxTrackedClients) {
        clients.delete(clients.keys().next().value);
      }
      bucket = { count: 0, resetAt: at + HOUR_MS };
      clients.set(client, bucket);
    }
    if (day.count >= perDay || bucket.count >= perClientPerHour) {
      return false;
    }
    day.count += 1;
    bucket.count += 1;
    return true;
  };
}

// No IP or other visitor detail: the line holds what they chose to send.
async function appendSubmission(filePath, submission, now = new Date()) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.appendFile(filePath, `${JSON.stringify({ at: now.toISOString(), ...submission })}\n`);
}

export { appendSubmission, createSubmissionQuota, normalizeSubmission };
