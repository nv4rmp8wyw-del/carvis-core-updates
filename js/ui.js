// Wiederverwendbare UI-Bausteine: Icons, Toasts, Modals, Bestätigungsdialoge, Nachrichten.
import { $, esc, md, fmtTime } from './util.js';
import { renderBlocks } from './blocks.js';

const P = {
  dashboard: 'M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z',
  chat: 'M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8l-5 4V5a1 1 0 0 1 1-1Z',
  project: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z',
  task: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z',
  preview: 'M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z',
  doc: 'M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.5V9h5.5L13 3.5ZM8 13h8v2H8v-2Zm0 4h8v2H8v-2Z',
  memory: 'M12 2a7 7 0 0 0-7 7c0 2.4 1.2 4.5 3 5.7V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.3A7 7 0 0 0 12 2Zm-2 19h4v1h-4v-1Z',
  settings: 'M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.9c-.6.3-1.2.6-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1L11 21h4l.4-2.9c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5-2.2-1.6ZM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z',
  ultimate: 'M12 2 9 9H2l5.5 4.5L5 21l7-4.5 7 4.5-2.5-7.5L22 9h-7l-3-7Z',
  core: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z',
  clip: 'M16.5 6.5 8.4 14.6a1.5 1.5 0 0 0 2.1 2.1l8.1-8.1a3 3 0 0 0-4.2-4.2l-8.4 8.4a4.5 4.5 0 0 0 6.4 6.4l7.4-7.4 1.4 1.4-7.4 7.4a6.5 6.5 0 0 1-9.2-9.2l8.4-8.4a5 5 0 0 1 7 7l-8.1 8.1a3.5 3.5 0 0 1-5-5l8.1-8.1 1.4 1.4Z',
  history: 'M13 3a9 9 0 0 0-9 9H1l4 4 4-4H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 13 3Zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8H12Z',
  more: 'M5 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  trash: 'M6 7h12l-1 14H7L6 7Zm3-4h6l1 2h4v2H4V5h4l1-2Z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z',
  mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z',
  lock: 'M17 9V7A5 5 0 0 0 7 7v2H5v13h14V9h-2ZM9 7a3 3 0 0 1 6 0v2H9V7Z',
  dot: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  speak: 'M3 10v4h4l5 4V6L7 10H3Zm13.5 2A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4Z',
  copy: 'M8 3h11v13H8V3ZM5 7h1v12h10v1H5V7Z',
  save: 'M5 3h11l3 3v15H5V3Zm2 2v5h8V5H7Zm5 8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  mail: 'M3 5h18v14H3V5Zm2 2v.5l7 4.5 7-4.5V7H5Z',
  calendar: 'M7 2h2v2h6V2h2v2h3v18H4V4h3V2Zm-1 8v10h12V10H6Z',
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.9 9h-3a15 15 0 0 0-1.3-5.6A8 8 0 0 1 18.9 11ZM12 4c.9 1.2 1.8 3.8 1.9 7h-3.8c.1-3.2 1-5.8 1.9-7ZM4.1 13h3a15 15 0 0 0 1.3 5.6A8 8 0 0 1 4.1 13Zm3-2h-3a8 8 0 0 1 4.3-5.6A15 15 0 0 0 7.1 11Zm4.9 9c-.9-1.2-1.8-3.8-1.9-7h3.8c-.1 3.2-1 5.8-1.9 7Zm3.6-1.4a15 15 0 0 0 1.3-5.6h3a8 8 0 0 1-4.3 5.6Z',
  code: 'M8.6 16.6 4 12l4.6-4.6L7.2 6 1.2 12l6 6 1.4-1.4Zm6.8 0L20 12l-4.6-4.6L16.8 6l6 6-6 6-1.4-1.4Z',
  phone: 'M7 1h10a2 2 0 0 1 2 2v18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2Zm0 4v14h10V5H7Z',
  update: 'M11 3h2v9.2l3.3-3.3 1.4 1.4L12 16l-5.7-5.7 1.4-1.4L11 12.2V3ZM5 18h14v2H5v-2Z',
  agent: 'M12 2l2.4 5.6L20 10l-5.6 2.4L12 18l-2.4-5.6L4 10l5.6-2.4L12 2Zm7 13 1 2.4 2.4 1-2.4 1L19 22l-1-2.6-2.4-1 2.4-1L19 15Z',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7l1-8Z',
  file: 'M6 2h8l6 6v14H4V2h2Zm7 1.5V9h5.5L13 3.5Z',
  plug: 'M16 7V3h-2v4h-4V3H8v4H6v6a6 6 0 0 0 5 5.9V22h2v-3.1A6 6 0 0 0 18 13V7h-2Z',
  window: 'M3 4h18v16H3V4Zm2 4v10h14V8H5Z',
  columns: 'M3 4h8v16H3V4Zm10 0h8v16h-8V4ZM5 6v12h4V6H5Zm10 0v12h4V6h-4Z',
  compare: 'M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5v2h2V1h-2v2Zm0 15H5l5-6v6Zm9-15h-5v2h5v13l-5-6v9h5a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Z',
  review: 'M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 9.5 16a6.5 6.5 0 0 0 4.2-1.6l.3.3v.8l5 5 1.5-1.5-5-5Zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Z',
  team: 'M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13Zm8 0h-.9a4.2 4.2 0 0 1 1.9 3.5V19h6v-2.5c0-2.3-4.7-3.5-7-3.5Z',
  reset: 'M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8Z',
  share: 'M18 16a3 3 0 0 0-2.4 1.2l-6.7-3.9a3 3 0 0 0 0-2.6l6.7-3.9A3 3 0 1 0 15 5l-6.7 3.9a3 3 0 1 0 0 6.2L15 19a3 3 0 1 0 3-3Z',
  close: 'M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7l-1.4-1.4L9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3 1.4 1.4Z',
  chevron: 'M7 10l5 5 5-5H7Z',
};

