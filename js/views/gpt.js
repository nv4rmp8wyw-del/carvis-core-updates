// GPT – Multi-KI-Arbeitsbereich: bis zu vier KI-Fenster mit eigenem Verlauf, Modellwahl je Fenster
// und fünf Modi (Auto, Einzeln, Vergleich, Review, Team). Keine simulierten Antworten:
// Fenster ohne verbundenes Modell sagen das ausdrücklich.
import { modelMenu, modelLabel } from './talk.js';
import { esc, md, fmtTime, uid, download } from '../util.js';
import { icon, toast, popover, confirmDialog, userBubble } from '../ui.js';
import { store, actions } from '../store.js';
import { callExpert, COST_LABEL } from '../ai/providers.js';
import { answering } from '../ai/busy.js';
import { answerLanguage } from '../ai/orchestrator.js';
import { t, lang } from '../i18n.js';
import { chips } from './workspace.js';

export const MAX_PANELS = 4;
const MAX_PANEL_MSGS = 60;
export const MODES = [
  { id: 'auto', get label() { return t('gpt.m.auto'); }, icon: 'core', get hint() { return t('gpt.m.autoHint'); } },
  { id: 'single', get label() { return t('gpt.m.single'); }, icon: 'window', get hint() { return t('gpt.m.singleHint'); } },
  { id: 'compare', get label() { return t('gpt.m.compare'); }, icon: 'compare', get hint() { return t('gpt.m.compareHint'); } },
  { id: 'review', get label() { return t('gpt.m.review'); }, icon: 'review', get hint() { return t('gpt.m.reviewHint'); } },
  { id: 'team', get label() { return t('gpt.m.team'); }, icon: 'team', get hint() { return t('gpt.m.teamHint'); } },
];
const offline = () => t('gpt.offline');

// ---------------------------------------------------------------- Zustand
const defaults = () => ({ mode: 'auto', focus: 0, panels: [{ id: uid(), source: 'carvis', messages: [] }], widths: [] });
export function ws() {
  const st = store.get();
  if (!st.gpt || !Array.isArray(st.gpt.panels) || !st.gpt.panels.length) st.gpt = defaults();
  const g = st.gpt;
  if (!MODES.some((m) => m.id === g.mode)) g.mode = 'auto';
  g.focus = Math.max(0, Math.min(g.focus | 0, g.panels.length - 1));
  return g;
}
const save = (fn) => store.update((s) => { fn(s.gpt); });
const running = new Map(); // Panel-ID -> AbortController (nur Laufzeit)
const partials = new Map(); // Panel-ID -> gestreamter Text der laufenden Antwort

/** Modelle, die in einem Fenster gewählt werden können. */
function usableExperts(st = store.get()) {
  return st.experts.filter((e) => e.cost !== 'paid' || st.settings.allowPaid);
}
const expertOf = (src, st = store.get()) => st.experts.find((e) => e.id === src);
/** Verbindungszustand eines Fensters: carvis | ok | off */
function panelState(p, st = store.get()) {
  if (p.source === 'carvis') return 'carvis';
  const ex = expertOf(p.source, st);
  if (!ex || !ex.enabled || (ex.cost === 'paid' && !st.settings.allowPaid)) return 'off';
  return 'ok';
}
const panelLabel = (p, st = store.get()) => (p.source === 'carvis' ? 'CARVIS · Auto' : expertOf(p.source, st)?.label || 'Nicht verbundenes Modell');

