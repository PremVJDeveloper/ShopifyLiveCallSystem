'use strict';

const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const config = require('../config');

/**
 * RoomManager — owns all active room state.
 *
 * Key architectural decision: participants are keyed by a **stable userId**
 * (UUID generated on the client and passed in URL params), NOT by socket ID.
 * This makes reconnection after page refresh trivial — just update socketId.
 *
 * Room shape:
 * {
 *   roomId: string,
 *   status: 'connecting' | 'active' | 'ended',
 *   createdAt: number (ms),
 *   participants: {
 *     [userId]: { socketId, role, name, userData }
 *   },
 *   timeout: TimeoutHandle | null,  // connection handshake timeout
 *   onCleanup: Function | null      // registered by socket layer
 * }
 */
class RoomManager {
  constructor() {
    this._rooms = new Map();              // roomId → room
    this._socketToRoom = new Map();      // socketId → roomId
    this._userToSocket = new Map();      // userId → socketId (current)
    this._socketToUser = new Map();      // socketId → userId
  }

  // ─── Room creation ────────────────────────────────────────────

  /**
   * Create a new room. Returns the roomId.
   */
  createRoom({ adminUserId, adminSocketId, adminName, userId, userSocketId, userName, userData }) {
    const roomId = uuidv4();

    const room = {
      roomId,
      status: 'connecting',
      createdAt: Date.now(),
      participants: {
        [adminUserId]: {
          socketId: adminSocketId,
          role: 'admin',
          name: adminName || 'Support Agent',
          userData: null,
        },
        [userId]: {
          socketId: userSocketId,
          role: 'user',
          name: userName || 'Customer',
          userData,
        },
      },
      timeout: null,
      onCleanup: null,
    };

    this._rooms.set(roomId, room);

    // Build reverse-lookup maps for both participants
    this._mapParticipant(adminUserId, adminSocketId, roomId);
    this._mapParticipant(userId, userSocketId, roomId);

    logger.info('Room created', { roomId, adminUserId, userId, userName });
    return roomId;
  }

  // ─── Look-ups ─────────────────────────────────────────────────

  getRoom(roomId) { return this._rooms.get(roomId) || null; }

  getRoomIdBySocket(socketId) { return this._socketToRoom.get(socketId) || null; }

  getRoomBySocket(socketId) {
    const roomId = this.getRoomIdBySocket(socketId);
    return roomId ? this.getRoom(roomId) : null;
  }

  getUserIdBySocket(socketId) { return this._socketToUser.get(socketId) || null; }

  getSocketByUserId(userId) { return this._userToSocket.get(userId) || null; }

  getAllRooms() { return Array.from(this._rooms.values()); }

  // ─── Reconnection ─────────────────────────────────────────────

  /**
   * Called when a participant reconnects with a new socket after a page refresh.
   * Returns true on success, false if room/userId not found.
   */
  reconnect(roomId, userId, newSocketId) {
    const room = this._rooms.get(roomId);
    if (!room || !room.participants[userId]) {
      logger.warn('Reconnect failed: room or user not found', { roomId, userId, newSocketId });
      return false;
    }

    const oldSocketId = room.participants[userId].socketId;

    // Update participant's socket ID
    room.participants[userId].socketId = newSocketId;

    // Update reverse-lookup maps
    if (oldSocketId) {
      this._socketToRoom.delete(oldSocketId);
      this._socketToUser.delete(oldSocketId);
    }
    this._mapParticipant(userId, newSocketId, roomId);

    logger.info('Participant reconnected', {
      roomId, userId, oldSocketId, newSocketId,
    });
    return true;
  }

  // ─── Status ───────────────────────────────────────────────────

  setActive(roomId) {
    const room = this._rooms.get(roomId);
    if (room) {
      room.status = 'active';
      this._clearHandshakeTimeout(room);
    }
  }

