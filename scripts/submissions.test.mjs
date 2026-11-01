import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSubmissionQuota, normalizeSubmission } from "../server/submissions.js";
import { submissionDefaults } from "../src/submissions.js";
import { BookmarkKind } from "../shared/bookmark-presets.js";
import { startServer } from "./contract_helpers.mjs";

test("a submission needs a known type and a query; control characters go", () => {
  assert.equal(normalizeSubmission({ kind: "ftp", query: "x" }), null);
  assert.equal(normalizeSubmission({ kind: "url", query: "   " }), null);
  assert.equal(normalizeSubmission(null), null);
  assert.deepEqual(
    normalizeSubmission({ kind: "genai", query: "a\r\nSubject: b", name: 7, ip: "1.2.3.4" }),
    { kind: "genai", query: "a Subject: b", name: "" }
  );
  assert.equal(normalizeSubmission({ kind: "url", query: "q", name: "n".repeat(500) }).name.length, 80);
  // A cut through an emoji, or half of one sent on purpose, cannot reach the mail.
  assert.ok(normalizeSubmission({ kind: "url", query: "q", name: `${"n".repeat(79)}🦦` }).name.isWellFormed());
  assert.ok(normalizeSubmission({ kind: "url", query: "\ud83d", name: "\ud83d" }).query.isWellFormed());
});

test("the quota caps each client and the whole server, and refills", () => {
  let at = 0;
  const take = createSubmissionQuota({ perClientPerHour: 2, perDay: 3, now: () => at });
  assert.deepEqual([take("a"), take("a"), take("a")], [true, true, false]);
  assert.deepEqual([take("b"), take("c")], [true, false]);
  at += 25 * 60 * 60 * 1000;
  assert.equal(take("a"), true);
});

test("the form starts from the last query, or from the menu it was opened in", () => {
  assert.deepEqual(
    submissionDefaults({ lastLoad: { mode: "url", query: "https://www.example.org/a" }, menuKind: BookmarkKind.GENAI_PROMPT }),
    { kind: BookmarkKind.WEB_PAGE, query: "https://www.example.org/a", name: "example.org" }
  );
  assert.deepEqual(
    submissionDefaults({ lastLoad: { mode: "genai", query: "otters" } }),
    { kind: BookmarkKind.GENAI_PROMPT, query: "otters", name: "otters" }
  );
  assert.deepEqual(
    submissionDefaults({ lastLoad: null, menuKind: BookmarkKind.IMAGE_SEARCH }),
    { kind: BookmarkKind.IMAGE_SEARCH, query: "", name: "" }
  );
});

test("POST /api/submit stores what was sent, and is absent when not configured", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-submit-"));
  const file = path.join(dir, "nested", "submissions.jsonl");
  const on = await startServer({ SUBMISSIONS_PATH: file });
  const off = await startServer({});
  const post = (base, body) => fetch(`${base}/api/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  try {
    assert.equal((await (await fetch(`${on.base}/api/health`)).json()).submissions.enabled, true);
    assert.equal((await (await fetch(`${off.base}/api/health`)).json()).submissions.enabled, false);
    assert.equal((await post(off.base, { kind: "url", query: "x" })).status, 404);
    assert.equal((await post(on.base, { kind: "url" })).status, 400);
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await post(on.base, { kind: "url", query: `q${i}`, name: "n" })).status, 204);
    }
    assert.equal((await post(on.base, { kind: "url", query: "over" })).status, 429);
    const lines = fs.readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(lines.length, 5);
    assert.deepEqual(Object.keys(lines[0]).sort(), ["at", "kind", "name", "query"]);
  } finally {
    await on.stop();
    await off.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
