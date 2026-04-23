'use strict';

const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../utils/logger');

let db = null;

/**
 * Initialize SQLite database.
 * Creates the data directory and schema if needed.
 * Synchronous (better-sqlite3 is sync by design) — wrapped in async for API compat.
 */
async function init() {
  try {
    const Database = require('better-sqlite3');
    const dbPath = config.db.sqlitePath;

    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');   // better concurrent read performance
    db.pragma('foreign_keys = ON');

    _createSchema();
    logger.info('SQLite database ready', { path: dbPath });
  } catch (err) {
    logger.error('SQLite init failed', { error: err.message });
    logger.warn('Continuing without database — call history will not be persisted.');
    db = null;
  }
}

function _createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS call_history (
      id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      room_id       TEXT NOT NULL,
      user_name      TEXT,
      user_phone     TEXT,
      looking_for    TEXT,
      price_range    TEXT,
      return_url     TEXT,
      admin_user_id  TEXT,
      admin_username TEXT,
      admin_ip       TEXT,
      user_user_id   TEXT,
      started_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      ended_at      TEXT,
      duration_secs INTEGER,
      end_reason    TEXT,
      created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE INDEX IF NOT EXISTS idx_call_history_room  ON call_history(room_id);
    CREATE INDEX IF NOT EXISTS idx_call_history_start ON call_history(started_at DESC);

    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      action         TEXT NOT NULL,
      admin_user_id  TEXT,
      target_room_id TEXT,
      target_user_id TEXT,
      details        TEXT,
      created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_log(created_at DESC);
  `);
}

// ─── Call history ─────────────────────────────────────────────

async function saveCallStart({ roomId, userData, adminUserId, adminUsername, adminIp, userUserId }) {
  if (!db) return null;
  try {
    const stmt = db.prepare(`
      INSERT INTO call_history (room_id, user_name, user_phone, looking_for, price_range, return_url, admin_user_id, admin_username, admin_ip, user_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      roomId,
      userData?.name || null,
      userData?.phone || null,
      userData?.lookingFor || null,
      userData?.priceRange || null,
      userData?.returnUrl || null,
      adminUserId || null,
      adminUsername || null,
      adminIp || null,
      userUserId || null
    );
    return info.lastInsertRowid;
  } catch (err) {
    logger.error('saveCallStart failed', { error: err.message, roomId });
    return null;
  }
}

async function saveCallEnd({ roomId, reason }) {
  if (!db) return;
  try {
    db.prepare(`
      UPDATE call_history
         SET ended_at      = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             end_reason    = ?,
             duration_secs = CAST(
               (julianday('now') - julianday(started_at)) * 86400
             AS INTEGER)
       WHERE room_id = ? AND ended_at IS NULL
    `).run(reason || 'ended', roomId);
  } catch (err) {
    logger.error('saveCallEnd failed', { error: err.message, roomId });
  }
}

async function getCallHistory({ limit = 50, offset = 0 } = {}) {
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT id, room_id, user_name, user_phone, looking_for, price_range, return_url,
             admin_username, admin_ip,
             started_at, ended_at, duration_secs, end_reason
        FROM call_history
       ORDER BY started_at DESC
       LIMIT ? OFFSET ?
    `).all(limit, offset);
  } catch (err) {
    logger.error('getCallHistory failed', { error: err.message });
    return [];
  }
}

// ─── Audit log ────────────────────────────────────────────────

async function logAdminAction({ action, adminUserId, targetRoomId, targetUserId, details }) {
  if (!db) return;
  try {
    db.prepare(`
      INSERT INTO admin_audit_log (action, admin_user_id, target_room_id, target_user_id, details)
      VALUES (?, ?, ?, ?, ?)
    `).run(action, adminUserId, targetRoomId, targetUserId, JSON.stringify(details));
  } catch (err) {
    logger.error('logAdminAction failed', { error: err.message });
  }
}

// ─── Health ──────────────────────────────────────────────────

async function isHealthy() {
  if (!db) return false;
  try { db.prepare('SELECT 1').get(); return true; }
  catch { return false; }
}

module.exports = {
  init,
  saveCallStart,
  saveCallEnd,
  getCallHistory,
  logAdminAction,
  isHealthy,
  isEnabled: () => !!db,
};
