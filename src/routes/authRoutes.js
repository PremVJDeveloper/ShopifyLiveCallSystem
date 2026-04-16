'use strict';

const express = require('express');
const router = express.Router();
const { login } = require('../middleware/auth');
const { requireAuth } = require('../middleware/auth');
const config = require('../config');
const logger = require('../utils/logger');
const SessionStore = require('../state/SessionStore');

/**
 * POST /api/auth/login
 * Body: { username, password }
 * Returns: { token }
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  logger.info('Admin login attempt', { username, ip: req.ip });
  const result = await login(username, password);

  if (!result.success) {
    logger.warn('Admin login failed', { username, ip: req.ip, reason: result.reason });
    return res.status(401).json({ error: result.reason || 'Invalid credentials' });
  }

  logger.info('Admin login successful', { username, ip: req.ip });
  res.json({ token: result.token, expiresIn: config.auth.jwtExpiresIn });
});

/**
 * GET /api/auth/verify
 * Verifies a JWT token. Returns 200 + payload if valid.
 */
router.get('/verify', requireAuth, (req, res) => {
  res.json({ valid: true, admin: req.admin });
});

/**
 * GET /api/call-history  (admin only)
 */
router.get('/call-history', requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const history = await SessionStore.getCallHistory({ limit, offset });
  res.json({ history, limit, offset });
});

module.exports = router;
