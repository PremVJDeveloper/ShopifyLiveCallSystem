/**
 * index.js — Landing page logic: Join Now + Schedule a Call
 */

// ── DOM refs ────────────────────────────────────────────────────
const nameEl        = document.getElementById('userName');
const phoneEl       = document.getElementById('userPhone');
const emailEl       = document.getElementById('userEmail');
const lookingForEl  = document.getElementById('lookingFor');
const priceRangeEl  = document.getElementById('priceRange');
const otherField    = document.getElementById('otherField');
const otherEl       = document.getElementById('lookingForOther');
const emailWrapper  = document.getElementById('emailFieldWrapper');
const emailError    = document.getElementById('emailError');
const nameError     = document.getElementById('nameError');
const joinNowBtn    = document.getElementById('joinNowBtn');
const scheduleBtn   = document.getElementById('scheduleBtn');
const chips         = document.querySelectorAll('.chip');
const customDtGroup = document.getElementById('customDtGroup');
const customDate    = document.getElementById('customDate');
const customTime    = document.getElementById('customTime');
const mainCard      = document.getElementById('mainCard');
const confirmCard   = document.getElementById('confirmCard');
const confirmSub    = document.getElementById('confirmSubtitle');
const confirmBadge  = document.getElementById('confirmTimeBadgeText');
const joinLinkUrl   = document.getElementById('joinLinkUrl');
const copyBtn       = document.getElementById('copyLinkBtn');
const joinNowConfirm= document.getElementById('joinNowConfirmBtn');
const scheduleAnother = document.getElementById('scheduleAnotherBtn');

// ── State ────────────────────────────────────────────────────────
let selectedSchedule = null; // '15' | '30' | '60' | 'custom'

// ── Prefill from URL params ──────────────────────────────────────
const params = new URLSearchParams(window.location.search);
if (params.get('name')) nameEl.value = params.get('name');
if (params.get('phone')) phoneEl.value = params.get('phone');

// Show/hide "Other" text input
lookingForEl?.addEventListener('change', () => {
  const isOther = lookingForEl.value === 'Other';
  otherField.style.display = isOther ? 'block' : 'none';
  if (isOther) otherEl.focus();
});

// ── Admin Availability ───────────────────────────────────────────
async function getAdminStatus() {
  try {
    const res = await fetch('/api/admin-status');
    const { adminOnline } = await res.json();
    return !!adminOnline;
  } catch (err) {
    console.error('Failed to check admin status:', err);
    return false;
  }
}

async function updateJoinNowVisibility() {
  const adminOnline = await getAdminStatus();
  if (!adminOnline) {
    joinNowBtn.style.display = 'none';
    
    // Avoid duplicate banners
    if (!document.querySelector('.offline-banner')) {
      const offlineMsg = document.createElement('div');
      offlineMsg.className = 'offline-banner';
      offlineMsg.innerHTML = '🕒 Experts are currently offline. Please schedule a call below.';
      joinNowBtn.parentNode.insertBefore(offlineMsg, joinNowBtn);
    }
  }
}

updateJoinNowVisibility();

// Helper: get final lookingFor value
function getLookingFor() {
  const base = lookingForEl?.value || '';
  if (base === 'Other') return otherEl?.value?.trim() || 'Other';
  return base;
}

const today = new Date();
const maxDate = new Date(today);
maxDate.setDate(today.getDate() + 7);
customDate.min = _toDateStr(today);
customDate.max = _toDateStr(maxDate);
customDate.value = _toDateStr(today);

// Set default time to nearest 30-min slot in future
const roundedTime = new Date(Math.ceil(Date.now() / (30*60*1000)) * 30*60*1000);
customTime.value = `${String(roundedTime.getHours()).padStart(2,'0')}:${String(roundedTime.getMinutes()).padStart(2,'0')}`;

// ── Schedule chip selection ──────────────────────────────────────
chips.forEach(chip => {
  chip.addEventListener('click', () => {
    // Deselect all
    chips.forEach(c => c.classList.remove('selected'));
    chip.classList.add('selected');
    selectedSchedule = chip.dataset.value;

    // Show/hide custom picker
    customDtGroup.classList.toggle('visible', selectedSchedule === 'custom');

    // Show email + schedule button
    emailWrapper.classList.add('visible');
    scheduleBtn.style.display = 'flex';
  });
});

