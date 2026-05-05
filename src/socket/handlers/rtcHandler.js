'use strict';

const logger = require('../../utils/logger');
const roomManager = require('../../state/RoomManager');
const SessionStore = require('../../state/SessionStore');
const { isValidRoomId, isValidUserId } = require('../../utils/sanitize');

/**
 * WebRTC signaling handler — offer, answer, ICE candidates, reconnection.
 *
 * KEY FIX: Uses stable userId (from URL) instead of socket.id for room lookups.
 * This makes reconnection after page refresh work correctly.
 */
module.exports = function rtcHandler(io, socket) {

  const userId = socket.handshake.query.userId || null;

  // ─── join-room ──────────────────────────────────────────────
  socket.on('join-room', (roomId) => {
    if (!isValidRoomId(roomId)) return;

    const room = roomManager.getRoom(roomId);
    if (!room) {
      socket.emit('join-failed', { reason: 'Room not found', roomId });
      return;
    }

    // Reconnection: update socket mapping if this userId is a registered participant
    if (userId && room.participants[userId]) {
      roomManager.reconnect(roomId, userId, socket.id);
    }

    // Join Socket.IO room
    socket.join(roomId);

    // ── KEY FIX: notify existing members that someone joined ──
    socket.to(roomId).emit('user-joined', {
      id: socket.id,
      userId,
      timestamp: new Date().toISOString(),
    });

    // ── KEY FIX: also notify the NEW JOINER of any already-present peers ──
    // This prevents the signaling deadlock where admin joins second and
    // never receives user-joined (so admin can always kick off the offer).
    const roomMembers = io.sockets.adapter.rooms.get(roomId);
    if (roomMembers) {
      const existingPeers = [...roomMembers].filter(sid => sid !== socket.id);
      if (existingPeers.length > 0) {
        socket.emit('user-joined', {
          id: existingPeers[0],   // first existing peer
          userId: null,
          existing: true,          // flag so client knows this is a pre-existing peer
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Send room info back
    socket.emit('room-info', roomManager.serializeRoom(roomId));

    logger.info('User joined room', { socketId: socket.id, userId, roomId });
  });

  // ─── room-joined (media ready acknowledgment) ──────────────
  socket.on('room-joined', ({ room, role, mediaReady }) => {
    if (!isValidRoomId(room)) return;

    // Mark room as active and clear handshake timeout
    roomManager.setActive(room);

    // Notify peer
    socket.to(room).emit('peer-reconnected', {
      socketId: socket.id,
      userId,
      role,
      mediaReady: !!mediaReady,
      timestamp: new Date().toISOString(),
    });

    logger.info('Room joined with media', { socketId: socket.id, userId, room, role });
  });

  // ─── media-ready ────────────────────────────────────────────
  socket.on('media-ready', ({ room, hasVideo, hasAudio }) => {
    if (!isValidRoomId(room)) return;
    socket.to(room).emit('peer-media-ready', {
      socketId: socket.id,
      userId,
      hasVideo: !!hasVideo,
      hasAudio: !!hasAudio,
    });
  });

  // ─── WebRTC offer ───────────────────────────────────────────
  socket.on('offer', ({ room, offer, targetId }) => {
    if (!room || !offer) return;

    logger.debug('WebRTC offer', { from: socket.id, room, target: targetId || 'broadcast' });

    if (targetId) {
      socket.to(targetId).emit('offer', offer);
    } else {
      socket.to(room).emit('offer', offer);
    }
  });

  // ─── WebRTC answer ──────────────────────────────────────────
  socket.on('answer', ({ room, answer, targetId }) => {
    if (!room || !answer) return;

    logger.debug('WebRTC answer', { from: socket.id, room, target: targetId || 'broadcast' });

    if (targetId) {
      socket.to(targetId).emit('answer', answer);
    } else {
      socket.to(room).emit('answer', answer);
    }
  });

  // ─── ICE candidate ─────────────────────────────────────────
  socket.on('ice', ({ room, candidate, targetId }) => {
    if (!room || !candidate) return;

    if (targetId) {
      socket.to(targetId).emit('ice', candidate);
    } else {
      socket.to(room).emit('ice', candidate);
    }
  });

  // ─── reconnect-call ─────────────────────────────────────────
  socket.on('reconnect-call', ({ room, userId: reconnectUserId }) => {
    if (!isValidRoomId(room)) {
      socket.emit('reconnect-failed', { reason: 'Invalid room ID' });
      return;
    }

    const targetUserId = reconnectUserId || userId;
    const success = roomManager.reconnect(room, targetUserId, socket.id);

    if (success) {
      socket.join(room);

      socket.emit('reconnect-success', {
        roomId: room,
        roomInfo: roomManager.serializeRoom(room),
        timestamp: new Date().toISOString(),
      });

      // Notify peer
      socket.to(room).emit('user-reconnected', {
        id: socket.id,
        userId: targetUserId,
        timestamp: new Date().toISOString(),
      });

      logger.info('Reconnection successful', { socketId: socket.id, userId: targetUserId, room });
    } else {
      socket.emit('reconnect-failed', {
        reason: 'Room not found or user not a participant',
        roomId: room,
      });
      logger.warn('Reconnection failed', { socketId: socket.id, userId: targetUserId, room });
    }
  });

  // ─── end-call ───────────────────────────────────────────────
  socket.on('end-call', ({ room, reason }) => {
    if (!isValidRoomId(room)) return;

    socket.to(room).emit('call-ended', {
      by: socket.id,
      userId,
      reason: reason || 'Call ended by peer',
      timestamp: new Date().toISOString(),
    });

    // Confirm to sender
    socket.emit('call-ended-confirm', {
      roomId: room,
      timestamp: new Date().toISOString(),
    });

    const roomObj = roomManager.getRoom(room);
    if (roomObj && roomObj.onCleanup) roomObj.onCleanup(room, 'call-ended');

    // Save to DB
    SessionStore.saveCallEnd({ roomId: room, reason: reason || 'ended-by-peer' });

    roomManager.cleanupRoom(room, 'call-ended');
    logger.info('Call ended', { socketId: socket.id, userId, room, reason });
  });

  // ─── leave-room ─────────────────────────────────────────────
  socket.on('leave-room', (room) => {
    if (!room) return;
    socket.leave(room);
    logger.debug('User left room', { socketId: socket.id, room });
  });

  // ─── get-room-info ──────────────────────────────────────────
  socket.on('get-room-info', (room) => {
    const data = roomManager.serializeRoom(room);
    socket.emit('room-info-response', {
      roomId: room,
      exists: !!data,
      data,
      userCount: data ? data.participants.length : 0,
    });
  });

  // ─── screen-share relay ──────────────────────────────────────
  // Relay to everyone else in the room so the receiver can update their layout.
  socket.on('screen-share-start', ({ room }) => {
    if (!isValidRoomId(room)) return;
    socket.to(room).emit('screen-share-started', { by: socket.id });
    logger.debug('Screen share started', { socketId: socket.id, room });
  });

  socket.on('screen-share-stop', ({ room }) => {
    if (!isValidRoomId(room)) return;
    socket.to(room).emit('screen-share-stopped', { by: socket.id });
    logger.debug('Screen share stopped', { socketId: socket.id, room });
  });
};
