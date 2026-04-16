#!/bin/bash
# ================================================================
# start-app.sh — Run AFTER deploy.bat has pushed the code
# SSH in and run: bash ~/app/deploy/start-app.sh
# ================================================================
set -e

APP_DIR="/home/ubuntu/app"
APP_PORT=3000

cd "$APP_DIR"

echo "▶ Installing npm dependencies..."
npm install --production

echo "▶ Creating data directory..."
mkdir -p data

echo "▶ Checking .env..."
if [ ! -f .env ]; then
  echo "  ⚠  .env not found — copying from .env.example"
  cp .env.example .env
  echo "  ✏  Edit .env now: nano .env"
  echo "     Set: TURN_URL, TURN_USERNAME, TURN_CREDENTIAL, JWT_SECRET, ADMIN_PASSWORD_HASH"
  exit 1
fi

echo "▶ Starting app with PM2..."
pm2 stop livecall 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save

echo ""
echo "  ✅ App is running!"
echo "  📋 Logs : pm2 logs livecall"
echo "  📊 Status: pm2 status"
echo ""

PUBLIC_IP=$(curl -s http://checkip.amazonaws.com)
echo "  🌐 Open: http://${PUBLIC_IP}"
echo "  🔑 Admin: http://${PUBLIC_IP}/admin"
echo ""