export const icon = (name, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[name] || P.dot}"/></svg>`;

// ---- Toasts ----
export function toast(text, tone = 'info', ms = 3200) {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = `toast toast-${tone}`;
  el.textContent = text;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

// ---- Popover-Menü ----
// Hängt direkt an <body> (position: fixed) – kann von keinem Container mit overflow abgeschnitten werden.
// items: [{ sec } | { sep: true } | { label, icon, hint, on, disabled, run }]
let openPop = null;
export function closePopover() {
  if (!openPop) return;
  const { el, anchor, cleanup } = openPop;
  openPop = null;
  cleanup();
  el.remove();
  anchor?.setAttribute('aria-expanded', 'false');
}
export function popover(anchor, items, { align = 'start', label = 'Menü' } = {}) {
  if (openPop?.anchor === anchor) { closePopover(); return null; } // zweiter Klick schließt
  closePopover();
  const el = document.createElement('div');
  el.className = 'pop';
  el.setAttribute('role', 'menu');
  el.setAttribute('aria-label', label);
  el.innerHTML = items.map((it, i) => it.sep ? '<div class="pop-sep" role="separator"></div>'
    : it.sec ? `<div class="pop-sec">${esc(it.sec)}</div>`
    : `<button class="pop-item ${it.on ? 'on' : ''}" role="menuitem" data-i="${i}" ${it.disabled ? 'aria-disabled="true" tabindex="-1"' : ''} ${it.title ? `title="${esc(it.title)}"` : ''}>${it.icon ? icon(it.icon) : ''}<span>${esc(it.label)}</span>${it.hint && !it.on ? `<small>${esc(it.hint)}</small>` : ''}</button>`).join('');
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  let left = align === 'end' ? r.right - w : r.left;
  left = Math.max(12, Math.min(left, innerWidth - w - 12));
  let top = r.bottom + 6;
  if (top + h > innerHeight - 12) top = Math.max(12, r.top - h - 6);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  anchor.setAttribute('aria-expanded', 'true');
  const onDown = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) closePopover(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { closePopover(); anchor.focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const btns = [...el.querySelectorAll('.pop-item:not([aria-disabled])')];
      const i = btns.indexOf(document.activeElement);
      btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus();
    }
  };
  const onScroll = (e) => { if (!el.contains(e.target)) closePopover(); };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', closePopover);
  document.addEventListener('scroll', onScroll, true);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (!b || b.getAttribute('aria-disabled')) return;
    const it = items[+b.dataset.i];
    closePopover();
    it.run?.();
  });
  openPop = { el, anchor, cleanup: () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey); window.removeEventListener('resize', closePopover); document.removeEventListener('scroll', onScroll, true); } };
  el.querySelector('.pop-item:not([aria-disabled])')?.focus({ preventScroll: true });
  return el;
}

