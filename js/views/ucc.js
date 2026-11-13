// AKTIONEN-CENTER. Ohne Agent gibt es nur Plan und Vorschau. Ausgeführt wird nur, wenn der Desktop-Agent verbunden ist
// und im Aktionsmodus (--aktionen, in der Windows-App automatisch) läuft – und nur nach deiner Freigabe. Nichts wird vorgetäuscht.
import { VERSION } from '../version.js';
import { esc, relTime } from '../util.js';
import { icon, toast, confirmDialog } from '../ui.js';
import { store, actions } from '../store.js';
import { agentClient, agentState } from '../agent-client.js';
import { AGENTS, STATUS, requestStop } from '../agents.js';
import { aiOverview, catalogStatus } from './models.js';
import { CATALOG, COST_LABEL } from '../ai/providers.js';

const S = { plan: null, job: null, log: null, err: '', busy: '', free: null, timer: null, f: {} };
const fv = (k, d = '') => esc(S.f[k] ?? d);

/** Feste Vorlagen: CC erzeugt Schritte nur aus diesen Vorlagen, nie aus frei erzeugten KI-Befehlen. */
export const TEMPLATES = {
  doc: { label: 'Dokument erstellen', build: (f, perms) => ({ title: `Dokument ${f.name}`, steps: [
    { op: 'write_file', path: f.name, content: f.text || 'Leeres Dokument\n' }] }) },
  app: { label: 'Programm öffnen', build: (f) => ({ title: `Programm ${f.app}`, steps: [{ op: 'open_app', app: f.app }] }) },
  browser: { label: 'Browser-Testablauf', build: (f) => ({ title: 'Browser-Test', steps: [
    { op: 'browser_goto', url: f.url }, { op: 'browser_text', selector: 'body' }, { op: 'browser_screenshot', name: f.shot || 'browser-test.png' }] }) },
  pay: { label: 'Zahlung (Test: wird blockiert)', build: (f) => ({ title: 'Zahlungsanfrage (Test)', steps: [{ op: 'pay', amount: '10 EUR', recipient: 'Testempfänger' }] }) },
  diag: { label: 'PC- und Netzwerkdiagnose', build: () => ({ title: 'Diagnose', steps: [{ op: 'sysinfo' }, { op: 'netdiag', targets: ['1.1.1.1:443', 'github.com:443'] }] }) },
};

const ultReady = (st) => agentClient.connected && !!agentState.perms?.ultimate;
const ultReason = (st) => !agentClient.connected ? 'Desktop-Agent nicht verbunden' : !agentState.perms?.ultimate ? 'Agent läuft ohne --aktionen (Aktionsmodus)' : '';

const STEP_LED = { fertig: 'ok', läuft: 'warn', wartet: 'idle', fehler: 'danger', gestoppt: 'danger' };

function poll(ctx) {
  clearInterval(S.timer);
  S.timer = setInterval(async () => {
    if (!location.hash.includes('/ucc')) { clearInterval(S.timer); return; }
    try {
      S.job = (await agentClient.ultJob(S.job?.id)).job;
      ctx.rerender();
      if (!S.job || S.job.status !== 'läuft') { clearInterval(S.timer); S.log = (await agentClient.log()).log; ctx.rerender(); }
    } catch (e) { S.err = e.message; clearInterval(S.timer); ctx.rerender(); }
  }, 600);
}

