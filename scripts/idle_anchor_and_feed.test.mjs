// The VR idle launcher's anchor, and the tunnel's image feed.

import test from "node:test";
import assert from "node:assert/strict";

import {
  IDLE_ANCHOR_AXIS_LIMIT_RAD,
  gazeYawFromForward,
  idleAnchorTargetYaw,
  stepIdleAnchorYaw
} from "../src/idle-anchor.js";
import { stepImageFeed } from "../src/tunnel-run.js";
import { IMAGE_SPAWN_MAX_INTERVAL_MS, IMAGE_SPAWN_MAX_LOADS_IN_FLIGHT, IMAGE_SPAWN_SPACING_RINGS } from "../src/constants.js";

const DEG = Math.PI / 180;

test("facing the tunnel, the launcher stays on the axis wherever the head points", () => {
  for (const gaze of [-40, -5, 0, 20, 55]) {
    assert.equal(idleAnchorTargetYaw(gaze * DEG, 0), 0);
  }
});

test("a launcher left off to one side comes back to the axis", () => {
  let yaw = -30 * DEG;
  for (let frame = 0; frame < 180; frame += 1) {
    yaw = stepIdleAnchorYaw(0, yaw, 1 / 90);
  }
  assert.ok(Math.abs(yaw) < 0.001);
});

test("turned well away, it follows; turning back within reach of it, it holds until the axis is in range", () => {
  const away = 120 * DEG;
  assert.equal(idleAnchorTargetYaw(away, 0), away);
  assert.equal(idleAnchorTargetYaw(100 * DEG, away), away);
  assert.equal(idleAnchorTargetYaw(IDLE_ANCHOR_AXIS_LIMIT_RAD - 0.01, away), 0);
});

test("looking straight up or down leaves it alone", () => {
  assert.equal(gazeYawFromForward(0.1, 0.99, 0.05), null);
  assert.equal(idleAnchorTargetYaw(null, 0.3), 0.3);
  assert.ok(Math.abs(gazeYawFromForward(0, 0, -1)) < 1e-9);
});

function framesToSpawn(ringsPerSecond, loadsInFlight = 0) {
  let progress = 0;
  for (let frame = 1; frame < 2000; frame += 1) {
    const step = stepImageFeed({ progress, ringsPerSecond, dtS: 1 / 90, loadsInFlight });
    if (step.spawn) {
      return frame;
    }
    progress = step.progress;
  }
  return Infinity;
}

test("flying faster brings images sooner, at the same spacing", () => {
  const slow = framesToSpawn(16.25);
  const fast = framesToSpawn(56.25);
  assert.ok(Math.abs((slow / 90) * 16.25 - IMAGE_SPAWN_SPACING_RINGS) < 0.5);
  assert.ok(Math.abs((fast / 90) * 56.25 - IMAGE_SPAWN_SPACING_RINGS) < 1);
});

test("a very slow flight still feeds at the interval floor", () => {
  assert.ok(Math.abs(framesToSpawn(1) / 90 - IMAGE_SPAWN_MAX_INTERVAL_MS / 1000) < 0.05);
});

test("the feed waits for the network, then releases one image, not a burst", () => {
  assert.equal(framesToSpawn(56.25, IMAGE_SPAWN_MAX_LOADS_IN_FLIGHT), Infinity);
  const held = stepImageFeed({ progress: 1, ringsPerSecond: 56.25, dtS: 1, loadsInFlight: IMAGE_SPAWN_MAX_LOADS_IN_FLIGHT });
  assert.deepEqual(held, { progress: 1, spawn: false });
  assert.deepEqual(
    stepImageFeed({ progress: 1, ringsPerSecond: 56.25, dtS: 1, loadsInFlight: 0 }),
    { progress: 0, spawn: true }
  );
});
