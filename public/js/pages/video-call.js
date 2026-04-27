/**
 * video-call.js — Page orchestrator (thin).
 * Imports all modules and wires them together.
 */
import { socketClient } from '../lib/socket-client.js';
import { WebRTCManager } from '../lib/webrtc.js';
import { session } from '../utils/storage.js';
import * as Media from '../modules/media.js';
import * as Chat from '../modules/chat.js';
import * as Controls from '../modules/controls.js';
import * as Catalog from '../modules/catalog.js';

// ─── URL Params ────────────────────────────────────────────────
const params = new URLSearchParams(window.location.search);
const roomId   = params.get('room');
const role     = params.get('role') || 'user';
const userName = params.get('name') || (role === 'admin' ? 'Support Agent' : 'Customer');
const returnUrl      = params.get('return_url')       || 'https://vaama.co';
const adminReturnUrl = params.get('admin_return_url') || '/admin';
const userId = session.getUserId();   // stable UUID across refreshes

// ─── DOM refs ──────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const statusEl        = $('status');
const connStatusEl    = $('connectionStatus');
const localVideo      = $('localVideo');
const remoteVideo     = $('remoteVideo');
const localLabel      = $('localLabel');
const remoteLabel     = $('remoteLabel');
const permOverlay     = $('permissionOverlay');
const permMessage     = $('permissionMessage');
const retryPermBtn    = $('retryPermission');
const skipPermBtn     = $('skipPermission');
const toggleVideoBtn  = $('toggleVideo');
const toggleAudioBtn  = $('toggleAudio');
const toggleScreenBtn = $('toggleScreen');
const endCallBtn      = $('endCall');
const toggleChatBtn   = $('toggleChat');
const unreadBadge     = $('unreadBadge');
const chatPanel       = $('chatPanel');
const chatMessages    = $('chatMessages');
const chatInput       = $('chatInput');
const sendMsgBtn      = $('sendMessage');
const catalogPanel    = $('catalogPanel');
const catalogGrid     = $('productsGrid');
const catalogSearch   = $('productSearch');
const vendorFilter    = $('vendorFilter');
const typeFilter      = $('typeFilter');
const prevPage        = $('prevPage');
const nextPage        = $('nextPage');
const pageInfo        = $('pageInfo');
const modalEl         = $('productModal');
const durationEl      = $('callDuration');

// ─── State ─────────────────────────────────────────────────────
let peerSocketId = null;
let rtcManager = null;
let localStream = null;
let callStartTime = null;
let durationTimer = null;

// ─── Shared panel helpers (module-level so init + startCall share them) ──
const isMobile = () => window.innerWidth <= 640;
let closeChatRef    = () => {};   // set in init()
let closeCatalogRef = () => {};   // set in startCall()

// ─── Fetch ICE servers from server ─────────────────────────────
async function getIceServers() {
  try {
    const res = await fetch('/api/ice-servers');
    const data = await res.json();
    return data.iceServers;
  } catch {
    return [{ urls: 'stun:stun.l.google.com:19302' }];
  }
}