// ---------------------------------------------------------------- Fenster verwalten
export function addPanel(source) {
  const g = ws();
  if (g.panels.length >= MAX_PANELS) { toast(t('gpt.maxPanels', { n: MAX_PANELS }), 'info'); return false; }
  const used = new Set(g.panels.map((p) => p.source));
  const next = source || usableExperts().find((e) => e.enabled && !used.has(e.id))?.id || (used.has('carvis') ? usableExperts()[0]?.id || 'none' : 'carvis');
  save((x) => { x.panels.push({ id: uid(), source: next, messages: [] }); x.focus = x.panels.length - 1; x.widths = []; });
  return true;
}
function closePanel(i) {
  const g = ws();
  if (g.panels.length <= 1) return toast(t('gpt.minPanel'), 'info');
  running.get(g.panels[i].id)?.abort();
  save((x) => { x.panels.splice(i, 1); x.focus = Math.min(x.focus, x.panels.length - 1); x.widths = []; });
}
function setLayout(n) {
  const g = ws();
  while (ws().panels.length < n) if (!addPanel()) break;
  if (g.panels.length > n) save((x) => { x.panels.slice(n).forEach((p) => running.get(p.id)?.abort()); x.panels = x.panels.slice(0, n); x.focus = Math.min(x.focus, n - 1); x.widths = []; });
}
export function setMode(id) {
  save((x) => { x.mode = id; });
  const g = ws();
  if ((id === 'compare' || id === 'review') && g.panels.length < 2) {
    addPanel();
    if (id === 'review') toast(t('gpt.reviewToast'), 'info');
  }
  if ((id === 'auto' || id === 'team') && !g.panels.some((p) => p.source === 'carvis')) save((x) => { x.panels[0].source = 'carvis'; x.panels[0].messages = []; });
}
function resetLayout() {
  ws().panels.forEach((p) => running.get(p.id)?.abort());
  save((x) => { const d = defaults(); x.mode = d.mode; x.focus = 0; x.widths = []; x.panels = [x.panels.find((p) => p.source === 'carvis') || d.panels[0]]; });
  toast(t('gpt.layoutReset'), 'ok', 1400);
}
async function newConversation(ctx) {
  const g = ws();
  const p = g.panels[g.focus];
  if (p.source === 'carvis') { actions.newChat(); toast(t('gpt.newChatToast'), 'ok'); }
  else save((x) => { x.panels[x.focus].messages = []; });
}

