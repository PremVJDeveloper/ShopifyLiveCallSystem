'use strict';

const express = require('express');
const router = express.Router();
const roomManager = require('../state/RoomManager');
const queueManager = require('../state/QueueManager');
const SessionStore = require('../state/SessionStore');
const logger = require('../utils/logger');

/**
 * GET /health
 * Returns current server health + stats.
 */
router.get('/', (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    memory: process.memoryUsage(),
    queue: { size: queueManager.size() },
    rooms: { active: roomManager.getAllRooms().length },
    db: { connected: SessionStore.isEnabled() },
    version: process.env.npm_package_version || '1.0.0',
    node: process.version,
  };
  res.json(health);
});

/**
 * GET /metrics  (Prometheus-style text format for monitoring)
 */
router.get('/metrics', (req, res) => {
  const rooms = roomManager.getAllRooms().length;
  const queue = queueManager.size();
  const uptime = process.uptime();
  const mem = process.memoryUsage();

  res.set('Content-Type', 'text/plain');
  res.send([
    `# HELP livecall_rooms_active Number of active call rooms`,
    `livecall_rooms_active ${rooms}`,
    `# HELP livecall_queue_size Number of users waiting in queue`,
    `livecall_queue_size ${queue}`,
    `# HELP process_uptime_seconds Server uptime in seconds`,
    `process_uptime_seconds ${Math.round(uptime)}`,
    `# HELP process_heap_used_bytes Heap memory used`,
    `process_heap_used_bytes ${mem.heapUsed}`,
    '',
  ].join('\n'));
});

module.exports = router;
