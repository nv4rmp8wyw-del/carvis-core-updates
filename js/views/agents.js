import { VERSION } from '../version.js';
import { esc } from '../util.js';
import { icon, confirmDialog, toast } from '../ui.js';
import { store } from '../store.js';
import { AGENTS, STATUS, WORKFLOWS, run, requestStop, enqueue, cancelTask, queue, agentStatus, MAX_QUEUE, STEP_TIMEOUT_MS } from '../agents.js';
import { relTime } from '../util.js';
import { agentClient } from '../agent-client.js';

const ST_LED = { fertig: 'ok', läuft: 'warn', 'wartet auf Genehmigung': 'warn', fehler: 'danger', gestoppt: 'danger', abgelehnt: 'danger', wartet: 'idle' };

function queuePanel(s) {
  const hist = [...(s.agentTasks || [])].reverse().slice(0, 6);
  if (!queue.waiting.length && !hist.length) return '';
  return `<section class="card glass" style="margin-bottom:18px" data-queue>
    <header class="card-head"><h2>${icon('task')} Aufgabenwarteschlange</h2><span class="muted small">${queue.current ? '1 läuft' : 'frei'} · ${queue.waiting.length}/${MAX_QUEUE} wartend</span></header>
    <ul class="status-list">${queue.waiting.map((t, i) => `<li data-task="${t.id}"><span class="led led-idle"></span><span class="k">${i + 1}. ${esc(t.wf.name)}</span><span class="v">wartet <button class="link-btn" data-act="task-cancel" data-id="${t.id}">entfernen</button></span></li>`).join('')}
      ${hist.map((h) => `<li><span class="led led-${h.status === 'fertig' ? 'ok' : 'danger'}"></span><span class="k">${esc(h.name)}</span><span class="v">${esc(h.status)}<small>${relTime(h.ts)}${h.error ? ' · ' + esc(h.error) : ''}</small></span></li>`).join('')}</ul>
    <p class="muted small">Es läuft immer nur ein Ablauf; jeder Schritt hat ein Zeitlimit von ${STEP_TIMEOUT_MS / 1000} s (Bestätigungen ausgenommen). Der Not-Stopp beendet den laufenden Ablauf und leert die Warteschlange.</p>
  </section>`;
}

function runPanel() {
  const r = run.current;
  if (!r) return '';
  return `<section class="card glass" style="margin-bottom:18px" aria-live="polite">
    <header class="card-head"><h2>${icon('bolt')} Ablauf: ${esc(r.wf.name)}</h2>
      ${r.finished ? `<span class="tag ${r.error ? 'tag-danger' : 'tag-ok'}">${r.error ? 'BEENDET MIT FEHLER' : 'ABGESCHLOSSEN'}</span>` : '<button class="btn btn-danger" data-act="wf-stop">■ Not-Stopp</button>'}</header>
    <ul class="status-list">${r.steps.map((s) => `<li><span class="led led-${ST_LED[s.status] || 'idle'}"></span><span class="k">${esc(s.title)} <small class="muted">${esc(s.agent)}</small></span><span class="v">${esc(s.status)}${s.msg ? ` <small>${esc(s.msg)}</small>` : ''}</span></li>`).join('')}</ul>
    ${r.error ? `<div class="notice notice-warn" style="margin-top:10px">${esc(r.error)}</div>` : ''}
  </section>`;
}

