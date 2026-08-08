// src/database.js
// SQLite database module for Brainrot Bot.
//
// Schema overview (all per-guild, expandable):
//   guilds       — per-guild settings (welcome message, spawn channel, avatar, etc.)
//   users        — per-user data within a guild (Discord user + guild composite key)
//   user_inventory — brainrots caught by users (guild-scoped)
//   spawns       — active spawn events (one per guild at a time)
//   catch_log    — history of catches (for stats / nuke)
//
// Usage:
//   const db = require("./database");
//   db.init();                         // call once at startup
//   db.setGuildSetting(guildId, key, value);
//   db.getGuildSetting(guildId, key);
//   db.getActiveSpawn(guildId);
//   db.setActiveSpawn(guildId, rotName, expiresAt);
//   db.addCatch(guildId, userId, rotName);
//   db.getUserInventory(guildId, userId);
//   db.clearUserInventory(guildId, userId);
//   db.close();

const Database = require("better-sqlite3");
const path = require("path");
const log = require("./logger");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "brainrot.db");

let _db = null;

function init() {
  if (_db) return _db;
  const dir = path.dirname(DB_PATH);
  // Ensure the directory exists.
  try {
    require("fs").mkdirSync(dir, { recursive: true });
  } catch (e) {
    log.warn(`Could not create DB directory ${dir}: ${e.message}`);
  }
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  // --- guilds table ---
  // One row per guild. Settings are stored as key/value pairs.
  _db.exec(`
    CREATE TABLE IF NOT EXISTS guilds (
      guild_id   TEXT NOT NULL,
      key        TEXT NOT NULL,
      value      TEXT,
      PRIMARY KEY (guild_id, key)
    )
  `);

  // --- users table ---
  // Per-user data within a guild. Composite PK (guild_id, user_id).
  _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      username   TEXT,
      avatar     TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now')),
      PRIMARY KEY (guild_id, user_id)
    )
  `);

  // --- user_inventory table ---
  // Brainrots caught by users. Each row is one caught rot.
  _db.exec(`
    CREATE TABLE IF NOT EXISTS user_inventory (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      rot_name   TEXT NOT NULL,
      caught_at  INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (guild_id, user_id) REFERENCES users(guild_id, user_id) ON DELETE CASCADE
    )
  `);

  // --- spawns table ---
  // Active spawn events. One per guild at a time.
  _db.exec(`
    CREATE TABLE IF NOT EXISTS spawns (
      guild_id   TEXT PRIMARY KEY,
      rot_name   TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  // --- catch_log table ---
  // History of all catches (for stats, nuke, etc.)
  _db.exec(`
    CREATE TABLE IF NOT EXISTS catch_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      rot_name   TEXT NOT NULL,
      caught_at  INTEGER DEFAULT (strftime('%s', 'now'))
    )
  `);

  // --- indexes for performance ---
  _db.exec(`
    CREATE INDEX IF NOT EXISTS idx_user_inventory_guild ON user_inventory(guild_id);
    CREATE INDEX IF NOT EXISTS idx_user_inventory_user  ON user_inventory(user_id);
    CREATE INDEX IF NOT EXISTS idx_catch_log_guild      ON catch_log(guild_id);
    CREATE INDEX IF NOT EXISTS idx_catch_log_user       ON catch_log(user_id);
  `);

  log.info(`Database initialized at ${DB_PATH}`);
  return _db;
}

// --- Guild settings ---

function setGuildSetting(guildId, key, value) {
  const stmt = _db.prepare(
    "INSERT INTO guilds (guild_id, key, value) VALUES (?, ?, ?) " +
    "ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value"
  );
  stmt.run(guildId, key, value === undefined || value === null ? null : String(value));
}

function getGuildSetting(guildId, key, defaultValue = null) {
  const stmt = _db.prepare("SELECT value FROM guilds WHERE guild_id = ? AND key = ?");
  const row = stmt.get(guildId, key);
  return row ? row.value : defaultValue;
}

function getAllGuildSettings(guildId) {
  const stmt = _db.prepare("SELECT key, value FROM guilds WHERE guild_id = ?");
  const rows = stmt.all(guildId);
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  return obj;
}

function deleteGuildSetting(guildId, key) {
  const stmt = _db.prepare("DELETE FROM guilds WHERE guild_id = ? AND key = ?");
  stmt.run(guildId, key);
}

// --- Users ---

function upsertUser(guildId, userId, username = null, avatar = null) {
  const stmt = _db.prepare(
    "INSERT INTO users (guild_id, user_id, username, avatar) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(guild_id, user_id) DO UPDATE SET " +
    "username = excluded.username, avatar = excluded.avatar, updated_at = strftime('%s', 'now')"
  );
  stmt.run(guildId, userId, username, avatar);
}

