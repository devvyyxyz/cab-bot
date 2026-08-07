// src/emojis.js
// Loads application emojis from Discord at boot and provides:
//   - emojiFor(entity)         → "<:Name:id>" format string for use in any text
//   - emojiMarkdown(entity)    → same as above (alias)
//   - emojiUrl(entity)         → CDN URL for the emoji image (used in MediaGallery)
//   - emojiForIconFile(file)   → "<:Name:id>" given an icon filename like "61.png"
//   - allEmojisLoaded()        → boolean
//
// Entity matching is case-insensitive on FullName/Name/ShortenedName.
// We also build an iconFile → emoji map for direct lookups from data files.

const { REST, Routes } = require("discord.js");

let _emojiByName = new Map();   // "brrbrrrpatapim" → { name, id }
let _emojiByIcon = new Map();   // "61.png" → { name, id }
let _loaded = false;

// Build a normalized key from a name (PascalCase → lowercase, no spaces).
function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// Fetch all application emojis and index them.
async function loadEmojis(token, appId) {
  const rest = new REST({ version: "10" }).setToken(token);
  const result = await rest.get(Routes.applicationEmojis(appId));
  _emojiByName = new Map();
  _emojiByIcon = new Map();
  for (const e of result.items || []) {
    const key = normalize(e.name);
    _emojiByName.set(key, { name: e.name, id: e.id });
  }
  _loaded = true;
  return _emojiByName.size;
}

// Given an entity name (FullName, Name, etc.), return the emoji mention string.
// Returns "" if no emoji is found (so callers can safely concatenate).
function emojiFor(name) {
  if (!_loaded) return "";
  const key = normalize(name);
  const e = _emojiByName.get(key);
  if (!e) return "";
  return `<:${e.name}:${e.id}>`;
}

const emojiMarkdown = emojiFor;

// CDN URL for the emoji image (PNG, animated if applicable).
function emojiUrl(name) {
  if (!_loaded) return null;
  const key = normalize(name);
  const e = _emojiByName.get(key);
  if (!e) return null;
  // Application emojis can be animated; use the right extension.
  // We don't store the animated flag, but Discord serves both .gif and .png
  // for animated emojis at the .gif URL. Default to .png (works for static).
  // If the emoji is animated, .png still returns a still frame.
  // To always get the right format, use .gif for safety? No — for static
  // emojis, .gif 404s. Use .png and accept still frames for animated ones.
  return `https://cdn.discordapp.com/emojis/${e.id}.png?size=128&quality=lossless`;
}

// Given an icon filename like "61.png", find the corresponding emoji.
// We need to know which entity uses that icon, so the caller (boot code)
// must register the icon → entity mapping. We provide a setter here.
function registerIconForEntity(iconFile, entityName) {
  const e = _emojiByName.get(normalize(entityName));
  if (e) {
    _emojiByIcon.set(iconFile, e);
  }
}

function emojiForIconFile(iconFile) {
  const e = _emojiByIcon.get(iconFile);
  if (!e) return "";
  return `<:${e.name}:${e.id}>`;
}

function emojiUrlForIconFile(iconFile) {
  const e = _emojiByIcon.get(iconFile);
  if (!e) return null;
  return `https://cdn.discordapp.com/emojis/${e.id}.png?size=128&quality=lossless`;
}

function allEmojisLoaded() {
  return _loaded;
}

function emojiCount() {
  return _emojiByName.size;
}

module.exports = {
  loadEmojis,
  emojiFor,
  emojiMarkdown,
  emojiUrl,
  registerIconForEntity,
  emojiForIconFile,
  emojiUrlForIconFile,
  allEmojisLoaded,
  emojiCount,
  normalize,
};
