'use strict';
/**
 * renderTemplate.js
 * Minimal template renderer for email HTML files.
 *
 * Syntax:
 *   {{variable}}              — simple substitution
 *   {{#if variable}}...{{/if}} — conditional block (renders when value is truthy)
 */

const fs   = require('fs');
const path = require('path');

const TEMPLATES_DIR = __dirname;

/**
 * Load and render an email template.
 * @param {string} templateName  — filename without extension, e.g. 'customerConfirmation'
 * @param {Object} vars          — key/value pairs for {{variable}} substitution
 * @returns {string}             — rendered HTML string
 */
function renderTemplate(templateName, vars = {}) {
  const filePath = path.join(TEMPLATES_DIR, `${templateName}.html`);
  let html = fs.readFileSync(filePath, 'utf8');

  // 1. Process {{#if key}}...{{/if}} blocks
  html = html.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, block) => {
    return vars[key] ? block : '';
  });

  // 2. Substitute {{variable}} placeholders
  html = html.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = vars[key];
    return val !== undefined && val !== null ? String(val) : '';
  });

  return html;
}

module.exports = { renderTemplate };
