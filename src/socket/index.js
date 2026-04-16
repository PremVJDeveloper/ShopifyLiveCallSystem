'use strict';

const logger = require('../utils/logger');
const config = require('../config');
const { socketAdminAuth } = require('../middleware/auth');
const roomManager = require('../state/RoomManager');
const queueManager = require('../state/QueueManager');

// Handlers
const callHandler = require('./handlers/callHandler');
const adminHandler = require('./handlers/adminHandler');
const rtcHandler = require('./handlers/rtcHandler');
const chatHandler = require('./handlers/chatHandler');
const productHandler = require('./handlers/productHandler');

/**
 * Initialize Socket.IO — attach middleware, register all handlers,
 * set up disconnect + periodic cleanup.
 */
function setupSocket(io) {
  // ─── Middleware ────────────────────────────────────────────
  io.use(socketAdminAuth);

  // ─── Queue expire callback ────────────────────────────────
  queueManager.onExpire((socketId) => {
    const sock = io.sockets.sockets.get(socketId);
    if (sock) {
      sock.emit('queue-timeout', { message: 'Your queue time has expired. Please try again.' });
    }
    io.to('admin-room').emit('remove-call', { userId: socketId });
  });

  // ─── Connection handler ───────────────────────────────────
  io.on('connection', (socket) => {
    const userId = socket.handshake.query.userId || null;

    logger.info('Socket connected', {
      socketId: socket.id,
      userId,
      isAdmin: !!socket.isAdmin,
      ip: socket.handshake.address,
    });

    socket.connectionTime = Date.now();

    // Acknowledge
    socket.emit('connection-ack', {
      socketId: socket.id,
      timestamp: new Date().toISOString(),
    });

    // Register all event handlers
    callHandler(io, socket);
    adminHandler(io, socket);
    rtcHandler(io, socket);
    chatHandler(io, socket);
    productHandler(io, socket);

    // ─── Health ping ────────────────────────────────────────
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: new Date().toISOString(), serverTime: Date.now() });
    });

    // ─── Error handler ──────────────────────────────────────
    socket.on('error', (error) => {
      logger.error('Socket error', { socketId: socket.id, error: error.message });
    });

    // ─── Disconnect handler ─────────────────────────────────
    socket.on('disconnect', (reason) => {
      const duration = Date.now() - socket.connectionTime;

      logger.info('Socket disconnected', {
        socketId: socket.id,
        userId,
        reason,
        durationMs: duration,
        wasInQueue: queueManager.has(socket.id),
        roomId: roomManager.getRoomIdBySocket(socket.id),
      });

      // Handle room disconnect (mark participant as disconnected, but keep in room for reconnect)
      const roomId = roomManager.getRoomIdBySocket(socket.id);
      if (roomId) {
        const room = roomManager.getRoom(roomId);
        roomManager.onSocketDisconnect(socket.id);

        // Notify peer
        socket.to(roomId).emit('peer-disconnected', {
          socketId: socket.id,
          userId,
          reason,
          timestamp: new Date().toISOString(),
          reconnectPossible: reason === 'transport close' || reason === 'ping timeout',
        });

        // Schedule room cleanup after grace period (if nobody reconnects)
        setTimeout(() => {
          const currentRoom = roomManager.getRoom(roomId);
          if (currentRoom) {
            // Check if ALL participants have null socketIds (nobody connected)
            const allDisconnected = Object.values(currentRoom.participants)
              .every(p => !p.socketId);
            if (allDisconnected) {
              logger.info('All participants disconnected, cleaning room', { roomId });
              if (currentRoom.onCleanup) currentRoom.onCleanup(roomId, 'all-disconnected');
              const SessionStore = require('../state/SessionStore');
              SessionStore.saveCallEnd({ roomId, reason: 'all-disconnected' });
              roomManager.cleanupRoom(roomId, 'all-disconnected');
            }
          }
        }, config.timeouts.reconnectGraceMs);
      }

      // Handle queue disconnect
      if (queueManager.has(socket.id)) {
        // Keep in queue briefly for reconnect, then remove
        setTimeout(() => {
          if (queueManager.has(socket.id)) {
            const entry = queueManager.remove(socket.id);
            if (entry) {
              io.to('admin-room').emit('remove-call', { userId: socket.id });
            }
          }
        }, 15000); // 15 second grace period for queue
      }
    });
  });

  // ─── ngrok header fix ───────────────────────────────────────
  io.engine.on('initial_headers', (headers) => {
    headers['ngrok-skip-browser-warning'] = '1';
  });

  // ─── Periodic cleanup ──────────────────────────────────────
  setInterval(() => {
    roomManager.cleanupStaleRooms();
    queueManager.cleanupStale();

    logger.info('Server state snapshot', {
      queueSize: queueManager.size(),
      activeRooms: roomManager.getAllRooms().length,
      connectedSockets: io.engine.clientsCount,
      uptime: Math.round(process.uptime()),
      memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
    });
  }, config.timeouts.periodicCleanupMs);

  logger.info('Socket.IO initialized');
}

module.exports = setupSocket;
