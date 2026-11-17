// Chat (CARVIS CORE 4.1): eigenständiger KI-Chat mit Unterhaltungen.
// Nutzt den bestehenden Verlauf (store.messages + chatArchive) und die CARVIS-Pipeline (Streaming, Stopp,
// Modell „Automatisch“) – kein zweiter Chatspeicher. Neu: Umbenennen, gezielt löschen, Liste immer sichtbar.
import { store, actions, CHAT_ARCHIVE_MAX } from '../store.js';
import { esc } from '../util.js';
import { icon, toast, confirmDialog, popover, modal } from '../ui.js';
import { ai, PHASE } from '../ai/autoconnect.js';
import { t, lang } from '../i18n.js';

const MAX_FILE = 300 * 1024;
const TEXT_RE = /\.(txt|md|csv|json|js|ts|py|html|css|xml|yml|yaml|log|ini|toml|sql|sh|ps1|bat|java|c|cpp|cs|go|rs|php|rb)$/i;
let pending = []; // Textanhänge der nächsten Nachricht
let filter = '';

const fmtD = (ts) => new Date(ts).toLocaleString(lang(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const currentTitle = (st) => st.chatTitle || (st.messages.find((m) => m.role === 'user')?.text || '').split('\n')[0].slice(0, 60) || t('chat.newTitle');

function usableModels(st) { return st.experts.filter((e) => e.enabled && e.local && e.cost === 'free'); }
export function modelLabel(st) {
  if (st.settings.modelChoice && st.settings.modelChoice !== 'auto') {
    const ex = st.experts.find((e) => e.id === st.settings.modelChoice);
    if (ex) return ex.model;
  }
  return ai.phase === 'bereit' ? t('model.autoWith', { m: ai.model }) : t('model.auto');
}
/** Kompakte Modellwahl: „Automatisch“ oder ein verbundenes lokales Modell (gemeinsam für Chat und CARVIS). */
export function modelMenu(anchor, after = () => {}) {
  const st = store.get();
  const list = usableModels(st);
  popover(anchor, [
    { label: t('model.auto'), icon: 'core', hint: t('common.recommended'), on: !st.settings.modelChoice || st.settings.modelChoice === 'auto', run: () => { actions.setSettings({ modelChoice: 'auto' }); after(); } },
    { sec: list.length ? t('model.manual') : t('model.noneLocal') },
    ...list.map((e) => ({ label: e.model, icon: 'llm', hint: e.status === 'error' ? t('model.error') : e.status === 'ok' ? t('common.verified') : '', on: st.settings.modelChoice === e.id, run: () => { actions.setSettings({ modelChoice: e.id }); after(); } })),
    { sec: t('common.more') }, { label: t('model.manage'), icon: 'settings', run: () => (location.hash = '#/gpt/models') },
  ], { align: 'end', label: t('model.label') });
}

function listHtml(st) {
  const arch = (st.chatArchive || []).filter((c) => !filter || (c.title || '').toLowerCase().includes(filter.toLowerCase()));
  const cur = st.messages.length ? `<li class="tk-item on" aria-current="true"><button class="tk-open" data-act="talk-focus" title="${esc(t('chat.isOpen'))}"><b>${esc(currentTitle(st))}</b><small>${esc(t('chat.open', { n: st.messages.length }))}</small></button><button class="icon-btn tk-more" data-act="talk-menu" data-id="current" aria-label="${esc(t('chat.menu'))}" title="${esc(t('chat.menu'))}">${icon('more')}</button></li>` : '';
  return `${cur}${arch.map((c) => `<li class="tk-item"><button class="tk-open" data-act="talk-open" data-id="${c.id}"><b>${esc(c.title || t('chat.untitled'))}</b><small>${esc(t('chat.messages', { date: fmtD(c.ts), n: c.messages.length }))}</small></button><button class="icon-btn tk-more" data-act="talk-menu" data-id="${c.id}" aria-label="${esc(t('chat.menuNamed', { t: c.title || t('chat.untitled') }))}" title="${esc(t('chat.menu'))}">${icon('more')}</button></li>`).join('')}`
    || `<li class="tk-empty">${esc(t('chat.none'))}</li>`;
}

function paintList(root = document) {
  const st = store.get();
  const ul = root.querySelector('[data-talk-list]');
  if (ul) { const h = listHtml(st); if (ul.dataset.k !== h) { ul.dataset.k = h; ul.innerHTML = h; } }
  const ti = root.querySelector('[data-talk-title]'); if (ti) ti.textContent = currentTitle(st);
  const rg = root.querySelector('[data-talk-regen]'); if (rg) rg.hidden = st.messages[st.messages.length - 1]?.role !== 'assistant';
  const m = root.querySelector('[data-talk-model]'); if (m) m.innerHTML = `${icon('core')} ${esc(modelLabel(st))}`;
  const n = (st.chatArchive || []).length;
  const warn = root.querySelector('[data-talk-cap]');
  if (warn) warn.hidden = n < CHAT_ARCHIVE_MAX - 10;
}

function paintAttach(root = document) {
  const el = root.querySelector('[data-talk-att]');
  if (el) el.innerHTML = pending.map((a, i) => `<span class="chip att-chip">${icon('clip')} ${esc(a.name)}<button type="button" class="att-x" data-act="talk-att-del" data-i="${i}" aria-label="${esc(t('chat.removeAtt', { name: a.name }))}">×</button></span>`).join('');
}

async function addFiles(files) {
  for (const f of files) {
    if (!TEXT_RE.test(f.name) && !(f.type || '').startsWith('text/')) { toast(t('chat.onlyText', { name: f.name }), 'warn'); continue; }
    let text = await f.text();
    const cut = text.length > MAX_FILE;
    if (cut) text = text.slice(0, MAX_FILE);
    pending.push({ name: f.name, text, cut });
  }
  paintAttach();
}

function send(ctx) {
  const inp = document.querySelector('#talk-input');
  const text = (inp?.value || '').trim();
  if (!text && !pending.length) return;
  const F = '```';
  const att = pending.map((a) => `\n\n📎 ${t('chat.attachment')}: ${a.name}${a.cut ? t('chat.cut') : ''}\n${F}\n${a.text}\n${F}`).join('');
  pending = []; paintAttach();
  if (inp) { inp.value = ''; inp.style.height = ''; }
  ctx.send((text || t('chat.lookAtAtt')) + att);
}

export default {
  id: 'talk',
  get title() { return t('nav.chat'); },
  icon: 'chat',
  selfManaged: true, // Liste und Verlauf werden gezielt aktualisiert, die Eingabe bleibt erhalten
  render(st) {
    const ready = ai.phase === 'bereit';
    let sideOff = false; try { sideOff = localStorage.getItem('ccc.talk.side') === 'off'; } catch { /* egal */ }
    return `<div class="page talk${sideOff ? ' side-off' : ''}" data-talk>
      <aside class="tk-side" aria-label="${esc(t('chat.list'))}">
        <button class="btn btn-primary tk-new" data-act="talk-new">${icon('plus')} ${esc(t('chat.new'))}</button>
        <input class="tk-search" type="search" placeholder="${esc(t('chat.search'))}" aria-label="${esc(t('chat.searchLabel'))}" data-talk-search value="${esc(filter)}">
        <ul class="tk-list" data-talk-list>${listHtml(st)}</ul>
        <p class="small muted" data-talk-cap hidden>${esc(t('chat.cap', { n: CHAT_ARCHIVE_MAX }))}</p>
      </aside>
      <section class="tk-main">
        <header class="tk-head"><button class="icon-btn tk-toggle" data-act="talk-side" aria-label="${esc(t('chat.toggleSide'))}" title="${esc(t('chat.toggleSide'))}">${icon('history')}</button><h1 data-talk-title>${esc(currentTitle(st))}</h1>
          <button class="icon-btn" data-act="talk-regen" data-talk-regen aria-label="${esc(t('chat.regen'))}" title="${esc(t('chat.regen'))}" ${st.messages[st.messages.length - 1]?.role === 'assistant' ? '' : 'hidden'}>${icon('reset')}</button>
          <button class="pill" data-act="talk-model" data-talk-model aria-haspopup="menu" title="${esc(t('chat.chooseModel'))}">${icon('core')} ${esc(modelLabel(st))}</button></header>
        ${ready ? '' : `<div class="notice ${ai.phase === 'fehler' ? 'notice-warn' : 'notice-info'} tk-ai">${esc(PHASE[ai.phase] || '')}${ai.detail ? ` – ${esc(ai.detail)}` : ''} <a href="#/gpt/dashboard" class="link-btn">${esc(t('chat.setupAi'))}</a></div>`}
        <div class="tk-feed" id="talk-feed" aria-live="polite"></div>
        <form class="tk-composer" data-talk-form autocomplete="off">
          <div class="tk-att" data-talk-att></div>
          <div class="tk-row">
            <label class="icon-btn" title="${esc(t('chat.attachTitle'))}" aria-label="${esc(t('chat.attach'))}">${icon('clip')}<input type="file" multiple data-talk-file hidden></label>
            <textarea id="talk-input" rows="1" placeholder="${esc(t('chat.placeholder'))}" aria-label="${esc(t('chat.message'))}"></textarea>
            <button type="button" class="icon-btn mic" data-act="mic" title="${esc(t('carvis.mic'))}" aria-label="${esc(t('carvis.mic'))}">${icon('mic')}</button>
            <button type="submit" class="icon-btn send" aria-label="${esc(t('carvis.send'))}" title="${esc(t('chat.sendTitle'))}">${icon('send')}</button>
          </div>
        </form>
      </section>
    </div>`;
  },
  onMount(root, ctx) {
    ctx.paintFeeds();
    paintAttach(root);
    const inp = root.querySelector('#talk-input');
    inp?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(ctx); } });
    inp?.addEventListener('input', () => { inp.style.height = 'auto'; inp.style.height = `${Math.min(inp.scrollHeight, 220)}px`; });
    root.querySelector('[data-talk-form]')?.addEventListener('submit', (e) => { e.preventDefault(); send(ctx); });
    root.querySelector('[data-talk-file]')?.addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
    root.querySelector('[data-talk-search]')?.addEventListener('input', (e) => { filter = e.target.value; paintList(root); });
    setTimeout(() => inp?.focus({ preventScroll: true }), 0);
  },
  /** Von app.js nach jeder Store-Änderung: Liste und Kopf aktualisieren (Verlauf malt renderFeeds). */
  refresh() { paintList(); },
  async onAct(act, el, ctx) {
    const id = el?.dataset.id;
    if (act === 'talk-focus') document.querySelector('#talk-input')?.focus();
    if (act === 'talk-side') { const tk = document.querySelector('[data-talk]'); tk?.classList.toggle('side-off'); try { localStorage.setItem('ccc.talk.side', tk?.classList.contains('side-off') ? 'off' : 'on'); } catch { /* egal */ } }
    if (act === 'talk-regen') { const q = actions.takeLastExchange(); if (q) ctx.send(q); else toast(t('chat.noRegen'), 'info'); }
    if (act === 'talk-new') { actions.newChat(); paintList(); document.querySelector('#talk-input')?.focus(); }
    if (act === 'talk-open') { actions.openChat(id); paintList(); }
    if (act === 'talk-att-del') { pending.splice(Number(el.dataset.i), 1); paintAttach(); }
    if (act === 'talk-model') modelMenu(el, () => paintList());
    if (act === 'talk-menu') {
      const st = store.get();
      const title = id === 'current' ? currentTitle(st) : (st.chatArchive || []).find((c) => c.id === id)?.title || t('chat.untitled');
      popover(el, [
        { label: t('common.rename'), icon: 'doc', run: () => rename(id, title) },
        { label: t('common.delete'), icon: 'trash', run: async () => {
          if (!(await confirmDialog(t('chat.delAsk', { t: title }), { ok: t('common.delete') }))) return;
          if (id === 'current') { actions.clearChat(); store.update((x) => { x.chatTitle = ''; }); }
          else actions.deleteArchivedChat(id);
          paintList(); toast(t('chat.deleted'), 'ok');
        } },
      ], { align: 'end', label: t('chat.untitled') });
    }
  },
};

function rename(id, title) {
  modal({
    title: t('chat.rename'),
    body: `<label class="field">${esc(t('chat.name'))}<input type="text" data-rename value="${esc(title)}" maxlength="80"></label>`,
    actions: [{ label: t('common.cancel'), value: null }, { label: t('common.save'), cls: 'btn-primary', getValue: (w) => w.querySelector('[data-rename]').value }],
    onMount: (w, close) => { const i = w.querySelector('[data-rename]'); i?.focus(); i?.select(); i?.addEventListener('keydown', (e) => { if (e.key === 'Enter') close(i.value); }); },
  }).then((v) => {
    if (v && v.trim()) { actions.renameChat(id, v); paintList(); toast(t('chat.renamed'), 'ok'); }
  });
}