function aiCard(st) {
  const o = aiOverview(st);
  const usable = st.experts.filter((e) => e.enabled);
  return `<section class="card glass"><header class="card-head"><h2>${icon('core')} Verbundene KI-Modelle</h2><span class="tag ${o.connected ? 'tag-ok' : 'tag-warn'}">${o.connected} verbunden</span></header>
    <ul class="status-list">${usable.map((e) => `<li><span class="led led-${e.status === 'ok' ? 'ok' : e.status === 'error' ? 'danger' : 'warn'}"></span><span class="k">${esc(e.label || e.model)}</span><span class="v">${e.status === 'ok' ? 'getestet, verbunden' : e.status === 'error' ? 'Fehler' : 'eingerichtet, ungetestet'}</span></li>`).join('') || '<li class="muted">Kein Modell eingerichtet.</li>'}
      ${(st.browserModels || []).map((m) => `<li><span class="led led-warn"></span><span class="k">${esc(m)}</span><span class="v">im Browser geladen</span></li>`).join('')}</ul>
    <p class="muted small">GPT, Claude und Gemini sind <b>nicht verbunden</b> (nur Proxy-Vorlage). Es werden nur Modelle genutzt, die hier als verbunden stehen. <button class="link-btn" data-go="#/gpt/models">Modelle ›</button></p></section>`;
}

function providerCard(st) {
  return `<section class="card glass span-2"><header class="card-head"><h2>${icon('plug')} KI-Provider und tatsächlicher Status</h2></header>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Provider</th><th>Weg</th><th>Kosten</th><th>Status</th></tr></thead><tbody>
    ${CATALOG.map((c) => { const k = catalogStatus(c, st); return `<tr><td>${esc(c.name)}</td><td>${c.how === 'local' ? 'lokal' : 'über eigenen Proxy'}</td><td>${esc(COST_LABEL[c.cost])}</td><td><span class="led led-${k.led}"></span> ${esc(k.text)}</td></tr>`; }).join('')}
    </tbody></table></div>
    <p class="muted small">„verbunden“ steht nur dort, wo eine Verbindung wirklich getestet wurde. Cloud-Anbieter sind ohne eigenen Proxy nie verbunden. Kostenpflichtige Anbieter werden nur nach ausdrücklicher Freigabe genutzt.</p></section>`;
}

function agentsCard(st) {
  return `<section class="card glass"><header class="card-head"><h2>${icon('bolt')} Aktive Agenten</h2></header>
    <ul class="status-list">${AGENTS.map((a) => { const k = a.status(st); const m = STATUS[k]; return `<li><span class="led led-${k === 'aktiv' ? 'ok' : 'idle'}"></span><span class="k">${esc(a.name)}</span><span class="v">${m.label.toLowerCase()}</span></li>`; }).join('')}</ul></section>`;
}

