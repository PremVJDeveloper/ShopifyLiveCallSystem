'use strict';

// ================================================================
// ShopifyLiveCallSystem — Production Entry Point
// ================================================================

const config = require('./src/config');
const logger = require('./src/utils/logger');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
const cors = require('cors');
const ScheduleStore = require('./src/state/ScheduleStore');
const roomManager = require('./src/state/RoomManager');

// ─── Express App ────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

// ─── Socket.IO ──────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: config.socketio.pingTimeout,
  pingInterval: config.socketio.pingInterval,
  connectTimeout: config.socketio.connectTimeout,
});

// ─── Global Middleware ──────────────────────────────────────────
app.use(compression());
app.use(helmet({
  contentSecurityPolicy: false,  // Allow inline scripts in HTML files
  crossOriginEmbedderPolicy: false,
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
const requestLogger = require('./src/middleware/requestLogger');
app.use(requestLogger);

// ─── Static Files ───────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── Routes ─────────────────────────────────────────────────────
const pageRoutes = require('./src/routes/pages');
const scheduleRoutes = require('./src/routes/schedule');
const adminApiRoutes = require('./src/routes/adminRoutes');
const healthRoutes   = require('./src/routes/health');
const logRoutes = require('./src/routes/logs');
const authRoutes = require('./src/routes/authRoutes');
const iceRoutes = require('./src/routes/iceServers');

app.use('/', pageRoutes);
app.use('/api/schedule',  scheduleRoutes);
app.use('/api/admin',     adminApiRoutes);
app.use('/api/health',    healthRoutes);
app.use('/metrics', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/ice-servers', iceRoutes);

// Join link lookup (used by join.html)
app.get('/api/schedule/join/:token', async (req, res) => {
  const record = await ScheduleStore.getByToken(req.params.token);
  if (!record) return res.status(404).json({ error: 'Not found' });
  return res.json(record);
});

app.get('/api/admin-status', (req, res) => {
  const sockets = Array.from(io.sockets.sockets.values());
  const adminOnline = sockets.some(s => s.isAdmin === true);
  res.json({ adminOnline });
});

// ─── Socket.IO Setup ────────────────────────────────────────────
const setupSocket = require('./src/socket');
setupSocket(io);

// ─── Database Init ──────────────────────────────────────────────
const db = require('./src/state/DBManager');
const SessionStore = require('./src/state/SessionStore');

// ─── Start Server ───────────────────────────────────────────────
async function start() {
  // Initialize databases
  await db.init();
  await SessionStore.init();
  await ScheduleStore.init();

  server.listen(config.server.port, () => {
    logger.info('Server started', {
      port: config.server.port,
      env: config.server.env,
      node: process.version,
      db: db.type,
      turn: config.webrtc.iceServers.length > 2 ? 'configured' : 'STUN only',
    });

    const dbDisplay = db.type === 'postgres' 
      ? '✅ PostgreSQL (RDS/EC2)' 
      : '✅ SQLite (' + config.db.sqlitePath + ')';

    console.log('');
    console.log('  🚀 ShopifyLiveCallSystem');
    console.log(`  ├─ Server:    http://localhost:${config.server.port}`);
    console.log(`  ├─ Admin:     http://localhost:${config.server.port}/admin`);
    console.log(`  ├─ Login:     http://localhost:${config.server.port}/login`);
    console.log(`  ├─ Health:    http://localhost:${config.server.port}/health`);
    console.log(`  ├─ Metrics:   http://localhost:${config.server.port}/metrics`);
    console.log(`  ├─ Database:  ${dbDisplay}`);
    console.log(`  └─ TURN:      ${config.webrtc.iceServers.length > 2 ? '✅ Configured' : '⚠ STUN only (set TURN creds in .env)'}`);
    console.log('');
  });
}

start().catch(err => {
  logger.error('Failed to start server', { error: err.message, stack: err.stack });
  process.exit(1);
});

// ─── Graceful Shutdown ──────────────────────────────────────────
function shutdown(signal) {
  logger.warn(`${signal} received — graceful shutdown`, {
    connectedClients: io.engine.clientsCount,
  });

  io.emit('server-shutdown', {
    message: 'Server is shutting down for maintenance',
    timestamp: new Date().toISOString(),
  });

  setTimeout(() => {
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  }, 3000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  // Don't exit — keep server running
});