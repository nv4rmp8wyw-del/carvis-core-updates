import { VERSION } from '../version.js';
import { esc } from '../util.js';
import { icon, confirmDialog, toast } from '../ui.js';
import { store } from '../store.js';
import { AGENTS, STATUS, WORKFLOWS, run, runWorkflow, requestStop } from '../agents.js';
import { agentClient } from '../agent-client.js';

const ST_LED = { fertig: 'ok', läuft: 'warn', fehler: 'danger', gestoppt: 'danger', abgelehnt: 'danger', wartet: 'idle' };

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
        <p class="muted">Neun Agenten mit ehrlichem Status. Abläufe zeigen jeden Schritt, fragen vor Änderungen nach und lassen sich mit dem Not-Stopp beenden. Der Stopp wirkt zwischen den Schritten, ein bereits laufender Schritt wird nicht abgebrochen.</p></div></header>
      ${runPanel()}
      <div class="grid">
        ${AGENTS.map((a) => {
          const st = STATUS[a.status(s)];
          return `<section class="card glass"><header class="card-head"><h2>${icon(a.icon)} ${esc(a.name)}</h2><span class="tag ${st.cls}">${st.label}</span></header>
            <p class="muted small">${esc(a.desc)}</p>${a.go ? `<button class="link-btn" data-go="${a.go}">Öffnen ›</button>` : ''}</section>`;
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
    if (act === 'wf-stop') { requestStop(); toast('Not-Stopp ausgelöst.', 'info'); return; }
    if (act !== 'wf-run') return;
    const wf = WORKFLOWS.find((w) => w.id === el.dataset.id);
    if (!wf || (run.current && !run.current.finished)) return;
    const params = {};
    el.closest('.wf').querySelectorAll('[name]').forEach((i) => (params[i.name] = i.value.trim()));
    if ((wf.params || []).some((p) => !params[p.name])) { toast('Bitte alle Felder ausfüllen.', 'info'); return; }
    await runWorkflow(wf, params, {
      update: () => ctx.rerender(),
      confirm: (text) => confirmDialog(text, { title: 'Aktion bestätigen', ok: 'Ausführen', danger: false }),
    });
  },
};
