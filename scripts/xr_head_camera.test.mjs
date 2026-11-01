// three r187 poses the XR camera at the left eye; the app centres on the head.

import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import { xrHeadCamera } from "../src/xr-head-camera.js";

function xrRig() {
  const leftEye = new THREE.PerspectiveCamera();
  const rightEye = new THREE.PerspectiveCamera();
  const xrCamera = new THREE.ArrayCamera([leftEye, rightEye]);
  const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5);
  const pose = (x) => new THREE.Matrix4().compose(new THREE.Vector3(x, 1.6, 0), yaw, new THREE.Vector3(1, 1, 1));
  leftEye.matrixWorld.copy(pose(-0.032));
  rightEye.matrixWorld.copy(pose(0.032));
  xrCamera.matrixWorld.copy(leftEye.matrixWorld);
  xrCamera.matrix.copy(leftEye.matrixWorld);
  xrCamera.matrix.decompose(xrCamera.position, xrCamera.quaternion, xrCamera.scale);
  return xrCamera;
}

test("the head sits between the eyes and looks where the XR camera looks", () => {
  const xrCamera = xrRig();
  const head = xrHeadCamera(xrCamera);
  const position = head.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(position.x) < 1e-6);
  assert.ok(Math.abs(position.y - 1.6) < 1e-6);
  const headDir = head.getWorldDirection(new THREE.Vector3());
  const xrDir = xrCamera.getWorldDirection(new THREE.Vector3());
  assert.ok(headDir.distanceTo(xrDir) < 1e-6);
});

test("before the first XR frame there are no eyes, so the XR camera is returned", () => {
  const xrCamera = new THREE.ArrayCamera();
  assert.equal(xrHeadCamera(xrCamera), xrCamera);
});
