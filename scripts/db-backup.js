#!/usr/bin/env node
// scripts/db-backup.js
// Copy the DB file to data/backups/ with a timestamped filename

const path = require('path');
const fs = require('fs');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'brainrot.db');
const OUT_DIR = path.join(__dirname, '..', 'data', 'backups');

function run() {
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const now = new Date().toISOString().replace(/[:.]/g, '-');
    const out = path.join(OUT_DIR, `brainrot-${now}.db`);
    fs.copyFileSync(DB_PATH, out);
    console.log('Backup written to', out);
  } catch (err) {
    console.error('Backup failed:', err);
    process.exit(1);
  }
}

run();
