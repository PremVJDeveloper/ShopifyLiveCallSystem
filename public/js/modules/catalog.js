/**
 * Product catalog module — load, filter, paginate, send products.
 */
import { dom } from '../utils/dom.js';

let allProducts = [];
let filteredProducts = [];
let currentPage = 1;
const PER_PAGE = 50; // Increased to show more products at once

let currentModal = null;
let onSendProduct = null;

// DOM refs
let gridEl, searchEl, vendorEl, typeEl, prevBtn, nextBtn, pageInfoEl, modalEl;

export function init({ grid, search, vendor, type, prev, next, pageInfo, modal, onSend }) {
  gridEl = grid;
  searchEl = search;
  vendorEl = vendor;
  typeEl = type;
  prevBtn = prev;
  nextBtn = next;
  pageInfoEl = pageInfo;
  modalEl = modal;
  onSendProduct = onSend;
  _setupListeners();
}

export async function load() {
  try {
    dom.html(gridEl, '<div class="catalog-loading"><div class="spinner-sm"></div><p>Loading products…</p></div>');
    const res = await fetch('/data/products_catalog.json');
    if (!res.ok) throw new Error('Catalog not found');
    const data = await res.json();
    allProducts = data.products || [];
    _populateFilters();
    filteredProducts = [...allProducts];
    currentPage = 1;
    _updateCount();
    _render();

  } catch (e) {
    dom.html(gridEl, `<p class="catalog-error">⚠ Could not load catalog: ${e.message}</p>`);
  }
}

function _populateFilters() {
  const vendors = [...new Set(allProducts.map(p => p.vendor).filter(Boolean))].sort();
  const types = [...new Set(allProducts.map(p => p.product_type).filter(Boolean))].sort();

  vendors.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    vendorEl.appendChild(opt);
  });
  types.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    typeEl.appendChild(opt);
  });
}

function _filter() {
  const q = searchEl.value.toLowerCase();
  const vendor = vendorEl.value;
  const type = typeEl.value;

  filteredProducts = allProducts.filter(p => {
    const matchQ = !q || [p.title, p.handle, p.vendor, p.product_type]
      .join(' ').toLowerCase().includes(q);
    const matchVendor = !vendor || p.vendor === vendor;
    const matchType = !type || p.product_type === type;
    return matchQ && matchVendor && matchType;
  });

  currentPage = 1;
  _updateCount();
  _render();

}

function _render() {
  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PER_PAGE));
  const start = (currentPage - 1) * PER_PAGE;
  const page = filteredProducts.slice(start, start + PER_PAGE);

  if (page.length === 0) {
    dom.html(gridEl, '<p class="catalog-empty">No products match your search.</p>');
  } else {
    gridEl.innerHTML = '';
    page.forEach(product => {
      const card = _createCard(product);
      gridEl.appendChild(card);
    });
  }

  dom.text(pageInfoEl, `Page ${currentPage} of ${totalPages}`);
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
}

function _createCard(product) {
  const rawImg = product.image_url || product.image?.src || '';
  // Request a Shopify thumbnail (200×200) instead of full-res — much faster to load
  const img = rawImg ? _shopifyThumb(rawImg, 200) : '';
  const priceVal = product.price || product.variants?.[0]?.price;
  const price = priceVal
    ? `₹${parseFloat(priceVal).toLocaleString('en-IN')}`
    : '';
  const div = document.createElement('div');
  div.className = 'product-card';
  div.innerHTML = `
    <div class="product-card-img">
      ${img
        ? `<img src="${img}" alt="" loading="lazy" decoding="async" />`
        : '<div class="no-img-icon">📦</div>'}
    </div>
    <div class="product-card-details">
      <p class="product-title">${escapeHtml(product.title || '')}</p>
      ${price ? `<p class="product-price">${price}</p>` : ''}
    </div>
    <button class="send-product-btn" title="Send to customer">Send ↗</button>
  `;
  div.querySelector('.product-card-img').addEventListener('click', () => _openModal(product));
  div.querySelector('.product-title').addEventListener('click', () => _openModal(product));
  div.querySelector('.send-product-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (onSendProduct) onSendProduct(product);
    _flashBtn(e.target);
  });
  return div;
}

/** Convert a Shopify CDN URL to a sized thumbnail, e.g. _200x */
function _shopifyThumb(url, size = 200) {
  if (!url) return url;
  // Shopify format: filename.ext?v=xxx  →  filename_200x.ext?v=xxx
  return url.replace(/(\.(?:webp|jpg|jpeg|png|gif))(?=\?|$)/i, `_${size}x$1`);
}


function _openModal(product) {
  currentModal = product;
  const img = product.image_url || product.image?.src || '';
  const priceVal = product.price || product.variants?.[0]?.price;
  const price = priceVal
    ? `₹${parseFloat(priceVal).toLocaleString('en-IN')}`
    : 'N/A';
  const url = `https://vaama.co/products/${product.handle}`;

  dom.html(modalEl, `
    <div class="modal-box">
      <button class="modal-close-btn" id="closeModal">✕</button>
      ${img ? `<img src="${img}" alt="" class="modal-img" />` : ''}
      <div class="modal-meta">
        <h3>${escapeHtml(product.title || '')}</h3>
        <p><strong>Vendor:</strong> ${escapeHtml(product.vendor || '')}</p>
        <p><strong>Type:</strong> ${escapeHtml(product.product_type || '')}</p>
        <p><strong>Price:</strong> ${price}</p>
        <a href="${url}" target="_blank" rel="noopener" class="modal-link">${url}</a>
      </div>
      <div class="modal-actions">
        <button id="modalCopyUrl" class="btn-secondary">Copy URL</button>
        <button id="modalSend" class="btn-primary">Send to Customer ↗</button>
      </div>
    </div>
  `);
  dom.show(modalEl);

  document.getElementById('closeModal').onclick = () => dom.hide(modalEl);
  document.getElementById('modalCopyUrl').onclick = () => {
    navigator.clipboard.writeText(url);
    document.getElementById('modalCopyUrl').textContent = '✓ Copied!';
  };
  document.getElementById('modalSend').onclick = () => {
    if (onSendProduct) onSendProduct(product);
    dom.hide(modalEl);
  };
}

function _setupListeners() {
  dom.on(searchEl, 'input', _filter);
  dom.on(vendorEl, 'change', _filter);
  dom.on(typeEl, 'change', _filter);
  dom.on(prevBtn, 'click', () => { if (currentPage > 1) { currentPage--; _render(); } });
  dom.on(nextBtn, 'click', () => {
    const totalPages = Math.ceil(filteredProducts.length / PER_PAGE);
    if (currentPage < totalPages) { currentPage++; _render(); }
  });
}

function _flashBtn(btn) {
  const original = btn.textContent;
  btn.textContent = '✓ Sent!';
  btn.disabled = true;
  setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 2000);
}

function _updateCount() {
  const countEl = document.getElementById('catalogCount');
  if (countEl) {
    const total = allProducts.length;
    const shown = filteredProducts.length;
    countEl.textContent = shown < total ? `${shown} / ${total}` : `${total} products`;
    countEl.style.display = '';
  }
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