function connCard(st) {
  const p = agentState.perms;
  return `<section class="card glass span-2"><header class="card-head"><h2>${icon('plug')} Testmodus &amp; Berechtigungen</h2><span class="tag ${ultReady(st) ? 'tag-ok' : 'tag-warn'}">${ultReady(st) ? 'BEREIT' : 'NICHT BEREIT'}</span></header>
    <p class="muted small">kostenlos: Aktionen laufen echt, aber nur über den lokalen Desktop-Agenten, nur in freigegebenen Ordnern/Programmen/Domains und nur nach deiner Freigabe.</p>
    ${agentClient.connected ? `<ul class="status-list">
      <li><span class="led led-ok"></span><span class="k">Desktop-Agent</span><span class="v">${esc(agentState.info.platform)} · ${esc(agentState.info.version)}</span></li>
      <li><span class="led led-${p?.ultimate ? 'ok' : 'idle'}"></span><span class="k">Aktionen im Agent</span><span class="v">${p?.ultimate ? 'an' : 'aus (Start mit --aktionen)'}</span></li>
      <li><span class="led led-ok"></span><span class="k">Ordner</span><span class="v">${esc((p?.roots || []).join(', '))}</span></li>
      <li><span class="led led-${p?.apps?.length ? 'ok' : 'idle'}"></span><span class="k">Programme</span><span class="v">${esc((p?.apps || []).join(', ') || 'keine freigegeben')}</span></li>
      <li><span class="led led-${p?.domains?.length ? 'ok' : 'idle'}"></span><span class="k">Browser-Domains</span><span class="v">${esc((p?.domains || []).join(', ') || 'keine')} ${p?.browser ? '' : '· Playwright fehlt'}</span></li>
      <li><span class="led led-danger"></span><span class="k">Nie ohne gesonderte Bestätigung</span><span class="v">Löschen, Installieren, Zahlen, Mailversand: nicht implementiert</span></li></ul>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn" data-act="ucc-refresh">Berechtigungen neu laden</button><button class="btn" data-act="ucc-disconnect">Trennen</button></div>`
    : `<form class="inline-form" data-form="ucc-connect"><input name="url" value="${esc(agentState.url)}" aria-label="Agent-Adresse"><input name="token" type="password" placeholder="Token aus dem Terminal" autocomplete="off" required aria-label="Token"><button class="btn btn-primary" type="submit">Verbinden</button></form>
      <p class="muted small">In der Windows-App startet der Agent automatisch. Im Browser: <code>py tools\\desktop-agent.py --aktionen --allow %USERPROFILE%\\CCC-Test --allow-app notepad=C:\\Windows\\notepad.exe</code>. Funktioniert in Chrome/Edge am PC, nicht in Safari/iPhone.</p>`}
    ${S.err ? `<div class="notice notice-warn" style="margin-top:10px">${esc(S.err)}</div>` : ''}</section>`;
}

function taskCard(st) {
  const apps = agentState.perms?.apps || [];
  const doms = agentState.perms?.domains || [];
  const ready = ultReady(st);
  return `<section class="card glass span-2"><header class="card-head"><h2>${icon('task')} Aufgabe</h2></header>
    <form class="inline-form" data-form="ucc-task" style="flex-wrap:wrap">
      <select name="tpl" aria-label="Vorlage">${Object.entries(TEMPLATES).map(([k, t]) => `<option value="${k}" ${S.f.tpl === k ? 'selected' : ''}>${t.label}</option>`).join('')}</select>
      <input name="name" placeholder="Dateiname (Dokument)" value="${fv('name', 'testdokument.md')}" maxlength="80" aria-label="Dateiname">
      <input name="text" placeholder="Text (Dokument)" value="${fv('text', '# Testdokument\\nErstellt mit CARVIS CORE.')}" maxlength="2000" aria-label="Text">
      <select name="app" aria-label="Programm">${apps.map((a) => `<option ${S.f.app === a ? 'selected' : ''}>${esc(a)}</option>`).join('') || '<option value="">(kein Programm freigegeben)</option>'}</select>
      <input name="url" placeholder="URL (Browser)" value="${fv('url', doms[0] ? `https://${doms[0]}/` : '')}" aria-label="URL">
      <button class="btn" type="button" data-act="ucc-free">Nur Vorschau</button>
      <button class="btn btn-primary" type="button" data-act="ucc-ultimate" ${ready ? '' : 'disabled'} title="${esc(ready ? '' : ultReason(st))}">Plan prüfen &amp; ausführen</button>
    </form>
    ${ready ? '' : `<p class="muted small">Ausführung nicht verfügbar: ${esc(ultReason(st))}.</p>`}
    ${S.free ? `<div class="notice" style="margin-top:10px"><b>VORSCHAU – NICHTS WURDE AUSGEFÜHRT</b><ol>${S.free.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
      <p class="small">Realistisches Ergebnis: ${esc(S.free.result)}</p><p class="small muted">Mit verbundenem Desktop-Agenten kannst du diese Schritte nach Freigabe tatsächlich ausführen.</p></div>` : ''}
    ${S.plan ? `<div class="notice" style="margin-top:10px"><b>GEPRÜFTER PLAN: ${esc(S.plan.title)}</b> (noch nicht ausgeführt)<ol>${S.plan.steps.map((x) => `<li>${esc(x.preview)}</li>`).join('')}</ol>
      <button class="btn btn-primary" data-act="ucc-approve">Freigeben &amp; ausführen</button> <button class="btn" data-act="ucc-discard">Verwerfen</button></div>` : ''}</section>`;
}

function jobCard() {
  const j = S.job;
  if (!j) return `<section class="card glass span-2"><header class="card-head"><h2>${icon('bolt')} Laufende Aufgabe</h2></header><p class="empty">Keine Aufgabe.</p></section>`;
  const done = j.steps.filter((x) => x.status === 'fertig').length;
  const pct = Math.round(100 * done / j.steps.length);
  return `<section class="card glass span-2"><header class="card-head"><h2>${icon('bolt')} ${esc(j.title)}</h2><span class="tag ${j.status === 'fertig' ? 'tag-ok' : j.status === 'läuft' ? 'tag-warn' : 'tag-danger'}">${esc(j.status.toUpperCase())}</span></header>
    <div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" style="height:8px;border-radius:6px;background:rgba(255,255,255,.1);overflow:hidden"><div style="width:${pct}%;height:100%;background:var(--cyan)"></div></div>
    <p class="muted small">${done} von ${j.steps.length} Schritten · ${pct} %</p>
    <ul class="status-list">${j.steps.map((x) => `<li><span class="led led-${STEP_LED[x.status] || 'idle'}"></span><span class="k">${esc(x.preview)}</span><span class="v">${esc(x.status)}${x.attempts > 1 ? ` · ${x.attempts}. Versuch` : ''}${x.error ? ` · ${esc(x.error)}` : x.result ? ` · ${esc(typeof x.result === 'string' ? x.result.slice(0, 140) : JSON.stringify(x.result).slice(0, 140))}` : ''}</span></li>`).join('')}</ul>
    ${j.status !== 'läuft' ? `<button class="btn" data-act="ucc-undo">Änderungen rückgängig (Dateien)</button>` : ''}</section>`;
}

function logCard() {
  return `<section class="card glass span-2"><header class="card-head"><h2>${icon('dot')} Aktionshistorie</h2><button class="btn" data-act="ucc-log" ${agentClient.connected ? '' : 'disabled'}>Aktualisieren</button></header>
    ${S.log ? `<ul class="activity">${[...S.log].reverse().slice(0, 20).map((e) => `<li><span class="led led-${e.ok ? 'ok' : 'danger'}"></span><span>${esc(e.action)}${e.detail ? ` – ${esc(e.detail)}` : ''}</span><time>${relTime(e.ts)}</time></li>`).join('')}</ul>` : '<p class="empty">Noch nicht geladen (Agent nötig).</p>'}</section>`;
}

function freePreview(tpl, f) {
  const t = TEMPLATES[tpl];
  const b = t.build(f);
  const steps = b.steps.map((x) => ({ write_file: `Datei „${x.path}“ anlegen (${(x.content || '').length} Zeichen)`, open_app: `Programm „${x.app}“ starten`, browser_goto: `Browser: ${x.url} öffnen`, browser_text: 'Seitentext lesen', browser_screenshot: `Screenshot „${x.name}“ speichern`, sysinfo: 'Systemdaten lesen', pay: 'Zahlung von 10 EUR an „Testempfänger“ (wird blockiert)', netdiag: 'Netzwerk testen' }[x.op] || x.op));
  const result = { doc: `Eine Datei „${f.name}“ mit deinem Text. Sie existiert erst, wenn du den Plan freigibst und der Agent ihn ausführt.`, app: 'Das Programm würde sich öffnen.', browser: 'Seitentitel, Text und ein Screenshot der Seite.', pay: 'Nichts. CARVIS bezahlt nie. Eine Zahlung wird blockiert und braucht eine gesonderte Einzelbestätigung (nicht implementiert).', diag: 'Werte für CPU, RAM, Speicher und Netzwerk-Latenz.' }[tpl];
  return { steps, result };
}

function runTask(form, ctx, mode) {
  const f = Object.fromEntries(new FormData(form));
  const fields = { ...f, text: String(f.text || '').replace(/\\n/g, '\n') };
  if (mode === 'ultimate' && ultReady(store.get())) {
    S.err = ''; S.free = null;
    const b = TEMPLATES[f.tpl].build(fields);
    agentClient.ultPlan(b.title, b.steps).then((p) => { S.plan = p; }).catch((e) => { S.plan = null; S.err = e.message; }).finally(() => ctx.rerender());
  } else {
    S.plan = null; S.err = ''; S.free = freePreview(f.tpl, fields); ctx.rerender();
  }
}

export default {
  id: 'ucc',
  title: 'Aktionen-Center',
  icon: 'ultimate',
  render(st) {
    return `<div class="page"><header class="page-head"><div><p class="eyebrow">Aktionsmodus</p><h1>AKTIONEN-CENTER</h1>
      <p class="muted">Hier planst du Aufgaben. Echte Aktionen führt nur der lokale Desktop-Agent aus, nur in freigegebenen Ordnern und nur nach deiner Freigabe. Ohne Agent siehst du nur eine Vorschau.</p></div>
      <button class="btn btn-danger" data-act="ucc-stop" ${agentState.stopped ? 'disabled' : ''}>■ NOT-STOPP</button></header>
      ${agentState.stopped ? '<div class="notice notice-warn">Not-Stopp aktiv. Nichts läuft mehr. <button class="btn btn-primary" data-act="ucc-resume">Fortsetzen</button></div>' : ''}
      <div class="grid">${connCard(st)}${taskCard(st)}${jobCard()}${providerCard(st)}${aiCard(st)}${agentsCard(st)}${logCard()}</div></div>`;
  },
  onSubmit(form, ctx) {
    if (form.dataset.form === 'ucc-connect') {
      agentClient.connect(form.url.value, form.token.value).then(() => { S.err = ''; toast('Verbunden.', 'success'); }).catch((e) => { S.err = e.message; }).finally(() => ctx.rerender());
      return;
    }
    if (form.dataset.form === 'ucc-task') runTask(form, ctx, 'free');
  },
  onChange(el, ctx) {
    if (el.closest?.('[data-form=ucc-task]') && el.name) S.f[el.name] = el.value;
    if (el.dataset.actChange === 'ult-toggle') { actions.setSettings({ ultimateDev: el.checked }); toast(el.checked ? 'Aktionsmodus an. Ausführung braucht zusätzlich den Agenten mit --aktionen.' : 'Aktionsmodus aus.', 'info'); ctx.rerender(); }
  },
  async onAct(act, el, ctx) {
    const done = () => ctx.rerender();
    try {
      if (act === 'ucc-free' || act === 'ucc-ultimate') return runTask(el.closest('form'), ctx, act === 'ucc-free' ? 'free' : 'ultimate');
      if (act === 'ucc-stop') { requestStop(); agentState.stopped = true; toast('Not-Stopp ausgelöst.', 'info'); done(); }
      if (act === 'ucc-resume') { await agentClient.resume(); done(); }
      if (act === 'ucc-refresh') { await agentClient.refreshPerms(); done(); }
      if (act === 'ucc-disconnect') { agentClient.disconnect(); S.plan = S.job = S.log = null; done(); }
      if (act === 'ucc-discard') { S.plan = null; done(); }
      if (act === 'ucc-log') { S.log = (await agentClient.log()).log; done(); }
      if (act === 'ucc-approve') {
        const ok = await confirmDialog(`Dieser Ablauf wird jetzt echt ausgeführt:\n\n${S.plan.steps.map((x, i) => `${i + 1}. ${x.preview}`).join('\n')}`, { title: 'Ausführung freigeben', ok: 'Ausführen', danger: false });
        if (!ok) return;
        const r = await agentClient.ultApprove(S.plan.id);
        S.plan = null; S.job = (await agentClient.ultJob(r.jobId)).job; done(); poll(ctx);
      }
      if (act === 'ucc-undo' && S.job) { const r = await agentClient.ultUndo(S.job.id); toast(r.undone.length ? r.undone.join('\n') : 'Nichts rückgängig zu machen.', 'info'); S.log = (await agentClient.log()).log; done(); }
    } catch (e) { S.err = e.message; if (e.status === 423) agentState.stopped = true; done(); }
  },
};
