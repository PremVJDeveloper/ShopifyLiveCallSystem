/**
 * admin.js — Admin dashboard page orchestrator.
 */
import { socketClient } from '../lib/socket-client.js';
import { storage, session } from '../utils/storage.js';
import { dom } from '../utils/dom.js';

// ─── Auth check ────────────────────────────────────────────────
const token = storage.get('admin_token');
if (!token) {
  window.location.href = '/login';
  throw new Error('Not authenticated'); // stop execution
}

// Verify token on load
fetch('/api/auth/verify', { headers: { Authorization: `Bearer ${token}` } })
  .then(r => { if (!r.ok) { storage.remove('admin_token'); window.location.href = '/login'; } })
  .catch(() => {});

// ─── State ─────────────────────────────────────────────────────
const userId = session.getUserId();
let totalCallsToday = 0;
let soundEnabled = true;
let notificationsEnabled = true;

// ─── DOM ───────────────────────────────────────────────────────
const connDot        = document.getElementById('connectionDot');
const connText       = document.getElementById('statusText');
const queueCountEl   = document.getElementById('queueCount');
const activeCountEl  = document.getElementById('activeCalls');
const waitingNumEl   = document.getElementById('waitingCallsCount');
const activeNumEl    = document.getElementById('activeCallsCount');
const todayNumEl     = document.getElementById('totalCallsToday');
const callListEl     = document.getElementById('callList');
const emptyQueueEl   = document.getElementById('emptyQueue');
const activeRoomsEl  = document.getElementById('activeRoomsList');
const historyListEl  = document.getElementById('detailedHistoryList');
const refreshHistoryBtn = document.getElementById('refreshHistoryBtn');
const logoutBtn      = document.getElementById('logoutBtn');
const soundToggle    = document.getElementById('soundToggle');
const notifToggle    = document.getElementById('desktopNotificationToggle');

// Audio for notifications
const notifAudio = new Audio('/sounds/notification.mp3');

// ─── Socket ────────────────────────────────────────────────────
const socket = socketClient.connect({
  auth: { token },
  query: { userId, token },
});

socket.on('connect', () => {
  setConnected(true);
  socket.emit('admin-join');
});

socket.on('disconnect', () => setConnected(false));
socket.on('reconnect', () => { setConnected(true); socket.emit('admin-join'); });

socket.on('admin-connected', (data) => {
  updateCounts({ waiting: data.waitingCount, active: 0 });
});

// ─── Incoming call ─────────────────────────────────────────────
socket.on('new-call', (entry) => {
  if (document.getElementById(`call-${entry.socketId}`)) return; // already shown

  addCallCard(entry);
  updateWaitingCount(1);
  playNotification(entry);
});

socket.on('remove-call', ({ userId: removedId }) => {
  document.getElementById(`call-${removedId}`)?.remove();
  updateWaitingCount(-1);
  checkEmpty();
});

// ─── Active rooms ──────────────────────────────────────────────
socket.on('room-created', ({ roomId, room }) => {
  addActiveRoom(roomId, room);
  updateActiveCount(1);
  totalCallsToday++;
  dom.text(todayNumEl, totalCallsToday);
});

// ── Admin accepted a call → redirect to video call page ───────
socket.on('call-accepted-admin', ({ roomId, userData }) => {
  const adminName = encodeURIComponent('Support Agent');
  const returnUrl  = encodeURIComponent('/admin');
  window.location.href =
    `/video-call?room=${roomId}&role=admin&name=${adminName}&admin_return_url=${returnUrl}`;
});

socket.on('room-ended', ({ roomId }) => {
  document.getElementById(`room-${roomId}`)?.remove();
  updateActiveCount(-1);
  addHistoryEntry(roomId);
});

socket.on('active-rooms', ({ rooms }) => {
  if (activeRoomsEl) activeRoomsEl.innerHTML = '';
  let count = 0;
  rooms.forEach(r => { if (r) { addActiveRoom(r.roomId, r); count++; } });
  updateCounts({ active: count });
});

