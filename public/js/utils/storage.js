/**
 * Storage utilities for persistent and session data.
 */

const APP_PREFIX = 'vc_';

export const storage = {
  get: (key) => {
    try {
      return JSON.parse(localStorage.getItem(APP_PREFIX + key));
    } catch (e) {
      return null;
    }
  },
  set: (key, value) => {
    localStorage.setItem(APP_PREFIX + key, JSON.stringify(value));
  },
  remove: (key) => {
    localStorage.removeItem(APP_PREFIX + key);
  }
};

export const session = {
  get: (key) => {
    try {
      return JSON.parse(sessionStorage.getItem(APP_PREFIX + key));
    } catch (e) {
      return null;
    }
  },
  set: (key, value) => {
    sessionStorage.setItem(APP_PREFIX + key, JSON.stringify(value));
  },
  remove: (key) => {
    sessionStorage.removeItem(APP_PREFIX + key);
  },
  
  /**
   * Generates or retrieves a stable userId for the current session.
   * Uses crypto.randomUUID when available (HTTPS), falls back to a
   * manual UUID v4 implementation for HTTP (non-secure) contexts.
   */
  getUserId: () => {
    let userId = storage.get('user_id');
    if (!userId) {
      userId = _generateUUID();
      storage.set('user_id', userId);
    }
    return userId;
  }
};

/** UUID v4 — works on both HTTPS and plain HTTP */
function _generateUUID() {
  // Use native crypto.randomUUID if available (HTTPS / localhost)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: manual UUID v4 using Math.random (HTTP contexts)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
