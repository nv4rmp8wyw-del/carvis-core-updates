// CARVIS CORE – App-Steuerung: Routing, Moduswechsel, Chat-Pipeline, Sprache, Ereignisse.
import { VERSION } from './version.js';
import { nextGreeting } from './greeting.js';
import { md, $, $$, esc, fmtTime, fmtDateLong, plainText, sleep, greetingByTime } from './util.js';
import { store, actions } from './store.js';
import { HoloCore } from './core.js';
import { applyTheme, applySpeed, onThemeApplied, hexToHsl } from './theme.js';
import { voice } from './voice.js';
import { respond } from './engine.js';
import { icon, toast, modal, confirmDialog, renderMessage, thinkingBubble, popover, closePopover } from './ui.js';
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
const design = lazyView('design', 'Design', 'preview', () => import('./views/design.js'));
const business = lazyView('business', 'Business', 'project', () => import('./views/business.js'));
function loadView(v) {
  if (!v.lazy) return v._p || Promise.resolve();
  const loader = v.lazy;
  v.lazy = null;
  v._p = loader().then((m) => { Object.assign(v, m.default); }).catch((e) => { v.lazy = loader; v._p = null; throw e; });
  return v._p;
}
import { projects, tasks, previews, documents, memory, chips, blocksToText } from './views/workspace.js';
import { gpt } from './views/gpt.js';

const VIEWS = [dashboard, gpt, models, agents, business, computer, finance, ucc, projects, tasks, previews, documents, memory, design, perf, update, settings];
// Genau drei Hauptreiter: Dashboard · CARVIS · GPT. Jede Unteransicht gehört genau einem Bereich (keine doppelten Einträge).
const TABS = [
  { id: 'dashboard', title: 'Dashboard', icon: 'dashboard', href: '#/gpt/dashboard' },
  { id: 'carvis', title: 'CARVIS', icon: 'core', href: '#/carvis' },
  { id: 'gpt', title: 'GPT', icon: 'chat', href: '#/gpt/chat' },
];
// Kontextleiste je Bereich: wichtigste Ansichten direkt, selten genutzte im „Mehr“-Menü.
const AREAS = {
  dashboard: { main: ['dashboard', 'perf', 'design', 'update', 'settings'], more: ['computer', 'finance', 'ucc'] },
  gpt: { main: ['chat', 'models', 'agents', 'business'], more: ['projects', 'tasks', 'documents', 'previews', 'memory'] },
};
const SUBTITLE = { dashboard: 'Übersicht', chat: 'Arbeitsbereich' };
const areaOf = (id) => Object.keys(AREAS).find((a) => AREAS[a].main.includes(id) || AREAS[a].more.includes(id)) || 'gpt';
const tabOf = () => (mode === 'carvis' ? 'carvis' : areaOf(viewId));
const CORE_LABEL = { idle: 'Bereit', listening: 'Hört zu', thinking: 'Verarbeitet', speaking: 'Spricht', executing: 'Führt aus', error: 'Fehler' };
// Ehrlicher Ruhezustand: ohne Internet „Offline“, ohne verbundene KI „Bereit · ohne KI“ (Kern gedämpft)
function aiConnected() {
  const st = store.get();
  return st.experts.some((e) => e.enabled && e.status === 'ok' && (e.cost !== 'paid' || st.settings.allowPaid));
}
function idleLabel() {
  if (!navigator.onLine) return 'Offline';
  return aiConnected() ? 'Bereit' : 'Bereit · ohne KI';
}

const app = $('#app');
const viewEl = $('#view');
const status = { llm: 'unknown', sw: false, wake: false, online: navigator.onLine };

let mode = 'carvis';
let viewId = 'dashboard';
let busy = false;
let coreState = 'idle';
let pendingRender = false;
let answerCtrl = null; // Abbruch der laufenden Antwort (Stopp-Knopf)
let partial = ''; // gestreamter Antworttext
let stage = '';
let greetingPending = false;

const core = new HoloCore($('#core'));
let coreView = 'full';
onThemeApplied((pal, t, light) => {
  const calm = t.coreView === 'calm';
  core.setTheme({ hue: pal.h, sat: Math.min(100, pal.s), glow: Math.min(1, t.glow) * (calm ? 0.5 : 1), speed: t.speed * (calm ? 0.5 : 1) });
  coreView = t.coreView;
  core.setActive(mode === 'carvis' && (coreView === 'full' || coreView === 'calm')); // Canvas ruht, wenn er nicht sichtbar ist
});
window.__cccTheme = () => store.get().settings.theme;
applyTheme(store.get().settings.theme);

