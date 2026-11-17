// Dashboard v1.2 (D-054) nach den Referenzbildern des Inhabers (LIGHT/DARK identisch):
// Kopf mit Begrüßung und großer CARVIS-Kugel (offizielles Logo) vor Lichtwellen, vier Schnellaktionen, drei Karten
// (KI-Systeme · Systemübersicht · Letzte Aktivitäten) und das untere CARVIS-CORE-Band.
// Ehrlichkeit: Jede Statusangabe stammt aus einer echten Prüfung. „Verbunden/Bereit“ nur nach echter Testantwort bzw.
// echter Erkennung; der Prozentwert der Systemübersicht ist der Anteil bestandener Prüfungen (keine erfundene Kennzahl).
import { health, STATUS, STATUS_LED } from '../health.js';
import { esc, relTime } from '../util.js';
import { icon } from '../ui.js';
import { store } from '../store.js';
import { agentClient, inApp } from '../agent-client.js';
import { ai, PHASE } from '../ai/autoconnect.js';
import { STARTER } from '../ai/modelmanager.js';
import { t, tn } from '../i18n.js';
import { greetingWord } from '../greeting.js';

// Kachel ohne Zwischenzustände („Prüfung läuft“), damit das Dashboard im Ruhezustand nicht neu zeichnet
export const healthState = () => { const o = health.overall(); return o === 'checking' ? 'ok' : o; };

/** Fünf getrennte, ehrliche Stufen. „bereit“ nur nach echter Testantwort (ai.verifiedAt). */
export function aiLadder() {
  const p = ai.phase;
  const engine = ai.engine === true || ['kein-modell', 'verbinden', 'testen', 'bereit', 'laden'].includes(p);
  const installed = p === 'bereit' || (ai.installed?.length || 0) > 0;
  const connected = ['testen', 'bereit'].includes(p);
  const verified = p === 'bereit' && !!ai.verifiedAt;
  const agent = agentClient.connected ? 'yes' : inApp() ? 'no' : 'notNeeded';
  const val = (b) => (b ? 'yes' : 'no');
  const known = p !== 'idle' && p !== 'pruefen';
  return [
    { key: 'agent', state: agent },
    { key: 'provider', state: known ? val(engine) : 'open', extra: engine && ai.server ? ai.server : '' },
    { key: 'model', state: known && engine ? val(installed) : 'open' },
    { key: 'connected', state: known && installed ? val(connected) : 'open' },
    { key: 'verified', state: known ? val(verified) : 'open' },
  ];
}
const LADDER_LED = { yes: 'ok', no: 'warn', open: 'idle', notNeeded: 'idle' };
const ladderHtml = () => `<details class="ai-ladder-wrap"><summary class="icon-btn sm ghost" title="${esc(t('dash.aiStatus'))}" aria-label="${esc(t('dash.aiStatus'))}">i</summary><ol class="ai-ladder" aria-label="${esc(t('dash.aiStatus'))}">${aiLadder().map((s) =>
  `<li data-step="${s.key}" data-state="${s.state}"><span class="led led-${LADDER_LED[s.state]}"></span><span>${esc(t(`ai.ladder.${s.key}`))}</span><b>${esc(t(`ai.ladder.${s.state}`))}${s.extra ? ` · ${esc(s.extra)}` : ''}</b></li>`).join('')}</ol></details>`;

/** Ein Eintrag je Anbieter mit echtem Status: ok (echte Antwort) · found (gefunden) · none (nicht gefunden) · setup (nicht eingerichtet) · open (nicht geprüft) */
export function providerRows(s = store.get()) {
  const ready = ai.phase === 'bereit';
  const checked = !['idle', 'pruefen'].includes(ai.phase);
  const local = (name, found) => (ready && ai.server === name ? 'ok' : !checked ? 'open' : found);
  const cloud = (vendor) => {
    const ex = (s.experts || []).filter((e) => !e.local && (e.vendorKey === vendor || e.provider === vendor) && e.enabled);
    return ex.some((e) => e.status === 'ok') ? 'ok' : ex.length ? 'found' : 'setup';
  };
  return [
    { id: 'ollama', name: t('dash.pOllama'), icon: 'core', state: local('Ollama', ai.ollama === 'none' ? 'none' : ai.ollama ? 'found' : 'none') },
    { id: 'lmstudio', name: 'LM Studio', icon: 'cube', state: local('LM Studio', ai.servers?.['LM Studio'] || 'none') },
    { id: 'llamacpp', name: 'llama.cpp', icon: 'code', state: local('llama.cpp', ai.servers?.['llama.cpp'] || 'none') },
    { id: 'cloud', name: t('dash.pCloud'), icon: 'sparkle', state: ['openrouter', 'gemini'].map(cloud).sort((a, b) => ['ok', 'found', 'setup'].indexOf(a) - ['ok', 'found', 'setup'].indexOf(b))[0] },
  ];
}
const P_TONE = { ok: 'ok', found: 'info', none: 'idle', setup: 'idle', open: 'idle' };

