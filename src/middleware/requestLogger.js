'use strict';

const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * Express middleware that logs every HTTP request + response.
 */
function requestLogger(req, res, next) {
  const requestId = uuidv4().slice(0, 8);
  const startTime = Date.now();
  req.requestId = requestId;

  res.on('finish', () => {
    const ms = Date.now() - startTime;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level]('HTTP', {
      requestId,
      method: req.method,
      url: req.url,
      status: res.statusCode,
      ms,
      ip: req.ip,
    });
  });

  next();
}

module.exports = requestLogger;
