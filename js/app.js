// CARVIS CORE – App-Steuerung: Routing, Moduswechsel, Chat-Pipeline, Sprache, Ereignisse.
import { VERSION, displayVersion } from './version.js';
import { t, tn, initLang, setLang, onLang, applyStatic, lang, LANGS, langInfo } from './i18n.js';
import { nextGreeting } from './greeting.js';
import { md, $, $$, esc, fmtTime, fmtDateLong, plainText, sleep, greetingByTime } from './util.js';
import { store, actions } from './store.js';
// Sprache vor dem ersten Zeichnen festlegen (Standard Englisch, gespeicherte Wahl hat Vorrang)
initLang(store.get().settings.uiLang);
// Ohne eigene Wahl (Erststart): Sprachein-/-ausgabe folgt der Standardsprache der App
if (!store.get().settings.uiLang && store.get().settings.lang !== langInfo().speech) actions.setSettings({ lang: langInfo().speech });
import { Orb } from './orb.js'; // 4.1: neuer CARVIS-Orb (core.js bleibt für ältere Tests/Vergleich im Repo)
import { applyTheme, applySpeed, onThemeApplied, hexToHsl } from './theme.js';
import { voice } from './voice.js';
import { respond } from './engine.js';
import { icon, toast, modal, confirmDialog, renderMessage, thinkingBubble, popover, closePopover } from './ui.js';
import { isSite, isLandingRoute, showLanding, hideLanding, refreshLanding } from './landing.js';
import { health, startHealth } from './health.js';
import dashboard, { healthState } from './views/dashboard.js';
import settings from './views/settings.js';
import models from './views/models.js';
// Seltener genutzte Ansichten werden erst bei Bedarf geladen (schnellerer Start) und im Leerlauf vorgeladen.
const lazyView = (id, title, icon, loader) => ({ id, title, icon, lazy: loader });
const agents = lazyView('agents', 'Agenten', 'bolt', () => import('./views/agents.js'));
const computer = lazyView('computer', 'Computer', 'dashboard', () => import('./views/computer.js'));
const finance = lazyView('finance', 'Finanzen', 'doc', () => import('./views/finance.js'));
const ucc = lazyView('ucc', 'Aktionen', 'bolt', () => import('./views/ucc.js'));
const update = lazyView('update', 'Updates', 'bolt', () => import('./views/update.js'));
const versions = lazyView('versions', 'Versionen', 'history', () => import('./views/versions.js'));
const perf = lazyView('perf', 'Optimierung', 'dashboard', () => import('./views/perf.js'));
const design = lazyView('design', 'Design', 'preview', () => import('./views/design.js'));
const business = lazyView('business', 'Business', 'project', () => import('./views/business.js'));
const healthView = lazyView('health', 'Systemzustand', 'bolt', () => import('./views/health.js'));
function loadView(v) {
  if (!v.lazy) return v._p || Promise.resolve();
  const loader = v.lazy;
  v.lazy = null;
  v._p = loader().then((m) => { Object.assign(v, m.default); }).catch((e) => { v.lazy = loader; v._p = null; throw e; });
  return v._p;
}
import { projects, tasks, previews, documents, memory, chips, blocksToText } from './views/workspace.js';
import { gpt } from './views/gpt.js';
import talk, { modelMenu } from './views/talk.js';
import { answering } from './ai/busy.js';
import { initSearch, openSearch, searchOpen } from './search.js';
import { ai, onAI, autoConnectAI, setupModel, waitForOllama, installOllama, PHASE, OLLAMA_DOWNLOAD } from './ai/autoconnect.js';