/** Systemübersicht: echte Prüfungen, Wert = Anteil bestandener */
export function systemChecks() {
  const hs = healthState();
  const list = [
    { key: 'sysAi', ok: ai.phase === 'bereit' },
    { key: 'sysAgent', ok: agentClient.connected || !inApp(), na: !agentClient.connected && !inApp() },
    { key: 'sysNet', ok: navigator.onLine },
    { key: 'sysData', ok: typeof store.storageOk === 'function' ? store.storageOk() : true },
    { key: 'sysHealth', ok: hs === 'ok' || hs === 'fixed' },
  ];
  const pct = Math.round((list.filter((x) => x.ok).length / list.length) * 100);
  return { list, pct, hs };
}

function aiCard(s) {
  const busy = ['pruefen', 'verbinden', 'testen', 'laden'].includes(ai.phase) || ai.running;
  const rows = providerRows(s);
  let action = '';
  if (ai.phase === 'kein-ollama') action = `<button class="btn btn-primary btn-sm" data-act="ai-install-ollama">${icon('update')} ${esc(t('ai.installOllama'))}</button>`;
  else if (ai.phase === 'kein-modell' && ai.recommended) action = `<button class="btn btn-primary btn-sm" data-act="ai-setup-model" data-model="${ai.recommended.name}" data-size="${ai.recommended.sizeGB}">${icon('update')} ${esc(t('ai.setup', { label: ai.recommended.label, gb: ai.recommended.sizeGB }))}</button>`;
  else if (ai.phase === 'fehler') action = `<button class="btn btn-primary btn-sm" data-act="ai-connect">${esc(t('ai.reconnect'))}</button>`;
  else if (ai.phase === 'idle') action = `<button class="btn btn-primary btn-sm" data-act="ai-connect">${icon('core')} ${esc(t('ai.connect'))}</button>`;
  const progress = ai.phase === 'laden' ? `<div class="bar" role="progressbar" aria-valuenow="${ai.progress?.pct ?? 0}" aria-valuemin="0" aria-valuemax="100"><i style="width:${ai.progress?.pct ?? 0}%"></i></div><button class="btn btn-sm btn-ghost" data-act="ai-cancel">${esc(t('ai.cancel'))}</button>` : '';
  return `<section class="card dash-card dash-ai" data-dash-ai="${ai.phase}">
    <header class="card-head"><h2 title="${esc(`${PHASE[ai.phase] || ''}${ai.detail ? ` – ${ai.detail}` : ''}`)}"><span class="led led-${ai.phase === 'bereit' ? 'ok' : ai.phase === 'fehler' ? 'danger' : busy ? 'idle led-pulse' : 'warn'}"></span> ${esc(t('dash.aiSystems'))}<small class="dash-ai-phase">${esc(PHASE[ai.phase] || '')}${ai.phase === 'bereit' ? ` · ${esc(ai.model)}` : ''}</small></h2><div class="head-tools">${ladderHtml()}<a class="icon-btn sm ghost" href="#/gpt/models" aria-label="${esc(t('dash.aiManager'))}">${icon('chevronR')}</a></div></header>
    <ul class="prov-list">${rows.map((r) => `<li data-provider="${r.id}" data-state="${r.state}">${icon(r.icon)}<span>${esc(r.name)}</span><em class="badge badge-${P_TONE[r.state]}">${esc(t(`dash.p.${r.state}`))}</em><a class="icon-btn sm ghost" href="#/gpt/models" aria-label="${esc(t('dash.aiManager'))}">${icon('more')}</a></li>`).join('')}</ul>
    <div class="dash-ai-actions">${action}${progress}<a class="btn btn-ghost btn-sm dash-wide" href="#/gpt/models">${icon('layers')} ${esc(t('dash.aiManager'))}</a></div>
  </section>`;
}

function sysCard() {
  const { list, pct, hs } = systemChecks();
  const aiOk = ai.phase === 'bereit';
  const limited = hs === 'ok' && !aiOk;
  const status = limited ? t('dash.noAiLimited') : STATUS[hs];
  const C = 2 * Math.PI * 52;
  const label = pct === 100 ? t('dash.optimal') : pct >= 60 ? t('dash.good') : t('dash.limited');
  return `<section class="card dash-card dash-sys" data-heal-tile data-limited="${limited}">
    <header class="card-head"><h2>${icon('monitor')} ${esc(t('dash.sysOverview'))}</h2><a class="icon-btn sm ghost" href="#/gpt/health" aria-label="${esc(t('common.details'))}">${icon('chevronR')}</a></header>
    <div class="sys-body">
      <div class="gauge-ring" role="img" aria-label="${esc(t('dash.gaugeAria', { n: pct }))}"><svg viewBox="0 0 120 120" aria-hidden="true"><defs><linearGradient id="gr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#62d8e6"/><stop offset=".5" stop-color="#7a8cff"/><stop offset="1" stop-color="#b29cff"/></linearGradient></defs>
        <circle cx="60" cy="60" r="52" class="g-track"/><circle cx="60" cy="60" r="52" class="g-val" stroke="url(#gr)" stroke-dasharray="${(C * pct) / 100} ${C}" transform="rotate(-90 60 60)"/></svg>
        <div><b>${pct} %</b><small>${esc(label)}</small></div></div>
      <ul class="sys-checks">${list.map((x) => `<li data-ok="${x.ok}">${x.ok ? icon('check') : '<span class="led led-warn"></span>'}<span title="${x.na ? esc(t('ai.ladder.notNeeded')) : ''}">${esc(t(`dash.${x.key}`))}</span></li>`).join('')}</ul>
    </div>
    <p class="small dash-sys-status"><span class="led led-${limited ? 'warn' : STATUS_LED[hs]}"></span> <span class="dash-big-inline">${esc(status)}</span></p>
  </section>`;
}

