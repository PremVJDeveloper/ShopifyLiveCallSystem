'use strict';

const logger = require('../utils/logger');
const config = require('../config');

/**
 * QueueManager — manages the list of users waiting for an admin to accept.
 *
 * Queue entry shape:
 * {
 *   socketId: string,
 *   userId: string,       // stable UUID from client
 *   userData: object,
 *   timestamp: ISO string,
 *   status: 'waiting',
 *   _timeout: TimeoutHandle
 * }
 */
class QueueManager {
  constructor() {
    this._queue = new Map();          // socketId → entry
    this._userIdIndex = new Map();    // userId → socketId (for reconnect)
    this._onExpire = null;            // callback(socketId) when queue entry expires
  }

  // ─── Registration ─────────────────────────────────────────────

  /**
   * Register an expire callback (called by socket layer).
   */
  onExpire(fn) { this._onExpire = fn; }

  // ─── Add / remove ─────────────────────────────────────────────

  /**
   * Add a user to the queue.
   * Returns false if already in queue.
   */
  add(socketId, userId, userData) {
    if (this._queue.has(socketId)) return false;

    const entry = {
      socketId,
      userId,
      userData,
      timestamp: new Date().toISOString(),
      status: 'waiting',
      _timeout: null,
    };

    // Auto-expire after 30 minutes
    entry._timeout = setTimeout(() => {
      this._expire(socketId);
    }, config.timeouts.queueEntryMs);

    this._queue.set(socketId, entry);
    if (userId) this._userIdIndex.set(userId, socketId);

    logger.info('User added to queue', {
      socketId, userId,
      name: userData?.name,
      queueSize: this._queue.size,
    });

    return true;
  }

  /**
   * Remove an entry and clear its timeout.
   * Returns the removed entry or null.
   */
  remove(socketId) {
    const entry = this._queue.get(socketId);
    if (!entry) return null;

    clearTimeout(entry._timeout);
    this._queue.delete(socketId);
    if (entry.userId) this._userIdIndex.delete(entry.userId);

    logger.info('User removed from queue', {
      socketId,
      name: entry.userData?.name,
      queueSize: this._queue.size,
    });

    return entry;
  }

  /**
   * Update socket ID for a user who reconnected while waiting.
   */
  updateSocket(oldSocketId, newSocketId) {
    const entry = this._queue.get(oldSocketId);
    if (!entry) return false;
    entry.socketId = newSocketId;
    this._queue.delete(oldSocketId);
    this._queue.set(newSocketId, entry);
    if (entry.userId) this._userIdIndex.set(entry.userId, newSocketId);
    return true;
  }

  // ─── Queries ──────────────────────────────────────────────────

  has(socketId) { return this._queue.has(socketId); }

  get(socketId) { return this._queue.get(socketId) || null; }

  getByUserId(userId) {
    const sid = this._userIdIndex.get(userId);
    return sid ? this._queue.get(sid) || null : null;
  }

  /**
   * Position of a socket in the queue (1-based). Returns -1 if not found.
   */
  getPosition(socketId) {
    let pos = 1;
    for (const [sid] of this._queue) {
      if (sid === socketId) return pos;
      pos++;
    }
    return -1;
  }

  size() { return this._queue.size; }

  /**
   * Returns all entries as an array (for admin sync).
   */
  getAll() {
    return Array.from(this._queue.values()).map(e => ({
      socketId: e.socketId,
      userId: e.userId,
      userData: e.userData,
      timestamp: e.timestamp,
      status: e.status,
    }));
  }

  // ─── Periodic cleanup ─────────────────────────────────────────

  cleanupStale() {
    const now = Date.now();
    let count = 0;
    for (const [socketId, entry] of this._queue) {
      const age = now - new Date(entry.timestamp).getTime();
      if (age > config.timeouts.queueEntryMs) {
        this._expire(socketId);
        count++;
      }
    }
    if (count > 0) logger.info('Expired stale queue entries', { count });
  }

  // ─── Internal ─────────────────────────────────────────────────

  _expire(socketId) {
    const entry = this._queue.get(socketId);
    if (!entry) return;
    logger.info('Queue entry expired', { socketId, name: entry.userData?.name });
    this.remove(socketId);
    if (this._onExpire) this._onExpire(socketId);
  }
}

module.exports = new QueueManager(); // singleton
