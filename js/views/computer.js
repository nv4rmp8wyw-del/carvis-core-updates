import { esc, relTime } from '../util.js';
import { icon, confirmDialog, toast, modal } from '../ui.js';
import { agentClient, agentState } from '../agent-client.js';
import { suggestions, requestStop } from '../agents.js';
import { ring } from '../sysmon.js';

const S = { sys: null, net: null, files: null, log: null, busy: '', err: '' };
const fmtB = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

async function guarded(ctx, label, fn) {
  S.busy = label; S.err = ''; ctx.rerender();
  try { await fn(); } catch (e) { S.err = e.message; if (e.status === 423) agentState.stopped = true; }
  S.busy = ''; ctx.rerender();
}

const connectCard = () => `<section class="card glass span-2">
  <header class="card-head"><h2>${icon('plug')} Desktop-Agent</h2><span class="tag ${agentClient.connected ? 'tag-ok' : 'tag-warn'}">${agentClient.connected ? 'VERBUNDEN' : 'NICHT VERBUNDEN'}</span></header>
  ${agentClient.connected ? `<ul class="status-list">
      <li><span class="led led-ok"></span><span class="k">Agent</span><span class="v">${esc(agentState.info.platform)} · Version ${esc(agentState.info.version)}</span></li>
      <li><span class="led led-${agentState.stopped ? 'danger' : 'ok'}"></span><span class="k">Status</span><span class="v">${agentState.stopped ? 'NOT-STOPP aktiv' : 'bereit'}</span></li>
      <li><span class="led led-ok"></span><span class="k">Freigegebene Ordner</span><span class="v">${esc((agentState.perms?.roots || []).join(', '))}</span></li>
      <li><span class="led led-ok"></span><span class="k">Befehlsausführung</span><span class="v">nicht möglich (nicht vorgesehen)</span></li></ul>
    <div class="row-actions" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
      ${agentState.stopped ? '<button class="btn btn-primary" data-act="agent-resume">Fortsetzen</button>' : '<button class="btn btn-danger" data-act="agent-stop">■ Not-Stopp</button>'}
      <button class="btn" data-act="agent-disconnect">Trennen</button></div>`
    : `<p class="muted small">Der Desktop-Agent ist ein kleines Programm auf deinem Computer. Ohne ihn kann CC im Browser weder CPU-Last noch Prozesse, Autostart oder Ordner sehen. Er hört nur auf <b>127.0.0.1</b>, hat <b>keinen Befehlszugriff</b> und schreibt nur nach deiner Bestätigung neue Dateien in freigegebene Ordner.</p>
      <ol class="small muted" style="padding-left:18px"><li>Python 3 installieren (python.org). Dann im CCC-Ordner: <code>python3 tools/desktop-agent.py</code> (Windows: <code>py tools\\desktop-agent.py</code>)</li>
        <li>Den angezeigten Token hier eingeben und verbinden.</li></ol>
      <form class="inline-form" data-form="agent-connect"><input name="url" value="${esc(agentState.url)}" aria-label="Agent-Adresse"><input name="token" type="password" placeholder="Token aus dem Terminal" autocomplete="off" required aria-label="Token"><button class="btn btn-primary" type="submit">Verbinden</button></form>
      <p class="muted small">Funktioniert in Chrome und Edge am PC. Safari und iPhone blockieren Verbindungen zu lokalen Programmen. Dort sind diese Funktionen nicht nutzbar.</p>`}
  ${S.err ? `<div class="notice notice-warn" style="margin-top:10px">${esc(S.err)}</div>` : ''}
</section>`;

