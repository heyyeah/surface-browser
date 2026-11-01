// The viewer's head as a camera, for placing things and aiming gaze in XR.
//
// three r187 takes the XR camera's pose from the first view (the left eye), so
// anything placed or centred from it sits half an IPD to one side. This copies
// that camera with its position moved to the midpoint of the eyes.

import * as THREE from "three";

const headCamera = new THREE.PerspectiveCamera();
headCamera.matrixAutoUpdate = false;

const _left = new THREE.Vector3();
const _right = new THREE.Vector3();

function xrHeadCamera(xrCamera) {
  const [leftEye, rightEye] = xrCamera.cameras ?? [];
  if (!leftEye || !rightEye) {
    return xrCamera;
  }
  _left.setFromMatrixPosition(leftEye.matrixWorld);
  _right.setFromMatrixPosition(rightEye.matrixWorld);
  headCamera.matrix.copy(xrCamera.matrixWorld).setPosition(_left.lerp(_right, 0.5));
  headCamera.matrixWorld.copy(headCamera.matrix);
  headCamera.matrixWorldInverse.copy(headCamera.matrixWorld).invert();
  headCamera.projectionMatrix.copy(xrCamera.projectionMatrix);
  headCamera.projectionMatrixInverse.copy(xrCamera.projectionMatrixInverse);
  return headCamera;
}

export { xrHeadCamera };
