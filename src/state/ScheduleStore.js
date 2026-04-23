'use strict';
/**
 * ScheduleStore — SQLite store for scheduled calls.
 * Uses the same better-sqlite3 DB as SessionStore.
 */

const path = require('path');
const fs   = require('fs');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const logger = require('../utils/logger');

let db = null;

async function init() {
  try {
    const Database = require('better-sqlite3');
    fs.mkdirSync(path.dirname(config.db.sqlitePath), { recursive: true });
    db = new Database(config.db.sqlitePath);
    db.pragma('journal_mode = WAL');
    _createSchema();
    logger.info('ScheduleStore ready');
  } catch (err) {
    logger.error('ScheduleStore init failed', { error: err.message });
    db = null;
  }
}

function _createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_calls (
      id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      token        TEXT UNIQUE NOT NULL,
      name         TEXT NOT NULL,
      phone        TEXT,
      email        TEXT,
      looking_for  TEXT,
      price_range  TEXT,
      scheduled_at TEXT NOT NULL,
      return_url   TEXT,
      status       TEXT NOT NULL DEFAULT 'pending',
      room_id      TEXT,
      created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sched_token  ON scheduled_calls(token);
    CREATE INDEX IF NOT EXISTS idx_sched_time   ON scheduled_calls(scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_sched_status ON scheduled_calls(status);
  `);

  // Migration: add looking_for to existing tables that don't have it yet
  const cols = db.prepare("PRAGMA table_info(scheduled_calls)").all().map(c => c.name);
  if (!cols.includes('looking_for')) {
    db.exec(`ALTER TABLE scheduled_calls ADD COLUMN looking_for TEXT`);
    logger.info('ScheduleStore: migrated — added looking_for column');
  }
  if (!cols.includes('price_range')) {
    db.exec(`ALTER TABLE scheduled_calls ADD COLUMN price_range TEXT`);
    logger.info('ScheduleStore: migrated — added price_range column');
  }
}

/**
 * Create a new scheduled call.
 * Returns the newly created record.
 */
function createSchedule({ name, phone, email, lookingFor, priceRange, scheduledAt, returnUrl }) {
  if (!db) throw new Error('Database not available');
  const token = uuidv4();
  db.prepare(`
    INSERT INTO scheduled_calls (token, name, phone, email, looking_for, price_range, scheduled_at, return_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(token, name, phone || null, email || null, lookingFor || null, priceRange || null, scheduledAt, returnUrl || null);
  return { token, name, phone, email, lookingFor: lookingFor || null, priceRange: priceRange || null, scheduledAt, returnUrl };
}

/**
 * Get a scheduled call by token.
 */
function getByToken(token) {
  if (!db) return null;
  return db.prepare('SELECT * FROM scheduled_calls WHERE token = ?').get(token) || null;
}

/**
 * Update status of a scheduled call.
 */
function updateStatus(token, status, roomId = null) {
  if (!db) return;
  db.prepare(`
    UPDATE scheduled_calls SET status = ?, room_id = ? WHERE token = ?
  `).run(status, roomId, token);
}

/**
 * Get all upcoming schedules (for admin view).
 */
function getUpcoming({ limit = 50 } = {}) {
  if (!db) return [];
  return db.prepare(`
    SELECT * FROM scheduled_calls
    WHERE status = 'pending' AND scheduled_at > datetime('now', '-1 hour')
    ORDER BY scheduled_at ASC LIMIT ?
  `).all(limit);
}

module.exports = { init, createSchedule, getByToken, updateStatus, getUpcoming };
