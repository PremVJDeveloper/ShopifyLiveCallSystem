'use strict';

require('dotenv').config();

const path = require('path');

const config = {
  server: {
    port: parseInt(process.env.PORT) || 3000,
    env: process.env.NODE_ENV || 'development',
    isDev: (process.env.NODE_ENV || 'development') === 'development',
  },

  auth: {
    adminUsername: process.env.ADMIN_USERNAME || 'admin',
    adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || null,
    jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-in-production',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },

  // ICE server config — served to clients via /api/ice-servers (never in client JS)
  webrtc: {
    iceServers: [
      // Google public STUN (always included as fast first-try)
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },

      // TURN relay — requires TURN_USERNAME + TURN_CREDENTIAL in .env
      ...(process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL ? (() => {
        // Use TURN_URL if set (self-hosted coturn on AWS)
        // Otherwise fall back to Metered.ca public relay
        const base = process.env.TURN_URL
          ? process.env.TURN_URL          // e.g. turn:1.2.3.4:3478
          : null;

        const creds = {
          username:   process.env.TURN_USERNAME,
          credential: process.env.TURN_CREDENTIAL,
        };

        if (base) {
          // Self-hosted coturn: single server, UDP + TCP + TLS variants
          const host = base.replace(/^turns?:/, '').split(':')[0];
          return [
            { urls: `turn:${host}:3478`,          ...creds },
            { urls: `turn:${host}:3478?transport=tcp`, ...creds },
            { urls: `turns:${host}:5349`,         ...creds },
          ];
        } else {
          // Metered.ca fallback
          return [
            { urls: 'turn:relay.metered.ca:80',                  ...creds },
            { urls: 'turn:relay.metered.ca:443',                 ...creds },
            { urls: 'turns:relay.metered.ca:443?transport=tcp',  ...creds },
          ];
        }
      })() : []),
    ],
  },

  // Database configuration
  db: {
    databaseUrl: process.env.DATABASE_URL || null, // e.g. postgres://...
    sqlitePath: process.env.SQLITE_DB_PATH
      ? path.resolve(process.env.SQLITE_DB_PATH)
      : path.join(__dirname, '../../data/livecall.db'),
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },

  // Room / queue timeouts
  timeouts: {
    queueEntryMs:         30 * 60 * 1000,  // 30 min in queue
    connectionHandshakeMs: 90 * 1000,       // 90 sec to establish WebRTC
    reconnectGraceMs:      60 * 1000,       // 60 sec reconnect window after disconnect
    emptyRoomCleanupMs:    30 * 1000,       // 30 sec before cleaning empty room
    periodicCleanupMs:  5 * 60 * 1000,     // Cleanup interval
  },

  // Socket.IO settings
  socketio: {
    pingTimeout:    60000,
    pingInterval:   25000,
    connectTimeout: 45000,
  },
};

// Validate critical production settings
if (config.server.env === 'production') {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    console.error('[CONFIG] ⚠ JWT_SECRET is weak or missing. Set a strong secret in .env');
  }
  if (!config.auth.adminPasswordHash) {
    console.error('[CONFIG] ⚠ ADMIN_PASSWORD_HASH is not set. Admin login will not work.');
  }
  if (config.webrtc.iceServers.length <= 2) {
    console.warn('[CONFIG] ⚠ TURN credentials not set. Calls may fail on restricted networks.');
  }
}

module.exports = config;
