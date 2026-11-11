import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createConcurrencyGuard } from "../server/concurrency-guard.js";

function fakeRes() {
  const res = new EventEmitter();
  res.locals = {};
  res.headers = {};
  res.statusCode = 200;
  res.headersSent = false;
  res.destroyed = false;
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = () => { res.headersSent = true; };
  return res;
}

// Resolves "admitted" or the refusal status.
function enter(guard, client, res = fakeRes()) {
  return new Promise((resolve) => {
    const json = res.json;
    res.json = (body) => { json(body); resolve(res.statusCode); };
    guard({ client }, res, () => resolve("admitted"));
  });
}

const options = (waitMs) => ({ waitMs, clientKey: (req) => req.client });

test("over the limit, a request waits for the next free slot", async () => {
  const guard = createConcurrencyGuard(1, 0, options(500));
  const first = fakeRes();
  assert.equal(await enter(guard, "a", first), "admitted");
  const waiting = enter(guard, "b");
  setTimeout(() => first.emit("finish"), 50);
  assert.equal(await waiting, "admitted");
});

test("a wait that runs out is refused as busy", async () => {
  const guard = createConcurrencyGuard(1, 0, options(50));
  assert.equal(await enter(guard, "a"), "admitted");
  assert.equal(await enter(guard, "b"), 503);
});

test("with no wait configured, an extra request is refused at once", async () => {
  const guard = createConcurrencyGuard(1, 0, options(0));
  assert.equal(await enter(guard, "a"), "admitted");
  assert.equal(await enter(guard, "b"), 503);
});

test("a waiter over its own per-client cap lets another client's waiter go first", async () => {
  const guard = createConcurrencyGuard(2, 1, options(500));
  const held = fakeRes();
  assert.equal(await enter(guard, "a", held), "admitted");
  const other = fakeRes();
  assert.equal(await enter(guard, "b", other), "admitted");
  const sameClient = enter(guard, "a");
  const third = enter(guard, "c");
  other.emit("finish");
  assert.equal(await third, "admitted");
  held.emit("finish");
  assert.equal(await sameClient, "admitted");
});
