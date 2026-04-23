'use strict';

const logger = require('../../utils/logger');
const { sanitizeString } = require('../../utils/sanitize');
const { chatMessageLimiter } = require('../../middleware/rateLimiter');

/**
 * Chat message handler.
 */
module.exports = function chatHandler(io, socket) {

  socket.on('chat-message', ({ room, message, senderName, senderRole }) => {
    if (!room || !message) return;

    // Rate-limit
    if (!chatMessageLimiter.allow(socket.id)) {
      socket.emit('error-message', { error: 'Sending messages too fast. Please slow down.' });
      return;
    }

    const cleanMessage = sanitizeString(message, 2000);
    const cleanName = sanitizeString(senderName, 100);

    if (!cleanMessage) return;

    const messageData = {
      message: cleanMessage,
      senderName: cleanName,
      senderRole: senderRole === 'admin' ? 'admin' : 'user',
      timestamp: new Date().toISOString(),
    };

    // Ensure socket is in the room
    if (!socket.rooms.has(room)) {
      socket.join(room);
    }

    // Broadcast to room (excluding sender)
    socket.to(room).emit('chat-message', messageData);

    logger.debug('Chat message', { room, from: socket.id, role: senderRole });
  });
};
