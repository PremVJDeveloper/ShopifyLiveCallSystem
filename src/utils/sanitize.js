'use strict';

/**
 * Strips HTML tags and trims whitespace from a string.
 * Used to sanitize user-provided text before broadcasting.
 * @param {*} str
 * @param {number} maxLen - Maximum allowed length (default 1000)
 */
function sanitizeString(str, maxLen = 1000) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/<[^>]*>/g, '')   // strip HTML tags
    .replace(/[<>]/g, '')       // remove stray angle brackets
    .trim()
    .slice(0, maxLen);
}

/**
 * Sanitizes a user data object coming from socket events.
 */
function sanitizeUserData(data) {
  if (!data || typeof data !== 'object') return null;
  return {
    name:       sanitizeString(data.name, 100),
    phone:      sanitizeString(data.phone, 30),
    lookingFor: sanitizeString(data.lookingFor, 150),
    priceRange: sanitizeString(data.priceRange, 100),
    returnUrl:  sanitizeUrl(data.returnUrl),
    source:     sanitizeString(data.source, 200),
    userAgent:  sanitizeString(data.userAgent, 500),
    tracking:   (data.tracking && typeof data.tracking === 'object') ? data.tracking : {}, // Allow tracking data
    timestamp:  typeof data.timestamp === 'string' ? data.timestamp : new Date().toISOString(),
  };
}

/**
 * Validates and sanitizes a URL string.
 * Returns an empty string for invalid/dangerous URLs.
 */
function sanitizeUrl(url) {
  if (typeof url !== 'string') return '';
  try {
    const parsed = new URL(url);
    // Only allow http/https
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.href.slice(0, 2048);
  } catch {
    return '';
  }
}

/**
 * Validates that a roomId looks like a UUID.
 */
function isValidRoomId(roomId) {
  return typeof roomId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roomId);
}

/**
 * Validates that a userId looks like a UUID.
 */
function isValidUserId(userId) {
  return isValidRoomId(userId); // same format
}

module.exports = { sanitizeString, sanitizeUserData, sanitizeUrl, isValidRoomId, isValidUserId };
