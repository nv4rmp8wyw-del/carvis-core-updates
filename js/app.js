// CARVIS CORE – App-Steuerung: Routing, Moduswechsel, Chat-Pipeline, Sprache, Ereignisse.
import { VERSION } from './version.js';
import { nextGreeting } from './greeting.js';
import { $, $$, esc, fmtTime, fmtDateLong, plainText, sleep, greetingByTime } from './util.js';
import { store, actions } from './store.js';
import { HoloCore } from './core.js';
import { applyTheme, applySpeed, onThemeApplied, hexToHsl } from './theme.js';
import { voice } from './voice.js';
import { respond } from './engine.js';
import { icon, toast, modal, confirmDialog, renderMessage, thinkingBubble } from './ui.js';
import dashboard from './views/dashboard.js';
import settings from './views/settings.js';
import models from './views/models.js';
// Seltener genutzte Ansichten werden erst bei Bedarf geladen (schnellerer Start) und im Leerlauf vorgeladen.
const lazyView = (id, title, icon, loader) => ({ id, title, icon, lazy: loader });
const agents = lazyView('agents', 'Agenten', 'bolt', () => import('./views/agents.js'));
const computer = lazyView('computer', 'Computer', 'dashboard', () => import('./views/computer.js'));
const finance = lazyView('finance', 'Finanzen', 'doc', () => import('./views/finance.js'));
const ucc = lazyView('ucc', 'Aktionen', 'bolt', () => import('./views/ucc.js'));
const update = lazyView('update', 'Updates', 'bolt', () => import('./views/update.js'));
const perf = lazyView('perf', 'Optimierung', 'dashboard', () => import('./views/perf.js'));
const design = lazyView('design', 'Erscheinungsbild', 'settings', () => import('./views/design.js'));
function loadView(v) {
  if (!v.lazy) return v._p || Promise.resolve();
  const loader = v.lazy;
  v.lazy = null;
  v._p = loader().then((m) => { Object.assign(v, m.default); }).catch((e) => { v.lazy = loader; v._p = null; throw e; });
  return v._p;
}
import { chat, projects, tasks, previews, documents, memory, chips, blocksToText } from './views/workspace.js';

const VIEWS = [dashboard, chat, models, agents, computer, finance, ucc, projects, tasks, previews, documents, memory, design, perf, update, settings];
// Genau drei Hauptreiter: Dashboard · CARVIS · GPT. Alle Werkzeuge liegen kompakt unter GPT (Leiste + „Mehr“-Menü).
const TABS = [
  { id: 'dashboard', title: 'Dashboard', icon: 'dashboard', href: '#/gpt/dashboard' },
  { id: 'carvis', title: 'CARVIS', icon: 'core', href: '#/carvis' },
  { id: 'gpt', title: 'GPT', icon: 'chat', href: '#/gpt/chat' },
];
const TOOLS = ['chat', 'models', 'agents', 'perf', 'update', 'settings'];
const MORE = ['projects', 'tasks', 'previews', 'documents', 'memory', 'computer', 'finance', 'ucc', 'design'];
const tabOf = () => (mode === 'carvis' ? 'carvis' : viewId === 'dashboard' ? 'dashboard' : 'gpt');
const CORE_LABEL = { idle: 'IDLE · bereit', listening: 'LISTENING · hört zu', thinking: 'THINKING · verarbeitet', speaking: 'SPEAKING · spricht', executing: 'EXECUTING · führt aus', error: 'ERROR · Fehler' };

const app = $('#app');
const viewEl = $('#view');
const status = { llm: 'unknown', sw: false, wake: false, online: navigator.onLine };

let mode = 'carvis';
let viewId = 'dashboard';
let busy = false;
let coreState = 'idle';
let pendingRender = false;
let stage = '';
let greetingPending = false;