// ─── Main init ─────────────────────────────────────────────────
async function init() {
  if (!roomId) {
    setStatus('Error: No room ID. Please start a call from the main page.', 'error');
    return;
  }

  // Set labels
  localLabel.textContent = role === 'admin' ? 'You (Agent)' : userName;
  remoteLabel.textContent = role === 'admin' ? 'Customer' : 'Support Agent';

  // Init chat
  Chat.init({
    panel: chatPanel, messagesContainer: chatMessages,
    input: chatInput, sendBtn: sendMsgBtn, unreadBadge,
    name: userName, role,
  });
  Chat.setSendHandler((text) => {
    socket.emit('chat-message', { room: roomId, message: text, senderName: userName, senderRole: role });
  });
  Chat.addSystemMessage('Connecting to your call…');

  // Toggle chat panel (header button + control bar button)
  const openChat  = () => {
    // On mobile: close catalog first if it's open
    if (isMobile()) closeCatalogRef();
    chatPanel.classList.add('open');
    if (toggleChatBtn) toggleChatBtn.querySelector('.btn-icon').textContent = '✕';
    Chat.clearUnread();
  };
  const closeChat = () => {
    chatPanel.classList.remove('open');
    if (toggleChatBtn) toggleChatBtn.querySelector('.btn-icon').textContent = '💬';
  };
  // Wire module-level ref so startCall()'s openCatalog can call closeChat on mobile
  closeChatRef = closeChat;
  toggleChatBtn?.addEventListener('click', () => chatPanel.classList.contains('open') ? closeChat() : openChat());
  document.getElementById('closeChat')?.addEventListener('click', closeChat);

  // Quick responses (admin only)
  if (role === 'admin') {
    document.querySelectorAll('.quick-response-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const msg = btn.dataset.message;
        socket.emit('chat-message', { room: roomId, message: msg, senderName: userName, senderRole: role });
        Chat.addMyMessage(msg);
      });
    });
    document.getElementById('quickResponses')?.style && (document.getElementById('quickResponses').style.display = 'block');
  }

  // Acquire media
  setStatus('Requesting camera & microphone…', 'connecting');
  permOverlay.style.display = 'none';
  let hasVideo = false;

  try {
    const result = await Media.requestMedia();
    localStream = result.stream;
    hasVideo = result.hasVideo;
    localVideo.srcObject = localStream;
    if (!hasVideo) localLabel.textContent += ' (audio only)';
  } catch (err) {
    permOverlay.style.display = 'flex';
    permMessage.textContent = 'Camera/microphone access denied.';
    setStatus('Waiting for media permissions…', 'error');
    return;
  }

  // Permission retry
  retryPermBtn?.addEventListener('click', async () => {
    permOverlay.style.display = 'none';
    try {
      const result = await Media.requestMedia();
      localStream = result.stream;
      localVideo.srcObject = localStream;
      await startCall();
    } catch {
      permOverlay.style.display = 'flex';
    }
  });

  // Skip (audio only)
  skipPermBtn?.addEventListener('click', async () => {
    try {
      localStream = (await navigator.mediaDevices.getUserMedia({ audio: true, video: false }));
      localVideo.srcObject = null;
      permOverlay.style.display = 'none';
      await startCall();
    } catch { /* ignore */ }
  });

  await startCall();
}