// ---------------------------------------------------------------- Anhänge (Textdateien)
const ATT_MAX_FILES = 3;
const ATT_MAX_BYTES = 300 * 1024;
const ATT_MAX_CHARS = 12000; // kleine lokale Modelle haben wenig Kontext
const ATT_TEXT = /\.(txt|md|markdown|csv|tsv|json|xml|html?|css|js|mjs|ts|tsx|jsx|py|rs|java|c|cc|cpp|h|cs|go|rb|php|sh|ps1|bat|ini|cfg|conf|toml|ya?ml|log|sql)$/i;
let pending = []; // [{ name, size, text, cut }]
async function addFiles(files) {
  for (const f of files) {
    if (pending.length >= ATT_MAX_FILES) { toast(t('gpt.maxAtt', { n: ATT_MAX_FILES }), 'info'); break; }
    if (!(ATT_TEXT.test(f.name) || /^text\//.test(f.type) || f.type === 'application/json')) { toast(t('gpt.onlyText', { name: f.name }), 'info'); continue; }
    if (f.size > ATT_MAX_BYTES) { toast(t('gpt.tooBig', { name: f.name }), 'info'); continue; }
    let text = await f.text();
    const cut = text.length > ATT_MAX_CHARS;
    if (cut) text = text.slice(0, ATT_MAX_CHARS);
    pending.push({ name: f.name, size: f.size, text: text.replace(/```/g, "'''"), cut });
  }
  paintAttachments();
}
function paintAttachments() {
  const el = view?.querySelector('.gw-atts');
  if (!el) return;
  el.innerHTML = pending.map((a, i) => `<span class="chip att-chip">${icon('clip')} ${esc(a.name)} <small>${Math.max(1, Math.round(a.size / 1024))} KB${a.cut ? t('gpt.cutShort') : ''}</small><button type="button" class="att-x" data-act="gw-att-del" data-i="${i}" aria-label="Anhang ${esc(a.name)} entfernen">×</button></span>`).join('');
  el.hidden = !pending.length;
}
function withAttachments(text) {
  if (!pending.length) return text;
  const body = text || 'Bitte sieh dir den Anhang an und fasse das Wichtigste zusammen.';
  const F = '```';
  const att = pending.map((a) => `\n\n📎 ${t('chat.attachment')}: ${a.name}${a.cut ? t('chat.cut') : ''}\n${F}\n${a.text}\n${F}`).join('');
  pending = [];
  paintAttachments();
  return body + att;
}

// ---------------------------------------------------------------- Verläufe
function historyItems(ctx) {
  const st = store.get();
  const list = st.chatArchive || [];
  const fmtD = (ts) => new Date(ts).toLocaleString(lang(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return [
    { label: t('gpt.newChat'), icon: 'plus', hint: st.messages.length ? t('gpt.archiveCurrent') : '', run: () => newConversation(ctx) },
    { sec: list.length ? t('gpt.earlier', { n: list.length }) : t('gpt.noEarlier') },
    ...list.map((c) => ({ label: c.title || t('chat.untitled'), icon: 'chat', hint: fmtD(c.ts), run: () => { actions.openChat(c.id); toast(t('gpt.chatOpened'), 'ok'); } })),
    ...(list.length ? [{ sec: t('gpt.cleanup') }, { label: t('gpt.delOldest'), icon: 'trash', run: async () => { const c = list[list.length - 1]; if (await confirmDialog(t('gpt.delAsk', { t: c.title }), { ok: t('common.delete'), danger: true })) actions.deleteArchivedChat(c.id); } }] : []),
  ];
}
function exportMarkdown() {
  const st = store.get();
  const g = ws();
  const parts = g.panels.map((p, i) => {
    const list = p.source === 'carvis' ? st.messages : p.messages;
    const body = list.map((m) => `**${m.role === 'user' ? 'Du' : panelLabel(p)}** (${fmtTime(m.ts)}):\n\n${m.text}`).join('\n\n---\n\n');
    return `## Fenster ${i + 1}: ${panelLabel(p)}\n\n${body || '_leer_'}`;
  });
  download(`carvis-gpt-${new Date().toISOString().slice(0, 10)}.md`, `# CARVIS CORE – GPT-Arbeitsbereich\n\n${parts.join('\n\n')}\n`, 'text/markdown');
  toast(t('gpt.exported'), 'ok');
}

// ---------------------------------------------------------------- Senden
// Lokale Modelle laufen nacheinander (mehrere gleichzeitig überlasten den Arbeitsspeicher).
let localChain = Promise.resolve();
const queueLocal = (fn) => (localChain = localChain.then(fn, fn));

function pushMsg(panelId, m) {
  save((x) => {
    const p = x.panels.find((q) => q.id === panelId);
    if (!p) return;
    p.messages.push({ id: uid(), ts: Date.now(), ...m });
    if (p.messages.length > MAX_PANEL_MSGS) p.messages = p.messages.slice(-MAX_PANEL_MSGS);
  });
}

async function consentFor(ex) {
  const st = store.get();
  if (ex.local) return true;
  if (ex.cost === 'paid' && !st.settings.allowPaid) return false;
  if (st.consents[ex.vendorKey]) return true;
  const ok = await confirmDialog(t('gpt.extAsk', { vendor: ex.vendorKey, label: ex.label, paid: ex.cost === 'paid' ? t('gpt.paid') : '' }), { title: t('gpt.extTitle'), ok: t('gpt.allow'), danger: ex.cost === 'paid' });
  if (ok) actions.setConsent(ex.vendorKey, true);
  return ok;
}

/** Fragt das Modell eines Fensters. Gibt den Antworttext zurück (oder null bei Fehler). */
async function askPanel(panelId, text, { quiet = false } = {}) {
  const st = store.get();
  const p = ws().panels.find((q) => q.id === panelId);
  if (!p) return null;
  if (!quiet) pushMsg(panelId, { role: 'user', text });
  const ex = expertOf(p.source, st);
  if (panelState(p, st) !== 'ok') { pushMsg(panelId, { role: 'assistant', text: offline(), error: true, offline: true }); return null; }
  if (!(await consentFor(ex))) { pushMsg(panelId, { role: 'assistant', text: 'Nicht gesendet: Anbieter nicht freigegeben.', error: true }); return null; }
  const history = p.messages.filter((m) => !m.error).slice(-12).map((m) => ({ role: m.role, content: m.text }));
  if (quiet) history.push({ role: 'user', content: text });
  const msgs = [{ role: 'system', content: `Du bist ein KI-Modell im Multi-KI-Arbeitsbereich von CARVIS CORE. ${answerLanguage()} Klar strukturiert und ehrlich; erfinde keine Fakten.` }, ...history];
  const ctrl = new AbortController();
  running.set(panelId, ctrl);
  paintPanel(panelId);
  const run = async () => {
    if (ctrl.signal.aborted) throw new Error('abgebrochen');
    return callExpert(ex, msgs, st.settings, { signal: ctrl.signal, onToken: (txt) => {
      partials.set(panelId, txt);
      const el = view?.querySelector(`[data-feed="${panelId}"] .msg-thinking .stream`);
      if (el) { el.innerHTML = md(txt); el.closest('.gw-feed').scrollTop = 1e9; }
    } });
  };
  answering.begin();
  try {
    const r = await (ex.local ? queueLocal(run) : run()).finally(() => answering.end());
    actions.recordExpert?.(ex.id, { ok: true, ms: r.ms });
    pushMsg(panelId, { role: 'assistant', text: r.content, model: ex.label, ms: r.ms });
    return r.content;
  } catch (e) {
    actions.recordExpert?.(ex.id, { ok: false, error: e.message });
    const part = partials.get(panelId);
    if (ctrl.signal.aborted && part) pushMsg(panelId, { role: 'assistant', text: `${part}\n\n*– abgebrochen –*`, model: ex.label });
    else pushMsg(panelId, { role: 'assistant', text: ctrl.signal.aborted ? 'Abgebrochen.' : `Keine Antwort von ${ex.label}: ${e.message}`, error: !ctrl.signal.aborted });
    return null;
  } finally {
    running.delete(panelId);
    partials.delete(panelId);
    paintPanel(panelId);
  }
}

/** Einstieg aus dem Eingabefeld. ctx.send = CARVIS-Pipeline (gemeinsamer Verlauf mit dem CARVIS-Bereich). */
export async function sendFromComposer(text, ctx) {
  text = withAttachments((text || '').trim());
  if (!text) return;
  const g = ws();
  const carvisPanel = g.panels.find((p) => p.source === 'carvis');
  const viaCarvis = (opts) => ctx.send(text, opts);
  switch (g.mode) {
    case 'auto':
    case 'team':
      if (!carvisPanel) setMode(g.mode);
      if (g.mode === 'team' && usableExperts().filter((e) => e.enabled && e.local && e.cost === 'free').length < 2) toast(t('gpt.teamFew'), 'info');
      return viaCarvis(g.mode === 'team' ? { collab: 'always' } : {});
    case 'single': {
      const p = g.panels[g.focus];
      return p.source === 'carvis' ? viaCarvis() : askPanel(p.id, text);
    }
    case 'compare':
      return Promise.all(g.panels.map((p) => (p.source === 'carvis' ? viaCarvis() : askPanel(p.id, text))));
    case 'review': {
      const [a, b] = g.panels;
      if (!b) return toast(t('gpt.reviewNeeds2'), 'info');
      let answer;
      if (a.source === 'carvis') { await viaCarvis(); const last = [...store.get().messages].reverse().find((m) => m.role === 'assistant'); answer = last && !last.error && last.source !== 'demo' ? last.text : null; }
      else answer = await askPanel(a.id, text);
      if (!answer) { if (b.source !== 'carvis') pushMsg(b.id, { role: 'assistant', text: t('gpt.reviewSkipped'), error: true }); return; }
      const prompt = `${t('gpt.reviewPrompt', { q: text })}\n\n${t('gpt.answerSep')}\n${answer}`;
      if (b.source === 'carvis') return ctx.send(prompt);
      pushMsg(b.id, { role: 'user', text: `Review der Antwort aus Fenster 1 (${panelLabel(a)})`, meta: true });
      return askPanel(b.id, prompt, { quiet: true });
    }
  }
}

// ---------------------------------------------------------------- Darstellung
function msgHtml(m, p) {
  if (m.role === 'user') return `<div class="msg msg-user"><div class="bubble">${userBubble(m.text)}</div><time>${fmtTime(m.ts)}</time></div>`;
  return `<div class="msg msg-ai ${m.error ? 'msg-error' : ''}">
    <div class="msg-head"><span class="avatar" aria-hidden="true"></span><b>${esc(m.model || panelLabel(p))}</b>${m.error ? '' : `<span class="src src-llm" title="${esc(t('src.llmT'))}">${esc(t('src.llm'))}</span>`}<time>${fmtTime(m.ts)}${m.ms ? ` · ${(m.ms / 1000).toFixed(1)} s` : ''}</time></div>
    <div class="bubble">${m.error ? esc(m.text) : md(m.text)}</div>
    ${m.error ? '' : `<div class="msg-tools"><button class="tool" data-act="gw-copy" data-id="${m.id}" title="${esc(t('common.copy'))}">${icon('copy')}</button></div>`}
  </div>`;
}

function feedHtml(p, st) {
  if (p.source === 'carvis') return ''; // wird von app.js (renderFeeds) gefüllt
  const state = panelState(p, st);
  const busy = running.has(p.id);
  const body = p.messages.map((m) => msgHtml(m, p)).join('');
  const thinking = busy ? `<div class="msg msg-ai msg-thinking"><div class="msg-head"><span class="avatar"></span><b>${esc(panelLabel(p, st))}</b><span class="src src-sys">antwortet …</span></div><div class="bubble"><div class="stream">${partials.get(p.id) ? md(partials.get(p.id)) : ''}</div>${partials.get(p.id) ? '' : '<span class="dots"><i></i><i></i><i></i></span>'}</div></div>` : '';
  if (body || thinking) return body + thinking;
  if (state === 'off') {
    return `<div class="gw-off"><span class="led led-warn"></span><b>${offline()}</b><span class="muted">${usableExperts(st).length ? t('gpt.pickModel') : t('gpt.noModel')}</span><button class="btn btn-sm" data-go="#/gpt/models">${icon('plug')} ${t('gpt.openModels')}</button></div>`;
  }
  return `<div class="gw-empty"><b>${esc(panelLabel(p, st))}</b><span>Eigener Verlauf. Im Modus „Vergleich“ bekommt dieses Fenster dieselbe Frage wie die anderen.</span></div>`;
}

function sourceSelect(p, i, st) {
  const takenCarvis = ws().panels.some((q, j) => j !== i && q.source === 'carvis');
  const opts = [];
  if (!takenCarvis) opts.push(`<option value="carvis" ${p.source === 'carvis' ? 'selected' : ''}>CARVIS · Auto (Routing)</option>`);
  usableExperts(st).forEach((e) => opts.push(`<option value="${esc(e.id)}" ${p.source === e.id ? 'selected' : ''}>${esc(e.label)}${e.enabled ? '' : ' (deaktiviert)'} · ${esc(COST_LABEL[e.cost] || '')}</option>`));
  if (p.source !== 'carvis' && !expertOf(p.source, st)) opts.unshift(`<option value="${esc(p.source)}" selected>Kein Modell verbunden</option>`);
  return `<select data-gw-source="${i}" aria-label="${esc(t('gpt.modelFor', { n: i + 1 }))}">${opts.join('')}</select>`;
}

function panelHtml(p, i, g, st) {
  const state = panelState(p, st);
  const led = state === 'off' ? 'warn' : state === 'carvis' ? (st.experts.some((e) => e.enabled && e.status === 'ok') ? 'ok' : 'idle') : expertOf(p.source, st)?.status === 'ok' ? 'ok' : expertOf(p.source, st)?.status === 'error' ? 'danger' : 'idle';
  const busy = running.has(p.id);
  const n = g.panels.length;
  return `<section class="gw-panel ${i === g.focus ? 'focus' : ''}" data-panel="${i}" data-pid="${p.id}" data-state="${state}" aria-label="${esc(t('gpt.window', { n: i + 1 }))}">
    <header class="gw-head">
      <span class="gw-num">${i + 1}</span><span class="led led-${led}" title="${state === 'off' ? offline() : t('gpt.modelStatus')}"></span>
      ${sourceSelect(p, i, st)}
      <span class="grow"></span>
      ${busy ? `<button class="icon-btn sm ghost" data-act="gw-stop" data-i="${i}" title="${esc(t('common.cancel'))}" aria-label="${esc(t('gpt.cancelAnswer'))}">■</button>` : ''}
      <button class="icon-btn sm ghost" data-act="gw-panel-menu" data-i="${i}" title="${esc(t('gpt.panelOpts'))}" aria-label="${esc(t('gpt.panelOptsN', { n: i + 1 }))}" aria-haspopup="menu">${icon('more')}</button>
      ${n > 1 ? `<button class="icon-btn sm ghost" data-act="gw-close" data-i="${i}" title="${esc(t('gpt.closePanel'))}" aria-label="${esc(t('gpt.closePanelN', { n: i + 1 }))}">${icon('close')}</button>` : ''}
    </header>
    <div class="gw-feed" ${p.source === 'carvis' ? 'id="gpt-feed" aria-live="polite"' : 'aria-live="polite"'} data-feed="${p.id}">${feedHtml(p, st)}</div>
    ${i < n - 1 && n <= 3 ? `<div class="gw-split" data-split="${i}" role="separator" aria-orientation="vertical" aria-label="${esc(t('gpt.resize'))}"></div>` : ''}
  </section>`;
}

function colsVar(g) {
  const n = g.panels.length;
  if (n === 4) return '1fr 1fr';
  const w = g.widths?.length === n ? g.widths : Array(n).fill(1);
  return w.map((x) => `minmax(0, ${Math.max(0.2, x).toFixed(3)}fr)`).join(' ');
}

function targetText(g, st) {
  const p = g.panels[g.focus];
  switch (g.mode) {
    case 'auto': return 'Sendet an <b>CARVIS</b> – automatische Modellwahl.';
    case 'single': return `Sendet nur an <b>Fenster ${g.focus + 1}</b> (${esc(panelLabel(p, st))}).`;
    case 'compare': return `Sendet dieselbe Frage an <b>${g.panels.length} Fenster</b>; lokale Modelle nacheinander.`;
    case 'review': return t('gpt.reviewDesc');
    case 'team': return t('gpt.teamDesc');
    default: return '';
  }
}

let view; // aktuelle Wurzel
let vctx = null; // Kontext aus app.js (send, paintFeeds)
function paintPanel(panelId) {
  if (!view?.isConnected) return;
  const st = store.get();
  const g = ws();
  const i = g.panels.findIndex((p) => p.id === panelId);
  const el = view.querySelector(`[data-pid="${panelId}"]`);
  if (i < 0 || !el) return;
  const fresh = document.createElement('div');
  fresh.innerHTML = panelHtml(g.panels[i], i, g, st);
  const next = fresh.firstElementChild;
  const oldFeed = el.querySelector('.gw-feed');
  if (g.panels[i].source === 'carvis') next.querySelector('.gw-feed').replaceWith(oldFeed); // Verlauf gehört app.js
  el.replaceWith(next);
  const feed = next.querySelector('.gw-feed');
  feed.scrollTop = feed.scrollHeight;
}

function paintAll(ctx = vctx) {
  if (!view?.isConnected) return;
  const st = store.get();
  const g = ws();
  const host = view.querySelector('.gw-panels');
  const keepCarvis = host.querySelector('#gpt-feed');
  host.dataset.n = g.panels.length;
  host.style.setProperty('--cols', colsVar(g));
  host.innerHTML = g.panels.map((p, i) => panelHtml(p, i, g, st)).join('');
  if (keepCarvis) { const slot = host.querySelector('#gpt-feed'); if (slot) slot.replaceWith(keepCarvis); }
  host.querySelectorAll('.gw-feed').forEach((f) => (f.scrollTop = f.scrollHeight));
  view.querySelectorAll('[data-gw-mode]').forEach((b) => { const on = b.dataset.gwMode === g.mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  const ml = view.querySelector('[data-gw-mode-label]'); if (ml) ml.textContent = MODES.find((m) => m.id === g.mode)?.label || 'Auto';
  view.querySelector('.gw-target').innerHTML = targetText(g, st);
  view.querySelector('.gw-mob-tabs').innerHTML = mobTabs(g, st);
  const add = view.querySelector('[data-act="gw-add"]');
  if (add) add.disabled = g.panels.length >= MAX_PANELS;
  const hint = view.querySelector('.gw-hint');
  if (hint) hint.textContent = `${g.panels.length}/${MAX_PANELS} Fenster`;
  ctx?.paintFeeds?.();
}

const mobTabs = (g, st) => g.panels.map((p, i) => `<button class="chip ${i === g.focus ? 'on' : ''}" data-act="gw-focus" data-i="${i}">${i + 1} · ${esc(panelLabel(p, st))}</button>`).join('');

function moreItems(ctx) {
  const g = ws();
  const go = (h) => () => (location.hash = h);
  return [
    { sec: t('gpt.secWindow') },
    { label: t('gpt.newPanel'), icon: 'plus', hint: `${g.panels.length}/${MAX_PANELS}`, disabled: g.panels.length >= MAX_PANELS, run: () => addPanel() && paintAll(ctx) },
    ...[1, 2, 3, 4].map((n) => ({ label: `${n === 1 ? t('gpt.layout1') : t('gpt.layoutN', { n })}${n === 4 ? ' (2 × 2)' : ''}`, icon: 'columns', on: g.panels.length === n, run: () => { setLayout(n); paintAll(ctx); } })),
    { label: t('gpt.layoutResetBtn'), icon: 'reset', run: () => { resetLayout(); paintAll(ctx); } },
    { sec: t('gpt.modeLabel') },
    ...MODES.map((m) => ({ label: m.label, icon: m.icon, on: g.mode === m.id, title: m.hint, run: () => { setMode(m.id); paintAll(ctx); } })),
    { sec: t('chat.untitled') },
    { label: t('gpt.historyMore'), icon: 'history', run: () => setTimeout(() => { const b = document.querySelector('[data-act="gw-more"]'); if (b) popover(b, historyItems(ctx), { align: 'end', label: t('gpt.history') }); }, 0) },
    { label: t('gpt.newChatPanel'), icon: 'chat', run: () => newConversation(ctx) },
    { label: t('gpt.export'), icon: 'share', run: exportMarkdown },
    { sec: t('gpt.secTools') },
    { label: t('model.manage'), icon: 'plug', run: go('#/gpt/models') },
    { label: t('view.agents'), icon: 'agent', run: go('#/gpt/agents') },
    { label: t('view.projects'), icon: 'project', run: go('#/gpt/projects') },
    { label: t('view.tasks'), icon: 'task', run: go('#/gpt/tasks') },
    { label: t('view.documents'), icon: 'doc', run: go('#/gpt/documents') },
    { label: t('view.memory'), icon: 'memory', run: go('#/gpt/memory') },
  ];
}

// ---------------------------------------------------------------- Ansicht
export const gpt = {
  id: 'chat',
  title: 'Arbeitsbereich',
  icon: 'chat',
  selfManaged: true, // Verlauf und Fenster werden gezielt aktualisiert; Eingabe bleibt erhalten
  sendFromComposer,
  render(s) {
    const g = ws();
    return `<div class="gw" data-gw>
      <div class="gw-bar">
        <button class="pill gw-model" data-act="gw-model" aria-haspopup="menu" title="${esc(t('gpt.modelTitle'))}">${icon('core')} ${t('gpt.modelBtn')} <b data-gw-model>${esc(modelLabel(s))}</b></button>
        <button class="btn btn-sm btn-ghost gw-mode-btn" data-act="gw-mode-menu" aria-haspopup="menu" title="${esc(t('gpt.modeTitle'))}">${icon(MODES.find((m) => m.id === g.mode)?.icon || 'core')} ${t('gpt.mode')} <b data-gw-mode-label>${esc(MODES.find((m) => m.id === g.mode)?.label || 'Auto')}</b>${icon('chevron')}</button>
        <span class="grow"></span>
        <button class="icon-btn" data-act="gw-add" ${g.panels.length >= MAX_PANELS ? 'disabled' : ''} aria-label="${esc(t('gpt.addWindow'))}" title="${esc(t('gpt.addTitle', { n: g.panels.length, max: MAX_PANELS }))}">${icon('plus')}</button>
        <button class="icon-btn" data-act="gw-more" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(t('gpt.moreFns'))}" title="${esc(t('gpt.moreTitle'))}">${icon('more')}</button>
      </div>
      <div class="gw-mob-tabs" aria-label="${esc(t('gpt.windows'))}">${mobTabs(g, s)}</div>
      <div class="gw-panels" data-n="${g.panels.length}" style="--cols:${colsVar(g)}">${g.panels.map((p, i) => panelHtml(p, i, g, s)).join('')}</div>
      <div class="gw-compose">
        <div class="chips">${chips()}</div>
        <div class="gw-atts" hidden></div>
        <form class="composer composer-gpt" id="gpt-form" autocomplete="off">
          <label class="icon-btn" title="${esc(t('gpt.attachTitle'))}" aria-label="${esc(t('chat.attach'))}">${icon('clip')}<input type="file" multiple data-gw-attach hidden></label>
          <button type="button" class="icon-btn mic" data-act="mic" title="${esc(t('carvis.mic'))}" aria-label="${esc(t('carvis.mic'))}">${icon('mic')}</button>
          <textarea name="q" rows="1" placeholder="${esc(t('gpt.placeholder'))}" title="${esc(t('gpt.enterHint'))}" aria-label="${esc(t('chat.message'))}"></textarea>
          <button type="submit" class="icon-btn send" aria-label="${esc(t('carvis.send'))}"><svg viewBox="0 0 24 24"><path d="M3 20.5 21 12 3 3.5 3 10l12 2-12 2z"/></svg></button>
        </form>
        <div class="gw-target">${targetText(g, s)}</div>
      </div>
    </div>`;
  },
  onMount(root, ctx) {
    view = root.querySelector('[data-gw]');
    vctx = ctx;
    paintAttachments();
    view.querySelector('[data-gw-attach]')?.addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
    view.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); view.classList.add('drop'); } });
    view.addEventListener('dragleave', (e) => { if (e.target === view) view.classList.remove('drop'); });
    view.addEventListener('drop', (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); view.classList.remove('drop'); addFiles([...e.dataTransfer.files]); });
    ctx.paintFeeds?.();
    root.querySelectorAll('.gw-feed').forEach((f) => (f.scrollTop = f.scrollHeight));
    // Fokus per Klick ins Fenster
    view.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('[data-panel]');
      if (!el || e.target.closest('select, button, .gw-split')) return;
      const i = +el.dataset.panel;
      if (ws().focus !== i) { save((x) => { x.focus = i; }); view.querySelectorAll('.gw-panel').forEach((p) => p.classList.toggle('focus', +p.dataset.panel === i)); view.querySelector('.gw-target').innerHTML = targetText(ws(), store.get()); view.querySelector('.gw-mob-tabs').innerHTML = mobTabs(ws(), store.get()); }
    });
    // Breite per Trenner ziehen
    view.addEventListener('pointerdown', (e) => {
      const sp = e.target.closest('.gw-split');
      if (!sp) return;
      e.preventDefault();
      const host = view.querySelector('.gw-panels');
      const g = ws();
      const n = g.panels.length;
      const k = +sp.dataset.split;
      const els = [...host.querySelectorAll('.gw-panel')];
      const w = els.map((x) => x.getBoundingClientRect().width);
      const total = w.reduce((a, b) => a + b, 0);
      const x0 = e.clientX;
      const a0 = w[k], b0 = w[k + 1];
      sp.classList.add('drag');
      sp.setPointerCapture(e.pointerId);
      let fr = w.map((x) => x / total * n);
      const move = (ev) => {
        const dx = Math.max(-a0 + 220, Math.min(b0 - 220, ev.clientX - x0));
        const next = [...w]; next[k] = a0 + dx; next[k + 1] = b0 - dx;
        fr = next.map((x) => x / total * n);
        host.style.setProperty('--cols', fr.map((x) => `minmax(0, ${x.toFixed(3)}fr)`).join(' '));
      };
      const up = () => { sp.classList.remove('drag'); sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); save((x) => { x.widths = fr; }); };
      sp.addEventListener('pointermove', move);
      sp.addEventListener('pointerup', up);
    });
  },
  onAct(act, el, ctx) {
    const i = +el.dataset.i;
    if (act === 'gw-add') { if (addPanel()) paintAll(ctx); }
    if (act === 'gw-close') { closePanel(i); paintAll(ctx); }
    if (act === 'gw-mode') { setMode(el.dataset.gwMode); paintAll(ctx); }
    if (act === 'gw-model') { modelMenu(el, () => { const m = document.querySelector('[data-gw-model]'); if (m) m.textContent = modelLabel(store.get()); }); return; }
    if (act === 'gw-mode-menu') popover(el, MODES.map((m) => ({ label: m.label, icon: m.icon, on: ws().mode === m.id, hint: m.id === 'auto' ? t('common.recommended') : '', title: m.hint, run: () => { setMode(m.id); paintAll(ctx); } })), { label: t('gpt.modeLabel') });
    if (act === 'gw-focus') { save((x) => { x.focus = i; }); paintAll(ctx); }
    if (act === 'gw-stop') running.get(ws().panels[i]?.id)?.abort();
    if (act === 'gw-more') popover(el, moreItems(ctx), { align: 'end', label: t('common.more') });
    if (act === 'gw-history') popover(el, historyItems(ctx), { align: 'end', label: t('gpt.history') });
    if (act === 'gw-att-del') { pending.splice(+el.dataset.i, 1); paintAttachments(); }
    if (act === 'gw-panel-menu') {
      const g = ws();
      const p = g.panels[i];
      popover(el, [
        { label: t('gpt.onlyThis'), icon: 'window', run: () => { save((x) => { x.focus = i; x.mode = 'single'; }); paintAll(ctx); } },
        { label: t('gpt.clearPanel'), icon: 'trash', run: async () => { if (p.source === 'carvis') { if (await confirmDialog(t('gpt.clearCarvisAsk'), { ok: t('gpt.clearOk') })) actions.clearChat(); } else { save((x) => { x.panels[i].messages = []; }); paintAll(ctx); } } },
        { label: t('gpt.closePanel'), icon: 'close', disabled: g.panels.length <= 1, run: () => { closePanel(i); paintAll(ctx); } },
      ], { align: 'end', label: `Fenster ${i + 1}` });
    }
    if (act === 'gw-copy') {
      const m = ws().panels.flatMap((p) => p.messages).find((x) => x.id === el.dataset.id);
      if (m) navigator.clipboard.writeText(m.text).then(() => toast(t('common.copied'), 'ok', 1200), () => toast(t('gpt.copyFail'), 'danger'));
    }
  },
  onChange(el, ctx) {
    if (el.dataset.gwSource !== undefined) {
      const i = +el.dataset.gwSource;
      const val = el.value;
      save((x) => { const p = x.panels[i]; if (p.source !== val) { running.get(p.id)?.abort(); p.source = val; p.messages = []; } });
      paintAll(ctx);
    }
  },
  /** Von app.js nach jeder Store-Änderung: nur Fenster mit eigenem Verlauf neu zeichnen. */
  refresh() {
    if (!view?.isConnected) return;
    const g = ws();
    const shown = [...view.querySelectorAll('.gw-panel')].map((e) => e.dataset.pid);
    if (shown.join() !== g.panels.map((p) => p.id).join()) return paintAll();
    g.panels.forEach((p) => {
      if (p.source === 'carvis') return;
      const feed = view.querySelector(`[data-feed="${p.id}"]`);
      const sig = `${p.messages.length}:${p.messages.at(-1)?.id || ''}:${running.has(p.id)}`;
      if (feed && feed.dataset.sig !== sig) { feed.dataset.sig = sig; feed.innerHTML = feedHtml(p, store.get()); feed.scrollTop = feed.scrollHeight; }
    });
  },
};
