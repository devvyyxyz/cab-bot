// src/logger.js
// Lightweight structured logger. Replaces bare console.log calls with
// timestamped, level-tagged output. Falls back to console if needed.
//
// Usage:
//   const log = require("./logger");
//   log.info("Bot online");
//   log.warn("Emoji load failed");
//   log.error("Interaction error", err);

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const COLORS = {
  error: "\x1b[31m",
  warn: "\x1b[33m",
  info: "\x1b[36m",
  debug: "\x1b[90m",
};
const RESET = "\x1b[0m";

const threshold = LEVELS[process.env.LOG_LEVEL || "info"] ?? LEVELS.info;

function format(levelName, msg, meta) {
  const ts = new Date().toISOString();
  const tag = `[${ts}] [${levelName.toUpperCase()}]`;
  const colored = COLORS[levelName] ? COLORS[levelName] + tag + RESET : tag;
  const line = `${colored} ${msg}`;
  if (meta !== undefined) {
    try {
      return `${line} ${typeof meta === "string" ? meta : JSON.stringify(meta)}`;
    } catch {
      return `${line} ${String(meta)}`;
    }
  }
  return line;
}

function log(levelName, msg, meta) {
  if (LEVELS[levelName] > threshold) return;
  const fn = levelName === "error" ? console.error : levelName === "warn" ? console.warn : console.log;
  fn(format(levelName, msg, meta));
}

module.exports = {
  error: (msg, meta) => log("error", msg, meta),
  warn: (msg, meta) => log("warn", msg, meta),
  info: (msg, meta) => log("info", msg, meta),
  debug: (msg, meta) => log("debug", msg, meta),
};