const ctx = {
  status,
  rerender: () => renderView(),
  // Für Hintergrund-Ergebnisse (Status nachgeladen o. Ä.): nicht neu zeichnen, solange ein Textfeld bearbeitet oder geklickt wird
  softRerender: () => { if ((viewEl.contains(document.activeElement) && isTextField(document.activeElement)) || pointerDown) { pendingRender = true; return; } renderView(); },
  renderStatus: () => renderStatus(true),
  send: (text, opts) => send(text, opts),
  paintFeeds: () => renderFeeds(),
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
  chip.textContent = state === 'idle' ? idleLabel() : CORE_LABEL[state];
  chip.dataset.state = state;
  document.body.dataset.core = state;
  document.body.dataset.ai = aiConnected() ? 'on' : 'none';
  document.body.dataset.net = navigator.onLine ? 'on' : 'off';
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
  closePopover();
}

function setMode(m) {
  mode = m;
  app.dataset.mode = m;
  core.setActive(m === 'carvis' && (coreView === 'full' || coreView === 'calm'));
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
  moveTabIndicator();
  const sub = $('#subnav');
  const area = AREAS[cur];
  if (area) {
    sub.hidden = false;
    const title = (id) => SUBTITLE[id] || VIEWS.find((x) => x.id === id).title;
    const link = (id) => `<a href="#/gpt/${id}" data-view="${id}" class="${id === viewId ? 'on' : ''}" ${id === viewId ? 'aria-current="page"' : ''}>${title(id)}</a>`;
    const inMore = area.more.includes(viewId);
    const html = area.main.map(link).join('') + `<button type="button" class="sub-more ${inMore ? 'on' : ''}" data-act="sub-more" aria-haspopup="menu" aria-expanded="false">${inMore ? title(viewId) : 'Mehr'}${icon('chevron')}</button>`;
    if (sub.dataset.k !== html) { sub.dataset.k = html; sub.innerHTML = html; }
  } else { sub.hidden = true; sub.innerHTML = ''; sub.dataset.k = ''; }
}

// Gleitende Markierung unter dem aktiven Hauptreiter (nur transform/width, GPU-schonend)
function moveTabIndicator() {
  const tabs = $('#tabs');
  const on = tabs?.querySelector('a.on');
  if (!tabs || !on || !on.offsetWidth) return;
  tabs.style.setProperty('--ix', `${on.offsetLeft}px`);
  tabs.style.setProperty('--iw', `${on.offsetWidth}px`);
  tabs.classList.add('has-ind');
}
window.addEventListener('resize', () => requestAnimationFrame(moveTabIndicator));
document.fonts?.ready.then(moveTabIndicator);

function subMore(el) {
  const area = AREAS[tabOf()];
  if (!area) return;
  popover(el, area.more.map((id) => { const v = VIEWS.find((x) => x.id === id); return { label: v.title, icon: v.icon, on: id === viewId, run: () => (location.hash = `#/gpt/${id}`) }; }), { label: 'Weitere Bereiche' });
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
  cf.innerHTML = msgs.slice(-4).map((m) => renderMessage(m, { compact: true })).join('') + (busy ? thinkingBubble(stage, partial) : '');
  cf.scrollTop = cf.scrollHeight;
  app.classList.toggle('has-chat', msgs.length > 0 || busy);
  const gf = $('#gpt-feed');
  if (gf) {
    gf.innerHTML = msgs.length || busy
      ? msgs.map((m) => renderMessage(m)).join('') + (busy ? thinkingBubble(stage, partial) : '')
      : `<div class="gw-empty"><div class="mini-core" aria-hidden="true"></div><b>CARVIS · Auto</b><span>CARVIS wählt für jede Frage das passende verbundene Modell. Gemeinsamer Verlauf mit dem CARVIS-Bereich.</span></div>`;
    gf.scrollTop = gf.scrollHeight;
  }
}

