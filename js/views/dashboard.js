import { VERSION } from '../version.js';
import { esc, greetingByTime, relTime } from '../util.js';
import { icon } from '../ui.js';
import { donut } from '../blocks.js';
import { actions, projectProgress, store } from '../store.js';
import { voice } from '../voice.js';
import { sysmon, ring } from '../sysmon.js';
import { agentClient, agentState } from '../agent-client.js';
import { aiOverview } from './models.js';
import { CATALOG, COST_LABEL } from '../ai/providers.js';

function aiCard(s) {
  const o = aiOverview(s);
  const rows = s.experts.slice(0, 6);
  const lastModel = [...s.messages].reverse().find((m) => m.role === 'assistant' && (m.source === 'llm' || m.source === 'collab'));
  return `<section data-dash="ai" class="card glass span-2">
    <header class="card-head"><h2>${icon('plug')} KI-Modelle</h2><button class="link-btn" data-go="#/gpt/models">Verwalten ›</button></header>
    <div class="ai-summary">
      <div class="ai-stat"><b>${o.connected}</b><span>verbunden</span></div>
      <div class="ai-stat"><b>${o.available}</b><span>verfügbar</span></div>
      <div class="ai-stat"><b>${o.notConnected}</b><span>nicht verbunden</span></div>
      <div class="ai-stat"><b>0 €</b><span>bisherige Kosten*</span></div>
    </div>
    ${rows.length ? `<ul class="cat-list">${rows.map((e) => `<li><span class="led led-${e.status === 'ok' ? 'ok' : e.status === 'error' ? 'danger' : 'warn'}"></span><div><b>${esc(e.label)}</b><small>${e.local ? 'lokal' : esc(e.vendorKey)} · ${e.enabled ? 'aktiv' : 'deaktiviert'}</small></div><span class="muted small">${e.status === 'ok' ? 'verbunden' : e.status === 'error' ? 'Fehler' : 'ungetestet'}</span><span class="tag ${e.cost === 'free' ? 'tag-ok' : e.cost === 'paid' ? 'tag-danger' : 'tag-warn'}">${COST_LABEL[e.cost]}</span></li>`).join('')}</ul>`
      : `<p class="muted small">Noch kein echtes KI-Modell verbunden. Vorbereitet: ${CATALOG.map((c) => c.name).join(', ')}. <button class="link-btn" data-go="#/gpt/models">Jetzt verbinden ›</button></p>`}
    <p class="muted small">${lastModel ? `Zuletzt verwendet: <b>${esc(lastModel.model || '')}</b>. ` : ''}*CC selbst verursacht keine Kosten; kostenpflichtige Anbieter sind gesperrt, solange du sie nicht ausdrücklich freigibst.</p>
  </section>`;
}