  setHandshakeTimeout(roomId, fn) {
    const room = this._rooms.get(roomId);
    if (!room) return;
    this._clearHandshakeTimeout(room);
    room.timeout = setTimeout(() => {
      logger.warn('Room handshake timeout', { roomId });
      fn(roomId);
    }, config.timeouts.connectionHandshakeMs);
  }

  registerCleanupCallback(roomId, fn) {
    const room = this._rooms.get(roomId);
    if (room) room.onCleanup = fn;
  }

  // ─── Participant tracking ──────────────────────────────────────

  /**
   * Returns the other participant's socket ID in a 1:1 room.
   */
  getPeerSocketId(roomId, myUserId) {
    const room = this._rooms.get(roomId);
    if (!room) return null;
    for (const [uid, p] of Object.entries(room.participants)) {
      if (uid !== myUserId) return p.socketId;
    }
    return null;
  }

  /**
   * Returns all socket IDs currently in a room.
   */
  getSocketIds(roomId) {
    const room = this._rooms.get(roomId);
    if (!room) return [];
    return Object.values(room.participants).map(p => p.socketId).filter(Boolean);
  }

  // ─── Cleanup ──────────────────────────────────────────────────

  /**
   * Remove a participant's socket-level mapping (on disconnect).
   * Does NOT remove the participant from the room (allows reconnect).
   */
  onSocketDisconnect(socketId) {
    const roomId = this._socketToRoom.get(socketId);
    if (roomId) {
      const room = this._rooms.get(roomId);
      if (room) {
        const userId = this._socketToUser.get(socketId);
        if (userId && room.participants[userId]) {
          // Keep participant in room for reconnect, but null out socket
          room.participants[userId].socketId = null;
        }
      }
    }
    this._socketToRoom.delete(socketId);
    this._socketToUser.delete(socketId);
  }

  /**
   * Fully remove a room and all its mappings.
   */
  cleanupRoom(roomId, reason = 'unknown') {
    const room = this._rooms.get(roomId);
    if (!room) return false;

    this._clearHandshakeTimeout(room);

    // Remove all participant mappings
    for (const [userId, p] of Object.entries(room.participants)) {
      if (p.socketId) {
        this._socketToRoom.delete(p.socketId);
        this._socketToUser.delete(p.socketId);
      }
      this._userToSocket.delete(userId);
    }

    this._rooms.delete(roomId);
    logger.info('Room cleaned up', { roomId, reason });
    return true;
  }

  // ─── Periodic stale room cleanup ──────────────────────────────

  cleanupStaleRooms(maxAgeMs = 30 * 60 * 1000) {
    const now = Date.now();
    let cleaned = 0;
    for (const [roomId, room] of this._rooms) {
      if (now - room.createdAt > maxAgeMs) {
        if (room.onCleanup) room.onCleanup(roomId, 'stale');
        this.cleanupRoom(roomId, 'stale');
        cleaned++;
      }
    }
    if (cleaned > 0) logger.info('Cleaned up stale rooms', { count: cleaned });
  }

  // ─── Serialization (for admin panel) ──────────────────────────

  serializeRoom(roomId) {
    const room = this._rooms.get(roomId);
    if (!room) return null;
    return {
      roomId: room.roomId,
      status: room.status,
      createdAt: room.createdAt,
      participants: Object.entries(room.participants).map(([userId, p]) => ({
        userId,
        role: p.role,
        name: p.name,
        connected: !!p.socketId,
      })),
    };
  }

  serializeAll() {
    return Array.from(this._rooms.keys()).map(id => this.serializeRoom(id));
  }

  // ─── Internal ─────────────────────────────────────────────────

  _mapParticipant(userId, socketId, roomId) {
    if (socketId) {
      this._socketToRoom.set(socketId, roomId);
      this._socketToUser.set(socketId, userId);
      this._userToSocket.set(userId, socketId);
    }
  }

  _clearHandshakeTimeout(room) {
    if (room.timeout) {
      clearTimeout(room.timeout);
      room.timeout = null;
    }
  }
}

module.exports = new RoomManager(); // singleton
