#!/usr/bin/env node
// scripts/db-migrate.js
// Runs SQL migrations from the migrations/ directory against the configured DB.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'brainrot.db');
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

function run() {
  console.log('Running DB migrations against', DB_PATH);
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version));

  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const version = file;
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log('Applying', file);
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare(`INSERT INTO schema_migrations (version, applied_at) VALUES (?, strftime('%s','now'))`).run(version);
    });
    try {
      tx();
      console.log('Applied', file);
    } catch (err) {
      console.error('Failed to apply', file, err);
      process.exit(1);
    }
  }
  console.log('Migrations complete.');
  db.close();
}

run();