// ── Join Now ────────────────────────────────────────────────────
joinNowBtn.addEventListener('click', () => {
  if (!_validateName()) return;
  const name = nameEl.value.trim();
  const phone = phoneEl.value.trim();
  const lookingFor = getLookingFor();
  const priceRange = priceRangeEl?.value || '';
  const returnUrl = params.get('return_url') || 'https://vaama.co';

  setLoading(joinNowBtn, true);
  const data = btoa(JSON.stringify({ name, phone, lookingFor, priceRange, returnUrl }));
  setTimeout(() => {
    window.location.href = `/call-request?data=${encodeURIComponent(data)}`;
  }, 400);
});

// ── Confirm Schedule ─────────────────────────────────────────────
scheduleBtn.addEventListener('click', async () => {
  if (!_validateName()) return;
  if (!_validateEmail()) return;

  const scheduledAt = _getScheduledTime();
  if (!scheduledAt) {
    alert('Please select a valid date and time.');
    return;
  }

  const name      = nameEl.value.trim();
  const phone     = phoneEl.value.trim();
  const email     = emailEl.value.trim();
  const lookingFor = getLookingFor();
  const priceRange = priceRangeEl?.value || '';
  const returnUrl = params.get('return_url') || 'https://vaama.co';

  setLoading(scheduleBtn, true);

  try {
    const res = await fetch('/api/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, email, lookingFor, priceRange, scheduledAt: scheduledAt.toISOString(), returnUrl }),
    });

    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Scheduling failed');

    // Show confirmation
    _showConfirmation(json, scheduledAt, name);

  } catch (err) {
    alert('Could not schedule: ' + err.message);
  } finally {
    setLoading(scheduleBtn, false);
  }
});

// ── Confirmation UI ─────────────────────────────────────────────
async function _showConfirmation(data, scheduledAt, name) {
  mainCard.style.display = 'none';
  confirmCard.style.display = 'block';

  const link = `${window.location.origin}/join/${data.token}`;
  joinLinkUrl.textContent = link;

  const fmt = scheduledAt.toLocaleString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
  confirmBadge.textContent = fmt;

  // Always hide Join Now on confirmation card as requested
  joinNowConfirm.style.display = 'none';
  confirmSub.textContent = `We've sent a confirmation to ${data.email || 'your email'} with joining instructions.`;

  // Set Back to Vaama link
  const backBtn = document.getElementById('backToVaamaBtn');
  if (backBtn) {
    const returnUrl = params.get('return_url') || 'https://vaama.co';
    backBtn.href = returnUrl;
  }

  copyBtn.onclick = () => {
    navigator.clipboard.writeText(link).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
    });
  };
}


scheduleAnother.addEventListener('click', () => {
  confirmCard.style.display = 'none';
  mainCard.style.display = 'block';
  // Reset
  chips.forEach(c => c.classList.remove('selected'));
  selectedSchedule = null;
  emailWrapper.classList.remove('visible');
  scheduleBtn.style.display = 'none';
  customDtGroup.classList.remove('visible');
  emailEl.value = '';
});

// ── Helpers ─────────────────────────────────────────────────────
function _validateName() {
  const valid = nameEl.value.trim().length >= 2;
  nameError.classList.toggle('visible', !valid);
  if (!valid) nameEl.focus();
  return valid;
}

function _validateEmail() {
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailEl.value.trim());
  emailError.classList.toggle('visible', !valid);
  if (!valid) emailEl.focus();
  return valid;
}

function _getScheduledTime() {
  const now = new Date();
  if (selectedSchedule === '15')  { now.setMinutes(now.getMinutes() + 15); return now; }
  if (selectedSchedule === '30')  { now.setMinutes(now.getMinutes() + 30); return now; }
  if (selectedSchedule === '60')  { now.setMinutes(now.getMinutes() + 60); return now; }
  if (selectedSchedule === 'custom') {
    if (!customDate.value || !customTime.value) return null;
    const dt = new Date(`${customDate.value}T${customTime.value}`);
    if (isNaN(dt) || dt <= new Date()) return null;
    return dt;
  }
  return null;
}

function _toDateStr(d) {
  return d.toISOString().split('T')[0];
}

function setLoading(btn, loading) {
  btn.classList.toggle('loading', loading);
  btn.disabled = loading;
}