function sysCards() {
  const y = S.sys;
  const memUsed = y?.memory ? Math.round(100 * (1 - y.memory.available / y.memory.total)) : null;
  const d0 = y?.disks?.[0];
  const dUsed = d0 ? Math.round(100 * (1 - d0.free / d0.total)) : null;
  return `<section class="card glass span-2"><header class="card-head"><h2>${icon('dashboard')} PC-Diagnose</h2>
      <button class="btn" data-act="agent-sys" ${S.busy ? 'disabled' : ''}>${S.busy === 'sys' ? 'Misst …' : 'Messen'}</button></header>
    ${y ? `<div class="gauges">${ring(y.cpu?.percent ?? null, y.cpu?.percent != null ? `${y.cpu.percent}%` : '–', 'CPU', 'cyan')}${ring(memUsed, memUsed != null ? `${memUsed}%` : '–', 'RAM belegt', 'blue')}${ring(dUsed, dUsed != null ? `${dUsed}%` : '–', 'Speicher belegt', 'violet')}</div>
      <p class="muted small">${esc(y.platform)} · ${y.cores} Kerne · CPU-Messung: ${esc(y.cpu?.method || '–')}${y.memory ? ` · RAM ${fmtB(y.memory.total - y.memory.available)} von ${fmtB(y.memory.total)}` : ''}</p>
      <h3 class="small">Größte Prozesse (nur Name und Speicher)</h3>
      <ul class="mini-list">${(y.processes || []).map((p) => `<li><span>${esc(p.name)}</span><span class="muted">${fmtB(p.bytes)}</span></li>`).join('') || '<li class="muted">nicht verfügbar</li>'}</ul>
      <h3 class="small">Autostart (${(y.autostart || []).length})</h3>
      <p class="muted small">${esc((y.autostart || []).join(', ') || 'keine Einträge gefunden oder nicht lesbar')}</p>`
      : '<p class="empty">Noch keine Messung. Tippe auf „Messen“.</p>'}</section>`;
}

function netCard() {
  const n = S.net;
  return `<section class="card glass"><header class="card-head"><h2>${icon('bolt')} Netzwerk</h2><button class="btn" data-act="agent-net" ${S.busy ? 'disabled' : ''}>${S.busy === 'net' ? 'Misst …' : 'Messen'}</button></header>
    ${n ? `<ul class="status-list">${n.results.map((r) => `<li><span class="led led-${r.loss ? 'warn' : r.medianMs != null && r.medianMs > 150 ? 'warn' : 'ok'}"></span><span class="k">${esc(r.host)}:${r.port}</span><span class="v">${r.medianMs ?? '–'} ms <small>Verlust ${r.loss} % · DNS ${r.dnsMs ?? '–'} ms</small></span></li>`).join('')}</ul>
      <p class="muted small">Gemessen wird der TCP-Verbindungsaufbau (5 Versuche), kein ICMP-Ping und kein Durchsatz-Speedtest. WLAN-Signalstärke liest der Agent nicht.</p>`
      : '<p class="empty">Noch keine Messung.</p>'}</section>`;
}

function tipsCard() {
  if (!S.sys && !S.net) return '';
  return `<section class="card glass"><header class="card-head"><h2>${icon('preview')} Optimierungsvorschläge</h2></header>
    <ul class="checks">${suggestions(S.sys, S.net).map((t) => `<li class="${t.tone === 'ok' ? 'ok' : 'sim'}">${esc(t.text)}</li>`).join('')}</ul>
    <p class="muted small">Nur Vorschläge aus echten Messwerten. CC ändert nichts an deinem System.</p></section>`;
}

function filesCard() {
  const f = S.files;
  return `<section class="card glass span-2"><header class="card-head"><h2>${icon('project')} Arbeitsordner</h2><button class="btn" data-act="agent-list" data-path="">Anzeigen</button></header>
    ${f ? `<p class="muted small">${esc(f.path)}</p><ul class="mini-list">${f.entries.map((e) => `<li><span>${e.type === 'dir' ? '📁' : '📄'} ${esc(e.name)}</span>${e.type === 'dir' ? `<button class="link-btn" data-act="agent-list" data-path="${esc(f.path + '/' + e.name)}">Öffnen ›</button>` : `<button class="link-btn" data-act="agent-read" data-path="${esc(f.path + '/' + e.name)}">Lesen ›</button>`}</li>`).join('') || '<li class="muted">Ordner ist leer.</li>'}</ul>` : '<p class="empty">Noch nicht geladen.</p>'}
    <form class="inline-form" data-form="agent-newfile"><input name="name" placeholder="neue-datei.txt" maxlength="80" required aria-label="Dateiname"><input name="content" placeholder="Inhalt" required maxlength="2000" aria-label="Inhalt"><button class="btn btn-primary" type="submit">Anlegen …</button></form>
    <p class="muted small">Neue Dateien werden erst nach deiner Bestätigung angelegt. Bestehende Dateien werden nie überschrieben oder gelöscht.</p></section>`;
}

