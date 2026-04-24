'use strict';
/**
 * scheduleRoutes.js — POST /api/schedule, GET /join/:token
 */
const express      = require('express');
const router       = express.Router();
const ScheduleStore = require('../state/ScheduleStore');
const mailer       = require('../utils/mailer');
const logger       = require('../utils/logger');

// ── POST /api/schedule ───────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { name, phone, email, lookingFor, priceRange, scheduledAt, returnUrl, tracking } = req.body;

    // Validate
    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!scheduledAt || isNaN(new Date(scheduledAt))) {
      return res.status(400).json({ error: 'Invalid scheduled time' });
    }

    // Must be in the future (allow up to 1 min grace for network delay)
    const dt = new Date(scheduledAt);
    if (dt < new Date(Date.now() - 60_000)) {
      return res.status(400).json({ error: 'Scheduled time must be in the future' });
    }

    // Must be within next 7 days
    if (dt > new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)) {
      return res.status(400).json({ error: 'Cannot schedule more than 7 days ahead' });
    }

    const record = await ScheduleStore.createSchedule({
      name: name.trim(),
      phone: phone?.trim() || null,
      email: email?.trim() || null,
      lookingFor: lookingFor?.trim() || null,
      priceRange: priceRange?.trim() || null,
      scheduledAt: dt.toISOString(),
      returnUrl: returnUrl || null,
      tracking: tracking || {}, // Capture tracking data
    });

    const joinUrl = `${req.protocol}://${req.get('host')}/join/${record.token}`;

    logger.info('Call scheduled', { name: record.name, scheduledAt: record.scheduledAt, token: record.token });

    // Fire emails in background (don't block response)
    Promise.all([
      record.email
        ? mailer.sendCustomerConfirmation({ 
            name: record.name, email: record.email, scheduledAt: record.scheduledAt, joinUrl, 
            lookingFor: record.lookingFor || record.looking_for, 
            priceRange: record.priceRange || record.price_range 
          })
        : Promise.resolve(),
      mailer.sendAdminNotification({ 
        name: record.name, phone: record.phone, email: record.email, scheduledAt: record.scheduledAt, joinUrl, 
        lookingFor: record.lookingFor || record.looking_for,
        priceRange: record.priceRange || record.price_range 
      }),
    ]).catch(err => logger.error('Email send error', { error: err.message }));

    return res.json({ token: record.token, joinUrl, scheduledAt: record.scheduledAt });

  } catch (err) {
    logger.error('Schedule creation failed', { error: err.message });
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/schedule/upcoming (admin) ──────────────────────────
router.get('/upcoming', async (req, res) => {
  try {
    const rows = await ScheduleStore.getUpcoming();
    const base = `${req.protocol}://${req.get('host')}`;
    const result = rows.map(r => ({
      ...r,
      joinUrl: `${base}/join/${r.token}`,
    }));
    return res.json({ schedules: result });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