const VIEWS = [dashboard, talk, gpt, models, agents, business, computer, finance, ucc, projects, tasks, previews, documents, memory, design, perf, update, versions, healthView, settings];
// 4.1: genau vier Hauptbereiche. Alles Weitere liegt im kompakten „Mehr“-Menü (nichts wurde entfernt).
// v1.2 (D-054): Reihenfolge laut Auftrag – CARVIS, Chat, GPT, Dashboard (Strg+1 … 4)
const TABS = [
  { id: 'carvis', get title() { return t('nav.carvis'); }, icon: 'mic', href: '#/carvis', key: '1' },
  { id: 'chat', get title() { return t('nav.chat'); }, icon: 'chat', href: '#/gpt/talk', key: '2' },
  { id: 'gpt', get title() { return t('nav.gpt'); }, icon: 'columns', href: '#/gpt/chat', key: '3' },
  { id: 'dashboard', get title() { return t('nav.dashboard'); }, icon: 'dashboard', href: '#/gpt/dashboard', key: '4' },
];
// Linke Hauptnavigation: danach Agenten, Automatisierung, Projekte, Analyse, Tools; unten Einstellungen.
// Jeder Eintrag führt zu einer vorhandenen, funktionierenden Ansicht (keine Platzhalter).
const SIDE_MORE = [
  { id: 'agents', key: 'nav.agents', icon: 'layers', href: '#/gpt/agents' },
  { id: 'ucc', key: 'nav.automation', icon: 'bolt', href: '#/gpt/ucc' },
  { id: 'projects', key: 'nav.projects', icon: 'project', href: '#/gpt/projects' },
  { id: 'health', key: 'nav.analysis', icon: 'chart', href: '#/gpt/health' },
  { id: 'tools', key: 'nav.tools', icon: 'cube', act: 'more-menu' },
];
const MORE = [
  { secKey: 'more.ai', items: ['models', 'agents', 'health', 'update', 'versions', 'settings'] },
  { secKey: 'more.pc', items: ['perf', 'computer', 'ucc'] },
  { secKey: 'more.work', items: ['business', 'projects', 'tasks', 'documents', 'previews', 'memory', 'finance'] },
  { secKey: 'more.look', items: ['design'] },
];
const AREAS = {}; // 4.1: keine Unterleisten mehr
// Sichtbare Namen der Ansichten aus dem Sprachsystem (Rückfall: Titel der Ansicht)
const viewTitle = (id) => { const k = `view.${id}`; const v = t(k); return v === k ? (VIEWS.find((x) => x.id === id)?.title || id) : v; };
const SUBTITLE = { get dashboard() { return t('view.dashboard'); }, get chat() { return t('view.chat'); } };
const tabOf = () => (mode === 'carvis' ? 'carvis' : viewId === 'dashboard' ? 'dashboard' : viewId === 'talk' ? 'chat' : viewId === 'chat' ? 'gpt' : 'more');
// Statussatz unter dem Orb (zeigt nur echte Zustände)
const CORE_SENTENCE = new Proxy({}, { get: (_, k) => t(`state.${String(k)}`) });
const CORE_LABEL = new Proxy({}, { get: (_, k) => (typeof k === 'string' ? t(`chip.${k}`) : undefined) });
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
let uiOk = true; // letzte Ansicht ohne Fehler gezeichnet (Erfolgskontrolle der Selbstreparatur)
let answerCtrl = null; // Abbruch der laufenden Antwort (Stopp-Knopf)
let partial = ''; // gestreamter Antworttext
let stage = '';
let greetingPending = false;

