/**
 * Chat module — manages the chat UI, messages, and notifications.
 */
import { dom } from '../utils/dom.js';

const MAX_MESSAGE_LENGTH = 2000;
let messages = [];
let unreadCount = 0;
let isPanelOpen = false;
let senderName = 'You';
let senderRole = 'user';
let onSendCallback = null;

// DOM refs — set after page load
let panelEl, messagesEl, inputEl, sendBtnEl, unreadBadgeEl;

export function init({ panel, messagesContainer, input, sendBtn, unreadBadge, name, role }) {
  panelEl = panel;
  messagesEl = messagesContainer;
  inputEl = input;
  sendBtnEl = sendBtn;
  unreadBadgeEl = unreadBadge;
  senderName = name;
  senderRole = role;

  // Consolidate listeners
  dom.on(sendBtnEl, 'click', performSend);
  dom.on(inputEl, 'keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      performSend();
    }
  });
}

export function togglePanel() {
  isPanelOpen = !isPanelOpen;
  dom.toggleClass(panelEl, 'open', isPanelOpen);
  if (isPanelOpen) {
    unreadCount = 0;
    updateBadge();
    scrollToBottom();
  }
  return isPanelOpen;
}

export function openPanel() {
  isPanelOpen = true;
  dom.addClass(panelEl, 'open');
  unreadCount = 0;
  updateBadge();
  scrollToBottom();
}

export function closePanel() {
  isPanelOpen = false;
  dom.removeClass(panelEl, 'open');
}

export function clearUnread() {
  unreadCount = 0;
  updateBadge();
}

export function addSystemMessage(text) {
  addMessage({ type: 'system', text, name: 'System', timestamp: new Date() });
}

export function addMyMessage(text) {
  addMessage({ type: 'me', text, name: 'You', timestamp: new Date() });
}

export function addPeerMessage({ message, senderName: peerName, timestamp }) {
  addMessage({ type: 'peer', text: message, name: peerName, timestamp: new Date(timestamp) });
  if (!isPanelOpen) {
    unreadCount++;
    updateBadge();
    // Desktop notification
    if (Notification.permission === 'granted' && document.hidden) {
      new Notification(`New message from ${peerName}`, {
        body: message.substring(0, 80),
      });
    }
  }
}

export function addProductMessage(product, isMine = false) {
  const priceVal = product.price || product.variants?.[0]?.price;
  const price = priceVal
    ? `₹${parseFloat(priceVal).toLocaleString('en-IN')}`
    : '';
  const img = product.image_url || product.image?.src || '';
  const url = `https://vaama.co/products/${product.handle}`;

  const msgEl = document.createElement('div');
  msgEl.className = `chat-message product-card-message ${isMine ? 'me-message' : 'peer-message'}`;
  msgEl.innerHTML = `
    <div class="message-meta">
      <span>${isMine ? 'You' : 'Admin'} shared a product</span>
      <span class="msg-time">${formatTime(new Date())}</span>
    </div>
    <a class="product-card-inline" href="${url}" target="_blank" rel="noopener">
      ${img ? `<img src="${img}" alt="" />` : '<div class="product-no-img">📦</div>'}
      <div class="product-card-info">
        <strong>${escapeHtml(product.title || '')}</strong>
        ${price ? `<span class="product-price">${price}</span>` : ''}
      </div>
    </a>
  `;
  messagesEl.appendChild(msgEl);
  scrollToBottom();
}

function performSend() {
  const text = inputEl.value.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!text) return;
  inputEl.value = '';
  inputEl.style.height = 'auto';
  addMyMessage(text);
  
  if (onSendCallback) {
    onSendCallback(text);
  }
}

// Set a custom send handler that also handles socket emit
export function setSendHandler(onSend) {
  onSendCallback = onSend;
}

function addMessage({ type, text, name, timestamp }) {
  messages.push({ type, text, name, timestamp });
  const el = document.createElement('div');
  el.className = `chat-message ${type}-message`;
  el.innerHTML = `
    <div class="message-meta">
      <span class="msg-name">${escapeHtml(name)}</span>
      <span class="msg-time">${formatTime(timestamp)}</span>
    </div>
    <div class="msg-body">${escapeHtml(text)}</div>
  `;
  messagesEl.appendChild(el);
  scrollToBottom();
}

function updateBadge() {
  if (unreadBadgeEl) {
    unreadBadgeEl.textContent = unreadCount;
    dom.toggleClass(unreadBadgeEl, 'visible', unreadCount > 0 && !isPanelOpen);
  }
}

function scrollToBottom() {
  if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
