'use strict';

const { Pool } = require('pg');
const Database = require('better-sqlite3');
const config = require('../config');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

class DBManager {
  constructor() {
    this.type = config.db.databaseUrl ? 'postgres' : 'sqlite';
    this.pool = null;   // for Postgres
    this.sqlite = null; // for SQLite
  }

  async init() {
    if (this.type === 'postgres') {
      try {
        this.pool = new Pool({
          connectionString: config.db.databaseUrl,
          ssl: config.db.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false }
        });
        // Test connection
        const client = await this.pool.connect();
        logger.info('PostgreSQL connected', { url: config.db.databaseUrl.split('@')[1] });
        client.release();
        await this._createSchema();
      } catch (err) {
        logger.error('PostgreSQL connection failed', { error: err.message });
        throw err;
      }
    } else {
      try {
        const dbPath = config.db.sqlitePath;
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        this.sqlite = new Database(dbPath);
        this.sqlite.pragma('journal_mode = WAL');
        this.sqlite.pragma('foreign_keys = ON');
        logger.info('SQLite connected', { path: dbPath });
        await this._createSchema();
      } catch (err) {
        logger.error('SQLite connection failed', { error: err.message });
        throw err;
      }
    }
  }

  async _createSchema() {
    if (this.type === 'postgres') {
      // Postgres Schema
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS scheduled_calls (
          id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          token        TEXT UNIQUE NOT NULL,
          name         TEXT NOT NULL,
          phone        TEXT,
          email        TEXT,
          looking_for  TEXT,
          price_range  TEXT,
          scheduled_at TIMESTAMPTZ NOT NULL,
          return_url   TEXT,
          status       TEXT NOT NULL DEFAULT 'pending',
          room_id      TEXT,
          utm_source   TEXT,
          utm_medium   TEXT,
          utm_campaign TEXT,
          utm_content  TEXT,
          utm_term     TEXT,
          gclid        TEXT,
          referrer     TEXT,
          full_url     TEXT,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS call_history (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          room_id       TEXT NOT NULL,
          user_name     TEXT,
          user_phone    TEXT,
          looking_for   TEXT,
          price_range   TEXT,
          return_url    TEXT,
          admin_user_id TEXT,
          admin_username TEXT,
          admin_ip      TEXT,
          user_user_id  TEXT,
          utm_source    TEXT,
          utm_medium    TEXT,
          utm_campaign  TEXT,
          utm_content   TEXT,
          utm_term      TEXT,
          gclid         TEXT,
          referrer      TEXT,
          full_url      TEXT,
          started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ended_at      TIMESTAMPTZ,
          duration_secs INTEGER,
          end_reason    TEXT,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
    } else {
      // SQLite Schema
      this.sqlite.exec(`
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
          utm_source   TEXT,
          utm_medium   TEXT,
          utm_campaign TEXT,
          utm_content  TEXT,
          utm_term     TEXT,
          gclid        TEXT,
          referrer     TEXT,
          full_url     TEXT,
          created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );

        CREATE TABLE IF NOT EXISTS call_history (
          id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
          room_id       TEXT NOT NULL,
          user_name     TEXT,
          user_phone    TEXT,
          looking_for   TEXT,
          price_range   TEXT,
          return_url    TEXT,
          admin_user_id TEXT,
          admin_username TEXT,
          admin_ip      TEXT,
          user_user_id  TEXT,
          utm_source    TEXT,
          utm_medium    TEXT,
          utm_campaign  TEXT,
          utm_content   TEXT,
          utm_term      TEXT,
          gclid         TEXT,
          referrer      TEXT,
          full_url      TEXT,
          started_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          ended_at      TEXT,
          duration_secs INTEGER,
          end_reason    TEXT,
          created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );
      `);
    }
  }

  async query(text, params) {
    if (this.type === 'postgres') {
      const res = await this.pool.query(text, params);
      return res.rows;
    } else {
      // Convert $1, $2 to ? for SQLite
      const sql = text.replace(/\$\d+/g, '?');
      const stmt = this.sqlite.prepare(sql);
      if (sql.trim().toUpperCase().startsWith('SELECT')) {
        return stmt.all(params);
      } else {
        const info = stmt.run(params);
        return info;
      }
    }
  }

  async getOne(text, params) {
    const rows = await this.query(text, params);
    return rows.length > 0 ? rows[0] : null;
  }

  async run(text, params) {
    return this.query(text, params);
  }
}

module.exports = new DBManager();