const core = new Orb($('#core'));
let coreView = 'full';
onThemeApplied((pal, t, light) => {
  const calm = t.coreView === 'calm';
  core.setTheme({ glow: Math.min(1, t.glow) * (calm ? 0.5 : 1), speed: t.speed * (calm ? 0.5 : 1), light });
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
  const sentence = $('#carvis-status');
  if (sentence) sentence.textContent = state === 'idle' ? (!navigator.onLine ? t('state.offline') : ai.phase === 'bereit' ? t('state.ready') : t('state.notConnected')) : CORE_SENTENCE[state] || '';
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
  // Öffentliche Website: ohne Ziel-Route die schlanke Startseite zeigen (nicht in der Windows-App, nicht auf localhost)
  if (isSite() && isLandingRoute()) { showLanding(); return; }
  hideLanding();
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

function renderSidebar() {
  const nav = $('#sb-nav');
  if (!nav) return;
  const a = (x) => `<a href="${x.href}" data-area="${x.id}" title="${esc(x.title)}${x.key ? ` (Ctrl+${x.key})` : ''}">${icon(x.icon)}<span>${esc(x.title)}</span></a>`;
  const m = (x) => (x.act
    ? `<button type="button" data-side="${x.id}" data-act="${x.act}" aria-haspopup="menu" title="${esc(t(x.key))}">${icon(x.icon)}<span>${esc(t(x.key))}</span></button>`
    : `<a href="${x.href}" data-side="${x.id}" title="${esc(t(x.key))}">${icon(x.icon)}<span>${esc(t(x.key))}</span></a>`);
  nav.innerHTML = `<div class="sb-group">${TABS.map(a).join('')}</div><hr><div class="sb-group">${SIDE_MORE.map(m).join('')}</div>
    <div class="sb-bottom"><hr><a href="#/gpt/settings" data-side="settings" title="${esc(t('nav.settings'))}">${icon('settings')}<span>${esc(t('nav.settings'))}</span></a>
    <button type="button" class="sb-toggle" data-act="sb-toggle" aria-label="${esc(t('nav.collapse'))}" title="${esc(t('nav.collapse'))}">${icon('sidebar')}</button></div>`;
}
function markSidebar() {
  $$('#sb-nav [data-side]').forEach((el) => {
    const on = mode === 'gpt' && el.dataset.side === viewId;
    el.classList.toggle('on', on);
    on ? el.setAttribute('aria-current', 'page') : el.removeAttribute('aria-current');
  });
  const lc = $('#lang-code'); if (lc) lc.textContent = lang().toUpperCase();
}
try { if (localStorage.getItem('ccc.sidebar') === 'mini') document.documentElement.dataset.sb = 'mini'; } catch { /* privat */ }

function renderNav() {
  renderSidebar();
  // Symbole für die Seitenleiste (Text bleibt als Beschriftung)
  $$('#tabs a[data-area]').forEach((el) => { const tab = TABS.find((x) => x.id === el.dataset.area); if (tab) { el.innerHTML = `${icon(tab.icon)}<span>${tab.title}</span>`; el.title = `${tab.title} (Ctrl+${tab.key})`; } });
  $('#bottom-nav').innerHTML = TABS.map((a) => `<a href="${a.href}" data-area="${a.id}">${icon(a.icon)}<span>${a.title}</span></a>`).join('') + `<button type="button" data-area="more" data-act="more-menu" aria-haspopup="menu">${icon('more')}<span>${t('common.more')}</span></button>`;
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
  markSidebar();
  const sub = $('#subnav');
  const area = sub ? AREAS[cur] : null;
  if (!sub) return;
  if (area) {
    sub.hidden = false;
    const title = (id) => viewTitle(id);
    const link = (id) => `<a href="#/gpt/${id}" data-view="${id}" class="${id === viewId ? 'on' : ''}" ${id === viewId ? 'aria-current="page"' : ''}>${title(id)}</a>`;
    const inMore = area.more.includes(viewId);
    const html = area.main.map(link).join('') + `<button type="button" class="sub-more ${inMore ? 'on' : ''}" data-act="sub-more" aria-haspopup="menu" aria-expanded="false">${inMore ? title(viewId) : t('common.more')}${icon('chevron')}</button>`;
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
  tabs.style.setProperty('--iy', `${on.offsetTop}px`); // senkrechte Seitenleiste (breite Bildschirme)
  tabs.style.setProperty('--ih', `${on.offsetHeight}px`);
  tabs.classList.add('has-ind');
}
window.addEventListener('resize', () => requestAnimationFrame(moveTabIndicator));
document.fonts?.ready.then(moveTabIndicator);

function moreMenu(el) {
  const items = [];
  MORE.forEach((g) => { items.push({ sec: t(g.secKey) }); g.items.forEach((id) => { const v = VIEWS.find((x) => x.id === id); if (v) items.push({ label: viewTitle(id), icon: v.icon, on: mode === 'gpt' && id === viewId, run: () => (location.hash = `#/gpt/${id}`) }); }); });
  popover(el, items, { align: 'end', label: t('nav.more') });
}
function toggleTheme() {
  const t = store.get().settings.theme || {};
  const light = document.documentElement.dataset.theme === 'light';
  actions.setSettings({ theme: { ...t, mode: light ? 'dark' : 'light' } });
  applyTheme(store.get().settings.theme);
  paintThemeBtn();
}
document.addEventListener('cc-theme', () => paintThemeBtn(), true);
function changeLanguage(code) {
  if (code === lang()) return;
  actions.setSettings({ uiLang: code, lang: langInfo(code).speech });
  setLang(code);
}
// Sprachwechsel: alles neu beschriften, was gerade sichtbar ist (statisches HTML, Navigation, Ansicht, Verlauf, Begrüßung, Status)
onLang((code) => {
  paintThemeBtn();
  renderNav();
  updateNav();
  renderFeeds();
  renderStatus(true);
  setCore(coreState);
  // Begrüßung nur neu beschriften (nicht erneut sprechen)
  greetingText = nextGreeting({ name: store.get().settings.userName, formal: lang() === 'de' && store.get().settings.addressForm !== 'du', back: true });
  $('#carvis-greeting').textContent = greetingText;
  if (mode === 'gpt') route();
  toast(t('lang.changed', { name: langInfo(code).name }), 'info', 1600);
});
function paintThemeBtn() {
  const light = document.documentElement.dataset.theme === 'light';
  const b = $('#theme-btn');
  if (b) { b.innerHTML = icon(light ? 'moon' : 'sun'); b.title = light ? t('nav.themeToDark') : t('nav.themeToLight'); b.setAttribute('aria-label', b.title); }
}
function subMore(el) {
  const area = AREAS[tabOf()];
  if (!area) return;
  popover(el, area.more.map((id) => { const v = VIEWS.find((x) => x.id === id); return { label: viewTitle(id), icon: v.icon, on: id === viewId, run: () => (location.hash = `#/gpt/${id}`) }; }), { label: t('nav.more') });
}

let lastHtml = '';
function renderView() {
  pendingRender = false;
  const v = currentView();
  if (v.lazy || (v._p && !v.render)) {
    viewEl.innerHTML = `<div class="page"><p class="muted">${t('common.loading')}</p></div>`;
    lastHtml = '';
    viewEl.dataset.view = v.id;
    loadView(v).then(() => currentView() === v && renderView()).catch((e) => {
      health.report('view-load', { subject: v.id, cause: `Ansicht „${v.title}“ konnte nicht geladen werden (${e.message})` }); viewEl.innerHTML = `<div class="page"><div class="notice notice-warn">${t('view.loadFail')}</div></div>`; });
    return;
  }
  let html;
  try { html = v.render(store.get(), ctx); uiOk = true; }
  catch (e) {
    uiOk = false;
    health.uiError(`Ansicht ${v.id}`, e);
    viewEl.innerHTML = `<div class="page"><div class="notice notice-warn" data-ui-fallback><b>Diese Ansicht hatte einen Fehler.</b> Deine Daten sind gespeichert und unverändert. CARVIS versucht, sie neu aufzubauen.
      <div class="row-actions" style="margin-top:10px"><button class="btn btn-sm" data-act="heal-rerender">Neu aufbauen</button><a class="btn btn-sm btn-ghost" href="#/gpt/health">Systemzustand</a></div></div></div>`;
    lastHtml = ''; viewEl.dataset.view = v.id;
    return;
  }
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
  try { v.onMount?.(viewEl, ctx); } catch (e) { uiOk = false; health.uiError(`Ansicht ${v.id} (Start)`, e); }
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
const talkModelHint = () => (store.get().settings.modelChoice && store.get().settings.modelChoice !== 'auto' ? t('model.manual') : t('model.auto'));
function renderFeeds() {
  const msgs = store.get().messages;
  const cf = $('#carvis-feed');
  cf.innerHTML = msgs.slice(-4).map((m) => renderMessage(m, { compact: true })).join('') + (busy ? thinkingBubble(stage, partial) : '');
  cf.scrollTop = cf.scrollHeight;
  app.classList.toggle('has-chat', msgs.length > 0 || busy);
  const tf = $('#talk-feed');
  if (tf) {
    tf.innerHTML = msgs.length || busy
      ? msgs.map((m) => renderMessage(m)).join('') + (busy ? thinkingBubble(stage, partial) : '')
      : `<div class="tk-empty-main"><div class="mini-orb" aria-hidden="true"></div><b>${t('chat.emptyTitle')}</b><span>${esc(t('chat.emptySub', { m: talkModelHint() }))}</span></div>`;
    tf.scrollTop = tf.scrollHeight;
  }
  const gf = $('#gpt-feed');
  if (gf) {
    gf.innerHTML = msgs.length || busy
      ? msgs.map((m) => renderMessage(m)).join('') + (busy ? thinkingBubble(stage, partial) : '')
      : `<div class="gw-empty"><div class="mini-core" aria-hidden="true"></div><b>CARVIS · Auto</b><span>${t('gpt.empty')}</span></div>`;
    gf.scrollTop = gf.scrollHeight;
  }
}

async function send(text, { viaVoice = false, collab } = {}) {
  text = (text || '').trim();
  if (!text) return;
  if (busy) return toast(t('toast.busy'));
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
  answering.begin();
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
        const tf = $('#talk-feed'); if (tf) tf.scrollTop = tf.scrollHeight;
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
  } finally { answering.end(); }
  if (ctrl.signal.aborted) {
    // Kein Ersatztext nach Abbruch: nur das, was das Modell bis dahin wirklich geschrieben hat
    res = { text: partial ? `${partial}\n\n*– abgebrochen –*` : 'Abgebrochen.', source: partial ? 'llm' : 'system', model: res?.model, blocks: [] };
  }
  answerCtrl = null;
  partial = '';
  const wait = 700 - (performance.now() - t0); // Verarbeitungszustand sichtbar halten
  if (wait > 0) await sleep(wait);
  if (res.executed) { setCore('executing'); await sleep(650); if (!res.error) { setCore('success'); await sleep(700); } } // 4.1: „Erfolg“ nur nach bestätigter Aktion
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
  if (!voice.ttsSupported) return toast(t('toast.ttsNo'), 'danger');
  voice.speak(plainText(text), {
    onBlocked: () => { if (coreState === 'speaking') setCore('idle'); (onBlocked || showVoiceGate)(); },
    voiceName: s.voiceName,
    lang: s.lang,
    rate: s.rate,
    pitch: s.pitch,
    volume: s.volume ?? 1,
    onStart: () => { voice.pauseWake(); setCore('speaking'); },
    onBoundary: () => core.kick(0.75),
    onLevel: (v) => core.setLevel(v), // nur bei Piper: echter Ausgabepegel
    onEnd: () => {
      core.clearLevel();
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
  return mode === 'gpt' && viewId === 'chat' ? $('#gpt-form textarea') : mode === 'gpt' && viewId === 'talk' ? $('#talk-input') : $('#carvis-form input');
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
  if (busy) return toast(t('toast.busyShort'));
  voice.unlock();
  const s = store.get().settings;
  voice.listen({
    lang: s.lang,
    onStart: () => { setCore('listening'); setMicUI(true); showInterim(t('carvis.hearing')); },
    onInterim: (t) => { showInterim(t); const inp = activeInput(); if (inp && !s.autoSendVoice) inp.value = t; },
    onLevel: (v) => core.setLevel(v),
    onError: (msg, code) => {
      if (code === 'not-allowed' || code === 'service-not-allowed') health.report('mic-denied', { cause: msg, silent: true });
      toast(msg, code === 'no-speech' ? 'info' : 'danger');
      if (code !== 'no-speech') flashError(2200);
    },
    onEnd: (final) => {
      setMicUI(false);
      core.clearLevel();
      showInterim('');
      if (coreState === 'listening') setCore(final ? 'heard' : 'idle'); // 4.1: „Sprache erkannt“ nur bei echtem Erkennungsergebnis
      if (!final) return;
      if (s.conversationMode && /^(stopp?|ende|danke,? das war'?s|tschüss|gespräch beenden)\b/i.test(final.trim())) {
        actions.addMessage({ role: 'user', text: final });
        actions.addMessage({ role: 'assistant', text: t('carvis.stopListening'), source: 'local', blocks: [] });
        voice.speak('Alles klar.', { lang: s.lang, voiceName: s.voiceName });
        return;
      }
      if (s.autoSendVoice) send(final, { viaVoice: true });
      else { const inp = activeInput(); if (inp) { inp.value = final; inp.focus(); } setTimeout(() => coreState === 'heard' && setCore('idle'), 900); }
    },
  });
}

function onWake(rest) {
  if (mode !== 'carvis') location.hash = '#/carvis';
  core.pulse(1);
  toast(t('toast.heyC'), 'ok', 1500);
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
  // 4.1: Status kommt vom KI-Verbindungsmanager – „bereit“ nur nach echter Testantwort
  const tone = ai.phase === 'bereit' ? 'ok' : ['pruefen', 'verbinden', 'testen', 'laden'].includes(ai.phase) ? 'idle' : ai.phase === 'fehler' ? 'danger' : 'warn';
  const label = ai.phase === 'bereit' ? `${t('ai.phase.bereit')} · ${ai.model}` : ai.phase === 'idle' ? t('ai.connect') : PHASE[ai.phase];
  pill.innerHTML = `<span class="led led-${tone}${tone === 'idle' && ai.running ? ' led-pulse' : ''}"></span>${esc(label)}`;
  pill.title = ai.phase === 'bereit' ? t('ai.verified', { detail: ai.detail }) : `${PHASE[ai.phase]}${ai.detail ? ` – ${ai.detail}` : ''}`;
  pill.dataset.go = '#/gpt/dashboard';
  if (coreState === 'idle') setCore('idle'); // Ruhezustand (online/KI) aktuell halten
  const cb = $('#talk-btn');
  if (cb) {
    cb.hidden = !voice.sttSupported;
    cb.classList.toggle('on', !!s.conversationMode);
    cb.innerHTML = `<span class="led led-${s.conversationMode ? 'ok' : 'idle'}"></span>${t(s.conversationMode ? 'carvis.convOn' : 'carvis.convOff')}`;
    cb.title = t('carvis.convTitle');
  }
  const wb = $('#wake-btn');
  wb.hidden = !voice.wakeSupported;
  wb.classList.toggle('on', !!status.wake);
  wb.innerHTML = `<span class="led led-${status.wake ? 'ok' : 'idle'}"></span>${t(status.wake ? 'carvis.wakeOn' : 'carvis.wakeOff')}`;
  wb.title = t('carvis.wakeTitle');
  $$('[data-act="toggle-tts"]').forEach((b) => b.classList.toggle('muted-on', !s.voiceOutput));
  if (rerenderViews && ['dashboard', 'settings', 'models'].includes(viewId)) safeRerender();
}

// =============================================================
// Schnellaktionen
// =============================================================
async function quickTask(projectId = null) {
  const s = store.get();
  const r = await modal({
    title: t('task.new'),
    body: `<label class="field">${t('task.task')}<input id="qt-title" maxlength="140" autofocus placeholder="${esc(t('task.todo'))}"></label>
      <div class="two"><label class="field">${t('task.project')}<select id="qt-proj"><option value="">${t('task.noProject')}</option>${s.projects.map((p) => `<option value="${p.id}" ${p.id === projectId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label class="field">${t('task.priority')}<select id="qt-prio"><option value="hoch">${t('task.high')}</option><option value="mittel" selected>${t('task.mid')}</option><option value="niedrig">${t('task.low')}</option></select></label></div>`,
    actions: [{ label: t('common.cancel'), value: null }, { label: t('common.create'), cls: 'btn-primary', getValue: (w) => ({ title: w.querySelector('#qt-title').value.trim(), projectId: w.querySelector('#qt-proj').value || null, priority: w.querySelector('#qt-prio').value }) }],
    onMount: (w, close) => w.querySelector('#qt-title').addEventListener('keydown', (e) => e.key === 'Enter' && w.querySelector('.modal-foot .btn-primary').click()),
  });
  if (r?.title) { actions.addTask(r); toast(t('toast.taskAdded'), 'ok'); }
}

async function quickText(title, label, placeholder) {
  return modal({
    title,
    body: `<label class="field">${label}<input id="qx" maxlength="120" autofocus placeholder="${esc(placeholder)}"></label>`,
    actions: [{ label: t('common.cancel'), value: null }, { label: t('common.ok'), cls: 'btn-primary', getValue: (w) => w.querySelector('#qx').value.trim() }],
    onMount: (w) => w.querySelector('#qx').addEventListener('keydown', (e) => e.key === 'Enter' && w.querySelector('.modal-foot .btn-primary').click()),
  });
}

// =============================================================
// Globale Aktionen (data-act)
// =============================================================
let aiPull = null; // laufender Modell-Download (Abbrechen)
const GLOBAL = {
  mic: () => toggleMic(),
  'stop-answer': () => { answerCtrl?.abort(); },
  'heal-rerender': () => { lastHtml = ''; renderView(); },
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
    if (on) { toast(t('toast.convOn'), 'ok'); if (!voice.listening && !busy) toggleMic(); }
    else { if (voice.listening) voice.stop(); toast(t('toast.convOff')); }
  },
  'toggle-wake': () => {
    actions.setSettings({ wakeWord: !store.get().settings.wakeWord });
    applySettings();
    if (store.get().settings.wakeWord) toast(t('toast.wakeOn'), 'ok');
  },
  suggest: (el) => (mode === 'gpt' && viewId === 'chat' ? gpt.sendFromComposer(el.dataset.text, ctx) : send(el.dataset.text)),
  'sub-more': (el) => subMore(el),
  'more-menu': (el) => moreMenu(el),
  'search-open': () => openSearch(),
  // Website-Download (D-056): Hauptklick = Portable EXE (Link im HTML), Menü = Installer, Hinweise. Keine früheren Versionen (kein Benutzer-Downgrade).
  'dl-menu': (el) => import('./downloads.js').then((d) => popover(el, [
    { label: t('dl.portable'), icon: 'update', run: () => { location.href = d.portableUrl(); } },
    { label: t('dl.installer'), icon: 'window', run: () => { location.href = d.installerUrl(); } },
    { label: t('dl.notes'), icon: 'doc', run: () => window.open(d.releaseNotesUrl(), '_blank', 'noopener') },
    { sep: true },
    { label: t('dl.unsigned'), icon: 'lock', disabled: true },
  ], { align: 'end', label: t('dl.windows') })),
  'sb-toggle': () => {
    const mini = document.documentElement.dataset.sb !== 'mini';
    if (mini) document.documentElement.dataset.sb = 'mini'; else delete document.documentElement.dataset.sb;
    try { localStorage.setItem('ccc.sidebar', mini ? 'mini' : 'full'); } catch { /* privat */ }
  },
  'carvis-menu': (el) => {
    const s = store.get().settings;
    popover(el, [
      { label: t('carvis.menuVoiceOut'), icon: 'speak', on: !!s.voiceOutput, run: () => GLOBAL['toggle-tts']() },
      { label: t('carvis.menuConversation'), icon: 'mic', on: !!s.conversationMode, run: () => { actions.setSettings({ conversationMode: !s.conversationMode }); toast(t(!s.conversationMode ? 'toast.convOn' : 'toast.convOff'), 'info', 1400); } },
      ...(voice.wakeSupported ? [{ label: t('carvis.menuWake'), icon: 'core', on: !!status.wake, run: () => GLOBAL['toggle-wake']?.() }] : []),
      { label: t('carvis.menuStopAnswer'), icon: 'close', run: () => { answerCtrl?.abort(); voice.cancelSpeak(); if (coreState === 'speaking') setCore('idle'); } },
      { sec: t('common.more') }, { label: t('carvis.menuVoiceSettings'), icon: 'settings', run: () => (location.hash = '#/gpt/settings') },
    ], { align: 'end', label: t('carvis.menuTitle') });
  },
  'toggle-theme': () => { toggleTheme(); refreshLanding(); },
  // Sprachmenü (Standard Englisch): Auswahl gilt sofort für App, KI-Antworten und Sprache – ohne Neustart
  'lang-menu': (el) => popover(el, [
    { sec: t('lang.title') },
    ...LANGS.map((l) => ({ label: l.name, icon: 'globe', on: l.code === lang(), run: () => changeLanguage(l.code) })),
  ], { align: 'end', label: t('nav.language') }),
  'code-copy': (el) => {
    const code = el.parentElement?.querySelector('code')?.innerText || '';
    navigator.clipboard?.writeText(code).then(() => { el.textContent = t('common.copied'); setTimeout(() => (el.textContent = t('common.copy')), 1400); }, () => toast(t('common.copyFail'), 'danger'));
  },
  'ai-connect': () => autoConnectAI({ force: true }),
  'ai-model-menu': (el) => modelMenu(el, () => renderStatus(true)),
  // Ein-Klick-Einrichtung (D-053): mit Agent (Windows-App) installiert CARVIS Ollama nach Zustimmung selbst (winget, offizielle
  // Quelle); ohne Agent oder bei Fehler öffnet sich die offizielle Seite. In jedem Fall verbindet CARVIS danach automatisch.
  'ai-install-ollama': async () => {
    const manual = (reason) => { window.open(OLLAMA_DOWNLOAD, '_blank', 'noopener'); toast(t('ai.installManual', { reason }), 'info', 8000); waitForOllama(); };
    const { agentClient: agc } = await import('./agent-client.js');
    if (!agc.connected) return manual(t('ai.reasonNoAgent'));
    if (!(await confirmDialog(t('ai.installAsk'), { title: t('ai.installOllama'), ok: t('ai.installOllama'), danger: false }))) return;
    toast(t('ai.installRunning'), 'info', 6000);
    const r = await installOllama();
    if (!r.ok) return manual(r.reason);
    toast(t('ai.installDone'), 'ok', 6000);
    waitForOllama({ maxMs: 3 * 60 * 1000 });
  },
  'ai-cancel': () => { aiPull?.abort(); },
  'ai-setup-model': async (el) => {
    const name = el.dataset.model;
    const size = el.dataset.size;
    if (!(await confirmDialog(t('ai.pullAsk', { name, gb: size }), { title: t('ai.pullTitle'), ok: t('ai.pullOk'), danger: false }))) return;
    aiPull = new AbortController();
    try { await setupModel(name, { signal: aiPull.signal }); toast(ai.phase === 'bereit' ? t('ai.readyToast', { model: ai.model }) : `${PHASE[ai.phase]}: ${ai.detail}`, ai.phase === 'bereit' ? 'ok' : 'warn'); } catch (e) { toast(t('ai.pullFailed', { err: e.message }), 'danger'); }
  },
  'close-sheet': () => closeSheet(),
  go: (el) => (location.hash = JSON.parse(el.dataset.payload)),
  'toggle-task': (el) => actions.toggleTask(el.dataset.id),
  'clear-chat': async () => {
    if (await confirmDialog(t('chat.clearAsk'), { ok: t('chat.clearOk') })) {
      actions.clearChat();
      toast(t('toast.histCleared'));
    }
  },
  'speak-msg': (el) => { const m = store.get().messages.find((x) => x.id === el.dataset.id); if (m) speak(m.text); },
  'copy-msg': async (el) => {
    const m = store.get().messages.find((x) => x.id === el.dataset.id);
    try { await navigator.clipboard.writeText(`${m.text}\n\n${blocksToText(m.blocks)}`.trim()); toast(t('common.copied'), 'ok', 1400); }
    catch { toast(t('common.copyFail'), 'danger'); }
  },
  'msg-to-doc': (el) => {
    const m = store.get().messages.find((x) => x.id === el.dataset.id);
    if (!m) return;
    const title = m.text.replace(/[*#`„“"]/g, '').split('\n')[0].slice(0, 60) || 'Antwort von CARVIS';
    const d = actions.addDocument({ title, content: `${m.text}\n\n${blocksToText(m.blocks)}`.trim() });
    documents.open(d.id);
    toast(t('toast.docSaved'), 'ok');
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
    const name = await quickText(t('project.new'), t('project.name'), t('project.example'));
    if (name) { actions.addProject({ name }); toast(t('project.added'), 'ok'); }
  },
  'quick-doc': () => { const d = actions.addDocument({ title: t('doc.new') }); documents.open(d.id); location.hash = '#/gpt/documents'; },
  'quick-plan': async () => {
    const goal = await quickText(t('plan.title'), t('plan.ask'), t('plan.example'));
    if (goal) { location.hash = '#/gpt/chat'; send(t('plan.prompt', { goal })); }
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
  // 4.1 Tastaturkürzel: Strg/⌘+1…4 Bereiche · Strg/⌘+Umschalt+L Hell/Dunkel · Strg/⌘+Umschalt+O neue Unterhaltung
  if ((e.metaKey || e.ctrlKey) && !e.altKey) {
    const tab = TABS.find((x) => x.key === e.key);
    if (tab && !e.shiftKey) { e.preventDefault(); location.hash = tab.href; }
    if (e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); toggleTheme(); }
    if (!e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); if (!searchOpen()) openSearch(); }
    if (e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); actions.newChat(); location.hash = '#/gpt/talk'; }
  }
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
window.addEventListener('offline', () => { status.online = false; renderStatus(true); if (coreState === 'idle') setCore('idle'); toast(t('toast.offline'), 'info'); });

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
  if (mode === 'gpt' && viewId === 'talk') talk.refresh();
  renderStatus(false);
  safeRerender();
});

$('#carvis-chips').innerHTML = chips(['Was kannst du?', 'Wie gehe ich bei einer App vor?', 'Zeige meine Aufgaben', 'Visualisiere meine Projekte']);
renderNav();
// Website: „Download for Windows“ nur im Browser (nicht in der Windows-App selbst). Ziel ist immer die öffentliche STABLE.
if (!(window.__TAURI__ && window.__TAURI__.core)) import('./downloads.js').then((d) => { const a = $('#dl-main'); if (a) { a.href = d.portableUrl(); a.setAttribute('download', ''); $('#dl-split').hidden = false; } }).catch(() => {});
// Globale Suche: Bereiche, Befehle und Agenten aus vorhandenen Ansichten (keine Platzhalter)
let agentList = [];
import('./agents.js').then((m) => { agentList = m.AGENTS || []; }).catch(() => {});
initSearch({
  views: () => [
    ...TABS.map((x) => ({ title: x.title, icon: x.icon, href: x.href })),
    ...SIDE_MORE.filter((x) => x.href).map((x) => ({ title: t(x.key), icon: x.icon, href: x.href })),
    ...MORE.flatMap((g) => g.items).filter((id) => VIEWS.some((v) => v.id === id)).map((id) => ({ title: viewTitle(id), icon: VIEWS.find((v) => v.id === id).icon, href: `#/gpt/${id}` })),
  ].filter((x, i, arr) => arr.findIndex((y) => y.href === x.href) === i),
  toggleTheme: () => toggleTheme(),
  connectAi: () => autoConnectAI({ force: true }),
  agents: () => agentList,
});
onAI(() => { renderStatus(false); if (mode === 'gpt' && ['dashboard', 'talk'].includes(viewId)) { if (viewId === 'talk') { talk.refresh(); safeRerender(); } else safeRerender(); } });
window.addEventListener('hashchange', route);
onLang(refreshLanding);
applyStatic();
route();
renderFeeds();
setCore('idle');
// Windows-Fenstertitel mit der einheitlichen Versionsangabe (D-051): „CARVIS CORE v1.0“ / „CARVIS CORE v1.1 TEST“.
// Der Browser-Tab bleibt „CARVIS CORE“ (Namensregel); die Version steht dort in Einstellungen und Update-Center.
try { window.__TAURI__?.window?.getCurrentWindow?.().setTitle(displayVersion()).catch(() => {}); } catch { /* Browser */ }
// Startbildschirm nur kurz zeigen; er blockiert nie Eingaben (pointer-events: none)
setTimeout(() => { const sp = $('#splash'); if (sp) { sp.classList.add('out'); setTimeout(() => sp.remove(), 450); } }, 350);
applySettings();
paintThemeBtn();
tickClock();
setTimeout(() => greet(false), 0); // nach vollständiger Initialisierung des Moduls
setTimeout(autoConnect, 0);
window.__ccAppReady = true; // Diagnose (js/boot-errors.js): Hauptmodul vollständig ausgeführt
// Self-Healing Engine (4.0): Überwachung, sichere Selbstreparatur, Erfolgskontrolle, Protokoll
Promise.all([import('./agent-client.js'), import('./ai/providers.js'), import('./ai/modelmanager.js')]).then(([ac, providers, mm]) => {
  startHealth({
    toast, voice, providers, mm,
    agentClient: ac.agentClient, agentState: ac.agentState, inApp: ac.inApp, autoConnectApp: ac.autoConnectApp,
    rerender: () => { lastHtml = ''; renderView(); },
    uiHealthy: () => uiOk,
    reloadView: async (id) => { const v = VIEWS.find((x) => x.id === id); if (v) { await loadView(v); if (currentView() === v) renderView(); } },
    viewLoaded: (id) => { const v = VIEWS.find((x) => x.id === id); return !!(v && !v.lazy && v.render); },
    firstDelay: Number(new URLSearchParams(location.search).get('healDelay')) || 6000,
  });
  // Systemzustand: bei jeder Änderung neu zeichnen; Dashboard nur, wenn sich die Kachel wirklich ändert (kein Flackern)
  const tile = () => `${healthState()}|${health.issues.filter((i) => i.status === 'fixed').length}`;
  let tileSig = tile();
  health.subscribe(() => {
    if (viewId === 'health') return safeRerender();
    if (viewId !== 'dashboard') return;
    const sig = tile();
    if (sig !== tileSig) { tileSig = sig; safeRerender(); }
  });
}).catch((e) => console.warn('Selbstreparatur nicht gestartet', e));
(window.requestIdleCallback || ((f) => setTimeout(f, 2500)))(() => VIEWS.forEach((v) => v.lazy && loadView(v).catch(() => {})));

// =============================================================
// Automatische Einrichtung: lokales Ollama selbst erkennen – nur wenn CC lokal läuft
// (auf der Live-Seite würde sonst jedes Gerät nach Zugriff aufs lokale Netzwerk fragen)
// =============================================================
async function autoConnect() {
  // Windows-App: erst den integrierten Agenten verbinden (er leitet auch Ollama durch)
  const m = await import('./agent-client.js').catch(() => null);
  const app = m ? await m.autoConnectApp().catch((e) => ({ app: true, ok: false, error: String(e) })) : { app: false };
  if (app.app && app.ok) { toast(t('toast.agentOn'), 'ok'); await afterAgent(m); }
  else if (app.app) {
    toast(t('toast.agentOff', { e: app.error }), 'warn');
    window.__ccDiagTitle?.(`Agent: ${app.error}`);
    // weiter im Hintergrund versuchen (alle 10 s, höchstens 5 Minuten), damit ein verspäteter Agent noch angemeldet wird
    if (!/Token falsch|konnte nicht gestartet|beendet, bevor/.test(app.error || '')) {
      let n = 0, running = false;
      const iv = setInterval(async () => {
        if (running) return;
        if (m.agentState.connected || ++n > 30) return clearInterval(iv);
        running = true;
        const r = await m.autoConnectApp(5000).catch(() => ({}));
        running = false;
        if (r.ok) { clearInterval(iv); toast(t('toast.agentOn'), 'ok'); await afterAgent(m); }
      }, 10000);
    }
  }
  if (!app.app) await discoverLocal(false);
  renderStatus(true);
  if (app.ok || ['localhost', '127.0.0.1'].includes(location.hostname)) autoConnectAI();
}

// Nach erfolgreicher Anmeldung beim integrierten Agenten: Spracherkennung über den Agenten, Ollama über die Durchleitung
async function afterAgent(m) {
  if (ai.phase !== 'bereit') setTimeout(() => autoConnectAI({ force: true }), 0);
  // WebView2 kann keine Web-Spracherkennung → lokale Erkennung über den Agenten (Windows System.Speech)
  try {
    const st = await m.agentClient.speechStatus();
    voice.useAgent((wav, lang) => m.agentClient.speechRecognize(wav, lang), st);
    // 4.1: Piper (lokal, hochwertig) als Sprachausgabe, wenn im Agenten installiert – sonst Systemstimme
    if (st.tts === 'piper' && store.get().settings.ttsEngine !== 'system') voice.useAgentTts((text) => m.agentClient.speechTts(plainText(text)));
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
    if (fresh.length) toast(t('toast.modelsOn', { n: fresh.length }), 'ok');
  } catch { /* Ollama läuft nicht – kein Problem */ }
}
if (!voice.sttSupported) $$('[data-act="mic"]').forEach((b) => (b.title = t('carvis.noStt')));

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
    greetingText = nextGreeting({ name: s.userName, formal: lang() === 'de' && s.addressForm !== 'du', back: !!back });
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
    if (r.state === 'available') toast(t('toast.updateAvail', { v: displayVersion(r.latest) }), 'info');
  } catch (e) { health.report('update-error', { cause: `Automatische Updateprüfung fehlgeschlagen: ${e.message}`, silent: true }); }
}, 4000);