const core = new HoloCore($('#core'));
onThemeApplied((pal, t, light) => core.setTheme({ hue: pal.h, sat: Math.min(100, pal.s < 12 ? pal.s : 100), glow: t.glow, speed: t.speed }));
window.__cccTheme = () => store.get().settings.theme;
applyTheme(store.get().settings.theme);

const ctx = {
  status,
  rerender: () => renderView(),
  renderStatus: () => renderStatus(true),
  applySettings,
  quickTask,
  speak,
};

// =============================================================
// Kern-Zustand
// =============================================================
function setCore(state) {
  coreState = state;
  core.setState(state);
  const chip = $('#state-chip');
  chip.textContent = CORE_LABEL[state];
  chip.dataset.state = state;
  document.body.dataset.core = state;
}

function flashError(ms = 2600) {
  setCore('error');
  setTimeout(() => coreState === 'error' && setCore('idle'), ms);
}

// =============================================================
// Routing & Moduswechsel
// =============================================================
const currentView = () => VIEWS.find((v) => v.id === viewId) || dashboard;

function route() {
  const m = (location.hash || '#/carvis').match(/^#\/(carvis|gpt)(?:\/(\w+))?/);
  if (!m) return location.replace('#/carvis');
  setMode(m[1]);
  if (m[1] === 'gpt') {
    const next = VIEWS.some((v) => v.id === m[2]) ? m[2] : 'dashboard';
    viewId = next;
    renderView();
    viewEl.scrollTop = 0;
  }
  closeSheet();
}

function setMode(m) {
  mode = m;
  app.dataset.mode = m;
  core.setActive(m === 'carvis');
  $('#mode-carvis').inert = m !== 'carvis';
  $('#mode-gpt').inert = m !== 'gpt';
  if (m === 'carvis') renderFeeds();
  updateNav();
}

function renderNav() {
  $('#bottom-nav').innerHTML = TABS.map((a) => `<a href="${a.href}" data-area="${a.id}">${icon(a.icon)}<span>${a.title}</span></a>`).join('');
}

function updateNav() {
  const cur = tabOf();
  $$('[data-area]').forEach((a) => {
    const on = a.dataset.area === cur;
    a.classList.toggle('on', on);
    a.setAttribute('aria-selected', on);
    on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  });
  const sub = $('#subnav');
  if (cur === 'gpt') {
    sub.hidden = false;
    const link = (id) => { const v = VIEWS.find((x) => x.id === id); return `<a href="#/gpt/${id}" data-view="${id}" class="${id === viewId ? 'on' : ''}">${v.title}</a>`; };
    const html = TOOLS.map(link).join('') + `<details class="more ${MORE.includes(viewId) ? 'on' : ''}"><summary>Mehr</summary><div class="more-menu">${MORE.map(link).join('')}</div></details>`;
    if (sub.dataset.k !== html) { sub.dataset.k = html; sub.innerHTML = html; }
  } else { sub.hidden = true; sub.innerHTML = ''; sub.dataset.k = ''; }
}

let lastHtml = '';
function renderView() {
  pendingRender = false;
  const v = currentView();
  if (v.lazy || (v._p && !v.render)) {
    viewEl.innerHTML = '<div class="page"><p class="muted">Lädt …</p></div>';
    lastHtml = '';
    viewEl.dataset.view = v.id;
    loadView(v).then(() => currentView() === v && renderView()).catch(() => { viewEl.innerHTML = '<div class="page"><div class="notice notice-warn">Diese Ansicht konnte nicht geladen werden. Bist du offline und hast sie noch nie geöffnet?</div></div>'; });
    return;
  }
  const html = v.render(store.get(), ctx);
  // Gleiches Ergebnis wie beim letzten Zeichnen: DOM nicht ersetzen (verhindert Flackern und Endlosschleifen aus onMount -> rerender)
  if (html === lastHtml && viewEl.dataset.view === v.id && viewEl.firstChild) return;
  const same = viewEl.dataset.view === v.id;
  const scroll = same ? viewEl.scrollTop : 0, winY = same ? window.scrollY : 0;
  lastHtml = html;
  viewEl.innerHTML = html;
  if (scroll) viewEl.scrollTop = scroll;
  if (winY) window.scrollTo(0, winY);
  viewEl.dataset.view = v.id;
  if (v.id === 'chat') renderFeeds();
  v.onMount?.(viewEl, ctx);
  applySpeed(store.get().settings.theme?.speed);
  updateNav();
  tickClock();
}

const isTextField = (el) => el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|url|date|number|search|email|)$/.test(el.type)));