let probed = false;
let liveLog = null;
let logAt = 0; // Protokoll höchstens alle 5 s holen
export default {
  id: 'dashboard',
  title: 'Dashboard',
  icon: 'dashboard',
  onMount(root, ctx) {
    if (agentClient.connected && Date.now() - logAt > 5000) {
      logAt = Date.now();
      agentClient.log().then((l) => { const changed = JSON.stringify(l.log) !== JSON.stringify(liveLog); liveLog = l.log; if (changed && root.dataset.view === 'dashboard') ctx.rerender(); }).catch(() => {});
    }
    if (probed) return;
    probed = true; // einmal pro Sitzung automatisch messen, danach nur auf Knopfdruck
    Promise.all([sysmon.measureLatency(), sysmon.readStorage(), sysmon.readBattery()])
      .then(() => root.dataset.view === 'dashboard' && ctx.rerender());
  },
  onChange(el, ctx) {
    if (el.dataset.dashUlt !== undefined) { actions.setSettings({ ultimateDev: el.checked }); ctx.rerender(); }
  },
  onAct(act, el, ctx) {
    if (act === 'dash-gpt-window' || act === 'dash-compare') {
      import('./gpt.js').then((g) => {
        if (act === 'dash-gpt-window') g.addPanel(); else g.setMode('compare');
        location.hash = '#/gpt/chat';
      });
      return;
    }
    if (act === 'net-test') { const l = el.closest('.dash')?.querySelector('[data-lat]'); if (l) l.textContent = 'wird gemessen …'; sysmon.measureLatency().then(() => ctx.rerender()); }
  },
  render(s, ctx) {
    const open = s.tasks.filter((t) => !t.done);
    const done = s.tasks.length - open.length;
    const prioOrder = { hoch: 0, mittel: 1, niedrig: 2 };
    const next = [...open].sort((a, b) => prioOrder[a.priority] - prioOrder[b.priority]).slice(0, 5);
    const st = ctx.status;
    const ai = aiOverview(s);
    const engine = ai.available
      ? { v: `${ai.available} Modell${ai.available === 1 ? '' : 'e'} aktiv`, tone: ai.connected ? 'ok' : ai.failing ? 'danger' : 'warn', note: ai.connected ? `${ai.connected} verbunden` : 'ungetestet' }
      : { v: 'Keine KI verbunden', tone: 'warn', note: 'Antworten aus Vorlagen, simuliert' };

    const statusRows = [
      ['KI-Koordination', engine.v, engine.tone, engine.note],
      ['Spracheingabe', voice.sttSupported ? 'Web Speech API' : 'nicht unterstützt', voice.sttSupported ? 'ok' : 'danger', voice.sttSupported ? 'bereit' : 'Browser'],
      ['Sprachausgabe', voice.ttsSupported ? (s.settings.voiceOutput ? 'aktiv' : 'stumm') : 'nicht unterstützt', voice.ttsSupported ? 'ok' : 'danger', voice.ttsSupported ? 'bereit' : ''],
      ['Wake-Word „Hey C“', !voice.wakeSupported ? 'nicht verfügbar' : st.wake ? 'hört zu' : 'aus', st.wake ? 'ok' : 'idle', ''],
      ['Lokaler Speicher', `${store.sizeKB()} KB`, store.storageOk() ? 'ok' : 'danger', store.storageOk() ? 'gesichert' : 'Fehler'],
      ['Offline / PWA', st.sw ? 'Service Worker aktiv' : 'nicht aktiv', st.sw ? 'ok' : 'idle', st.online ? 'online' : 'offline'],
    ];

    const inf = sysmon.info();
    const sm = sysmon.get();
    const lat = sm.latency;
    const memCount = s.memory.length;
    const stPct = sm.storage ? Math.round((sm.storage.used / sm.storage.quota) * 100) : null;
    const taskPct = s.tasks.length ? Math.round((done / s.tasks.length) * 100) : null;
    const latTone = !lat ? 'idle' : lat.med == null ? 'danger' : lat.med < 150 ? 'ok' : lat.med < 400 ? 'warn' : 'danger';

    return `<div class="page dash">
      <section class="dash-top">
        <div class="card dash-hello">
          <p class="eyebrow" data-date></p>
          <h1>${greetingByTime()}${s.settings.userName ? `, ${esc(s.settings.userName)}` : ''}.</h1>
          <p class="muted">${open.length ? `<b>${open.length}</b> offene Aufgabe${open.length === 1 ? '' : 'n'} in <b>${s.projects.length}</b> Projekt${s.projects.length === 1 ? '' : 'en'}.` : 'Keine offenen Aufgaben.'}</p>
          <span class="big-clock" data-clock="sec"></span>
        </div>
        <div class="card dash-health" aria-label="Systemzustand">
          <button class="health" data-go="#/gpt/models"><span class="led led-${engine.tone}"></span><b>KI</b><span>${esc(engine.v)}</span><small>${esc(engine.note)}</small></button>
          <button class="health" data-go="#/gpt/perf"><span class="led led-${agentClient.connected ? 'ok' : 'idle'}"></span><b>Agent</b><span>${agentClient.connected ? 'verbunden' : 'nicht verbunden'}</span><small>${agentClient.connected ? 'PC-Funktionen bereit' : 'nur in der Windows-App'}</small></button>
          <button class="health" data-act="net-test"><span class="led led-${inf.online ? latTone : 'danger'}"></span><b>Netz</b><span>${inf.online ? 'online' : 'offline'}</span><small>${lat?.med != null ? `${lat.med} ms Antwortzeit` : 'Antwortzeit messen'}</small></button>
          <button class="health" data-go="#/gpt/settings"><span class="led led-${store.storageOk() ? 'ok' : 'danger'}"></span><b>Daten</b><span>${store.sizeKB()} KB lokal</span><small>${store.storageOk() ? 'gespeichert' : 'Speicherfehler'}</small></button>
        </div>
      </section>

      <section class="quick" aria-label="Schnellaktionen">
        <button class="qa" data-go="#/carvis">${icon('core')}<b>Mit CARVIS sprechen</b><small>Sprach- und Textassistent</small></button>
        <button class="qa" data-act="dash-gpt-window">${icon('window')}<b>Neues KI-Fenster</b><small>im GPT-Arbeitsbereich</small></button>
        <button class="qa" data-act="dash-compare">${icon('compare')}<b>Modelle vergleichen</b><small>eine Frage, mehrere KIs</small></button>
        <button class="qa" data-go="#/gpt/perf">${icon('bolt')}<b>PC-Diagnose</b><small>${agentClient.connected ? 'Messen und optimieren' : 'braucht den Desktop-Agenten'}</small></button>
        <button class="qa" data-go="#/gpt/update">${icon('update')}<b>Updates prüfen</b><small>nur mit Bestätigung</small></button>
        <button class="qa" data-go="#/gpt/design">${icon('preview')}<b>Design wechseln</b><small>Profile, Hell/Dunkel</small></button>
        <button class="qa" data-act="quick-task">${icon('task')}<b>Neue Aufgabe</b><small>schnell erfassen</small></button>
        <button class="qa" data-act="quick-plan">${icon('project')}<b>Plan erstellen</b><small>CARVIS plant mit dir</small></button>
      </section>

      <div class="grid">
        <section data-dash="activity" class="card glass">
          <header class="card-head"><h2>${icon('dot')} Aktivität</h2></header>
          <ul class="activity">${s.activity.slice(0, 6).map((a) => `<li>${icon(a.icon || 'dot')}<span>${esc(a.text)}</span><time>${relTime(a.ts)}</time></li>`).join('') || '<li class="muted">Noch keine Aktivität.</li>'}</ul>
        </section>

        <section data-dash="device" class="card glass" id="mon-device">
          <header class="card-head"><h2>${icon('dashboard')} Gerät</h2><span class="tag tag-ok">GEMESSEN</span></header>
          <div class="gauges">
            ${ring(100, inf.cores ?? '–', 'CPU-Kerne', 'dim')}
            ${ring(100, inf.memGB ? `${inf.memGB} GB` : '–', 'RAM (≈, nur Zahl)', 'dim')}
            ${ring(stPct, stPct == null ? '–' : `${stPct}%`, 'Browser-Speicher', 'violet')}
          </div>
          <p class="muted small">Ein Browser darf die aktuelle CPU-Last und Prozesse nicht auslesen. In der Windows-App zeigt „Optimierung“ die echten Werte. RAM zeigt Chromium gerundet (max. 8 GB), Safari zeigt ihn nicht.${sm.battery ? ` Akku: ${sm.battery.level} %${sm.battery.charging ? ' (lädt)' : ''}.` : ''}</p>
        </section>

        <section data-dash="net" class="card glass" id="mon-net">
          <header class="card-head"><h2>${icon('bolt')} Netzwerk</h2><button class="link-btn" data-act="net-test">Messen ›</button></header>
          <ul class="status-list" data-net>
            <li><span class="led led-${inf.online ? 'ok' : 'danger'}"></span><span class="k">Verbindung</span><span class="v">${inf.online ? 'online' : 'offline'}${inf.type ? ` <small>${esc(inf.type)}</small>` : ''}</span></li>
            <li><span class="led led-${latTone}"></span><span class="k">Antwortzeit</span><span class="v" data-lat>${lat ? (lat.med == null ? 'keine Antwort' : `${lat.med} ms <small>min ${lat.min} · max ${lat.max}</small>`) : 'wird gemessen …'}</span></li>
            <li><span class="led led-${lat && lat.loss ? 'warn' : lat ? 'ok' : 'idle'}"></span><span class="k">Paketverlust</span><span class="v" data-loss>${lat ? `${lat.loss} % <small>von ${lat.n}</small>` : '–'}</span></li>
            <li><span class="led led-idle"></span><span class="k">Downlink (Schätzung)</span><span class="v">${inf.downlink != null ? `${inf.downlink} Mbit/s` : 'nicht verfügbar'}</span></li>
          </ul>
          <p class="muted small">Gemessen wird die Antwortzeit zum Server dieser App, kein vollständiger Speedtest und kein WLAN-Signal.</p>
        </section>

        <section data-dash="memory" class="card glass">
          <header class="card-head"><h2>${icon('memory')} Gedächtnis</h2><button class="link-btn" data-go="#/gpt/memory">Öffnen ›</button></header>
          <div class="gauges">
            ${ring(100, memCount, 'Erinnerungen', 'dim')}
            ${ring(100, s.messages.length, 'Nachrichten', 'dim')}
            ${ring(taskPct, taskPct == null ? '–' : `${taskPct}%`, 'Aufgaben erledigt', 'ok')}
          </div>
          <p class="muted small">Alles liegt nur lokal in diesem Browser (${store.sizeKB()} KB).</p>
        </section>

        <section data-dash="status" class="card glass">
          <header class="card-head"><h2>${icon('core')} Systemstatus</h2></header>
          <ul class="status-list">${statusRows.map(([k, v, tone, n]) => `<li><span class="led led-${tone}"></span><span class="k">${k}</span><span class="v">${v}${n ? ` <small>${n}</small>` : ''}</span></li>`).join('')}</ul>
        </section>

        ${aiCard(s)}

        <section data-dash="projects" class="card glass span-2">
          <header class="card-head"><h2>${icon('project')} Projekte</h2><button class="link-btn" data-go="#/gpt/projects">Alle ›</button></header>
          ${s.projects.length ? `<div class="proj-mini">${s.projects.slice(0, 4).map((p) => {
            const pr = projectProgress(p, s.tasks);
            const n = s.tasks.filter((t) => t.projectId === p.id);
            return `<div class="pm"><div class="pm-top"><b>${esc(p.name)}</b><span class="tag tag-${p.status === 'aktiv' ? 'ok' : p.status === 'pausiert' ? 'warn' : 'idle'}">${esc(p.status)}</span></div>
              <div class="progress"><span style="--w:${pr}%"></span></div><small class="muted">${pr} % · ${n.filter((t) => t.done).length}/${n.length} Aufgaben</small></div>`;
          }).join('')}</div>` : `<p class="empty">Noch keine Projekte. <button class="link-btn" data-act="quick-project">Erstes Projekt anlegen</button></p>`}
        </section>

        <section data-dash="tasks" class="card glass">
          <header class="card-head"><h2>${icon('task')} Aufgaben</h2><button class="link-btn" data-go="#/gpt/tasks">Alle ›</button></header>
          ${donut([{ label: 'Erledigt', value: done, color: 'rgb(var(--accent-rgb))' }, { label: 'Offen', value: open.length, color: 'var(--surface-4)' }], String(s.tasks.length))}
          <ul class="mini-list">${next.map((t) => `<li><button class="check" data-act="toggle-task" data-id="${t.id}" aria-label="Erledigt"></button><span>${esc(t.title)}</span><span class="tag tag-${t.priority === 'hoch' ? 'danger' : t.priority === 'mittel' ? 'warn' : 'idle'}">${t.priority}</span></li>`).join('') || '<li class="muted">Alles erledigt.</li>'}</ul>
        </section>

        <section data-dash="optimize" class="card glass">
          <header class="card-head"><h2>${icon('bolt')} Optimierung</h2></header>
          <ul class="status-list">
            <li><span class="led led-${agentClient.connected ? 'ok' : 'idle'}"></span><span class="k">Desktop-Agent</span><span class="v">${agentClient.connected ? 'verbunden' : 'nicht verbunden'}</span></li>
          </ul>
          <p class="muted small">${agentClient.connected ? 'Messen, PC optimieren und Gaming optimieren – mit Vorschau, Bestätigung und Rückgängig.' : 'Messwerte und Optimierungen stehen mit dem Desktop-Agenten der Windows-App zur Verfügung.'}</p>
          <button class="btn btn-primary" data-go="#/gpt/perf">Optimierung öffnen</button>
        </section>

        <section data-dash="ucc" class="card glass span-2">
          <header class="card-head"><h2>${icon('bolt')} Aktionen</h2></header>
          <ul class="status-list">
            <li><span class="led led-${agentClient.connected ? 'ok' : 'idle'}"></span><span class="k">Desktop-Agent</span><span class="v">${agentClient.connected ? 'verbunden' : 'nicht verbunden'}</span></li>
            <li><span class="led led-${agentClient.state.perms?.ultimate ? 'ok' : 'idle'}"></span><span class="k">Aktionsmodus im Agent</span><span class="v">${agentClient.state.perms?.ultimate ? 'aktiv' : 'aus (Agent mit --aktionen starten)'}</span></li>
            <li><span class="led led-${ai.connected ? 'ok' : 'idle'}"></span><span class="k">Verbundene KI-Modelle</span><span class="v">${ai.connected} von ${ai.available}</span></li></ul>
          <p class="small" data-dash-ult>Computer-Aktionen: ${agentClient.connected ? (agentState.perms?.ultimate ? '<b>bereit</b> (Agent im Aktionsmodus)' : 'Agent verbunden, aber ohne --aktionen') : 'Agent nicht verbunden'}</p>
          <h3 class="small">Live-Ausführungsprotokoll (Desktop-Agent)</h3>
          ${agentClient.connected && liveLog ? `<ul class="activity" data-live-log>${[...liveLog].reverse().slice(0, 6).map((e) => `<li><span class="led led-${e.ok ? 'ok' : 'danger'}"></span><span>${esc(e.action)}${e.detail ? ` – ${esc(e.detail)}` : ''}</span><time>${relTime(e.ts)}</time></li>`).join('') || '<li class="muted">Noch keine Einträge.</li>'}</ul>` : '<p class="muted small" data-live-log>Kein Protokoll: Desktop-Agent nicht verbunden.</p>'}
          <button class="btn btn-primary" data-go="#/gpt/ucc">Aktionen öffnen</button>
        </section>

      </div>
    </div>`;
  },
};
