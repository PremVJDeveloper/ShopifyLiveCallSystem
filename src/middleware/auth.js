'use strict';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Express middleware — verifies JWT in Authorization header or `?token=` query.
 * Attaches `req.admin = { username }` on success.
 */
function requireAuth(req, res, next) {
  const token =
    (req.headers.authorization || '').replace('Bearer ', '') ||
    req.query.token || '';

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const payload = jwt.verify(token, config.auth.jwtSecret);
    req.admin = payload;
    next();
  } catch (err) {
    logger.warn('JWT verification failed', { error: err.message, ip: req.ip });
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Verify admin credentials and return a signed JWT.
 * Called by POST /api/auth/login.
 */
async function login(username, password) {
  if (username !== config.auth.adminUsername) {
    return { success: false, reason: 'Invalid credentials' };
  }

  if (!config.auth.adminPasswordHash) {
    // Dev-mode fallback: accept literal password "admin" if no hash set
    if (config.server.isDev && password === 'admin') {
      logger.warn('Dev-mode admin login with default password. Set ADMIN_PASSWORD_HASH in .env!');
      return { success: true, token: _sign(username) };
    }
    return { success: false, reason: 'Admin password not configured on server' };
  }

  const valid = await bcrypt.compare(password, config.auth.adminPasswordHash);
  if (!valid) {
    return { success: false, reason: 'Invalid credentials' };
  }

  return { success: true, token: _sign(username) };
}

/**
 * Socket.IO middleware — extracts JWT from handshake and marks socket as admin.
 */
function socketAdminAuth(socket, next) {
  if (!socket || !socket.handshake) return next();

  const token =
    (socket.handshake.auth && socket.handshake.auth.token) ||
    (socket.handshake.query && socket.handshake.query.token) || '';

  if (!token) return next(); // non-admin socket — that's fine

  try {
    const payload = jwt.verify(token, config.auth.jwtSecret);
    socket.adminPayload = payload;
    socket.isAdmin = true;
  } catch {
    // Invalid token — treat as non-admin rather than disconnect
    socket.isAdmin = false;
  }
  next();
}

function _sign(username) {
  return jwt.sign(
    { username, role: 'admin' },
    config.auth.jwtSecret,
    { expiresIn: config.auth.jwtExpiresIn }
  );
}

module.exports = { requireAuth, login, socketAdminAuth };