let pointerDown = false; // solange Finger/Maus gedrückt sind, wird die Ansicht nicht ersetzt (sonst geht der Klick verloren)
function safeRerender() {
  if (mode !== 'gpt') return;
  const v = currentView();
  if (v.selfManaged) return;
  if ((viewEl.contains(document.activeElement) && isTextField(document.activeElement)) || pointerDown) { pendingRender = true; return; }
  renderView();
}

// Aufgeschobenes Rendern erst nach dem Loslassen, sonst geht der Klick auf einen Button verloren (Feld verliert Fokus, Ansicht wird ersetzt)
const flushRender = () => { if (pendingRender && !pointerDown && !(viewEl.contains(document.activeElement) && isTextField(document.activeElement))) renderView(); };
document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
document.addEventListener('pointerup', () => { pointerDown = false; setTimeout(flushRender, 60); }, true);
document.addEventListener('pointercancel', () => { pointerDown = false; setTimeout(flushRender, 60); }, true);
viewEl.addEventListener('focusout', () => setTimeout(flushRender, 0));

function closeSheet() {
  const r = $('#sheet-root');
  if (!r.innerHTML) return;
  r.classList.remove('in');
  setTimeout(() => (r.innerHTML = ''), 220);
}

// =============================================================
// Chat-Verlauf (geteilt von beiden Modi)
// =============================================================
function renderFeeds() {
  const msgs = store.get().messages;
  const cf = $('#carvis-feed');
  cf.innerHTML = msgs.slice(-4).map((m) => renderMessage(m, { compact: true })).join('') + (busy ? thinkingBubble(stage) : '');
  cf.scrollTop = cf.scrollHeight;
  app.classList.toggle('has-chat', msgs.length > 0 || busy);
  const gf = $('#gpt-feed');
  if (gf) {
    gf.innerHTML = msgs.length || busy
      ? msgs.map((m) => renderMessage(m)).join('') + (busy ? thinkingBubble(stage) : '')
      : `<div class="feed-empty"><div class="mini-core static"><i></i><i></i><i></i><b></b></div><p>Hallo. Ich bin C. Was kann ich für dich erledigen?</p></div>`;
    gf.scrollTop = gf.scrollHeight;
  }
}

async function send(text, { viaVoice = false } = {}) {
  text = (text || '').trim();
  if (!text) return;
  if (busy) return toast('C verarbeitet noch die letzte Anfrage …');
  voice.cancelSpeak();
  actions.addMessage({ role: 'user', text });
  busy = true;
  stage = '';
  setCore('thinking');
  renderFeeds();
  const t0 = performance.now();
  let res;
  try {
    res = await respond(text, {
      mode,
      confirm: (msg, o) => confirmDialog(msg, o),
      onStage: (st) => {
        stage = st;
        const el = $$('.msg-thinking .stage');
        if (el.length) el.forEach((x) => (x.textContent = st));
        else renderFeeds();
      },
    });
  } catch (e) {
    res = { text: `Interner Fehler: ${e.message}`, source: 'system', error: true, blocks: [] };
  }
  const wait = 700 - (performance.now() - t0); // Verarbeitungszustand sichtbar halten
  if (wait > 0) await sleep(wait);
  if (res.executed) { setCore('executing'); await sleep(650); }
  busy = false;
  stage = '';
  actions.addMessage({ role: 'assistant', text: res.text, blocks: res.blocks || [], source: res.source, model: res.model, error: !!res.error });
  if (res.nav) setTimeout(() => (location.hash = res.nav), 500);
  const s = store.get().settings;
  if (res.error) flashError();
  else if (s.voiceOutput && voice.ttsSupported && (mode === 'carvis' || viaVoice)) speak(res.text, { converse: viaVoice });
  else setCore('idle');
}

