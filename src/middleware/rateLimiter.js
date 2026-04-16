'use strict';

const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

/**
 * HTTP rate limiter for call-request endpoints.
 * 10 requests per minute per IP.
 */
const httpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('HTTP rate limit exceeded', { ip: req.ip, path: req.path });
    res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
  },
});

/**
 * Socket event rate limiter.
 * Usage:
 *   const limiter = socketRateLimiter({ maxPerWindow: 3, windowMs: 60000 });
 *   if (!limiter.allow(socket.id)) { socket.emit('rate-limited', ...); return; }
 */
function socketRateLimiter({ maxPerWindow = 5, windowMs = 60000 } = {}) {
  const hits = new Map(); // socketId → { count, resetAt }

  // Periodic cleanup to avoid map growth
  setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of hits) {
      if (now > entry.resetAt) hits.delete(id);
    }
  }, windowMs * 2);

  return {
    allow(socketId) {
      const now = Date.now();
      const entry = hits.get(socketId);

      if (!entry || now > entry.resetAt) {
        hits.set(socketId, { count: 1, resetAt: now + windowMs });
        return true;
      }

      if (entry.count >= maxPerWindow) {
        logger.warn('Socket rate limit exceeded', { socketId });
        return false;
      }

      entry.count++;
      return true;
    },
    reset(socketId) {
      hits.delete(socketId);
    },
  };
}

// Pre-built limiters for specific events
const callRequestLimiter = socketRateLimiter({ maxPerWindow: 3, windowMs: 60000 });
const chatMessageLimiter = socketRateLimiter({ maxPerWindow: 30, windowMs: 10000 });

module.exports = { httpLimiter, socketRateLimiter, callRequestLimiter, chatMessageLimiter };