function logCard() {
  return `<section class="card glass span-2"><header class="card-head"><h2>${icon('dot')} Agent-Protokoll</h2><button class="btn" data-act="agent-log">Aktualisieren</button></header>
    ${S.log ? `<ul class="activity">${[...S.log].reverse().slice(0, 15).map((e) => `<li><span class="led led-${e.ok ? 'ok' : 'danger'}"></span><span>${esc(e.action)}${e.detail ? ` – ${esc(e.detail)}` : ''}</span><time>${relTime(e.ts)}</time></li>`).join('')}</ul>` : '<p class="empty">Noch nicht geladen.</p>'}</section>`;
}

export default {
  id: 'computer',
  title: 'Computer',
  icon: 'dashboard',
  render() {
    return `<div class="page"><header class="page-head"><div><p class="eyebrow">PC &amp; Netzwerk</p><h1>Computer &amp; Optimierung</h1>
      <p class="muted">Echte Messwerte kommen vom lokalen Desktop-Agenten. Der Browser allein darf sie nicht lesen.</p></div></header>
      <div class="grid">${connectCard()}${agentClient.connected ? `${sysCards()}${netCard()}${tipsCard()}${filesCard()}${logCard()}` : ''}</div></div>`;
  },
  onSubmit(form, ctx) {
    const f = new FormData(form);
    if (form.dataset.form === 'agent-connect') {
      guarded(ctx, 'connect', async () => { await agentClient.connect(f.get('url'), f.get('token')); toast('Mit dem Desktop-Agenten verbunden.', 'success'); });
    }
    if (form.dataset.form === 'agent-newfile') {
      const name = String(f.get('name')).trim(), content = String(f.get('content'));
      guarded(ctx, 'file', async () => {
        const p = await agentClient.propose(name, content);
        const ok = await confirmDialog(`Der Agent legt diese Datei NEU an (${p.preview.bytes} Bytes):\n${p.preview.path}\n\nAnfang: ${p.preview.start.slice(0, 120)}`, { title: 'Aktion bestätigen', ok: 'Datei anlegen', danger: false });
        if (!ok) { await agentClient.cancel(p.id); toast('Abgebrochen. Nichts wurde verändert.', 'info'); return; }
        await agentClient.confirm(p.id);
        S.files = await agentClient.list('');
        toast('Datei angelegt.', 'success');
      });
    }
  },
  async onAct(act, el, ctx) {
    if (act === 'agent-disconnect') { agentClient.disconnect(); Object.assign(S, { sys: null, net: null, files: null, log: null, err: '' }); ctx.rerender(); }
    if (act === 'agent-stop') { requestStop(); agentState.stopped = true; ctx.rerender(); toast('Not-Stopp aktiv. Der Agent führt nichts mehr aus.', 'info'); }
    if (act === 'agent-resume') guarded(ctx, 'resume', () => agentClient.resume());
    if (act === 'agent-sys') guarded(ctx, 'sys', async () => { S.sys = await agentClient.system(); });
    if (act === 'agent-net') guarded(ctx, 'net', async () => { S.net = await agentClient.net(['1.1.1.1:443', 'github.com:443']); });
    if (act === 'agent-list') guarded(ctx, 'list', async () => { S.files = await agentClient.list(el.dataset.path || ''); });
    if (act === 'agent-log') guarded(ctx, 'log', async () => { S.log = (await agentClient.log()).log; });
    if (act === 'agent-read') {
      try {
        const r = await agentClient.read(el.dataset.path);
        modal({ title: r.path.split(/[\\/]/).pop(), body: `<pre style="white-space:pre-wrap;max-height:50vh;overflow:auto">${esc(r.content)}</pre>`, actions: [{ label: 'Schließen', value: true, cls: 'btn-primary' }] });
      } catch (e) { toast(e.message, 'error'); }
    }
  },
};