function getUser(guildId, userId) {
  const stmt = _db.prepare("SELECT * FROM users WHERE guild_id = ? AND user_id = ?");
  return stmt.get(guildId, userId);
}

// --- Spawn system ---

function getActiveSpawn(guildId) {
  const stmt = _db.prepare(
    "SELECT * FROM spawns WHERE guild_id = ? AND expires_at > strftime('%s', 'now')"
  );
  return stmt.get(guildId);
}

function setActiveSpawn(guildId, rotName, expiresAt) {
  const stmt = _db.prepare(
    "INSERT INTO spawns (guild_id, rot_name, expires_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(guild_id) DO UPDATE SET rot_name = excluded.rot_name, expires_at = excluded.expires_at"
  );
  stmt.run(guildId, rotName, expiresAt);
}

function clearSpawn(guildId) {
  const stmt = _db.prepare("DELETE FROM spawns WHERE guild_id = ?");
  stmt.run(guildId);
}

// --- Inventory / catches ---

function addCatch(guildId, userId, rotName) {
  // Ensure user exists
  upsertUser(guildId, userId);
  const insertInv = _db.prepare(
    "INSERT INTO user_inventory (guild_id, user_id, rot_name) VALUES (?, ?, ?)"
  );
  const insertLog = _db.prepare(
    "INSERT INTO catch_log (guild_id, user_id, rot_name) VALUES (?, ?, ?)"
  );
  const tx = _db.transaction((g, u, r) => {
    insertInv.run(g, u, r);
    insertLog.run(g, u, r);
  });
  tx(guildId, userId, rotName);
  try {
    log.info(`DB: added catch ${rotName} for user ${userId} in guild ${guildId} -> ${DB_PATH}`);
  } catch {}
}

function dbPath() {
  return DB_PATH;
}

function getUserInventory(guildId, userId) {
  const stmt = _db.prepare(
    "SELECT rot_name, COUNT(*) as count FROM user_inventory " +
    "WHERE guild_id = ? AND user_id = ? GROUP BY rot_name ORDER BY count DESC, rot_name"
  );
  return stmt.all(guildId, userId);
}

function getUserInventoryCount(guildId, userId) {
  const stmt = _db.prepare(
    "SELECT COUNT(*) as total FROM user_inventory WHERE guild_id = ? AND user_id = ?"
  );
  const row = stmt.get(guildId, userId);
  return row ? row.total : 0;
}

function clearUserInventory(guildId, userId) {
  const tx = _db.transaction((g, u) => {
    _db.prepare("DELETE FROM user_inventory WHERE guild_id = ? AND user_id = ?").run(g, u);
    _db.prepare("DELETE FROM catch_log WHERE guild_id = ? AND user_id = ?").run(g, u);
  });
  tx(guildId, userId);
}

// --- Nuke (clear all data for a guild) ---

function nukeGuild(guildId) {
  const tx = _db.transaction((g) => {
    _db.prepare("DELETE FROM user_inventory WHERE guild_id = ?").run(g);
    _db.prepare("DELETE FROM catch_log WHERE guild_id = ?").run(g);
    _db.prepare("DELETE FROM spawns WHERE guild_id = ?").run(g);
    _db.prepare("DELETE FROM users WHERE guild_id = ?").run(g);
    _db.prepare("DELETE FROM guilds WHERE guild_id = ?").run(g);
  });
  tx(guildId);
}

// --- Stats ---

function getTopCatchers(guildId, limit = 10) {
  const stmt = _db.prepare(
    "SELECT user_id, COUNT(*) as catches FROM catch_log " +
    "WHERE guild_id = ? GROUP BY user_id ORDER BY catches DESC LIMIT ?"
  );
  return stmt.all(guildId, limit);
}

function getCatchStats(guildId) {
  const stmt = _db.prepare(
    "SELECT COUNT(*) as total_catches, COUNT(DISTINCT user_id) as unique_catchers " +
    "FROM catch_log WHERE guild_id = ?"
  );
  return stmt.get(guildId);
}

function close() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

module.exports = {
  init,
  setGuildSetting,
  getGuildSetting,
  getAllGuildSettings,
  deleteGuildSetting,
  upsertUser,
  getUser,
  getActiveSpawn,
  setActiveSpawn,
  clearSpawn,
  addCatch,
  getUserInventory,
  getUserInventoryCount,
  clearUserInventory,
  nukeGuild,
  getTopCatchers,
  getCatchStats,
  close,
  dbPath,
};
