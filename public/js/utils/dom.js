/**
 * DOM utility for cleaner selector usage and manipulation.
 */

export const $ = (selector) => document.querySelector(selector);
export const $$ = (selector) => document.querySelectorAll(selector);

export const dom = {
  show: (el) => {
    if (el) el.style.display = '';
  },
  hide: (el) => {
    if (el) el.style.display = 'none';
  },
  text: (el, content) => {
    if (el) el.textContent = content;
  },
  html: (el, content) => {
    if (el) el.innerHTML = content;
  },
  on: (el, event, handler) => {
    if (el) el.addEventListener(event, handler);
  },
  addClass: (el, className) => {
    if (el) el.classList.add(className);
  },
  removeClass: (el, className) => {
    if (el) el.classList.remove(className);
  },
  toggleClass: (el, className, force) => {
    if (el) el.classList.toggle(className, force);
  }
};