async function startCall() {
  setStatus('Connecting to room…', 'connecting');

  // Init WebRTC
  const iceServers = await getIceServers();
  rtcManager = new WebRTCManager({ iceServers });
  rtcManager.init();
  rtcManager.addStream(localStream);

  rtcManager.onTrackCallback = (remoteStream) => {
    remoteVideo.srcObject = remoteStream;
    // Hide the "waiting" overlay as soon as a remote track arrives
    const overlay = document.getElementById('remoteOverlay');
    if (overlay) overlay.style.display = 'none';
  };

  rtcManager.onIceCandidateCallback = (candidate) => {
    socket.emit('ice', { room: roomId, candidate, targetId: peerSocketId });
  };

  rtcManager.onConnectionStateChangeCallback = (state) => {
    const labels = {
      connected:    { text: 'Connected ✓',     css: 'connected' },
      connecting:   { text: 'Connecting…',      css: 'connecting' },
      disconnected: { text: 'Reconnecting…',    css: 'reconnecting' },
      failed:       { text: 'Connection failed', css: 'error' },
      closed:       { text: 'Call ended',        css: '' },
    };
    const l = labels[state] || { text: state, css: '' };
    if (connStatusEl) { connStatusEl.textContent = l.text; connStatusEl.className = `connection-badge ${l.css}`; }

    if (state === 'connected') {
      callStartTime = callStartTime || Date.now();
      startDurationTimer();
      Chat.addSystemMessage('Video call connected ✓');
      // Also hide overlay when ICE reaches connected
      const overlay = document.getElementById('remoteOverlay');
      if (overlay) overlay.style.display = 'none';
    }
    if (state === 'disconnected') {
      // Show overlay again while reconnecting
      const overlay = document.getElementById('remoteOverlay');
      if (overlay) { overlay.style.display = 'flex'; }
      Chat.addSystemMessage('Connection lost. Attempting to reconnect…');
    }
    if (state === 'failed') {
      Chat.addSystemMessage('Connection failed. Try refreshing the page.');
    }
  };

  // Init controls
  Controls.init({
    stream: localStream,
    pc: rtcManager.pc,
    localVideo,
    onStateChange: null,
  });

  // Notify server media is ready
  socket.emit('room-joined', { room: roomId, role, mediaReady: true });
  socket.emit('media-ready', { room: roomId, hasVideo: localStream.getVideoTracks().length > 0, hasAudio: true });

  // Admin initialises catalog
  if (role === 'admin' && catalogPanel) {
    // Show the catalog toggle button in the control bar
    const catalogToggleBtn = document.getElementById('toggleCatalogBtn');
    if (catalogToggleBtn) catalogToggleBtn.style.display = '';

    // Show the catalog panel element (it starts hidden to avoid flash)
    catalogPanel.style.display = 'flex';

    Catalog.init({
      grid: catalogGrid, search: catalogSearch,
      vendor: vendorFilter, type: typeFilter,
      prev: prevPage, next: nextPage, pageInfo,
      modal: modalEl,
      onSend: (product) => {
        socket.emit('send-product', { room: roomId, product });
        Chat.addProductMessage(product, true);
      },
    });
    Catalog.load();

    // Left-drawer open/close helpers (toggle .open class — same pattern as chat panel)
    const openCatalog  = () => {
      // On mobile: close chat first if it's open
      if (isMobile()) closeChatRef();
      catalogPanel.classList.add('open');
      if (catalogToggleBtn) {
        catalogToggleBtn.querySelector('.btn-icon').textContent = '✕';
        catalogToggleBtn.classList.add('active');
      }
    };
    const closeCatalog = () => {
      catalogPanel.classList.remove('open');
      if (catalogToggleBtn) {
        catalogToggleBtn.querySelector('.btn-icon').textContent = '📦';
        catalogToggleBtn.classList.remove('active');
      }
    };
    // Expose closeCatalog so openChat (defined above) can call it on mobile
    closeCatalogRef = closeCatalog;

    // Control-bar toggle button
    catalogToggleBtn?.addEventListener('click', () =>
      catalogPanel.classList.contains('open') ? closeCatalog() : openCatalog()
    );

    // Close (✕) button inside drawer header
    document.getElementById('toggleCatalog')?.addEventListener('click', closeCatalog);
  }

  // Request notification permission
  if (Notification.permission === 'default') Notification.requestPermission();
}

// ─── Socket setup ──────────────────────────────────────────────
const socket = socketClient.connect({ query: { userId } });

socket.on('connect', () => {
  socket.emit('join-room', roomId);
});

socket.on('user-joined', async ({ id }) => {
  peerSocketId = id;
  setStatus(role === 'admin' ? 'Customer joined' : 'Agent joined', 'connecting');
  Chat.addSystemMessage(`${role === 'admin' ? 'Customer' : 'Support agent'} joined the call`);
  await new Promise(r => setTimeout(r, 500));
  // Admin is the offerer
  if (role === 'admin' && rtcManager) {
    try {
      const offer = await rtcManager.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      socket.emit('offer', { room: roomId, offer, targetId: peerSocketId });
    } catch (e) { console.error('Create offer failed:', e); }
  }
});

socket.on('offer', async (offer) => {
  if (!rtcManager) return;
  try {
    const answer = await rtcManager.handleOffer(offer);
    socket.emit('answer', { room: roomId, answer, targetId: peerSocketId });
  } catch (e) { console.error('Handle offer failed:', e); }
});

socket.on('answer', async (answer) => {
  if (!rtcManager) return;
  try { await rtcManager.handleAnswer(answer); }
  catch (e) { console.error('Handle answer failed:', e); }
});

socket.on('ice', async (candidate) => {
  if (!rtcManager) return;
  try { await rtcManager.addIceCandidate(candidate); }
  catch (e) { console.error('ICE candidate error:', e); }
});

socket.on('peer-reconnected', (data) => {
  peerSocketId = data.socketId;
  Chat.addSystemMessage(`${data.role === 'admin' ? 'Agent' : 'Customer'} reconnected`);
  if (role === 'admin' && rtcManager) {
    setTimeout(async () => {
      const offer = await rtcManager.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      socket.emit('offer', { room: roomId, offer, targetId: peerSocketId });
    }, 1000);
  }
});

