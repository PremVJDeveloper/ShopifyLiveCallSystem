/**
 * login.js — Admin login page.
 */
import { storage } from '../utils/storage.js';
import { dom } from '../utils/dom.js';

const form      = document.getElementById('loginForm');
const userInput = document.getElementById('username');
const passInput = document.getElementById('password');
const submitBtn = document.getElementById('submitBtn');
const errorEl   = document.getElementById('errorMsg');

// If already authenticated, redirect
const existingToken = storage.get('admin_token');
if (existingToken) {
  verifyAndRedirect(existingToken);
}

async function verifyAndRedirect(token) {
  try {
    const res = await fetch('/api/auth/verify', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      window.location.href = '/admin';
    } else {
      storage.remove('admin_token');
    }
  } catch {}
}

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  dom.hide(errorEl);
  submitBtn.disabled = true;
  submitBtn.textContent = 'Signing in…';

  const username = userInput.value.trim();
  const password = passInput.value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (res.ok && data.token) {
      storage.set('admin_token', data.token);
      window.location.href = '/admin';
    } else {
      dom.text(errorEl, data.error || 'Invalid username or password');
      dom.show(errorEl);
      passInput.value = '';
      passInput.focus();
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
    }
  } catch {
    dom.text(errorEl, 'Network error. Please try again.');
    dom.show(errorEl);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In';
  }
});
