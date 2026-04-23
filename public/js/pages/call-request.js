/**
 * call-request.js — Waiting room page.
 */
import { socketClient } from '../lib/socket-client.js';
import { session } from '../utils/storage.js';
import { dom } from '../utils/dom.js';

const params     = new URLSearchParams(window.location.search);
const encodedData = params.get('data');
const userId     = session.getUserId();

// Decode user data
let userData = {};
if (encodedData) {
  try { userData = JSON.parse(atob(encodedData)); } catch {}
}
if (!userData.name)      userData.name      = params.get('name')       || 'Guest';
if (!userData.phone)     userData.phone     = params.get('phone')      || '';
if (!userData.lookingFor) userData.lookingFor = params.get('looking_for') || '';
if (!userData.returnUrl) userData.returnUrl = params.get('return_url') || 'https://vaama.co';

// DOM
const statusEl     = document.getElementById('status');
const messageEl    = document.getElementById('message');
const cancelBtn    = document.getElementById('cancelBtn');
const userInfoEl   = document.getElementById('userInfoContainer');
const nameEl       = document.getElementById('displayName');
const phoneEl      = document.getElementById('displayPhone');
const returnUrlEl  = document.getElementById('displayReturnUrl');
const queuePosEl   = document.getElementById('queuePosition');

// Show user info
if (userData.name || userData.phone) {
  dom.show(userInfoEl);
  dom.text(nameEl, userData.name);
  dom.text(phoneEl, userData.phone);
  try {
    dom.text(returnUrlEl, new URL(userData.returnUrl).pathname);
  } catch {
    dom.text(returnUrlEl, userData.returnUrl);
  }
}

// Connect
const socket = socketClient.connect({ query: { userId } });

socket.on('connect', () => {
  dom.text(statusEl, 'Requesting video call…');
  dom.text(messageEl, `Connecting as "${userData.name}"`);

  socket.emit('request-call', {
    name:       userData.name,
    phone:      userData.phone,
    lookingFor: userData.lookingFor,
    priceRange: userData.priceRange,
    returnUrl:  userData.returnUrl,
    timestamp:  new Date().toISOString(),
    userAgent:  navigator.userAgent,
    source:     window.location.hostname,
  });
});

socket.on('queue-status', ({ position, message }) => {
  dom.text(statusEl, message || `Queue position: #${position}`);
  if (position && queuePosEl) {
    queuePosEl.textContent = `#${position}`;
    dom.show(queuePosEl.parentElement);
  }
});

socket.on('call-accepted', ({ roomId, userId, userData: acceptedData }) => {
  dom.text(statusEl, 'Call accepted! Connecting…');
  dom.text(messageEl, 'Your support agent is ready.');
  const name = acceptedData?.name || userData.name;
  const returnUrlEncoded = encodeURIComponent(userData.returnUrl);
  setTimeout(() => {
    window.location.href =
      `/video-call?room=${roomId}&name=${encodeURIComponent(name)}&return_url=${returnUrlEncoded}`;
  }, 800);
});

socket.on('queue-timeout', ({ message }) => {
  dom.text(statusEl, 'Queue Expired');
  dom.text(messageEl, message || 'No agents are available right now. Please try again later.');
  if (cancelBtn) cancelBtn.textContent = 'Go Back';
});

socket.on('request-failed', ({ reason }) => {
  dom.text(statusEl, 'Request Failed');
  dom.text(messageEl, reason || 'Could not join queue. Please try again.');
});

socket.on('disconnect', () => {
  dom.text(statusEl, 'Connection lost');
  dom.text(messageEl, 'Reconnecting…');
});

socket.on('reconnect', () => {
  dom.text(statusEl, 'Reconnected');
  dom.text(messageEl, 'Re-sending your call request…');
  socket.emit('request-call', {
    name: userData.name, phone: userData.phone,
    lookingFor: userData.lookingFor,
    returnUrl: userData.returnUrl, timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent, source: window.location.hostname,
  });
});

cancelBtn?.addEventListener('click', () => {
  socket.emit('cancel-call');
  window.location.href = userData.returnUrl || 'https://vaama.co';
});

window.addEventListener('beforeunload', () => socket.emit('cancel-call'));
