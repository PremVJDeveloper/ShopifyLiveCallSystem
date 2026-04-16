'use strict';

const logger = require('../../utils/logger');
const roomManager = require('../../state/RoomManager');

/**
 * Product sharing handler.
 */
module.exports = function productHandler(io, socket) {

  // ─── Send single product ───────────────────────────────────
  socket.on('send-product', ({ room, product }) => {
    if (!room || !product) {
      socket.emit('send-product-error', { error: 'Missing room or product data' });
      return;
    }

    if (!roomManager.getRoom(room)) {
      socket.emit('send-product-error', { error: 'Room not found' });
      return;
    }

    io.to(room).emit('product-shared', {
      product,
      sender: socket.id,
      senderName: 'Admin',
      timestamp: new Date().toISOString(),
    });

    socket.emit('product-sent', { room, product, timestamp: new Date().toISOString() });
    logger.info('Product shared', { room, title: product.title });
  });

  // ─── Send multiple products ────────────────────────────────
  socket.on('send-products', ({ room, products }) => {
    if (!room || !Array.isArray(products)) {
      socket.emit('send-product-error', { error: 'Missing room or products data' });
      return;
    }

    if (!roomManager.getRoom(room)) {
      socket.emit('send-product-error', { error: 'Room not found' });
      return;
    }

    io.to(room).emit('products-shared', {
      products,
      sender: socket.id,
      timestamp: new Date().toISOString(),
      count: products.length,
      type: 'multiple',
    });

    socket.emit('products-sent', { room, products, timestamp: new Date().toISOString() });
    logger.info('Multiple products shared', { room, count: products.length });
  });
};
