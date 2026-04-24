'use strict';
/**
 * ScheduleStore — Unified store for scheduled calls.
 * Uses DBManager to support both SQLite and Postgres.
 */

const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const db = require('./DBManager');

async function init() {
  // DBManager is initialized centrally in server.js
  logger.info('ScheduleStore ready');
}

/**
 * Create a new scheduled call.
 */
async function createSchedule({ name, phone, email, lookingFor, priceRange, scheduledAt, returnUrl, tracking = {} }) {
  const token = uuidv4();
  const sql = `
    INSERT INTO scheduled_calls (
      token, name, phone, email, looking_for, price_range, scheduled_at, return_url,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, referrer, full_url
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
  `;
  
  const params = [
    token, name, phone || null, email || null, lookingFor || null, priceRange || null, scheduledAt, returnUrl || null,
    tracking.utm_source || null, tracking.utm_medium || null, tracking.utm_campaign || null,
    tracking.utm_content || null, tracking.utm_term || null, tracking.gclid || null,
    tracking.referrer || null, tracking.full_url || null
  ];

  await db.run(sql, params);
  return { token, name, phone, email, lookingFor, priceRange, scheduledAt, returnUrl };
}

async function getByToken(token) {
  return await db.getOne('SELECT * FROM scheduled_calls WHERE token = $1', [token]);
}

async function updateStatus(token, status, roomId = null) {
  await db.run(
    'UPDATE scheduled_calls SET status = $1, room_id = $2 WHERE token = $3',
    [status, roomId, token]
  );
}

async function getUpcoming({ limit = 50 } = {}) {
  // SQLite and Postgres have slightly different syntax for "now"
  const nowFilter = db.type === 'postgres' 
    ? "scheduled_at > NOW() - INTERVAL '1 hour'"
    : "scheduled_at > datetime('now', '-1 hour')";

  return await db.query(`
    SELECT * FROM scheduled_calls
    WHERE status = 'pending' AND ${nowFilter}
    ORDER BY scheduled_at ASC LIMIT $1
  `, [limit]);
}

module.exports = { init, createSchedule, getByToken, updateStatus, getUpcoming };