function speak(text, { converse = false, onBlocked } = {}) {
  const s = store.get().settings;
  if (!voice.ttsSupported) return toast('Sprachausgabe wird von diesem Browser nicht unterstützt.', 'danger');
  voice.speak(plainText(text), {
    onBlocked: () => { if (coreState === 'speaking') setCore('idle'); (onBlocked || showVoiceGate)(); },
    voiceName: s.voiceName,
    lang: s.lang,
    rate: s.rate,
    pitch: s.pitch,
    onStart: () => { voice.pauseWake(); setCore('speaking'); },
    onBoundary: () => core.kick(0.75),
    onEnd: () => {
      if (coreState === 'speaking') setCore('idle');
      voice.resumeWake();
      // Gesprächsmodus: nach der Antwort automatisch wieder zuhören
      if (converse && store.get().settings.conversationMode && mode === 'carvis' && !voice.listening) setTimeout(() => !busy && toggleMic(), 350);
    },
  });
  if (coreState !== 'speaking') setCore('speaking');
}

// =============================================================
// Spracheingabe
// =============================================================
function activeInput() {
  return mode === 'gpt' && viewId === 'chat' ? $('#gpt-form textarea') : $('#carvis-form input');
}

function setMicUI(on) {
  $$('[data-act="mic"]').forEach((b) => b.classList.toggle('live', on));
}

function showInterim(t) {
  const el = $('#interim');
  el.textContent = t;
  el.classList.toggle('on', !!t);
}