export default {
  id: 'agents',
  title: 'Agenten',
  icon: 'bolt',
  render(s) {
    const docs = s.documents;
    return `<div class="page">
      <header class="page-head"><div><p class="eyebrow">Agenten</p><h1>Agenten &amp; Abläufe</h1>
        <p class="muted">Ein gemeinsames Agentenregister mit ehrlichem Status (Bereit · Arbeitet · Wartet auf Genehmigung · Fehler · braucht Voraussetzung · Geplant). Abläufe laufen über eine zentrale Warteschlange, zeigen jeden Schritt, fragen vor Änderungen nach und lassen sich mit dem Not-Stopp beenden.</p></div>
        ${run.current && !run.current.finished ? '<button class="btn btn-danger" data-act="wf-stop">■ Not-Stopp</button>' : ''}</header>
      ${runPanel()}
      ${queuePanel(s)}
      <div class="grid">
        ${AGENTS.map((a) => {
          const st = STATUS[agentStatus(a, s)];
          return `<section class="card glass" data-agent="${a.id}"><header class="card-head"><h2>${icon(a.icon)} ${esc(a.name)}</h2><span class="tag ${st.cls}">${st.label}</span></header>
            <p class="muted small">${esc(a.desc)}</p>${a.perm && a.perm !== '–' ? `<p class="small"><b>Rechte:</b> ${esc(a.perm)}${a.limit && a.limit !== '–' ? ` · <b>Grenzen:</b> ${esc(a.limit)}` : ''}</p>` : ''}${a.go ? `<button class="link-btn" data-go="${a.go}">Öffnen ›</button>` : ''}</section>`;
        }).join('')}
      </div>
      <header class="page-head compact" style="margin-top:26px"><div><h1 style="font-size:20px">Abläufe</h1></div></header>
      <div class="grid">
        ${WORKFLOWS.map((w) => {
          const blocked = w.needs.includes('agent') && !agentClient.connected;
          return `<section class="card glass wf" data-wf="${w.id}"><header class="card-head"><h2>${esc(w.name)}</h2>${w.needs.includes('agent') ? '<span class="tag tag-warn">DESKTOP-AGENT</span>' : '<span class="tag tag-ok">LOKAL</span>'}</header>
            <p class="muted small">${esc(w.desc)}</p>
            <ol class="small muted" style="padding-left:18px">${w.steps.map((x) => `<li>${esc(x.title)}${x.confirm ? ' <b>(mit Bestätigung)</b>' : ''}</li>`).join('')}</ol>
            ${(w.params || []).map((p) => p.type === 'doc'
              ? `<label class="small muted">${esc(p.label)}<select name="${p.name}" aria-label="${esc(p.label)}">${docs.map((d) => `<option value="${d.id}">${esc(d.title)}</option>`).join('') || '<option value="">Kein Dokument vorhanden</option>'}</select></label>`
              : `<label class="small muted">${esc(p.label)}<input name="${p.name}" placeholder="${esc(p.placeholder || '')}" maxlength="80" aria-label="${esc(p.label)}"></label>`).join('')}
            <div style="margin-top:12px"><button class="btn btn-primary" data-act="wf-run" data-id="${w.id}" ${blocked ? 'disabled title="Erst den Desktop-Agenten verbinden"' : ''}>Starten</button>
              ${blocked ? '<small class="muted"> Erst unter „Computer“ verbinden.</small>' : ''}</div></section>`;
        }).join('')}
      </div>
    </div>`;
  },
  async onAct(act, el, ctx) {
    if (act === 'wf-stop') { requestStop(); toast('Not-Stopp ausgelöst. Warteschlange geleert.', 'info'); ctx.rerender(); return; }
    if (act === 'task-cancel') { cancelTask(el.dataset.id); ctx.rerender(); return; }
    if (act !== 'wf-run') return;
    const wf = WORKFLOWS.find((w) => w.id === el.dataset.id);
    if (!wf) return;
    const params = {};
    el.closest('.wf').querySelectorAll('[name]').forEach((i) => (params[i.name] = i.value.trim()));
    if ((wf.params || []).some((p) => !params[p.name])) { toast('Bitte alle Felder ausfüllen.', 'info'); return; }
    const busy = run.current && !run.current.finished;
    try {
      enqueue(wf, params, {
        update: () => ctx.rerender(),
        confirm: (text) => confirmDialog(text, { title: 'Aktion bestätigen', ok: 'Ausführen', danger: false }),
      });
      if (busy) toast(`In der Warteschlange: ${wf.name} (Position ${queue.waiting.length})`, 'info');
    } catch (e) { toast(e.message, 'danger'); }
  },
};
