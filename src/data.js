// src/data.js
// Shared data, constants, and lookup maps for Brainrot Bot.

const rotsData = require("./data/rots.json").Data;
const bagData = require("./data/bag.json").Data;
const skinsData = require("./data/skins.json").Data;

const { flavorFor, flavorForItem, flavorForSkin, rarityStars, pick } = require("./slang");
const emojis = require("./emojis");

// ---------- Constants ----------

const ICON_BASE = "https://indieun.com/cab/icons";
const INVENTORY_URL = (id) => `https://indieun.com/cab/inventory/${encodeURIComponent(id)}`;
const APP_DIRECTORY_URL = (appId) => `https://discord.com/application-directory/${appId}`;
const TIERLIST_SCRIPT = require("path").join(__dirname, "tierlist.py");
const TIERLIST_OUT_DIR = require("path").join(__dirname, "..", "tierlists");

// ---------- Cooldowns ----------

const COOLDOWNS = {
  guess: 5000,
  inventory: 10000,
  tierlist: 15000,
  info: 0,
  trade: 0,
  top: 0,
  daily: 0,
  start: 0,
  help: 0,
  ping: 0,
};

// ---------- Data load ----------

const rots = Object.values(rotsData);
const items = Object.values(bagData);
const skins = Object.values(skinsData);

const rotByName = new Map(rots.map((r) => [r.FullName.toLowerCase(), r]));
const itemByName = new Map(items.map((i) => [i.Name.toLowerCase(), i]));
const skinByName = new Map(skins.map((s) => [s.Name.toLowerCase(), s]));

const rotBySpecies = rotByName;

const rotsWithSpawn = rots.filter((r) => r.SpawnLocation);
const spawnIndex = new Map();
for (const r of rotsWithSpawn) {
  const k = `W${r.SpawnLocation.World}.Z${r.SpawnLocation.Zone}`;
  if (!spawnIndex.has(k)) spawnIndex.set(k, []);
  spawnIndex.get(k).push(r);
}
const spawnKeys = Array.from(spawnIndex.keys()).sort();

module.exports = {
  rots,
  items,
  skins,
  rotByName,
  itemByName,
  skinByName,
  rotBySpecies,
  rotsWithSpawn,
  spawnIndex,
  spawnKeys,
  ICON_BASE,
  INVENTORY_URL,
  APP_DIRECTORY_URL,
  TIERLIST_SCRIPT,
  TIERLIST_OUT_DIR,
  COOLDOWNS,
  flavorFor,
  flavorForItem,
  flavorForSkin,
  rarityStars,
  pick,
  emojis,
};