async function send(text, { viaVoice = false, collab } = {}) {
  text = (text || '').trim();
  if (!text) return;
  if (busy) return toast('CARVIS verarbeitet noch die letzte Anfrage …');
  voice.cancelSpeak();
  actions.addMessage({ role: 'user', text });
  busy = true;
  stage = '';
  partial = '';
  answerCtrl = new AbortController();
  const ctrl = answerCtrl;
  setCore('thinking');
  renderFeeds();
  const t0 = performance.now();
  let res;
  try {
    res = await respond(text, {
      mode,
      collab,
      signal: ctrl.signal,
      // Streaming: Teilantwort sofort zeigen (nur die Textfläche, kein Neuaufbau des Verlaufs)
      onToken: (t) => {
        const first = !partial;
        partial = t;
        if (first) { renderFeeds(); return; }
        $$('.msg-thinking .stream').forEach((el) => { el.innerHTML = md(t); });
        const gf = $('#gpt-feed'); if (gf) gf.scrollTop = gf.scrollHeight;
      },
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
  if (ctrl.signal.aborted) {
    // Kein Ersatztext nach Abbruch: nur das, was das Modell bis dahin wirklich geschrieben hat
    res = { text: partial ? `${partial}\n\n*– abgebrochen –*` : 'Abgebrochen.', source: partial ? 'llm' : 'system', model: res?.model, blocks: [] };
  }
  answerCtrl = null;
  partial = '';
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
    volume: s.volume ?? 1,
    onStart: () => { voice.pauseWake(); setCore('speaking'); },
    onBoundary: () => core.kick(0.75),
    onEnd: () => {
      if (coreState === 'speaking') setCore('idle');
      voice.resumeWake();
      // Gesprächsmodus: nach der Antwort automatisch wieder zuhören
      if (converse && store.get().settings.conversationMode && mode === 'carvis' && !voice.listening) setTimeout(() => !busy && toggleMic(), 350);
    },
  });
  // „Spricht“ erst anzeigen, wenn die Ausgabe wirklich startet (onStart) – keine vorgetäuschte Aktivität
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
  if (busy) return toast('Moment – CARVIS verarbeitet noch.');
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
  if (coreState === 'idle') setCore('idle'); // Ruhezustand (online/KI) aktuell halten
  const cb = $('#talk-btn');
  if (cb) {
    cb.hidden = !voice.sttSupported;
    cb.classList.toggle('on', !!s.conversationMode);
    cb.innerHTML = `<span class="led led-${s.conversationMode ? 'ok' : 'idle'}"></span>Gespräch ${s.conversationMode ? 'an' : 'aus'}`;
    cb.title = 'Gesprächsmodus: CARVIS hört nach jeder gesprochenen Antwort wieder zu. Beenden mit „Stopp“.';
  }
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
  'stop-answer': () => { answerCtrl?.abort(); },
  'stop-speak': () => { voice.cancelSpeak(); if (coreState === 'speaking') setCore('idle'); },
  'voice-gate': () => { hideVoiceGate(); greet(true); },
  'voice-now': () => { location.hash = '#/carvis'; toggleMic(); },
  'toggle-tts': () => {
    const on = !store.get().settings.voiceOutput;
    actions.setSettings({ voiceOutput: on });
    if (!on) { voice.cancelSpeak(); if (coreState === 'speaking') setCore('idle'); }
    toast(on ? 'Sprachausgabe an' : 'Sprachausgabe aus', 'info', 1400);
  },
  // Ein Klick: Gesprächsmodus an und sofort zuhören
  'toggle-talk': () => {
    const on = !store.get().settings.conversationMode;
    actions.setSettings({ conversationMode: on });
    renderStatus();
    if (on) { toast('Gesprächsmodus an – sprich einfach. Beenden mit „Stopp“.', 'ok'); if (!voice.listening && !busy) toggleMic(); }
    else { if (voice.listening) voice.stop(); toast('Gesprächsmodus aus.'); }
  },
  'toggle-wake': () => {
    actions.setSettings({ wakeWord: !store.get().settings.wakeWord });
    applySettings();
    if (store.get().settings.wakeWord) toast('Wake-Word aktiv (experimentell) – sag „Hey C“.', 'ok');
  },
  suggest: (el) => (mode === 'gpt' && viewId === 'chat' ? gpt.sendFromComposer(el.dataset.text, ctx) : send(el.dataset.text)),
  'sub-more': (el) => subMore(el),
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
    const title = m.text.replace(/[*#`„“"]/g, '').split('\n')[0].slice(0, 60) || 'Antwort von CARVIS';
    const d = actions.addDocument({ title, content: `${m.text}\n\n${blocksToText(m.blocks)}`.trim() });
    documents.open(d.id);
    toast('Als Dokument gespeichert', 'ok');
  },
  'plan-to-project': (el) => {
    const { name, steps } = JSON.parse(el.dataset.payload);
    const p = actions.addProject({ name: name.charAt(0).toUpperCase() + name.slice(1), description: 'Aus einem Plan von CARVIS erstellt.' });
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
  if (e.key === 'Escape' && mode === 'carvis') { if (voice.listening) voice.abort(); voice.cancelSpeak(); }
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
    if (f.id === 'gpt-form') gpt.sendFromComposer(text, ctx);
    else send(text);
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

window.addEventListener('online', () => { status.online = true; renderStatus(true); if (coreState === 'idle') setCore('idle'); });
window.addEventListener('offline', () => { status.online = false; renderStatus(true); if (coreState === 'idle') setCore('idle'); toast('Offline – CC läuft lokal weiter.', 'info'); });

if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  // Neue Version automatisch anzeigen: übernimmt ein neuer Service Worker, einmal neu laden (nicht beim allerersten Besuch).
  if (navigator.serviceWorker.controller) {
    let neuGeladen = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!neuGeladen) { neuGeladen = true; location.reload(); } });
  }
  navigator.serviceWorker.ready.then(() => { status.sw = true; renderStatus(true); });
}

