// Globale Suche (v1.2, D-054): Lupe oben rechts oder Strg+K. Durchsucht NUR lokale CARVIS-CORE-Daten, auf die die App
// ohnehin Zugriff hat (Chats, Nachrichten, Projekte, Aufgaben, Dokumente, Gedächtnis, Aktivitäten, KI-Modelle, Agenten,
// Abläufe, Bereiche, Einstellungen, Befehle). Keine Dateien von der Festplatte, kein Netzwerk.
// Fehlertolerant (Teilwörter, Buchstabenfolge, ein Tippfehler), gruppiert, Tastatur (↑ ↓ Enter Esc), Klick außerhalb schließt.
// Suchverlauf nur, wenn in den Einstellungen erlaubt (settings.searchHistory, Standard: an; lokal, max. 8 Einträge).
import { store, actions } from './store.js';
import { esc } from './util.js';
import { icon } from './ui.js';
import { t } from './i18n.js';

const HKEY = 'ccc.search.history';
let ctxRef = null;
let root = null;
let sel = 0;
let flat = [];
let escHandler = null;

export function initSearch(ctx) { ctxRef = ctx; }

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');

// Höchstens ein Tippfehler (Levenshtein ≤ 1) für Wörter ab 4 Zeichen
function oneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, e = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++e > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return e + (a.length - i) + (b.length - j) <= 1;
}

/** Trefferwert 0 = kein Treffer; höher = besser. Exportiert für Tests. */
export function score(query, text) {
  const q = norm(query).trim(), s = norm(text);
  if (!q) return 0;
  if (s.startsWith(q)) return 100;
  const idx = s.indexOf(q);
  if (idx >= 0) return 80 - Math.min(idx, 40) / 2;
  const words = s.split(/[^a-z0-9]+/).filter(Boolean);
  const qw = q.split(/\s+/).filter(Boolean);
  if (qw.every((w) => words.some((x) => x.startsWith(w) || x.includes(w)))) return 60;
  if (qw.every((w) => w.length >= 4 && words.some((x) => oneEdit(w, x.slice(0, w.length)) || oneEdit(w, x)))) return 40;
  let k = 0; for (const c of s) if (c === q[k]) k++;
  return k === q.length && q.length >= 3 ? 20 : 0;
}

function sources() {
  const s = store.get();
  const go = (h) => () => { location.hash = h; };
  const out = [];
  const add = (group, items) => items.forEach((x) => out.push({ group, ...x }));
  add('areas', (ctxRef?.views?.() || []).map((v) => ({ title: v.title, icon: v.icon, run: go(v.href) })));
  add('commands', [
    { title: t('search.cmdNewChat'), icon: 'plus', run: () => { actions.newChat(); location.hash = '#/gpt/talk'; } },
    { title: t('search.cmdTheme'), icon: 'sun', run: () => ctxRef?.toggleTheme?.() },
    { title: t('search.cmdLanguage'), icon: 'globe', run: () => document.querySelector('#lang-btn')?.click() },
    { title: t('search.cmdConnectAi'), icon: 'core', run: () => { location.hash = '#/gpt/dashboard'; ctxRef?.connectAi?.(); } },
    { title: t('search.cmdCheck'), icon: 'reset', run: go('#/gpt/health') },
    { title: t('search.cmdUpdates'), icon: 'update', run: go('#/gpt/update') },
    { title: t('search.cmdTalk'), icon: 'mic', run: () => { location.hash = '#/carvis'; setTimeout(() => document.querySelector('[data-act="mic"]')?.click(), 250); } },
  ]);
  const chats = [...(s.messages.length ? [{ id: 'current', title: s.chatTitle || s.messages.find((m) => m.role === 'user')?.text || t('chat.untitled'), messages: s.messages }] : []), ...(s.chatArchive || [])];
  add('chats', chats.map((c) => ({ title: String(c.title || t('chat.untitled')).split('\n')[0].slice(0, 80), icon: 'chat', run: () => { if (c.id !== 'current') actions.openChat(c.id); location.hash = '#/gpt/talk'; } })));
  chats.forEach((c) => (c.messages || []).forEach((m) => out.push({ group: 'messages', title: String(m.text || '').replace(/\s+/g, ' ').slice(0, 120), sub: c.title, icon: m.role === 'user' ? 'chat' : 'core', run: () => { if (c.id !== 'current') actions.openChat(c.id); location.hash = '#/gpt/talk'; }, deep: true })));
  add('projects', (s.projects || []).map((p) => ({ title: p.name, sub: p.description, icon: 'project', run: go('#/gpt/projects') })));
  add('tasks', (s.tasks || []).map((x) => ({ title: x.title, sub: x.done ? '✓' : '', icon: 'task', run: go('#/gpt/tasks') })));
  add('documents', (s.documents || []).map((d) => ({ title: d.title, icon: 'doc', run: go('#/gpt/documents') })));
  add('memory', (s.memory || []).map((m) => ({ title: m.text || m.fact || '', icon: 'memory', run: go('#/gpt/memory') })));
  add('models', (s.experts || []).map((e) => ({ title: e.label || e.model, sub: e.status === 'ok' ? t('common.verified') : '', icon: 'llm', run: go('#/gpt/models') })));
  add('agents', (ctxRef?.agents?.() || []).map((a) => ({ title: a.name, sub: a.desc, icon: a.icon || 'agent', run: go(a.go || '#/gpt/agents') })));
  add('settings', ['set.look', 'set.ai', 'set.speech', 'set.uiLang', 'set.privacy', 'set.updates', 'set.readAloud', 'set.conv', 'set.voice', 'set.greet']
    .map((k) => ({ title: t(k), icon: 'settings', run: go('#/gpt/settings') })));
  add('activity', (s.activity || []).slice(0, 50).map((a) => ({ title: a.text, icon: 'history', run: go('#/gpt/dashboard') })));
  return out;
}

