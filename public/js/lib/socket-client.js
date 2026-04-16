/**
 * Socket.io client wrapper with automatic stable userId and reconnection management.
 */
import { session } from '../utils/storage.js';

class SocketClient {
  constructor() {
    this.socket = null;
    this.userId = session.getUserId();
  }

  connect(options = {}) {
    if (this.socket) {
      console.warn('Socket already connected');
      return this.socket;
    }

    const { query = {}, ...otherOptions } = options;

    // We always attach the stable userId to the handshake query
    this.socket = io(window.location.origin, {
      ...otherOptions,
      query: {
        ...query,
        userId: this.userId
      },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5
    });

    this._setupBaseEvents();
    return this.socket;
  }

  _setupBaseEvents() {
    this.socket.on('connect', () => {
      console.log('Socket connected:', this.socket.id);
    });

    this.socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
    });

    this.socket.on('connection-ack', (data) => {
      console.log('Connection acknowledged by server:', data);
    });

    this.socket.on('error-message', (data) => {
      console.error('Socket restricted action:', data.error);
      alert(data.error);
    });
  }

  get id() {
    return this.socket ? this.socket.id : null;
  }

  on(event, callback) {
    if (this.socket) this.socket.on(event, callback);
  }

  emit(event, data) {
    if (this.socket) this.socket.emit(event, data);
  }

  off(event, callback) {
    if (this.socket) this.socket.off(event, callback);
  }
}

// Single instance for the application
export const socketClient = new SocketClient();