// ---- Modal ----
export function modal({ title, body, actions = [], wide = false, onMount }) {
  return new Promise((resolve) => {
    const root = $('#modal-root');
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal glass ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn sm" data-close aria-label="Schließen">✕</button></header>
      <div class="modal-body">${body}</div>
      ${actions.length ? `<footer class="modal-foot">${actions.map((a, i) => `<button class="btn ${a.cls || 'btn-ghost'}" data-i="${i}">${esc(a.label)}</button>`).join('')}</footer>` : ''}
    </div>`;
    const prevFocus = document.activeElement;
    const close = (val) => {
      wrap.classList.remove('in');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => wrap.remove(), 200);
      prevFocus?.focus?.();
      resolve(val);
    };
    const onKey = (e) => e.key === 'Escape' && close(null);
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap || e.target.closest('[data-close]')) return close(null);
      const b = e.target.closest('[data-i]');
      if (b) {
        const a = actions[+b.dataset.i];
        close(a.value !== undefined ? a.value : a.getValue ? a.getValue(wrap) : true);
      }
    });
    document.addEventListener('keydown', onKey);
    root.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('in'));
    onMount?.(wrap, close);
    // Bei kritischen Aktionen liegt der Fokus auf „Abbrechen“, damit Enter nichts Gefährliches auslöst
    const last = wrap.querySelector('.modal-foot .btn:last-child');
    (wrap.querySelector('[autofocus]') || (last?.classList.contains('btn-danger') ? wrap.querySelector('.modal-foot .btn') : last))?.focus();
  });
}

export function confirmDialog(text, { title = 'Bitte bestätigen', ok = 'Bestätigen', danger = true } = {}) {
  return modal({
    title,
    body: `<p>${esc(text)}</p>`,
    actions: [
      { label: 'Abbrechen', value: false },
      { label: ok, value: true, cls: danger ? 'btn-danger' : 'btn-primary' },
    ],
  }).then(Boolean);
}

// ---- Nachrichten (geteilt von CARVIS- und GPT-Modus) ----
const SOURCE = {
  local: { label: 'Lokal ausgeführt', cls: 'src-local', title: 'Echte, lokal ausgeführte Aktion' },
  demo: { label: 'Vorlage · simuliert', cls: 'src-demo', title: 'Simulierte Antwort aus lokalen Vorlagen – keine echte KI' },
  llm: { label: 'KI-Modell', cls: 'src-llm', title: 'Antwort eines echten Sprachmodells' },
  collab: { label: 'Multi-KI', cls: 'src-collab', title: 'Mehrere echte Modelle, von CARVIS verglichen und zusammengeführt' },
  research: { label: 'Recherche · Wikipedia', cls: 'src-local', title: 'Echte Recherche mit Quelle, ohne KI' },
  system: { label: 'System', cls: 'src-sys', title: 'Systemmeldung' },
};

// Anhänge stehen als Block „📎 Anhang: Name“ + Codeblock im Nachrichtentext (so sieht sie auch die KI).
// In der Anzeige werden sie eingeklappt.
const ATT_RE = /\n*📎 Anhang: ([^\n]+)\n```[^\n]*\n([\s\S]*?)\n```/g;
export function userBubble(text = '') {
  const atts = [];
  const body = String(text).replace(ATT_RE, (_, name, content) => { atts.push([name, content]); return ''; }).trim();
  return `${body ? esc(body) : ''}${atts.map(([n, c]) => `<details class="att"><summary>${P.clip ? `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="${P.clip}"/></svg>` : '📎'} ${esc(n)}</summary><pre>${esc(c.slice(0, 4000))}${c.length > 4000 ? '\n…' : ''}</pre></details>`).join('')}`;
}

export function renderMessage(m, { compact = false } = {}) {
  if (m.role === 'user') {
    return `<div class="msg msg-user" data-id="${m.id}"><div class="bubble">${userBubble(m.text)}</div>${compact ? '' : `<time>${fmtTime(m.ts)}</time>`}</div>`;
  }
  const src = SOURCE[m.source] || SOURCE.system;
  const label = (m.source === 'llm' || m.source === 'collab') && m.model ? `${src.label} · ${m.model}` : src.label;
  return `<div class="msg msg-ai ${m.error ? 'msg-error' : ''}" data-id="${m.id}">
    <div class="msg-head"><span class="avatar" aria-hidden="true"></span><b>CARVIS</b><span class="src ${src.cls}" title="${src.title}">${esc(label)}</span>${compact ? '' : `<time>${fmtTime(m.ts)}</time>`}</div>
    <div class="bubble">${md(m.text)}${renderBlocks(compact ? (m.blocks || []).filter((b) => b.type === 'notice') : m.blocks)}</div>
    ${compact
      ? (m.blocks?.length ? `<button class="link-btn" data-go="#/gpt/chat">Details im GPT-Modus ›</button>` : '')
      : `<div class="msg-tools">
          <button class="tool" data-act="speak-msg" data-id="${m.id}" title="Vorlesen">${icon('speak')}</button>
          <button class="tool" data-act="copy-msg" data-id="${m.id}" title="Kopieren">${icon('copy')}</button>
          <button class="tool" data-act="msg-to-doc" data-id="${m.id}" title="Als Dokument speichern">${icon('save')}</button>
        </div>`}
  </div>`;
}

export function thinkingBubble(stage = '', partial = '') {
  return `<div class="msg msg-ai msg-thinking"><div class="msg-head"><span class="avatar"></span><b>CARVIS</b><span class="src src-sys">${partial ? 'antwortet …' : 'verarbeitet …'}</span><button class="link-btn" data-act="stop-answer" title="Antwort abbrechen">■ Stopp</button></div>
    <div class="bubble"><div class="stream">${partial ? md(partial) : ''}</div>${partial ? '' : '<span class="dots"><i></i><i></i><i></i></span>'}${stage && !partial ? `<span class="stage">${esc(stage)}</span>` : ''}</div></div>`;
}
