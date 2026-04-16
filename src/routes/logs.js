'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const logger = require('../utils/logger');

const logsDir = path.join(__dirname, '../../logs');

/**
 * GET /api/logs — Returns last N lines of today's log (admin only).
 */
router.get('/', requireAuth, (req, res) => {
  const lines = Math.min(parseInt(req.query.lines) || 100, 500);
  const date = new Date().toISOString().split('T')[0];
  const logFile = path.join(logsDir, `server-${date}.log`);

  try {
    if (!fs.existsSync(logFile)) {
      return res.json({ logs: [], total: 0, message: 'No log file for today yet' });
    }
    const content = fs.readFileSync(logFile, 'utf8');
    const all = content.split('\n').filter(l => l.trim());
    const recent = all.slice(-lines);
    res.json({ logs: recent.map(l => { try { return JSON.parse(l); } catch { return l; } }), total: all.length });
  } catch (err) {
    logger.error('Failed to read logs', { error: err.message });
    res.status(500).json({ error: 'Failed to read log file' });
  }
});

/**
 * GET /api/logs/download — Download today's log file.
 */
router.get('/download', requireAuth, (req, res) => {
  const date = new Date().toISOString().split('T')[0];
  const logFile = path.join(logsDir, `server-${date}.log`);
  if (!fs.existsSync(logFile)) return res.status(404).json({ error: 'Log file not found' });
  res.download(logFile, `server-${date}.log`);
});

module.exports = router;
