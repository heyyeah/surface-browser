import * as THREE from "three";
import { xrHeadCamera } from "./xr-head-camera.js";

// `?fps=1`: frames per second and the slowest frame in each half-second, as a
// corner badge on the page and a head-locked badge in XR. A diagnostic for
// comparing tunnel walls (photo vs `?water=procedural`), not visitor UI.

const WIDTH_PX = 256;
const HEIGHT_PX = 64;
const WIDTH_M = 0.24;
const OFFSET = new THREE.Matrix4().makeTranslation(-0.22, -0.2, -1); // low left, 1 m out

let canvas, ctx, texture, mesh, badge;
let windowStart = 0;
let frames = 0;
let lastFrame = 0;
let worstMs = 0;

function ensure(scene) {
  if (mesh) {
    return;
  }
  canvas = document.createElement("canvas");
  canvas.width = WIDTH_PX;
  canvas.height = HEIGHT_PX;
  ctx = canvas.getContext("2d");
  texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(WIDTH_M, WIDTH_M * HEIGHT_PX / WIDTH_PX),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false })
  );
  mesh.renderOrder = 10010;
  mesh.matrixAutoUpdate = false;
  mesh.matrixWorldAutoUpdate = false;
  mesh.frustumCulled = false;
  // Here, not in tickFpsMeter: render() only updates the XR camera's pose after
  // the frame loop, so placing it earlier would trail the head by a frame.
  mesh.onBeforeRender = (renderer) => {
    mesh.matrixWorld.multiplyMatrices(xrHeadCamera(renderer.xr.getCamera()).matrixWorld, OFFSET);
  };
  scene.add(mesh);
  badge = document.createElement("div");
  badge.style.cssText = "position:fixed;left:8px;bottom:36px;z-index:9999;padding:4px 8px;"
    + "font:600 13px/1.2 ui-monospace,monospace;color:#dbe6ff;background:rgba(7,12,20,.82);"
    + "border-radius:6px;pointer-events:none";
  document.body.appendChild(badge);
}

function draw(text) {
  badge.textContent = text;
  ctx.clearRect(0, 0, WIDTH_PX, HEIGHT_PX);
  ctx.fillStyle = "rgba(7, 12, 20, 0.82)";
  ctx.fillRect(0, 0, WIDTH_PX, HEIGHT_PX);
  ctx.fillStyle = "#dbe6ff";
  ctx.font = "600 30px ui-monospace, monospace";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 12, HEIGHT_PX / 2);
  texture.needsUpdate = true;
}

// Call once per frame, before render.
export function tickFpsMeter(renderer, scene) {
  ensure(scene);
  const now = performance.now();
  if (lastFrame) {
    worstMs = Math.max(worstMs, now - lastFrame);
  }
  lastFrame = now;
  frames += 1;
  if (!windowStart) {
    windowStart = now;
  } else if (now - windowStart >= 500) {
    draw(`${Math.round((frames * 1000) / (now - windowStart))} fps  max ${worstMs.toFixed(0)} ms`);
    windowStart = now;
    frames = 0;
    worstMs = 0;
  }
  mesh.visible = renderer.xr.isPresenting;
}