socket.on('peer-disconnected', () => {
  Chat.addSystemMessage('Other party disconnected. Waiting for reconnection…');
});

socket.on('user-reconnected', (data) => {
  peerSocketId = data.id;
  Chat.addSystemMessage('Peer reconnected');
});

socket.on('chat-message', (data) => {
  Chat.addPeerMessage(data);
});

socket.on('product-shared', (data) => {
  if (data.sender !== socket.id) Chat.addProductMessage(data.product, false);
});
socket.on('products-shared', (data) => {
  if (data.sender !== socket.id) {
    data.products.forEach((p, i) => setTimeout(() => Chat.addProductMessage(p, false), i * 300));
  }
});

socket.on('peer-media-ready', (data) => {
  Chat.addSystemMessage(`Peer media ready (video: ${data.hasVideo}, audio: ${data.hasAudio})`);
});

socket.on('call-ended', () => {
  Chat.addSystemMessage('Call ended by other party');
  endCall(false);
  setTimeout(redirect, 2000);
});

socket.on('call-ended-confirm', () => redirect());

socket.on('connection-timeout', () => {
  setStatus('Connection timeout — please refresh', 'error');
  Chat.addSystemMessage('Connection timed out. Please refresh and try again.');
});

socket.on('reconnect', () => {
  socket.emit('join-room', roomId);
  socket.emit('reconnect-call', { room: roomId, userId });
});

socket.on('reconnect-success', () => {
  setStatus('Reconnected to call', 'connected');
  Chat.addSystemMessage('Reconnected ✓');
  if (rtcManager && role === 'admin') {
    setTimeout(async () => {
      const offer = await rtcManager.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      socket.emit('offer', { room: roomId, offer, targetId: peerSocketId });
    }, 500);
  }
});

// ─── Controls ──────────────────────────────────────────────────
toggleVideoBtn?.addEventListener('click', () => {
  const on = Controls.toggleVideo(toggleVideoBtn);
  Chat.addSystemMessage(`You ${on ? 'enabled' : 'disabled'} your camera`);
});
toggleAudioBtn?.addEventListener('click', () => {
  const on = Controls.toggleAudio(toggleAudioBtn);
  Chat.addSystemMessage(`You ${on ? 'unmuted' : 'muted'} your microphone`);
});
toggleScreenBtn?.addEventListener('click', async () => {
  const sharing = await Controls.toggleScreenShare(toggleScreenBtn);
  Chat.addSystemMessage(sharing ? 'You started screen sharing' : 'You stopped screen sharing');
});
endCallBtn?.addEventListener('click', () => {
  socket.emit('end-call', { room: roomId, reason: 'user-ended' });
  endCall(true);
});

// ─── Helpers ───────────────────────────────────────────────────
function endCall(byMe = true) {
  stopDurationTimer();
  Controls.cleanup();
  rtcManager?.close();
  remoteVideo.srcObject = null;
  localVideo.srcObject = null;
  setStatus('Call ended', '');
}

function redirect() {
  socket.emit('leave-room', roomId);
  window.location.href = role === 'admin' ? adminReturnUrl : returnUrl;
}

function setStatus(text, type = '') {
  statusEl.textContent = text;
  statusEl.className = `status-text ${type}`;
}

function startDurationTimer() {
  if (durationTimer || !durationEl) return;
  durationTimer = setInterval(() => {
    const s = Math.floor((Date.now() - callStartTime) / 1000);
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    durationEl.textContent = `${m}:${sec}`;
  }, 1000);
}

function stopDurationTimer() {
  clearInterval(durationTimer);
  durationTimer = null;
}

// Warn on unload
window.addEventListener('beforeunload', (e) => {
  socket.emit('leave-room', roomId);
  if (rtcManager?.pc?.connectionState === 'connected') {
    e.preventDefault();
    e.returnValue = 'Are you sure you want to leave the call?';
  }
});

// ─── Start ─────────────────────────────────────────────────────
window.addEventListener('load', init);
