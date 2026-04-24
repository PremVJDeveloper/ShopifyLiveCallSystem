'use strict';
/**
 * adminRoutes.js — Admin-only data endpoints.
 */
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const SessionStore = require('../state/SessionStore');

// Guard all routes in this file with Admin JWT auth
router.use(requireAuth);

/**
 * GET /api/admin/history
 * Returns the full call history including admin details and IPs.
 */
router.get('/history', async (req, res) => {
  try {
    const history = await SessionStore.getCallHistory({ limit: 200 });
    return res.json({ history });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch history' });
  }
});

module.exports = router;
