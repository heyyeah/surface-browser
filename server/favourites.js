// The editable favourites list, stored beside the settings overrides in its own
// file. No file means the built-in DEFAULT_BOOKMARKS; reset deletes the file.
// GenAI auto-pooling keeps reading the built-ins (genAiBookmarkPrompts), so an
// edit here never changes what the pool grows.

import fs from "node:fs";
import path from "node:path";
import { resolveFilePath } from "./env.js";
import { SETTINGS_FILE_PATH } from "./settings.js";
import { DEFAULT_BOOKMARKS } from "../shared/bookmark-presets.js";
import { validateFavourites } from "../shared/favourites.js";

export const FAVOURITES_FILE_PATH = process.env.FAVOURITES_FILE_PATH
  || path.join(path.dirname(resolveFilePath(SETTINGS_FILE_PATH)), "favourites.local.json");

// { favourites, custom }: custom is false while the built-ins are in use.
export function loadFavourites(filePath = FAVOURITES_FILE_PATH) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.warn(`Favourites unreadable, using the built-ins: ${err.message}`);
    }
    return { favourites: DEFAULT_BOOKMARKS, custom: false };
  }
  try {
    return { favourites: validateFavourites(JSON.parse(raw)), custom: true };
  } catch (err) {
    console.warn(`Ignoring invalid favourites file: ${err.message}`);
    return { favourites: DEFAULT_BOOKMARKS, custom: false };
  }
}

// Throws on an invalid list (the route answers 400) before touching the file.
export function saveFavourites(rawList, filePath = FAVOURITES_FILE_PATH) {
  const favourites = validateFavourites(rawList);
  fs.mkdirSync(path.dirname(resolveFilePath(filePath)), { recursive: true });
  const tmp = `${resolveFilePath(filePath)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(favourites, null, 2)}\n`);
  fs.renameSync(tmp, filePath);
  return { favourites, custom: true };
}

export function resetFavourites(filePath = FAVOURITES_FILE_PATH) {
  fs.rmSync(filePath, { force: true });
  return { favourites: DEFAULT_BOOKMARKS, custom: false };
}
