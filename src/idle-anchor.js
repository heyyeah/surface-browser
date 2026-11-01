// Where the VR idle launcher sits: on the tunnel axis (yaw 0, world -Z) while the
// viewer is roughly facing the tunnel, so it never stays off to one side from
// wherever the head happened to be pointing as it opened. It only leaves the axis
// when the viewer has turned well away, so it can never end up behind them.
//
// Pure: no three.js, no DOM.

const IDLE_ANCHOR_AXIS_LIMIT_RAD = 60 * Math.PI / 180;
const IDLE_ANCHOR_TAU_S = 0.25;
// Near straight up or down the flattened forward vector is noise.
const IDLE_ANCHOR_MAX_PITCH_SIN = 0.95;

function wrapYaw(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

// Yaw of a forward vector; 0 faces -Z. Null when it says nothing about heading.
function gazeYawFromForward(x, y, z) {
  if (Math.abs(y) > IDLE_ANCHOR_MAX_PITCH_SIN || (x * x + z * z) < 1e-6) {
    return null;
  }
  return Math.atan2(-x, -z);
}

function idleAnchorTargetYaw(gazeYaw, currentYaw) {
  if (gazeYaw === null || Math.abs(wrapYaw(gazeYaw)) <= IDLE_ANCHOR_AXIS_LIMIT_RAD) {
    return gazeYaw === null ? currentYaw : 0;
  }
  return Math.abs(wrapYaw(gazeYaw - currentYaw)) > IDLE_ANCHOR_AXIS_LIMIT_RAD ? gazeYaw : currentYaw;
}

function stepIdleAnchorYaw(gazeYaw, currentYaw, dtS) {
  const target = idleAnchorTargetYaw(gazeYaw, currentYaw);
  const blend = 1 - Math.exp(-Math.max(0, dtS) / IDLE_ANCHOR_TAU_S);
  return wrapYaw(currentYaw + wrapYaw(target - currentYaw) * blend);
}

export { IDLE_ANCHOR_AXIS_LIMIT_RAD, gazeYawFromForward, idleAnchorTargetYaw, stepIdleAnchorYaw };
