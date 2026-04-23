'use strict';

const logger = require('../../utils/logger');
const queueManager = require('../../state/QueueManager');
const roomManager = require('../../state/RoomManager');
const SessionStore = require('../../state/SessionStore');
const { isValidRoomId } = require('../../utils/sanitize');

/**
 * Registers admin-specific socket events.
 * Guards admin events — only sockets with socket.isAdmin === true can use them.
 */
module.exports = function adminHandler(io, socket) {

  function requireAdmin() {
    if (!socket.isAdmin) {
      socket.emit('error-message', { error: 'Admin authentication required' });
      return false;
    }
    return true;
  }

  // ─── admin-join ─────────────────────────────────────────────
  socket.on('admin-join', () => {
    if (!requireAdmin()) return;

    socket.join('admin-room');

    socket.emit('admin-connected', {
      socketId: socket.id,
      waitingCount: queueManager.size(),
      timestamp: new Date().toISOString(),
    });

    // Send all waiting users
    const entries = queueManager.getAll();
    entries.forEach(entry => {
      socket.emit('new-call', entry);
    });

    // Send active rooms
    socket.emit('active-rooms', {
      count: roomManager.getAllRooms().length,
      rooms: roomManager.serializeAll(),
    });

    logger.info('Admin joined', { adminId: socket.id });
  });

  // ─── accept-call ────────────────────────────────────────────
  socket.on('accept-call', ({ userId: queueSocketId }) => {
    if (!requireAdmin()) return;

    const entry = queueManager.get(queueSocketId);
    if (!entry) {
      socket.emit('accept-failed', { reason: 'User no longer waiting', userId: queueSocketId });
      return;
    }

    // Remove from queue
    queueManager.remove(queueSocketId);

    const adminUserId = socket.handshake.query.userId || socket.id;
    const adminUsername = socket.adminPayload?.username || 'Support Agent';
    const adminIp = socket.handshake.address || 'unknown';
    const userUserId = entry.userId || queueSocketId;
    const userData = entry.userData;

    // Create room with stable userIds
    const roomId = roomManager.createRoom({
      adminUserId,
      adminSocketId: socket.id,
      adminName: socket.adminPayload?.username || 'Support Agent',
      userId: userUserId,
      userSocketId: queueSocketId,
      userName: userData?.name || 'Customer',
      userData,
    });

    // Join both sockets to the Socket.IO room
    const adminSocket = io.sockets.sockets.get(socket.id);
    const userSocket = io.sockets.sockets.get(queueSocketId);
    if (adminSocket) adminSocket.join(roomId);
    if (userSocket) userSocket.join(roomId);

    // Set handshake timeout
    roomManager.setHandshakeTimeout(roomId, (rid) => {
      io.to(rid).emit('connection-timeout', {
        roomId: rid,
        message: 'Connection timeout. Please try again.',
      });
      roomManager.cleanupRoom(rid, 'handshake-timeout');
    });

    // Register cleanup callback for admin notifications
    roomManager.registerCleanupCallback(roomId, (rid, reason) => {
      io.to('admin-room').emit('room-ended', { roomId: rid, reason });
    });

    // Notify user
    if (userSocket) {
      userSocket.emit('call-accepted', {
        roomId,
        adminId: socket.id,
        userId: userUserId,
        userData,
        timestamp: new Date().toISOString(),
      });
    }

    // Notify admin
    socket.emit('call-accepted-admin', {
      roomId,
      userId: queueSocketId,
      adminUserId,
      userUserId,
      userData,
      timestamp: new Date().toISOString(),
    });

    // Notify other admins
    io.to('admin-room').emit('remove-call', { userId: queueSocketId });
    io.to('admin-room').emit('room-created', {
      roomId,
      room: roomManager.serializeRoom(roomId),
    });

    // Save to database
    SessionStore.saveCallStart({
      roomId,
      userData,
      adminUserId,
      adminUsername,
      adminIp,
      userUserId,
    });
    SessionStore.logAdminAction({
      action: 'accept-call',
      adminUserId,
      targetRoomId: roomId,
      targetUserId: userUserId,
      details: { userName: userData?.name, adminUsername, adminIp },
    });

    logger.info('Call accepted', { roomId, adminId: socket.id, userSocketId: queueSocketId });
  });

  // ─── get-queue ──────────────────────────────────────────────
  socket.on('get-queue', () => {
    if (!requireAdmin()) return;
    socket.emit('queue-info', {
      count: queueManager.size(),
      users: queueManager.getAll(),
      timestamp: new Date().toISOString(),
    });
  });

  // ─── get-active-rooms ───────────────────────────────────────
  socket.on('get-active-rooms', () => {
    if (!requireAdmin()) return;
    socket.emit('active-rooms', {
      count: roomManager.getAllRooms().length,
      rooms: roomManager.serializeAll(),
    });
  });

  // ─── force-disconnect (admin power) ─────────────────────────
  socket.on('force-disconnect', ({ roomId }) => {
    if (!requireAdmin()) return;
    if (!isValidRoomId(roomId)) return;

    const room = roomManager.getRoom(roomId);
    if (!room) {
      socket.emit('error-message', { error: 'Room not found' });
      return;
    }

    io.to(roomId).emit('call-ended', {
      by: 'admin',
      reason: 'Disconnected by administrator',
    });

    SessionStore.saveCallEnd({ roomId, reason: 'force-disconnect' });
    SessionStore.logAdminAction({
      action: 'force-disconnect',
      adminUserId: socket.handshake.query.userId || socket.id,
      targetRoomId: roomId,
      details: {},
    });

    if (room.onCleanup) room.onCleanup(roomId, 'force-disconnect');
    roomManager.cleanupRoom(roomId, 'force-disconnect');

    logger.info('Admin force-disconnected room', { roomId, adminId: socket.id });
  });

  // ─── get-room-details ──────────────────────────────────────
  socket.on('get-room-details', ({ roomId }) => {
    if (!requireAdmin()) return;
    const data = roomManager.serializeRoom(roomId);
    socket.emit('room-info', data || { roomId, error: 'Room not found' });
  });
};