function toggleMic() {
  if (voice.listening) return voice.stop();
  if (busy) return toast('Moment – C verarbeitet noch.');
  voice.unlock();
  const s = store.get().settings;
  voice.listen({
    lang: s.lang,
    onStart: () => { setCore('listening'); setMicUI(true); showInterim('Ich höre zu …'); },
    onInterim: (t) => { showInterim(t); const inp = activeInput(); if (inp && !s.autoSendVoice) inp.value = t; },
    onLevel: (v) => core.setLevel(v),
    onError: (msg, code) => {
      toast(msg, code === 'no-speech' ? 'info' : 'danger');
      if (code !== 'no-speech') flashError(2200);
    },
    onEnd: (final) => {
      setMicUI(false);
      core.clearLevel();
      showInterim('');
      if (coreState === 'listening') setCore('idle');
      if (!final) return;
      if (s.conversationMode && /^(stopp?|ende|danke,? das war'?s|tschüss|gespräch beenden)\b/i.test(final.trim())) {
        actions.addMessage({ role: 'user', text: final });
        actions.addMessage({ role: 'assistant', text: 'Alles klar, ich höre nicht mehr automatisch zu.', source: 'local', blocks: [] });
        voice.speak('Alles klar.', { lang: s.lang, voiceName: s.voiceName });
        return;
      }
      if (s.autoSendVoice) send(final, { viaVoice: true });
      else { const inp = activeInput(); if (inp) { inp.value = final; inp.focus(); } }
    },
  });
}

function onWake(rest) {
  if (mode !== 'carvis') location.hash = '#/carvis';
  core.pulse(1);
  toast('„Hey C“ erkannt', 'ok', 1500);
  if (rest && rest.split(' ').length > 1) send(rest, { viaVoice: true });
  else setTimeout(toggleMic, 250);
}

// =============================================================
// Einstellungen anwenden & Status
// =============================================================
function applySettings() {
  const s = store.get().settings;
  applyTheme(s.theme);
  core.setReducedMotion(s.reduceMotion);
  document.body.classList.toggle('reduce-motion', !!s.reduceMotion);
  if (s.wakeWord && voice.wakeSupported) {
    voice.startWake(onWake, {
      lang: s.lang,
      onState: (on, err) => {
        status.wake = on;
        if (err) { toast(err, 'danger'); actions.setSettings({ wakeWord: false }); }
        renderStatus(false);
      },
    });
  } else if (voice.wakeOn) {
    voice.stopWake();
  } else {
    status.wake = false;
  }
  renderStatus(true);
}

function renderStatus(rerenderViews) {
  const s = store.get().settings;
  const pill = $('#engine-pill');
  const st = store.get();
  const active = st.experts.filter((e) => e.enabled && (e.cost !== 'paid' || s.allowPaid));
  const okCount = active.filter((e) => e.status === 'ok').length;
  const anyErr = active.some((e) => e.status === 'error');
  pill.innerHTML = active.length
    ? `<span class="led led-${okCount ? 'ok' : anyErr ? 'danger' : 'warn'}"></span>${active.length} KI-Modell${active.length === 1 ? '' : 'e'}${okCount ? '' : ' · ungetestet'}`
    : '<span class="led led-warn"></span>Keine KI verbunden';
  pill.title = active.length ? 'Verbundene KI-Modelle – klicken für die Übersicht' : 'Keine echte KI verbunden – freie Antworten sind simuliert. Klicken, um Modelle zu verbinden.';
  pill.dataset.go = '#/gpt/models';
  const wb = $('#wake-btn');
  wb.hidden = !voice.wakeSupported;
  wb.classList.toggle('on', !!status.wake);
  wb.innerHTML = `<span class="led led-${status.wake ? 'ok' : 'idle'}"></span>„Hey C“ ${status.wake ? 'aktiv' : 'aus'}`;
  wb.title = 'Experimentell: funktioniert nur, solange dieser Tab geöffnet und sichtbar ist.';
  $$('[data-act="toggle-tts"]').forEach((b) => b.classList.toggle('muted-on', !s.voiceOutput));
  if (rerenderViews && ['dashboard', 'settings', 'models'].includes(viewId)) safeRerender();
}

// =============================================================
// Schnellaktionen
// =============================================================
async function quickTask(projectId = null) {
  const s = store.get();
  const r = await modal({
    title: 'Neue Aufgabe',
    body: `<label class="field">Aufgabe<input id="qt-title" maxlength="140" autofocus placeholder="Was ist zu tun?"></label>
      <div class="two"><label class="field">Projekt<select id="qt-proj"><option value="">Kein Projekt</option>${s.projects.map((p) => `<option value="${p.id}" ${p.id === projectId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label class="field">Priorität<select id="qt-prio"><option>hoch</option><option selected>mittel</option><option>niedrig</option></select></label></div>`,
    actions: [{ label: 'Abbrechen', value: null }, { label: 'Anlegen', cls: 'btn-primary', getValue: (w) => ({ title: w.querySelector('#qt-title').value.trim(), projectId: w.querySelector('#qt-proj').value || null, priority: w.querySelector('#qt-prio').value }) }],
    onMount: (w, close) => w.querySelector('#qt-title').addEventListener('keydown', (e) => e.key === 'Enter' && w.querySelector('.modal-foot .btn-primary').click()),
  });
  if (r?.title) { actions.addTask(r); toast('Aufgabe angelegt', 'ok'); }
}

async function quickText(title, label, placeholder) {
  return modal({
    title,
    body: `<label class="field">${label}<input id="qx" maxlength="120" autofocus placeholder="${esc(placeholder)}"></label>`,
    actions: [{ label: 'Abbrechen', value: null }, { label: 'OK', cls: 'btn-primary', getValue: (w) => w.querySelector('#qx').value.trim() }],
    onMount: (w) => w.querySelector('#qx').addEventListener('keydown', (e) => e.key === 'Enter' && w.querySelector('.modal-foot .btn-primary').click()),
  });
}

// =============================================================
// Globale Aktionen (data-act)
// =============================================================
const GLOBAL = {
  mic: () => toggleMic(),
  'stop-speak': () => { voice.cancelSpeak(); if (coreState === 'speaking') setCore('idle'); },
  'voice-gate': () => { hideVoiceGate(); greet(true); },
  'voice-now': () => { location.hash = '#/carvis'; toggleMic(); },
  'toggle-tts': () => {
    const on = !store.get().settings.voiceOutput;
    actions.setSettings({ voiceOutput: on });
    if (!on) { voice.cancelSpeak(); if (coreState === 'speaking') setCore('idle'); }
    toast(on ? 'Sprachausgabe an' : 'Sprachausgabe aus', 'info', 1400);
  },
  'toggle-wake': () => {
    actions.setSettings({ wakeWord: !store.get().settings.wakeWord });
    applySettings();
    if (store.get().settings.wakeWord) toast('Wake-Word aktiv (experimentell) – sag „Hey C“.', 'ok');
  },
  suggest: (el) => send(el.dataset.text),
  'close-sheet': () => closeSheet(),
  go: (el) => (location.hash = JSON.parse(el.dataset.payload)),
  'toggle-task': (el) => actions.toggleTask(el.dataset.id),
  'clear-chat': async () => {
    if (await confirmDialog('Gesamten Chatverlauf löschen? Das betrifft CARVIS- und GPT-Modus und kann nicht rückgängig gemacht werden.', { ok: 'Verlauf löschen' })) {
      actions.clearChat();
      toast('Verlauf gelöscht');
    }
  },
  'speak-msg': (el) => { const m = store.get().messages.find((x) => x.id === el.dataset.id); if (m) speak(m.text); },
  'copy-msg': async (el) => {
    const m = store.get().messages.find((x) => x.id === el.dataset.id);
    try { await navigator.clipboard.writeText(`${m.text}\n\n${blocksToText(m.blocks)}`.trim()); toast('Kopiert', 'ok', 1400); }
    catch { toast('Kopieren nicht möglich', 'danger'); }
  },
  'msg-to-doc': (el) => {
    const m = store.get().messages.find((x) => x.id === el.dataset.id);
    if (!m) return;
    const title = m.text.replace(/[*#`„“"]/g, '').split('\n')[0].slice(0, 60) || 'Antwort von C';
    const d = actions.addDocument({ title, content: `${m.text}\n\n${blocksToText(m.blocks)}`.trim() });
    documents.open(d.id);
    toast('Als Dokument gespeichert', 'ok');
  },
  'plan-to-project': (el) => {
    const { name, steps } = JSON.parse(el.dataset.payload);
    const p = actions.addProject({ name: name.charAt(0).toUpperCase() + name.slice(1), description: 'Aus einem Plan von C erstellt.' });
    [...steps].reverse().forEach((t) => actions.addTask({ title: t, projectId: p.id }));
    toast(`Projekt mit ${steps.length} Aufgaben angelegt`, 'ok');
    el.disabled = true;
  },
  'plan-to-tasks': (el) => {
    const { steps } = JSON.parse(el.dataset.payload);
    [...steps].reverse().forEach((t) => actions.addTask({ title: t }));
    toast(`${steps.length} Aufgaben angelegt`, 'ok');
    el.disabled = true;
  },
  'quick-task': () => quickTask(),
  'quick-project': async () => {
    const name = await quickText('Neues Projekt', 'Projektname', 'z. B. Abschlussprojekt');
    if (name) { actions.addProject({ name }); toast('Projekt angelegt', 'ok'); }
  },
  'quick-doc': () => { const d = actions.addDocument({ title: 'Neues Dokument' }); documents.open(d.id); location.hash = '#/gpt/documents'; },
  'quick-plan': async () => {
    const goal = await quickText('Plan erstellen', 'Was möchtest du planen?', 'z. B. eine eigene Webseite');
    if (goal) { location.hash = '#/gpt/chat'; send(`Wie gehe ich bei ${goal} vor?`); }
  },
};

document.addEventListener('click', (e) => {
  voice.unlock();
  const go = e.target.closest('[data-go]');
  if (go && !go.disabled) { e.preventDefault(); location.hash = go.dataset.go; return; }
  const a = e.target.closest('[data-act]');
  if (!a || a.disabled) return;
  const act = a.dataset.act;
  if (GLOBAL[act]) { e.preventDefault(); GLOBAL[act](a, e); return; }
  const v = currentView();
  if (mode === 'gpt' && viewEl.contains(a) && v.onAct) v.onAct(act, a, ctx);
});

document.addEventListener('keydown', (e) => {
  const t = e.target;
  if ((e.key === 'Enter' || e.key === ' ') && t.matches?.('[role="button"][data-act]')) { e.preventDefault(); t.click(); }
  if (t.matches?.('#gpt-form textarea') && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); t.form.requestSubmit(); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && t.closest?.('[data-form="doc-save"]')) { e.preventDefault(); t.closest('form').requestSubmit(); }
  if (e.key === 'Escape' && mode === 'carvis') { if (voice.listening) voice.stop(); voice.cancelSpeak(); }
});

document.addEventListener('input', (e) => {
  if (e.target.matches('#gpt-form textarea')) autoGrow(e.target);
});
const autoGrow = (ta) => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`; };

document.addEventListener('submit', (e) => {
  const f = e.target;
  e.preventDefault();
  if (f.id === 'carvis-form' || f.id === 'gpt-form') {
    const inp = f.elements.q;
    const text = inp.value;
    inp.value = '';
    if (inp.tagName === 'TEXTAREA') autoGrow(inp);
    send(text);
    return;
  }
  const v = currentView();
  if (f.dataset.form && v.onSubmit) {
    const key = f.dataset.form;
    v.onSubmit(f, ctx);
    renderView();
    viewEl.querySelector(`[data-form="${key}"] input[name]:not([type=date])`)?.focus();
  }
});

document.addEventListener('change', (e) => {
  const v = currentView();
  if (mode === 'gpt' && viewEl.contains(e.target) && v.onChange) v.onChange(e.target, ctx);
});

// Fokus in Eingabefeldern darf die Modus-Container nicht seitlich verschieben (ältere Browser ohne overflow: clip)
[$('#modes'), ...$$('.mode')].forEach((el) => el.addEventListener('scroll', () => { el.scrollLeft = 0; el.scrollTop = 0; }));

// =============================================================
// Uhr, Online-Status, Service Worker
// =============================================================
function tickClock() {
  if (document.hidden) return;
  const now = new Date();
  $$('[data-clock]').forEach((el) => (el.textContent = fmtTime(now, el.dataset.clock === 'sec')));
  $$('[data-date]').forEach((el) => (el.textContent = fmtDateLong(now)));
}
setInterval(tickClock, 1000);
document.addEventListener('visibilitychange', tickClock);

window.addEventListener('online', () => { status.online = true; renderStatus(true); });
window.addEventListener('offline', () => { status.online = false; renderStatus(true); toast('Offline – CC läuft lokal weiter.', 'info'); });

if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.ready.then(() => { status.sw = true; renderStatus(true); });
}

if (voice.ttsSupported) speechSynthesis.addEventListener?.('voiceschanged', () => viewId === 'settings' && safeRerender());

// =============================================================
// Start
// =============================================================
store.subscribe(() => {
  renderFeeds();
  renderStatus(false);
  safeRerender();
});

$('#carvis-chips').innerHTML = chips(['Was kannst du?', 'Wie gehe ich bei einer App vor?', 'Zeige meine Aufgaben', 'Visualisiere meine Projekte']);
renderNav();
window.addEventListener('hashchange', route);
route();
renderFeeds();
setCore('idle');
applySettings();
tickClock();
setTimeout(() => greet(false), 0); // nach vollständiger Initialisierung des Moduls
setTimeout(autoConnect, 0);
(window.requestIdleCallback || ((f) => setTimeout(f, 2500)))(() => VIEWS.forEach((v) => v.lazy && loadView(v).catch(() => {})));

// =============================================================
// Automatische Einrichtung: lokales Ollama selbst erkennen – nur wenn CC lokal läuft
// (auf der Live-Seite würde sonst jedes Gerät nach Zugriff aufs lokale Netzwerk fragen)
// =============================================================
async function autoConnect() {
  // Windows-App: erst den integrierten Agenten verbinden (er leitet auch Ollama durch)
  const app = await import('./agent-client.js').then((m) => m.autoConnectApp()).catch(() => ({ app: false }));
  if (app.app && app.ok) toast('Integrierter Agent verbunden', 'ok');
  else if (app.app) toast('Integrierter Agent nicht verfügbar: ' + app.error, 'warn');
  const { discoverOllama, makeExpert } = await import('./ai/providers.js');
  if (app.ok || ['localhost', '127.0.0.1'].includes(location.hostname)) {
    try {
      const names = await discoverOllama(store.get().settings.ollamaUrl);
      const known = new Set(store.get().experts.map((e) => e.id));
      const fresh = names.map((n) => makeExpert({ provider: 'ollama', vendorKey: 'ollama', model: n, label: `${n} · Ollama`, cost: 'free', local: true })).filter((e) => !known.has(e.id));
      fresh.forEach((e) => actions.upsertExpert(e));
      if (fresh.length) toast(`${fresh.length} lokale KI-Modelle automatisch verbunden`, 'ok');
    } catch { /* Ollama läuft nicht – kein Problem */ }
  }
  renderStatus(true);
}
if (!voice.sttSupported) $$('[data-act="mic"]').forEach((b) => (b.title = 'Spracheingabe in diesem Browser nicht verfügbar'));

// =============================================================
// Begrüßung beim Öffnen
// =============================================================
let greetingText = '';

function greet(fromClick) {
  const st = store.get();
  const s = st.settings;
  if (!fromClick) {
    const back = st.lastVisit && Date.now() - st.lastVisit > 60 * 1000;
    greetingText = nextGreeting({ name: s.userName, formal: s.addressForm !== 'du', back: !!back, lang: s.lang || 'de' });
    $('#carvis-greeting').textContent = greetingText;
    store.update((x) => (x.lastVisit = Date.now()));
    if (!s.greetOnOpen || !s.voiceOutput || !voice.ttsSupported || mode !== 'carvis') return;
  }
  greetingPending = false;
  speak(greetingText, { onBlocked: showVoiceGate });
}

function showVoiceGate() {
  $('#voice-gate').hidden = false;
  greetingPending = true;
}
function hideVoiceGate() { $('#voice-gate').hidden = true; }

// Erste Interaktion irgendwo: blockierte Begrüßung nachholen
document.addEventListener('pointerdown', (e) => {
  if (greetingPending && !e.target.closest('#voice-gate')) {
    voice.unlock();
    hideVoiceGate();
    greetingPending = false;
    setTimeout(() => greet(true), 60);
  }
}, { capture: true });

// Klick auf den Kern unterbricht die Sprachausgabe
$('#core').addEventListener('click', () => { if (coreState === 'speaking') { voice.cancelSpeak(); setCore('idle'); } });

// Automatische Updateprüfung (nur wenn eingeschaltet, höchstens einmal pro Tag, nur Hinweis – installiert wird nie automatisch)
setTimeout(async () => {
  const s = store.get().settings;
  if (!s.autoUpdateCheck || Date.now() - (s.lastUpdateCheck || 0) < 86400000 || !navigator.onLine) return;
  try {
    const { checkUpdate } = await import('./update.js');
    const r = await checkUpdate();
    actions.setSettings({ lastUpdateCheck: Date.now() });
    if (r.state === 'available') toast(`Update ${r.latest} verfügbar. Siehe Update Center.`, 'info');
  } catch { /* still: kein Hinweis bei Netzwerkfehler */ }
}, 4000);