// ─── Call activity ─────────────────────────────────────────────
function addCallCard(entry) {
  const userData = entry.userData || {};
  const li = document.createElement('li');
  li.id = `call-${entry.socketId}`;
  li.className = 'call-card';

  const waitSince = new Date(entry.timestamp).toLocaleTimeString();
  const lookingFor = userData.lookingFor ? userData.lookingFor : '';
  const lookingBadge = lookingFor
    ? `<span class="looking-for-badge">🔍 ${escapeHtml(lookingFor)}</span>`
    : '';

  const priceRange = userData.priceRange ? userData.priceRange : '';
  const priceBadge = priceRange
    ? `<span class="price-range-badge">💰 ${escapeHtml(priceRange)}</span>`
    : '';

  li.innerHTML = `
    <div class="call-card-info">
      <div class="caller-avatar">${(userData.name?.[0] || '?').toUpperCase()}</div>
      <div class="caller-details">
        <strong>${escapeHtml(userData.name || 'Unknown')}</strong>
        <div class="caller-badges">${lookingBadge} ${priceBadge}</div>
        <span class="caller-meta">${escapeHtml(userData.phone || '')} · Waiting since ${waitSince}</span>
        ${userData.returnUrl ? `<a href="${escapeHtml(userData.returnUrl)}" target="_blank" class="caller-source">${new URL(userData.returnUrl).pathname}</a>` : ''}
      </div>
    </div>
    <div class="call-card-actions">
      <button class="btn-accept" data-id="${entry.socketId}">
        <span>📞</span> Accept
      </button>
    </div>
  `;


  li.querySelector('.btn-accept').addEventListener('click', () => {
    socket.emit('accept-call', { userId: entry.socketId });
    li.remove();
    updateWaitingCount(-1);
    checkEmpty();
  });

  dom.hide(emptyQueueEl);
  callListEl.prepend(li);
  checkEmpty();
}

function addActiveRoom(roomId, room) {
  if (!activeRoomsEl) return;
  const existing = document.getElementById(`room-${roomId}`);
  if (existing) return;

  const div = document.createElement('div');
  div.id = `room-${roomId}`;
  div.className = 'active-room-card';

  const participants = room?.participants || [];
  const user = participants.find(p => p.role === 'user');
  const agent = participants.find(p => p.role === 'admin');
  const startTime = room?.createdAt ? new Date(room.createdAt).toLocaleTimeString() : '—';

  div.innerHTML = `
    <div class="room-info">
      <div class="room-icon">🔴</div>
      <div>
        <strong>${escapeHtml(user?.name || 'Customer')}</strong>
        <span class="room-meta">Agent: ${escapeHtml(agent?.name || 'Agent')} · Started: ${startTime}</span>
      </div>
    </div>
    <button class="btn-disconnect" data-room="${roomId}">Disconnect</button>
  `;

  div.querySelector('.btn-disconnect').addEventListener('click', () => {
    if (confirm('Force disconnect this call?')) {
      socket.emit('force-disconnect', { roomId });
    }
  });

  activeRoomsEl.appendChild(div);
}

function addHistoryEntry(roomId) {
  // We now fetch the official history from the server
  fetchHistory();
}

