-- 001_create_schema.sql
-- Idempotent creation of the core schema used by the bot.

CREATE TABLE IF NOT EXISTS guilds (
  guild_id   TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT,
  PRIMARY KEY (guild_id, key)
);

CREATE TABLE IF NOT EXISTS users (
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  username   TEXT,
  avatar     TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now')),
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS user_inventory (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  rot_name   TEXT NOT NULL,
  caught_at  INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (guild_id, user_id) REFERENCES users(guild_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS spawns (
  guild_id   TEXT PRIMARY KEY,
  rot_name   TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS catch_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  rot_name   TEXT NOT NULL,
  caught_at  INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_user_inventory_guild ON user_inventory(guild_id);
CREATE INDEX IF NOT EXISTS idx_user_inventory_user  ON user_inventory(user_id);
CREATE INDEX IF NOT EXISTS idx_catch_log_guild      ON catch_log(guild_id);
CREATE INDEX IF NOT EXISTS idx_catch_log_user       ON catch_log(user_id);
