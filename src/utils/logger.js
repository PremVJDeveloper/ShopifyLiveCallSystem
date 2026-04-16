'use strict';

const { createLogger, format, transports } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const config = require('../config');

const { combine, timestamp, printf, colorize, errors, json } = format;

const logsDir = path.join(__dirname, '../../logs');

// Human-readable console format
const consoleFormat = printf(({ level, message, timestamp: ts, ...meta }) => {
  const metaStr = Object.keys(meta).length
    ? `\n  ${JSON.stringify(meta, null, 2).replace(/\n/g, '\n  ')}`
    : '';
  return `[${ts}] ${level.toUpperCase()}: ${message}${metaStr}`;
});

const logger = createLogger({
  level: config.logging.level,
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    json()
  ),
  transports: [
    // Console (human-readable in dev, structured in prod)
    new transports.Console({
      format: config.server.isDev
        ? combine(colorize({ all: true }), timestamp({ format: 'HH:mm:ss' }), consoleFormat)
        : combine(timestamp(), json()),
    }),

    // All logs (daily rotation, 14 day retention)
    new DailyRotateFile({
      filename: path.join(logsDir, 'server-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
      maxSize: '50m',
      zippedArchive: true,
    }),

    // Error-only log
    new DailyRotateFile({
      filename: path.join(logsDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxFiles: '30d',
      maxSize: '20m',
      zippedArchive: true,
    }),
  ],
});

// Attach a child factory for scoped loggers
logger.child = (bindings) => logger.child(bindings);

module.exports = logger;