async function fetchHistory() {
  if (!historyListEl) return;
  try {
    const res = await fetch('/api/admin/history', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!data.history) return;

    historyListEl.innerHTML = '';
    data.history.forEach(h => {
      const tr = document.createElement('tr');
      const start = new Date(h.started_at).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
      });
      const duration = h.duration_secs
        ? `${Math.floor(h.duration_secs / 60)}m ${h.duration_secs % 60}s`
        : 'Ongoing/Aborted';

      tr.innerHTML = `
        <td>${start}</td>
        <td>
          <div style="font-weight:600;">${escapeHtml(h.user_name || '—')}</div>
          <div style="font-size:11px;color:#888;">${escapeHtml(h.user_phone || '')}</div>
        </td>
        <td><span class="looking-for-badge">${escapeHtml(h.looking_for || 'General')}</span></td>
        <td><span class="price-range-badge">${escapeHtml(h.price_range || '—')}</span></td>
        <td>
          <div style="font-size:12px;">👤 ${escapeHtml(h.admin_username || 'Agent')}</div>
          <div style="font-size:10px;color:#888;">🌐 ${escapeHtml(h.admin_ip || '—')}</div>
        </td>
        <td style="font-size:12px;">${duration}</td>
      `;
      historyListEl.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to fetch history', err);
  }
}

refreshHistoryBtn?.addEventListener('click', fetchHistory);

// ─── Notification helpers ──────────────────────────────────────
function playNotification(entry) {
  if (soundEnabled) notifAudio.play().catch(() => {});
  if (notificationsEnabled && Notification.permission === 'granted') {
    new Notification('New call request!', {
      body: `${entry.userData?.name || 'A customer'} is waiting for support`,
      icon: '/favicon.ico',
    });
  }
  // Tab title flash
  const original = document.title;
  let alt = true;
  const t = setInterval(() => {
    document.title = alt ? '🔔 New Call!' : original;
    alt = !alt;
  }, 800);
  setTimeout(() => { clearInterval(t); document.title = original; }, 10000);
}

// ─── Count helpers ─────────────────────────────────────────────
let waitingCount = 0, activeCount = 0;

function updateWaitingCount(delta) {
  waitingCount = Math.max(0, waitingCount + delta);
  refreshCounts();
}
function updateActiveCount(delta) {
  activeCount = Math.max(0, activeCount + delta);
  refreshCounts();
}
function updateCounts({ waiting, active }) {
  if (waiting !== undefined) waitingCount = waiting;
  if (active !== undefined) activeCount = active;
  refreshCounts();
}
function refreshCounts() {
  dom.text(queueCountEl, `${waitingCount} waiting`);
  dom.text(activeCountEl, `· ${activeCount} active`);
  dom.text(waitingNumEl, waitingCount);
  dom.text(activeNumEl, activeCount);
}

function checkEmpty() {
  const hasCards = callListEl.children.length > 0;
  dom.toggleClass(emptyQueueEl, 'hidden', hasCards);
  if (!hasCards) dom.show(emptyQueueEl);
  else dom.hide(emptyQueueEl);
}

function setConnected(yes) {
  if (connDot) connDot.className = `status-dot ${yes ? 'online' : 'offline'}`;
  dom.text(connText, yes ? 'Connected' : 'Disconnected');
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ─── Settings ──────────────────────────────────────────────────
soundToggle?.addEventListener('change', () => { soundEnabled = soundToggle.checked; });
notifToggle?.addEventListener('change', () => {
  notificationsEnabled = notifToggle.checked;
  if (notificationsEnabled && Notification.permission === 'default') {
    Notification.requestPermission();
  }
});

// Test sound button
document.getElementById('testSoundBtn')?.addEventListener('click', () => {
  notifAudio.currentTime = 0;
  notifAudio.play().catch(() => {});
});

// Request notifications permission
if (Notification.permission === 'default') {
  setTimeout(() => {
    document.getElementById('permissionModal')?.style && (document.getElementById('permissionModal').style.display = 'flex');
  }, 2000);
}

document.getElementById('allowNotifications')?.addEventListener('click', () => {
  Notification.requestPermission().then(p => {
    document.getElementById('permissionModal').style.display = 'none';
  });
});
document.getElementById('denyNotifications')?.addEventListener('click', () => {
  document.getElementById('permissionModal').style.display = 'none';
});

// Logout
logoutBtn?.addEventListener('click', () => {
  storage.remove('admin_token');
  window.location.href = '/login';
});

// Initial state
dom.show(emptyQueueEl);
fetchHistory();
