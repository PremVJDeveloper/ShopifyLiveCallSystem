'use strict';
/**
 * SessionStore — Unified store for call history and logs.
 * Uses DBManager to support both SQLite and Postgres.
 */

const logger = require('../utils/logger');
const db = require('./DBManager');

async function init() {
  logger.info('SessionStore ready');
}

// ─── Call history ─────────────────────────────────────────────

async function saveCallStart({ roomId, userData, adminUserId, adminUsername, adminIp, userUserId }) {
  try {
    const tracking = userData?.tracking || {};
    const sql = `
      INSERT INTO call_history (
        room_id, user_name, user_phone, looking_for, price_range, return_url, 
        admin_user_id, admin_username, admin_ip, user_user_id,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, referrer, full_url
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    `;
    const params = [
      roomId,
      userData?.name || null,
      userData?.phone || null,
      userData?.lookingFor || null,
      userData?.priceRange || null,
      userData?.returnUrl || null,
      adminUserId || null,
      adminUsername || null,
      adminIp || null,
      userUserId || null,
      tracking.utm_source || null,
      tracking.utm_medium || null,
      tracking.utm_campaign || null,
      tracking.utm_content || null,
      tracking.utm_term || null,
      tracking.gclid || null,
      tracking.referrer || null,
      tracking.full_url || null
    ];

    await db.run(sql, params);
    return true;
  } catch (err) {
    logger.error('saveCallStart failed', { error: err.message, roomId });
    return null;
  }
}

async function saveCallEnd({ roomId, reason }) {
  try {
    const nowExpr = db.type === 'postgres' ? 'NOW()' : "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
    
    // Duration calculation
    let durationSql;
    if (db.type === 'postgres') {
      durationSql = `EXTRACT(EPOCH FROM (NOW() - started_at))::integer`;
    } else {
      durationSql = `CAST((julianday('now') - julianday(started_at)) * 86400 AS INTEGER)`;
    }

    const sql = `
      UPDATE call_history
         SET ended_at      = ${nowExpr},
             end_reason    = $1,
             duration_secs = ${durationSql}
       WHERE room_id = $2 AND ended_at IS NULL
    `;
    await db.run(sql, [reason || 'ended', roomId]);
  } catch (err) {
    logger.error('saveCallEnd failed', { error: err.message, roomId });
  }
}

async function getCallHistory({ limit = 50, offset = 0 } = {}) {
  try {
    return await db.query(`
      SELECT id, room_id, user_name, user_phone, looking_for, price_range, return_url,
             admin_username, admin_ip,
             started_at, ended_at, duration_secs, end_reason,
             utm_source, utm_medium, utm_campaign, gclid
        FROM call_history
       ORDER BY started_at DESC
       LIMIT $1 OFFSET $2
    `, [limit, offset]);
  } catch (err) {
    logger.error('getCallHistory failed', { error: err.message });
    return [];
  }
}

// ─── Audit log ────────────────────────────────────────────────

async function logAdminAction({ action, adminUserId, targetRoomId, targetUserId, details }) {
  try {
    await db.run(`
      INSERT INTO admin_audit_log (action, admin_user_id, target_room_id, target_user_id, details)
      VALUES ($1, $2, $3, $4, $5)
    `, [action, adminUserId, targetRoomId, targetUserId, JSON.stringify(details)]);
  } catch (err) {
    logger.error('logAdminAction failed', { error: err.message });
  }
}

module.exports = {
  init,
  saveCallStart,
  saveCallEnd,
  getCallHistory,
  logAdminAction,
  isHealthy: () => db.init().then(() => true).catch(() => false),
  isEnabled: () => true,
};
