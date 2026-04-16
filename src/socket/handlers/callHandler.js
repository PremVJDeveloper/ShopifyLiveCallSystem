'use strict';

const logger = require('../../utils/logger');
const { sanitizeUserData } = require('../../utils/sanitize');
const queueManager = require('../../state/QueueManager');
const { callRequestLimiter } = require('../../middleware/rateLimiter');

/**
 * Registers call-request and cancel-call socket events.
 */
module.exports = function callHandler(io, socket) {

  // ─── request-call ───────────────────────────────────────────
  socket.on('request-call', (rawUserData) => {
    // Rate-limit
    if (!callRequestLimiter.allow(socket.id)) {
      socket.emit('request-failed', { reason: 'Too many requests. Please wait.' });
      return;
    }

    const userData = sanitizeUserData(rawUserData);
    if (!userData || !userData.name) {
      socket.emit('request-failed', { reason: 'Name is required' });
      return;
    }

    // Extract stable userId from handshake
    const userId = socket.handshake.query.userId || socket.id;
    userData.socketId = socket.id;
    userData.ipAddress = socket.handshake.address;

    // Already in queue?
    if (queueManager.has(socket.id)) {
      const pos = queueManager.getPosition(socket.id);
      socket.emit('queue-status', {
        position: pos,
        message: 'You are already in the queue',
        alreadyInQueue: true,
      });
      return;
    }

    // Also check by userId (reconnect scenario)
    const existing = queueManager.getByUserId(userId);
    if (existing) {
      queueManager.updateSocket(existing.socketId, socket.id);
      const pos = queueManager.getPosition(socket.id);
      socket.emit('queue-status', {
        position: pos,
        message: `You are position #${pos} in the queue`,
        reconnected: true,
      });
      return;
    }

    // Add to queue
    const added = queueManager.add(socket.id, userId, userData);
    if (!added) {
      socket.emit('request-failed', { reason: 'Failed to join queue' });
      return;
    }

    const position = queueManager.getPosition(socket.id);

    // Notify all admins
    io.to('admin-room').emit('new-call', {
      socketId: socket.id,
      userId,
      userData,
      timestamp: new Date().toISOString(),
      status: 'waiting',
    });

    // Acknowledge to user
    socket.emit('queue-status', {
      position,
      message: position === 1
        ? 'You are next in line for a support agent'
        : `You are position #${position} in the queue`,
      estimatedWait: Math.max(1, position - 1) * 2,
    });

    logger.info('Call requested', { socketId: socket.id, userId, name: userData.name, position });
  });

  // ─── cancel-call ────────────────────────────────────────────
  socket.on('cancel-call', () => {
    const entry = queueManager.remove(socket.id);
    if (entry) {
      io.to('admin-room').emit('remove-call', { userId: socket.id });
      socket.emit('call-canceled', { message: 'Call request canceled' });
      logger.info('Call canceled by user', { socketId: socket.id, name: entry.userData?.name });
    }
  });
};