const GROUPS = ['areas', 'commands', 'chats', 'projects', 'tasks', 'documents', 'models', 'agents', 'settings', 'memory', 'activity', 'messages'];

export function query(q) {
  const res = [];
  for (const it of sources()) {
    const sc = Math.max(score(q, it.title), it.sub ? score(q, it.sub) * 0.7 : 0);
    if (sc > 0) res.push({ ...it, sc });
  }
  const by = {};
  res.sort((a, b) => b.sc - a.sc).forEach((r) => { (by[r.group] ||= []).length < (r.group === 'messages' ? 4 : 6) && by[r.group].push(r); });
  return GROUPS.filter((g) => by[g]).map((g) => ({ group: g, items: by[g] }));
}

const historyOn = () => store.get().settings.searchHistory !== false;
function history() { if (!historyOn()) return []; try { return JSON.parse(localStorage.getItem(HKEY) || '[]'); } catch { return []; } }
function remember(q) {
  if (!historyOn() || !q.trim()) return;
  try { localStorage.setItem(HKEY, JSON.stringify([q.trim(), ...history().filter((x) => x !== q.trim())].slice(0, 8))); } catch { /* privat */ }
}

function paint(q) {
  const list = root.querySelector('[data-search-list]');
  let groups;
  if (!q.trim()) {
    const h = history();
    groups = [
      ...(h.length ? [{ group: 'history', items: h.map((x) => ({ title: x, icon: 'history', fill: x })) }] : []),
      { group: 'areas', items: (ctxRef?.views?.() || []).slice(0, 6).map((v) => ({ title: v.title, icon: v.icon, run: () => { location.hash = v.href; } })) },
    ];
  } else groups = query(q);
  flat = groups.flatMap((g) => g.items);
  sel = Math.min(sel, Math.max(0, flat.length - 1));
  let n = -1;
  list.innerHTML = flat.length ? groups.map((g) => `<div class="sr-group" role="group" aria-label="${esc(t(`search.g.${g.group}`))}"><div class="sr-head">${esc(t(`search.g.${g.group}`))}</div>${g.items.map((it) => { n++; return `<button type="button" class="sr-item${n === sel ? ' on' : ''}" role="option" aria-selected="${n === sel}" data-i="${n}">${icon(it.icon || 'dot')}<span><b>${esc(it.title)}</b>${it.sub ? `<small>${esc(String(it.sub).slice(0, 90))}</small>` : ''}</span></button>`; }).join('')}</div>`).join('')
    : `<p class="sr-empty">${esc(t('search.empty', { q }))}</p>`;
}

function choose(i, q) {
  const it = flat[i];
  if (!it) return;
  if (it.fill) { const inp = root.querySelector('input'); inp.value = it.fill; sel = 0; paint(it.fill); inp.focus(); return; }
  remember(q);
  closeSearch();
  it.run?.();
}

export function openSearch() {
  if (root) { root.querySelector('input')?.focus(); return; }
  root = document.createElement('div');
  root.className = 'search-backdrop';
  root.innerHTML = `<div class="search-box" role="dialog" aria-modal="true" aria-label="${esc(t('search.title'))}">
    <label class="sr-input">${icon('search')}<input type="search" placeholder="${esc(t('search.placeholder'))}" aria-label="${esc(t('search.title'))}" aria-controls="sr-list" autocomplete="off"><kbd>Esc</kbd></label>
    <div class="sr-list" id="sr-list" role="listbox" data-search-list></div>
    <p class="sr-foot">${esc(t('search.foot'))}</p></div>`;
  document.body.appendChild(root);
  const inp = root.querySelector('input');
  sel = 0; paint('');
  inp.addEventListener('input', () => { sel = 0; paint(inp.value); });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, flat.length - 1); paint(inp.value); root.querySelector('.sr-item.on')?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); paint(inp.value); root.querySelector('.sr-item.on')?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'Enter') { e.preventDefault(); choose(sel, inp.value); }
    if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
  });
  // Esc schließt immer – auch wenn das Eingabefeld den Fokus noch nicht hat (Fokus wird erst im nächsten Frame gesetzt)
  escHandler = (e) => { if (e.key === 'Escape' && root) { e.preventDefault(); e.stopPropagation(); closeSearch(); } };
  document.addEventListener('keydown', escHandler, true);
  root.addEventListener('mousedown', (e) => { if (e.target === root) closeSearch(); });
  root.addEventListener('click', (e) => { const b = e.target.closest('.sr-item'); if (b) choose(Number(b.dataset.i), inp.value); });
  requestAnimationFrame(() => { root?.classList.add('in'); inp.focus(); });
}

export function closeSearch() {
  if (!root) return;
  const r = root; root = null; flat = [];
  if (escHandler) { document.removeEventListener('keydown', escHandler, true); escHandler = null; }
  r.remove();
  document.querySelector('#search-btn')?.focus({ preventScroll: true });
}
export const searchOpen = () => !!root;
