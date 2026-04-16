# ShopifyLiveCallSystem — Production WebRTC

A production-grade, Google Meet–inspired live video calling system built for Shopify support agents. Features WebRTC peer-to-peer video, real-time chat, product catalog sharing, and a JWT-authenticated admin dashboard.

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```
Edit `.env` — see the sections below for details on each value.

### 3. Generate admin password hash
```bash
node -e "require('bcryptjs').hash('your_password_here', 12).then(console.log)"
```
Paste the output as `ADMIN_PASSWORD_HASH` in `.env`.

### 4. Start the server
```bash
npm run dev      # Development (auto-restart)
npm start        # Production
```

Open http://localhost:3000

---

## Getting TURN Credentials (Required for Production)

Without TURN, calls will fail across ~30% of real-world networks (VPNs, corporate firewalls, mobile NAT).

**Free setup using Metered.ca (50 GB/month free):**

1. Go to https://app.metered.ca and create a free account
2. Click **"New Application"** → give it any name
3. In the left sidebar, click **"TURN Server"**
4. Copy your **Username** and **Credential** values
5. Add to `.env`:
```env
TURN_USERNAME=your_username_here
TURN_CREDENTIAL=your_credential_here
```

The server automatically serves these to clients via `/api/ice-servers` — credentials are never exposed in client-side JS.

---

## PostgreSQL Setup (Optional — for call history)

```bash
# Create database
createdb livecall_db

# Add to .env
DATABASE_URL=postgresql://postgres:password@localhost:5432/livecall_db
```

Tables are created automatically on first startup. If `DATABASE_URL` is not set, the server runs fine in memory-only mode (call history is not persisted).

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port (default: 3000) |
| `NODE_ENV` | No | `development` or `production` |
| `ADMIN_USERNAME` | Yes | Admin login username |
| `ADMIN_PASSWORD_HASH` | Yes | bcrypt hash of admin password |
| `JWT_SECRET` | Yes | Secret for JWT signing (min 32 chars) |
| `TURN_USERNAME` | Recommended | Metered.ca TURN username |
| `TURN_CREDENTIAL` | Recommended | Metered.ca TURN credential |
| `DATABASE_URL` | Optional | PostgreSQL connection string |
| `LOG_LEVEL` | No | `info`, `debug`, `warn`, `error` |

---

## Architecture

```
server.js                    ← Thin entry point (~100 lines)
src/
  config/index.js            ← All env vars in one place
  utils/
    logger.js                ← Winston structured logger
    sanitize.js              ← Input sanitization
  state/
    RoomManager.js           ← Room lifecycle (stable userId routing)
    QueueManager.js          ← Waiting queue with timeouts
    SessionStore.js          ← PostgreSQL persistence
  middleware/
    auth.js                  ← JWT login + socket auth
    rateLimiter.js           ← Per-IP rate limiting
    requestLogger.js         ← HTTP request logging
  routes/
    pages.js, health.js, logs.js, authRoutes.js, iceServers.js
  socket/
    index.js                 ← Socket.IO setup + lifecycle
    handlers/
      callHandler.js         ← request-call, cancel-call
      adminHandler.js        ← accept-call, force-disconnect
      rtcHandler.js          ← offer/answer/ICE, reconnection
      chatHandler.js         ← chat messages
      productHandler.js      ← product sharing

public/
  css/
    base.css                 ← Design tokens (dark glassmorphism)
    video-call.css           ← Google Meet–style video UI
    admin.css                ← Admin dashboard
    call-request.css         ← Waiting room
  js/
    lib/
      webrtc.js              ← RTCPeerConnection manager class
      socket-client.js       ← Socket singleton with stable userId
    utils/
      dom.js, storage.js
    modules/
      media.js               ← getUserMedia with fallback chain
      chat.js                ← Chat UI + notifications
      controls.js            ← Camera/mic/screen toggles
      catalog.js             ← Product catalog
    pages/
      video-call.js          ← Call orchestrator (thin)
      call-request.js        ← Waiting room
      admin.js               ← Admin dashboard
      login.js               ← JWT login
  html/
    login.html, admin.html, video-call.html, call-request.html
```

---

## Key Bug Fixes Applied

| Bug | Fix |
|---|---|
| **Reconnection after refresh** | Stable `userId` (UUID in localStorage) used instead of `socketId`. Server maps `userId → socketId` and updates on reconnect. |
| **ICE candidate race condition** | Candidates buffered in `WebRTCManager.iceCandidatesBuffer[]` until `setRemoteDescription` completes, then drained. |
| **`handleReconnection()` undefined** | Fully implemented reconnect flow: server emits `peer-reconnected`, admin re-creates offer. |
| **No TURN server** | TURN credentials fetched from `/api/ice-servers` (server-side, never in client JS). |
| **No admin auth** | JWT login page at `/login`. All admin socket events guarded by `socket.isAdmin`. |
| **No rate limiting** | `callRequestLimiter` (3/min) + `chatMessageLimiter` (30/10s). HTTP `express-rate-limit` on API routes. |
| **1349-line monolith** | Backend split into 15+ focused modules. Frontend split into library → module → page layers. |

---

## Endpoints

| Path | Description |
|---|---|
| `GET /` | Index page |
| `GET /call-request` | Waiting room (customers) |
| `GET /video-call` | Video call page |
| `GET /login` | Admin login |
| `GET /admin` | Admin dashboard (requires JWT) |
| `GET /health` | Server health + stats |
| `GET /metrics` | Prometheus-format metrics |
| `POST /api/auth/login` | Returns JWT token |
| `GET /api/auth/verify` | Verify JWT token |
| `GET /api/ice-servers` | TURN/STUN server config |
| `GET /api/logs` | Recent logs (admin only) |
| `GET /api/call-history` | Call history from DB (admin only) |

---

## Production Checklist

- [ ] Set strong `JWT_SECRET` (32+ random characters)
- [ ] Set `ADMIN_PASSWORD_HASH` (bcrypt hash)
- [ ] Set `TURN_USERNAME` + `TURN_CREDENTIAL`
- [ ] Set `DATABASE_URL` for call history
- [ ] Set `NODE_ENV=production`
- [ ] Put behind HTTPS (required for WebRTC in production)
- [ ] Set up process manager: `pm2 start server.js --name livecall`

---

## Tech Stack

**Backend:** Node.js · Express · Socket.IO · PostgreSQL (pg) · Winston · JWT · bcrypt

**Frontend:** Vanilla JS ES Modules · WebRTC API · CSS3 Glassmorphism · Inter font

**WebRTC:** Google STUN + optional Metered.ca TURN · ICE restart on failure
