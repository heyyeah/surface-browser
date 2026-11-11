// Surface Browser desktop: the same Express server and client as the web build,
// in one Electron app. The server runs in this (main) process on a random
// loopback port and serves dist/; the window loads it like a browser would, so
// the app behaves exactly as when the web version runs locally.
//
// Pages that need JavaScript render in a hidden Electron window instead of
// Playwright (page-renderer.mjs).

import { app, BrowserWindow, shell } from "electron";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElectronPageRenderer } from "./page-renderer.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Packaged, server/ and dist/ sit beside this file; in the repo, one level up.
const ROOT = fs.existsSync(path.join(HERE, "server")) ? HERE : path.resolve(HERE, "..");
const importFrom = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow = null;
let origin = "";

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function waitForPort(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error("The server did not start"));
        } else {
          setTimeout(attempt, 100);
        }
      });
    };
    attempt();
  });
}

// Every file the server writes goes under the app's data folder: inside the app
// bundle nothing is writable. A .env in that folder configures the app the way
// one does a local web install (keys, providers); the settings panel works too.
async function configureServerEnv(port) {
  const data = app.getPath("userData");
  fs.mkdirSync(path.join(data, "logs"), { recursive: true });
  const { config } = await import("dotenv");
  config({ path: path.join(data, ".env"), quiet: true });
  const at = (name) => path.join(data, name);
  const defaults = {
    SETTINGS_FILE_PATH: at("settings.json"),
    SPEND_STATE_PATH: at("spend-state.json"),
    KILL_SWITCH_PATH: at("KILL_SWITCH"),
    LIVE_STATS_PATH: at("live-stats.json"),
    QUERY_LOG_PATH: at("logs/queries.jsonl"),
    LOG_API_QUERIES_FILE: at("logs/query.log"),
    XR_DIAG_LOG_FILE: at("logs/xr-diag.log"),
    SPEND_LOG_FILE: at("logs/spend.log"),
    SCREENSHOT_DIR_PATH: at("screenshots"),
    GENAI_IMAGE_DIR_PATH: at("generated-images"),
    // The bundled speech model is not shipped (about 430 MB).
    STT_PROVIDER: "off"
  };
  for (const [key, value] of Object.entries(defaults)) {
    process.env[key] ??= value;
  }
  // Not overridable: the app must serve itself, on loopback only.
  Object.assign(process.env, {
    PORT: String(port),
    BIND_HOST: "127.0.0.1",
    SERVE_STATIC_DIR: path.join(ROOT, "dist"),
    PLAYWRIGHT_ENABLED: "1"
  });
}

async function startServer() {
  const port = await freePort();
  await configureServerEnv(port);
  const extract = await importFrom("server/extract.js");
  const netPolicy = await importFrom("server/net-policy.js");
  const render = await importFrom("server/playwright-render.js");
  extract.setPageRenderer(createElectronPageRenderer({
    collectRenderedImages: extract.collectRenderedImages,
    renderCollectArgs: extract.renderCollectArgs,
    requestHeadersForUpstream: render.requestHeadersForUpstream,
    responseHeadersForFulfil: render.responseHeadersForFulfil,
    timings: extract.RENDER_TIMINGS,
    skippedResourceTypes: render.RENDER_SKIPPED_RESOURCE_TYPES,
    userAgent: netPolicy.browserUserAgent()
  }));
  await importFrom("server/index.js");
  await waitForPort(port);
  return `http://127.0.0.1:${port}`;
}

function isAppUrl(url) {
  return url === origin || url.startsWith(`${origin}/`);
}

function openExternally(url) {
  if (/^https?:\/\//i.test(url)) {
    void shell.openExternal(url);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#0b1220",
    title: "Surface Browser",
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  });
  // The app's own pages stay in the window; any other link opens in the
  // system browser, so no web page ever runs with the app's origin.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      openExternally(url);
    }
  });
  // index.html's <title> names the WebXR build; there is no VR on the desktop.
  mainWindow.on("page-title-updated", (event) => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(["fullscreen", "clipboard-sanitized-write"].includes(permission));
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  void mainWindow.loadURL(origin);
}

async function checkForUpdates() {
  if (!app.isPackaged || process.platform !== "darwin") {
    return;
  }
  try {
    const { default: updater } = await import("electron-updater");
    await updater.autoUpdater.checkForUpdatesAndNotify();
  } catch (err) {
    console.warn("Update check failed:", err.message);
  }
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

app.whenReady().then(async () => {
  origin = await startServer();
  createWindow();
  void checkForUpdates();
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
