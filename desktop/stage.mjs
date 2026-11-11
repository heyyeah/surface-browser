// Assembles build/app, the folder electron-builder packages: the server and the
// built client (tracked files only, so no local settings, logs or keys), the
// desktop entry point, and production dependencies installed from app-lock.json.
//
// The server's optional extras stay out: Playwright (the app renders with its
// own Chromium) and the bundled speech model (about 430 MB).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(DESKTOP, "..");
const APP = path.join(DESKTOP, "build", "app");
const RUNTIME_DEPS = ["cheerio", "cors", "dotenv", "express", "mmdb-lib", "sharp", "undici"];
const LOCK = path.join(DESKTOP, "app-lock.json");
const UPDATER = { "electron-updater": "6.8.11" };

const web = JSON.parse(fs.readFileSync(path.join(WEB, "package.json"), "utf8"));
const desktop = JSON.parse(fs.readFileSync(path.join(DESKTOP, "package.json"), "utf8"));
if (!fs.existsSync(path.join(WEB, "dist", "index.html"))) {
  throw new Error("dist/ is missing: run the web build first (npm run stage does)");
}

fs.rmSync(APP, { recursive: true, force: true });
fs.mkdirSync(APP, { recursive: true });

const tracked = execFileSync("git", ["ls-files", "-z", "server", "shared"], { cwd: WEB, encoding: "utf8" })
  .split("\0").filter(Boolean);
for (const rel of tracked) {
  fs.mkdirSync(path.dirname(path.join(APP, rel)), { recursive: true });
  fs.copyFileSync(path.join(WEB, rel), path.join(APP, rel));
}
fs.cpSync(path.join(WEB, "dist"), path.join(APP, "dist"), { recursive: true });
for (const file of ["main.mjs", "page-renderer.mjs"]) {
  fs.copyFileSync(path.join(DESKTOP, file), path.join(APP, file));
}

const dependencies = { ...UPDATER };
for (const name of RUNTIME_DEPS) {
  if (!web.dependencies[name]) {
    throw new Error(`${name} is no longer a dependency of the web build; update stage.mjs`);
  }
  dependencies[name] = web.dependencies[name];
}
fs.writeFileSync(path.join(APP, "package.json"), JSON.stringify({
  name: "surface-browser",
  productName: desktop.productName,
  version: desktop.version,
  description: desktop.description,
  author: "Tim Plaisted",
  private: true,
  type: "module",
  main: "main.mjs",
  dependencies,
  allowScripts: web.allowScripts
}, null, 2));
fs.copyFileSync(path.join(WEB, ".npmrc"), path.join(APP, ".npmrc"));
// app-lock.json pins the staged app's whole tree, electron-updater included
// (the web lockfile does not know it). `node stage.mjs --relock` rewrites it,
// seeded from the web lockfile so shared versions stay identical.
const npm = (...args) => execFileSync("npm", [...args, "--no-audit", "--no-fund"], {
  cwd: APP,
  stdio: "inherit",
  shell: process.platform === "win32"
});
if (process.argv.includes("--relock")) {
  fs.copyFileSync(path.join(WEB, "package-lock.json"), path.join(APP, "package-lock.json"));
  npm("install", "--omit=dev", "--package-lock-only");
  fs.copyFileSync(path.join(APP, "package-lock.json"), LOCK);
}
fs.copyFileSync(LOCK, path.join(APP, "package-lock.json"));
npm("ci", "--omit=dev");
console.log(`Staged ${tracked.length} files and production dependencies in ${path.relative(process.cwd(), APP)}`);