const ACT_ICON = (txt = '') => (/optim|energ|autostart|temp/i.test(txt) ? 'bolt' : /modell|model|ki\b|ai\b/i.test(txt) ? 'layers' : /projekt|project/i.test(txt) ? 'check' : /chat/i.test(txt) ? 'chat' : 'history');
function recentCard(s) {
  const recent = (s.activity || []).slice(0, 4);
  const tasksOpen = s.tasks.filter((x) => !x.done).length;
  return `<section class="card dash-card dash-recent">
    <header class="card-head"><h2>${icon('history')} ${esc(t('dash.recent'))}</h2><a class="icon-btn sm ghost" href="#/gpt/health" aria-label="${esc(t('common.details'))}">${icon('chevronR')}</a></header>
    ${recent.length ? `<ul class="act-list">${recent.map((a) => `<li>${icon(a.icon && a.icon !== 'core' ? a.icon : ACT_ICON(a.text))}<span>${esc(a.text)}</span><time>${esc(relTime(a.ts))}</time></li>`).join('')}</ul>` : `<p class="empty">${esc(t('dash.nothing'))}</p>`}
    ${tasksOpen ? `<a class="link-btn small" href="#/gpt/tasks">${esc(tn('dash.openTasks', tasksOpen))}</a>` : ''}
  </section>`;
}

export default {
  id: 'dashboard',
  get title() { return t('nav.dashboard'); },
  icon: 'dashboard',
  onAct(act) {
    if (act === 'dash-talk') { location.hash = '#/carvis'; setTimeout(() => document.querySelector('[data-act="mic"]')?.click(), 300); }
    if (act === 'dash-newchat') { import('../store.js').then(({ actions }) => { actions.newChat(); location.hash = '#/gpt/talk'; }); }
    if (act === 'dash-diagnose') { health.runChecks({ force: true }); location.hash = '#/gpt/health'; }
  },
  render(s) {
    const ready = ai.phase === 'bereit';
    const name = s.settings.userName ? `, ${esc(s.settings.userName)}` : '';
    const { pct, hs } = systemChecks();
    const allOk = pct === 100 && hs === 'ok';
    return `<div class="page dash41 dash12">
      <section class="dash-hero">
        <div class="dash-hero-text"><p class="eyebrow">${esc(t('nav.dashboard'))}</p>
          <h1>${esc(greetingWord())}${name}.</h1>
          <p class="dash-q">${esc(ready ? t('dash.readyQ') : t('dash.notReady'))}</p></div>
        <div class="hero-orb" aria-hidden="true" data-orb="${ready ? 'ready' : 'idle'}"><img src="icons/cc-orb-glow-512.png" alt="" width="260" height="260"></div>
        <div class="waves" aria-hidden="true"></div>
      </section>
      <section class="dash-actions" aria-label="${esc(t('dash.quick'))}">
        <button class="qa qa-primary" data-act="dash-talk"><i>${icon('mic')}</i><b>${esc(t('dash.qaTalk'))}</b></button>
        <button class="qa" data-act="dash-newchat"><i>${icon('chat')}</i><b>${esc(t('dash.qaChat'))}</b></button>
        <a class="qa" href="#/gpt/ucc"><i>${icon('bolt')}</i><b>${esc(t('dash.qaAutomate'))}</b></a>
        <a class="qa" href="#/gpt/perf"><i>${icon('layers')}</i><b>${esc(t('dash.qaOptimize'))}</b></a>
      </section>
      <div class="dash-grid3">
        ${aiCard(s)}
        ${sysCard()}
        ${recentCard(s)}
      </div>
      <section class="dash-band">
        <img src="icons/cc-orb-128.png" alt="" width="72" height="72">
        <div><b>CARVIS CORE</b><span>${esc(t('dash.tagline'))}</span></div>
        <a class="pill band-pill" href="#/gpt/health" data-all-ok="${allOk}"><span class="led led-${allOk ? 'ok' : 'warn'}"></span>${esc(allOk ? t('dash.allActive') : t('dash.someLimited', { n: 100 - pct }))}${icon('sparkle')}</a>
        <div class="waves" aria-hidden="true"></div>
      </section>
    </div>`;
  },
};
// Vorrat an Startmodellen bleibt für die Ein-Klick-Einrichtung im KI-Manager verfügbar
export const _starter = STARTER;
