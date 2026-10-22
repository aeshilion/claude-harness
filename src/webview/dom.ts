// @ts-nocheck
// DOM builders and formatters with no state of their own.

export const el = (tag, attrs, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'className') node.className = v;
    else if (k === 'value') node.value = v;
    else if (k === 'checked') node.checked = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== undefined && c !== null && c !== false) node.append(c.nodeType ? c : String(c));
  return node;
};

export const icon = name => el('span', { className: `codicon codicon-${name}` });

export const logo = size => (document.body.dataset.logo ? el('img', { className: `logo ${size}`, src: document.body.dataset.logo, alt: '' }) : icon('hubot'));

export const iconBtn = (name, title, onclick, disabled) => el('button', { className: 'icon-btn', title, 'aria-label': title, onclick, disabled }, icon(name));

// A div that acts as a button: clickable, focusable, and opened with Enter or Space.
export const pressable = fn => ({
  role: 'button',
  tabindex: '0',
  onclick: fn,
  onkeydown: e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    fn();
  },
});

export const fmtAgo = t => {
  if (!t) return '-';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  if (m < 30 * 1440) return `${Math.round(m / 1440)} d ago`;
  return new Date(t).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
};

export function pageHead(glyph, title, sub, ...tools) {
  return el('header', { className: 'main-head' }, el('span', { className: 'big' }, icon(glyph)), el('div', { className: 'title' }, el('h1', {}, title), el('div', { className: 'path' }, sub)), el('div', { className: 'toolbar' }, ...tools));
}

export const fmtTime = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const fmtDate = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export const fmtDur = ms => {
  const minutes = Math.round(ms / 60000);
  if (ms < 60000) return `${Math.max(0, Math.round(ms / 1000))} s`;
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
};

export const fmtNum = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n));

export const shortType = t => String(t || '').split(':').pop();

export const shortModel = m => (m ? String(m).replace(/^claude-/, '') : '');

export const highlight = (text, q) => {
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  return i < 0 ? text : [text.slice(0, i), el('mark', {}, text.slice(i, i + q.length)), text.slice(i + q.length)];
};

export const SVG_NS = 'http://www.w3.org/2000/svg';

export const svg = (tag, attrs, ...children) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, String(v));
  }
  for (const c of children.flat()) if (c !== undefined && c !== null && c !== false) node.append(c.nodeType ? c : document.createTextNode(String(c)));
  return node;
};

export const clip = (text, chars) => (text.length > chars ? `${text.slice(0, Math.max(1, chars - 3))}...` : text);

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
