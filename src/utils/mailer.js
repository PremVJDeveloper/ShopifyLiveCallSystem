'use strict';
/**
 * mailer.js — Email sending utility using nodemailer.
 * Supports Gmail (via App Password) or any SMTP server.
 *
 * Required .env vars:
 *   SMTP_HOST       (e.g. smtp.gmail.com)
 *   SMTP_PORT       (e.g. 587)
 *   SMTP_USER       (your full gmail address)
 *   SMTP_PASS       (Gmail App Password — NOT your gmail login password)
 *   SMTP_FROM       (e.g. "Vaama Live <no-reply@vaama.co>")
 *   ADMIN_EMAIL     (admin receives call notifications)
 *   DEVELOPER_EMAIL (developer receives all notifications)
 *
 * Templates live in:  src/templates/<name>.html
 * Renderer:           src/templates/renderTemplate.js
 */

const logger         = require('./logger');
const { renderTemplate } = require('../templates/renderTemplate');

// ── SMTP transport (lazy-loaded) ──────────────────────────────────────────────

let transporter = null;

function _getTransporter() {
  if (transporter) return transporter;
  try {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST || 'smtp.gmail.com',
      port:   parseInt(process.env.SMTP_PORT) || 587,
      secure: parseInt(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    return transporter;
  } catch (err) {
    logger.warn('nodemailer not available — email sending disabled', { error: err.message });
    return null;
  }
}

function _isConfigured() {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

/** Extract bare address from "Display Name <addr@example.com>" */
function _bareAddress(fromString) {
  const m = (fromString || '').match(/<(.+)>/);
  return m ? m[1] : (fromString || process.env.SMTP_USER || '');
}

// ── Core send helper ──────────────────────────────────────────────────────────

/**
 * Send an email. Silently fails (logs error) if SMTP not configured.
 * @param {object} opts
 * @param {string}  opts.to
 * @param {string}  opts.subject
 * @param {string}  opts.html
 * @param {string}  opts.text        — plain-text fallback
 * @param {string}  [opts.replyTo]
 */
async function send({ to, subject, html, text, replyTo }) {
  if (!_isConfigured()) {
    logger.warn('Email not sent — SMTP_USER/SMTP_PASS not configured', { to, subject });
    return false;
  }
  const t = _getTransporter();
  if (!t) return false;

  try {
    const from         = process.env.SMTP_FROM || process.env.SMTP_USER;
    const supportEmail = _bareAddress(process.env.SMTP_FROM) || process.env.SMTP_USER;

    await t.sendMail({
      from,
      to,
      subject,
      html,
      text,
      // ── Anti-spam headers ──────────────────────────────
      replyTo:            replyTo || supportEmail,
      'Reply-To':         replyTo || supportEmail,
      'X-Mailer':         'Vaama Live Mailer',
      'X-Priority':       '3',   // Normal (1=High is a spam signal)
      'List-Unsubscribe': `<mailto:${supportEmail}?subject=unsubscribe>`,
    });

    logger.info('Email sent', { to, subject });
    return true;
  } catch (err) {
    logger.error('Email send failed', { error: err.message, to, subject });
    return false;
  }
}

// ── Email templates ───────────────────────────────────────────────────────────

/**
 * Send confirmation email to the customer after scheduling a call.
 */
async function sendCustomerConfirmation({ name, email, scheduledAt, joinUrl, lookingFor, priceRange }) {
  const dt = new Date(scheduledAt);

  const fmtFull = dt.toLocaleString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long',
    year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
    timeZone: 'Asia/Kolkata',
  });

  const dateFormatted = dt.toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });

  const timeFormatted = dt.toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true,
    timeZone: 'Asia/Kolkata',
  });

  const baseUrl = (() => { try { return new URL(joinUrl).origin; } catch { return ''; } })();

  const html = renderTemplate('customerConfirmation', {
    name,
    dateFormatted,
    timeFormatted,
    joinUrl,
    lookingFor,
    priceRange,
    baseUrl,
  });

  const text =
    `Hi ${name},\n\n` +
    `Your Vaama Live jewellery consultation is confirmed.\n\n` +
    `Date & Time : ${fmtFull} IST\n` +
    (lookingFor  ? `Category    : ${lookingFor}\n`  : '') +
    (priceRange  ? `Price Range : ${priceRange}\n`  : '') +
    `\nJoin here   : ${joinUrl}\n\n` +
    `The link activates 15 minutes before your session and is valid for 1 hour.\n\n` +
    `Need help? Reply to this email or write to support@vaama.co\n\n` +
    `— Vaama Live`;

  await send({
    to:      email,
    subject: `Your Vaama Live call is confirmed — ${fmtFull} IST`,
    html,
    text,
  });
}

/**
 * Send notification email to admin + developer when a call is scheduled.
 */
async function sendAdminNotification({ name, phone, email, scheduledAt, joinUrl, lookingFor, priceRange }) {
  const dt = new Date(scheduledAt);

  const fmtDate = dt.toLocaleString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long',
    year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
    timeZone: 'Asia/Kolkata',
  });

  const recipients = [
    process.env.ADMIN_EMAIL,
    process.env.DEVELOPER_EMAIL,
  ].filter(Boolean).join(',');

  if (!recipients) {
    logger.warn('No ADMIN_EMAIL or DEVELOPER_EMAIL set — admin notification skipped');
    return;
  }

  const html = renderTemplate('adminNotification', {
    name,
    phone:      phone  || '—',
    email:      email  || '—',
    fmtDate,
    joinUrl,
    lookingFor,
    priceRange,
  });

  const text =
    `New call scheduled!\n\n` +
    `Name       : ${name}\n` +
    `Phone      : ${phone  || '—'}\n` +
    `Email      : ${email  || '—'}\n` +
    `Time       : ${fmtDate} IST\n` +
    (lookingFor ? `Category   : ${lookingFor}\n` : '') +
    (priceRange ? `Price Range: ${priceRange}\n` : '') +
    `Join       : ${joinUrl}`;

  await send({
    to:      recipients,
    subject: `New call scheduled by ${name} — ${fmtDate} IST`,
    html,
    text,
  });
}

module.exports = { send, sendCustomerConfirmation, sendAdminNotification };
