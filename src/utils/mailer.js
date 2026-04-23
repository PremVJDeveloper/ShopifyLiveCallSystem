'use strict';
/**
 * mailer.js — Email sending utility using nodemailer.
 * Supports Gmail (via App Password) or any SMTP server.
 *
 * Required .env vars:
 *   SMTP_HOST     (e.g. smtp.gmail.com)
 *   SMTP_PORT     (e.g. 587)
 *   SMTP_USER     (your full gmail address)
 *   SMTP_PASS     (Gmail App Password — NOT your gmail login password)
 *   SMTP_FROM     (e.g. "Vaama Live <no-reply@vaama.co>")
 *   ADMIN_EMAIL   (admin receives call notifications)
 *   DEVELOPER_EMAIL (developer receives all notifications)
 */

const logger = require('./logger');

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

/**
 * Send an email. Silently fails (logs error) if SMTP not configured.
 */
async function send({ to, subject, html, text }) {
  if (!_isConfigured()) {
    logger.warn('Email not sent — SMTP_USER/SMTP_PASS not configured', { to, subject });
    return false;
  }
  const t = _getTransporter();
  if (!t) return false;
  try {
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    await t.sendMail({ from, to, subject, html, text });
    logger.info('Email sent', { to, subject });
    return true;
  } catch (err) {
    logger.error('Email send failed', { error: err.message, to, subject });
    return false;
  }
}

// ── Email templates ──────────────────────────────────────────────

/**
 * Send confirmation email to the customer.
 */
async function sendCustomerConfirmation({ name, email, scheduledAt, joinUrl, lookingFor, priceRange }) {
  const dt = new Date(scheduledAt);
  const fmt = dt.toLocaleString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long',
    year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
    timeZone: 'Asia/Kolkata',
  });

  await send({
    to: email,
    subject: `Your Vaama Live call is confirmed — ${fmt} IST`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="font-family:Inter,Arial,sans-serif;background:#0a0a12;color:#f1f5f9;margin:0;padding:0;">
  <div style="max-width:520px;margin:32px auto;background:#12121e;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;">
    <div style="background:linear-gradient(135deg,#7c3aed,#1e1b4b);padding:32px;text-align:center;">
      <div style="font-size:32px;margin-bottom:8px;">💎</div>
      <h1 style="margin:0;font-size:22px;color:#fff;font-weight:800;">Your Call is Confirmed!</h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,0.7);font-size:14px;">Vaama Live Jewellery Consultation</p>
    </div>
    <div style="padding:32px;">
      <p style="margin:0 0 16px;font-size:15px;color:#f1f5f9;">Hi <strong>${name}</strong>,</p>
      <p style="margin:0 0 24px;font-size:14px;color:rgba(241,245,249,0.7);line-height:1.6;">
        Your live jewellery consultation is scheduled. A Vaama expert will be ready for you at your scheduled time.
      </p>

      <div style="background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.3);border-radius:10px;padding:16px;margin-bottom:24px;text-align:center;">
        <div style="font-size:12px;color:#a78bfa;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px;">Scheduled Time</div>
        <div style="font-size:18px;font-weight:700;color:#fff;">📅 ${fmt} IST</div>
        ${lookingFor ? `<div style="margin-top:8px;font-size:13px;color:#a78bfa;">Category: <strong>${lookingFor}</strong></div>` : ''}
        ${priceRange ? `<div style="margin-top:4px;font-size:13px;color:#a78bfa;">Price Range: <strong>${priceRange}</strong></div>` : ''}
      </div>

      <a href="${joinUrl}" style="display:block;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;text-decoration:none;text-align:center;padding:16px;border-radius:10px;font-size:15px;font-weight:700;margin-bottom:16px;">
        🚀 Join Your Call
      </a>

      <div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:12px;margin-bottom:24px;">
        <div style="font-size:11px;color:rgba(241,245,249,0.4);margin-bottom:4px;">Or copy this link:</div>
        <div style="font-size:12px;color:#a78bfa;word-break:break-all;">${joinUrl}</div>
      </div>

      <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:16px;">
        <p style="font-size:12px;color:rgba(241,245,249,0.4);margin:0;line-height:1.6;">
          💡 <strong>Tip:</strong> The link becomes active 15 minutes before your scheduled time and remains valid for 1 hour after.<br/>
          Questions? Reply to this email or visit <a href="https://vaama.co" style="color:#a78bfa;">vaama.co</a>
        </p>
      </div>
    </div>
  </div>
</body>
</html>`,
    text: `Hi ${name},\n\nYour Vaama Live consultation is confirmed for: ${fmt} IST\n\nJoin here: ${joinUrl}\n\nThe link becomes active 15 minutes before your scheduled time.\n\nVaama Jewellery`,
  });
}

/**
 * Send notification email to admin + developer when a call is scheduled.
 */
async function sendAdminNotification({ name, phone, email, scheduledAt, joinUrl, lookingFor, priceRange }) {
  const dt = new Date(scheduledAt);
  const fmt = dt.toLocaleString('en-IN', {
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

  await send({
    to: recipients,
    subject: `📞 New call scheduled by ${name} — ${fmt} IST`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="font-family:Arial,sans-serif;background:#f8fafc;color:#1e293b;margin:0;padding:16px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
    <div style="background:#7c3aed;padding:20px 24px;">
      <h2 style="margin:0;color:#fff;font-size:18px;">📞 New Scheduled Call</h2>
    </div>
    <div style="padding:24px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:8px 0;color:#64748b;width:100px;">Name</td><td style="padding:8px 0;font-weight:600;">${name}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Phone</td><td style="padding:8px 0;">${phone || '—'}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Email</td><td style="padding:8px 0;">${email || '—'}</td></tr>
        ${lookingFor ? `<tr><td style="padding:8px 0;color:#64748b;">Category</td><td style="padding:8px 0;"><span style="background:#ede9fe;color:#7c3aed;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;">${lookingFor}</span></td></tr>` : ''}
        ${priceRange ? `<tr><td style="padding:8px 0;color:#64748b;">Price Range</td><td style="padding:8px 0;"><span style="background:#fef3c7;color:#d97706;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;">${priceRange}</span></td></tr>` : ''}
        <tr><td style="padding:8px 0;color:#64748b;">Time</td><td style="padding:8px 0;font-weight:600;color:#7c3aed;">${fmt} IST</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;">Join Link</td><td style="padding:8px 0;"><a href="${joinUrl}" style="color:#7c3aed;">${joinUrl}</a></td></tr>
      </table>

      <a href="${joinUrl}" style="display:inline-block;margin-top:16px;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">
        Open Admin Panel
      </a>
    </div>
  </div>
</body>
</html>`,
    text: `New call scheduled!\n\nName: ${name}\nPhone: ${phone}\nEmail: ${email}\nTime: ${fmt} IST\nJoin: ${joinUrl}`,
  });
}

module.exports = { send, sendCustomerConfirmation, sendAdminNotification };
