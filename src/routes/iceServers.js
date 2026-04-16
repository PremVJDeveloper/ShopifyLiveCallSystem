'use strict';

const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');

/**
 * Generate short-lived TURN credentials using coturn's use-auth-secret mechanism.
 *
 * coturn with use-auth-secret expects:
 *   username  = "{unix_expiry_timestamp}:{arbitrary_user_id}"
 *   password  = base64( HMAC-SHA1( turn_secret, username ) )
 *
 * These credentials are valid for `ttlSeconds` (we use 24h).
 */
function generateTurnCredentials(secret, ttlSeconds = 86400) {
  const expiry   = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = `${expiry}:vaama`;
  const password = crypto
    .createHmac('sha1', secret)
    .update(username)
    .digest('base64');
  return { username, credential: password };
}

/**
 * GET /api/ice-servers
 * Returns ICE + TURN config with freshly-generated time-based credentials.
 * Must be called each session (credentials expire after 24h).
 */
router.get('/', (req, res) => {
  const turnSecret = process.env.TURN_CREDENTIAL; // the static-auth-secret value
  const turnHost   = process.env.TURN_URL
    ? process.env.TURN_URL.replace(/^turns?:/, '').split(':')[0]
    : null;

  let iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  if (turnHost && turnSecret) {
    const creds = generateTurnCredentials(turnSecret);
    iceServers = [
      ...iceServers,
      // UDP (fastest, works on most networks)
      { urls: `turn:${turnHost}:3478`,             ...creds },
      // TCP (fallback for mobile 4G / strict firewalls that block UDP)
      { urls: `turn:${turnHost}:3478?transport=tcp`, ...creds },
      // TLS (most reliable fallback — works even on very restricted networks)
      { urls: `turns:${turnHost}:5349`,            ...creds },
      { urls: `turns:${turnHost}:5349?transport=tcp`, ...creds },
    ];
  }

  res.json({
    iceServers,
    timestamp:  new Date().toISOString(),
    expiresIn:  86400,
  });
});

module.exports = router;