if (voice.ttsSupported) speechSynthesis.addEventListener?.('voiceschanged', () => viewId === 'settings' && safeRerender());

// =============================================================
// Start
// =============================================================
store.subscribe(() => {
  renderFeeds();
  if (mode === 'gpt' && viewId === 'chat') gpt.refresh();
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
  const m = await import('./agent-client.js').catch(() => null);
  const app = m ? await m.autoConnectApp().catch((e) => ({ app: true, ok: false, error: String(e) })) : { app: false };
  if (app.app && app.ok) { toast('Integrierter Agent verbunden', 'ok'); await afterAgent(m); }
  else if (app.app) {
    toast('Integrierter Agent nicht verfügbar: ' + app.error, 'warn');
    // weiter im Hintergrund versuchen (alle 10 s, höchstens 5 Minuten), damit ein verspäteter Agent noch angemeldet wird
    if (!/Token falsch|konnte nicht gestartet|beendet, bevor/.test(app.error || '')) {
      let n = 0, running = false;
      const iv = setInterval(async () => {
        if (running) return;
        if (m.agentState.connected || ++n > 30) return clearInterval(iv);
        running = true;
        const r = await m.autoConnectApp(5000).catch(() => ({}));
        running = false;
        if (r.ok) { clearInterval(iv); toast('Integrierter Agent verbunden', 'ok'); await afterAgent(m); }
      }, 10000);
    }
  }
  if (!app.app) await discoverLocal(false);
  renderStatus(true);
}

// Nach erfolgreicher Anmeldung beim integrierten Agenten: Spracherkennung über den Agenten, Ollama über die Durchleitung
async function afterAgent(m) {
  // WebView2 kann keine Web-Spracherkennung → lokale Erkennung über den Agenten (Windows System.Speech)
  try {
    const st = await m.agentClient.speechStatus();
    voice.useAgent((wav, lang) => m.agentClient.speechRecognize(wav, lang), st);
    status.stt = st;
  } catch (e) { voice.useAgent(null, { available: false, reason: `Spracherkennung nicht prüfbar: ${e.message}` }); }
  $$('[data-act="mic"]').forEach((b) => (b.title = voice.sttSupported ? 'Spracheingabe starten/stoppen' : voice.sttReason));
  await discoverLocal(true);
  renderStatus(true);
}

// Lokales Ollama erkennen: in der App über den Agenten, sonst nur wenn CC über localhost läuft
async function discoverLocal(viaAgent) {
  if (!viaAgent && !['localhost', '127.0.0.1'].includes(location.hostname)) return;
  const { discoverOllama, makeExpert } = await import('./ai/providers.js');
  try {
    const names = await discoverOllama(store.get().settings.ollamaUrl);
    const known = new Set(store.get().experts.map((e) => e.id));
    const fresh = names.map((n) => makeExpert({ provider: 'ollama', vendorKey: 'ollama', model: n, label: `${n} · Ollama`, cost: 'free', local: true })).filter((e) => !known.has(e.id));
    fresh.forEach((e) => actions.upsertExpert(e));
    if (fresh.length) toast(`${fresh.length} lokale KI-Modelle automatisch verbunden`, 'ok');
  } catch { /* Ollama läuft nicht – kein Problem */ }
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
    // Laut nur einmal pro Sitzung begrüßen – nicht bei jedem Neuladen/Seitenwechsel
    let greeted = false;
    try { greeted = sessionStorage.getItem('cc.greeted') === '1'; sessionStorage.setItem('cc.greeted', '1'); } catch { /* privat */ }
    greetingText = nextGreeting({ name: s.userName, formal: s.addressForm !== 'du', back: !!back, lang: s.lang || 'de' });
    $('#carvis-greeting').textContent = greetingText;
    store.update((x) => (x.lastVisit = Date.now()));
    if (greeted || !s.greetOnOpen || !s.voiceOutput || !voice.ttsSupported || mode !== 'carvis') return;
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
