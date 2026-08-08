#!/usr/bin/env node
// scripts/db-vacuum.js
// Run VACUUM and WAL checkpoint on the DB

const path = require('path');
const Database = require('better-sqlite3');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'brainrot.db');

function run() {
  console.log('Vacuuming DB at', DB_PATH);
  const db = new Database(DB_PATH);
  try {
    db.exec('PRAGMA wal_checkpoint(FULL)');
    db.exec('VACUUM');
    console.log('VACUUM complete');
  } catch (err) {
    console.error('VACUUM failed:', err);
    process.exit(1);
  } finally {
    db.close();
  }
}

run();
