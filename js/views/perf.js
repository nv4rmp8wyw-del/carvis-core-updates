// PC-Center: echte Messwerte vom lokalen Desktop-Agenten (nur lesen). Vorschläge ändern nichts am System.
import { VERSION } from '../version.js';
import { esc } from '../util.js';
import { icon, toast } from '../ui.js';
import { actions, store } from '../store.js';
import { agentClient, agentState } from '../agent-client.js';

const S = { p: null, net: null, err: '', busy: '', opt: null, optJob: null, before: null };
const GB = (b) => (b / 1073741824).toFixed(1);
const NET_TARGETS = ['1.1.1.1:443', 'github.com:443', 'example.com:443'];

/** Regelbasierte Hinweise aus echten Messwerten. Keine Versprechen, keine Änderungen. */
export function findings(p, net) {
  const out = [];
  if (p) {
    const used = p.memory ? 1 - p.memory.available / p.memory.total : null;
    if (p.cpu != null && p.cpu > 85) out.push(['warn', `CPU-Auslastung ${Math.round(p.cpu)} %. Prüfe die Prozessliste auf Programme, die du nicht brauchst.`]);
    if (used != null && used > 0.85) out.push(['warn', `RAM zu ${Math.round(used * 100)} % belegt. Programme schließen oder mehr RAM erwägen.`]);
    for (const d of p.disks || []) {
      const free = d.free / d.total;
      if (free < 0.1) out.push(['warn', `Laufwerk ${d.path}: nur ${(free * 100).toFixed(0)} % frei (${GB(d.free)} GB). Windows und Programme werden bei wenig Platz spürbar langsamer.`]);
    }
    if ((p.autostart || []).length > 10) out.push(['info', `${p.autostart.length} Autostart-Einträge. Nicht benötigte kannst du unten mit Vorschau und Rückgängig-Funktion deaktivieren.`]);
    if (p.power && /spar|saver/i.test(p.power)) out.push(['info', `Energieprofil „${p.power}“ begrenzt die Leistung. Für volle Leistung „Ausbalanciert“ oder „Höchstleistung“ wählen (Windows-Einstellungen).`]);
    for (const t of p.temps || []) if (t.c > 85) out.push(['warn', `Sensor ${t.name}: ${t.c} °C. Lüfter und Staub prüfen.`]);
    if (p.gpu?.tempC > 85) out.push(['warn', `GPU ${p.gpu.tempC} °C.`]);
    if (p.wifi && p.wifi.signalPct < 40) out.push(['warn', `WLAN-Signal schwach (${p.wifi.signalPct} %). Näher an den Router oder 5-GHz-Band nutzen.`]);
  }
  for (const r of net || []) {
    if (r.loss >= 25) out.push(['warn', `${r.host}: ${r.loss} % fehlgeschlagene Verbindungsversuche. Instabile Verbindung (WLAN, Router, Anbieter).`]);
    if (r.dnsMs > 200) out.push(['info', `${r.host}: DNS-Auflösung dauert ${r.dnsMs} ms. Ein anderer DNS-Server könnte helfen (Änderung in dieser Version nicht automatisiert).`]);
    if (r.jitterMs > 50) out.push(['info', `${r.host}: stark schwankende Antwortzeit (±${r.jitterMs} ms).`]);
  }
  if (!out.length && (p || net)) out.push(['ok', 'Keine Auffälligkeiten in den gemessenen Werten.']);
  return out;
}

function tile(label, value, note = '') { return `<div class="tile"><span class="muted small">${esc(label)}</span><b style="font-size:1.4rem;display:block">${value}</b><span class="muted small">${note}</span></div>`; }

export default {
  id: 'perf',
  title: 'Optimierung',
  icon: 'dashboard',
  render(st) {
    const p = S.p;
    const base = st.settings.netBaseline;
    const netTable = (rows) => `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Ziel</th><th>DNS</th><th>Antwort (Median)</th><th>Schwankung</th><th>Verlust</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.host)}</td><td>${r.dnsMs ?? '–'} ms</td><td>${r.medianMs ?? '–'} ms</td><td>${r.jitterMs ?? '–'} ms</td><td>${r.loss} %</td></tr>`).join('')}</tbody></table></div>`;
    const fl = findings(p, S.net);
    return `<div class="page"><header class="page-head"><div><h1>Optimierung</h1>
      <p class="muted">Echte Messwerte vom lokalen Desktop-Agenten. Messen ändert nichts. Optimierungen laufen nur nach Vorschau und deiner Bestätigung und lassen sich rückgängig machen.</p></div>
      <button class="btn btn-primary" data-act="perf-run" ${!agentClient.connected || S.busy ? 'disabled' : ''}>${S.busy === 'perf' ? 'Messe …' : 'Jetzt messen'}</button></header>
      ${agentClient.connected ? '' : `<div class="notice notice-warn">Kein Desktop-Agent verbunden. In der Windows-App startet er automatisch; im Browser ist er nur lokal nutzbar. Ohne Agent gibt es hier keine Messwerte (der Browser darf sie nicht lesen).</div>`}
      <section class="card glass opt-hero" data-opt-hero>
        <div><h2>Ein Klick zur Optimierung</h2><p class="muted small">Jede Aktion zeigt zuerst eine Vorschau und läuft erst nach deiner Bestätigung. Nichts wird gelöscht, alles lässt sich rückgängig machen.</p></div>
        <div class="opt-hero-actions">
          <button class="btn btn-primary" data-act="opt-pc" ${!agentClient.connected || S.busy ? 'disabled' : ''}>PC optimieren</button>
          <button class="btn btn-primary" data-act="opt-gaming" ${!agentClient.connected || S.busy ? 'disabled' : ''}>Gaming optimieren</button>
        </div>
      </section>
      ${S.err ? `<div class="notice notice-warn" data-perf-error>${esc(S.err)}</div>` : ''}
      <div class="grid">
        <section class="card glass span-2"><header class="card-head"><h2>${icon('core')} System</h2>${p ? `<span class="tag">${esc(p.platform)}</span>` : ''}</header>
          ${p ? `<div class="chips" style="gap:12px;flex-wrap:wrap" data-perf-tiles>
            ${tile('CPU', p.cpu != null ? Math.round(p.cpu) + ' %' : 'n/v', `${p.cores} Kerne`)}
            ${tile('RAM', p.memory ? Math.round((1 - p.memory.available / p.memory.total) * 100) + ' %' : 'n/v', p.memory ? `${GB(p.memory.total - p.memory.available)} von ${GB(p.memory.total)} GB` : '')}
            ${tile('GPU', p.gpu ? (p.gpu.util != null ? p.gpu.util + ' %' : esc(p.gpu.name)) : 'n/v', p.gpu ? esc(p.gpu.name) : 'keine NVIDIA-GPU erkannt')}
            ${tile('Energieprofil', p.power ? esc(p.power) : 'n/v', '')}
            ${tile('Temperatur', p.temps?.length ? Math.max(...p.temps.map((t) => t.c)) + ' °C' : 'n/v', p.temps?.length ? 'höchster Sensor' : 'keine Sensoren lesbar')}</div>` : '<p class="empty">Noch nicht gemessen.</p>'}
          <p class="muted small">„n/v“ = nicht verfügbar auf diesem System. Dann zeige ich keinen erfundenen Wert.</p></section>
        <section class="card glass"><header class="card-head"><h2>${icon('dashboard')} Speicherplatz</h2></header>
          ${p ? `<ul class="status-list">${(p.disks || []).map((d) => `<li><span class="led led-${d.free / d.total < 0.1 ? 'danger' : 'ok'}"></span><span class="k">${esc(d.path)}</span><span class="v">${GB(d.free)} von ${GB(d.total)} GB frei</span></li>`).join('')}</ul>` : '<p class="empty">–</p>'}</section>
        <section class="card glass"><header class="card-head"><h2>${icon('bolt')} Größte Prozesse (RAM)</h2></header>
          ${p ? `<ul class="status-list">${(p.processes || []).map((x) => `<li><span class="led led-idle"></span><span class="k">${esc(x.name)}</span><span class="v">${(x.bytes / 1048576).toFixed(0)} MB</span></li>`).join('') || '<li class="muted">nicht lesbar</li>'}</ul>` : '<p class="empty">–</p>'}</section>
        <section class="card glass"><header class="card-head"><h2>${icon('plug')} Autostart</h2></header>
          ${p ? `<p class="small">${(p.autostart || []).length} Einträge</p><p class="muted small">${esc((p.autostart || []).slice(0, 25).join(', ') || 'keine gefunden')}</p>` : '<p class="empty">–</p>'}</section>
        <section class="card glass span-2"><header class="card-head"><h2>${icon('plug')} Netzwerk</h2><button class="btn" data-act="net-run" ${!agentClient.connected || S.busy ? 'disabled' : ''}>${S.busy === 'net' ? 'Teste …' : 'Netzwerk testen'}</button></header>
          ${p?.wifi ? `<p class="small">WLAN: Signal ${p.wifi.signalPct} %${p.wifi.ssid ? ' · ' + esc(p.wifi.ssid) : ''}</p>` : ''}
          ${p?.adapters?.length ? `<p class="muted small">Adapter: ${esc(p.adapters.join(', '))}</p>` : ''}
          ${S.net ? netTable(S.net) : '<p class="empty">Noch nicht getestet.</p>'}
          ${base ? `<h3 class="small">Vergleich mit gespeicherter Messung (${new Date(base.ts).toLocaleString('de-DE')})</h3>${netTable(base.rows)}${S.net ? `<p class="small" data-net-compare>${S.net.map((r) => { const b = base.rows.find((x) => x.host === r.host); if (!b || r.medianMs == null || b.medianMs == null) return ''; const d = r.medianMs - b.medianMs; return `${esc(r.host)}: ${d > 0 ? '+' : ''}${d.toFixed(1)} ms`; }).filter(Boolean).join(' · ')}</p>` : ''}` : ''}
          <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" data-act="net-save" ${S.net ? '' : 'disabled'}>Diese Messung als Vergleich speichern</button></div>
          <p class="muted small">Gemessen wird die TCP-Verbindungszeit (8 Versuche) und die DNS-Auflösung. Das ist kein echter Ping und kein Speedtest. Download-/Upload-Messung ist nicht implementiert.</p></section>
        <section class="card glass span-2" data-opt-card><header class="card-head"><h2>${icon('bolt')} Einzelne Maßnahmen</h2></header>
          <p class="muted small">Jede Aktion zeigt zuerst eine Vorschau. Nichts wird gelöscht: Temp-Dateien kommen in eine Quarantäne und können zurückgelegt werden. Sicherheitsfunktionen und die Registry (außer dem Autostart-Schalter des Task-Managers) bleiben unangetastet. Ein Leistungsgewinn wird nicht versprochen; unten siehst du nur die Messwerte vor und nach der Änderung.</p>
          <div class="chips" style="gap:8px;flex-wrap:wrap">
            <button class="btn" data-act="opt-temp" ${!agentClient.connected || S.busy ? 'disabled' : ''}>Temp-Dateien (&gt; 7 Tage) in Quarantäne</button>
                        <button class="btn" data-act="opt-balanced" ${!agentClient.connected || S.busy ? 'disabled' : ''}>Energieprofil: Ausbalanciert</button>
          </div>
          ${(p?.autostart || []).length ? `<p class="small" style="margin-top:10px">Autostart deaktivieren (nur Einträge des aktuellen Benutzers):</p><div class="chips" style="gap:6px;flex-wrap:wrap">${p.autostart.slice(0, 25).map((n) => `<button class="btn btn-sm" data-act="opt-auto" data-name="${esc(n)}" ${!agentClient.connected || S.busy ? 'disabled' : ''}>${esc(n)}</button>`).join('')}</div>` : ''}
          ${S.opt ? `<div class="notice" data-opt-preview><b>Vorschau – noch nichts geändert:</b><ul>${S.opt.preview.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
            <button class="btn btn-primary" data-act="opt-go">Bestätigen und ausführen</button> <button class="btn" data-act="opt-cancel">Abbrechen</button></div>` : ''}
          ${S.optJob ? `<div class="notice" data-opt-result><b>Ergebnis (${esc(S.optJob.status)}):</b><ul>${S.optJob.steps.map((x) => `<li>${esc(x.preview)} → ${esc(x.status)}${x.result ? ': ' + esc(x.result) : ''}${x.error ? ' – ' + esc(x.error) : ''}</li>`).join('')}</ul>
            ${S.before ? `<p class="small muted">Messung vorher (Momentaufnahme): CPU ${S.before.cpu != null ? Math.round(S.before.cpu) + ' %' : 'n/v'}, RAM ${S.before.memory ? Math.round((1 - S.before.memory.available / S.before.memory.total) * 100) + ' %' : 'n/v'}, Energieprofil ${esc(S.before.power || 'n/v')}. Messe jetzt erneut zum Vergleich; Schwankungen sind normal.</p>` : ''}
            <button class="btn" data-act="opt-undo" ${S.optJob.undone ? 'disabled' : ''}>${S.optJob.undone ? 'Rückgängig gemacht' : 'Rückgängig machen'}</button></div>` : ''}
        </section>
        <section class="card glass span-2"><header class="card-head"><h2>${icon('task')} Erkenntnisse &amp; Vorschläge</h2></header>
          ${fl.length ? `<ul class="status-list" data-findings>${fl.map(([t, x]) => `<li><span class="led led-${t === 'warn' ? 'warn' : t === 'ok' ? 'ok' : 'idle'}"></span><span class="k" style="white-space:normal">${esc(x)}</span></li>`).join('')}</ul>` : '<p class="empty">Erst messen.</p>'}
          <p class="muted small">Nicht implementiert: DNS ändern, Netzwerk-Tuning, Dienste abschalten. Das wird nicht vorgetäuscht.</p></section>
      </div></div>`;
  },
  async onAct(act, el, ctx) {
    try {
      if (act === 'perf-run') { S.busy = 'perf'; S.err = ''; ctx.rerender(); S.p = await agentClient.perf(); }
      if (act === 'net-run') { S.busy = 'net'; S.err = ''; ctx.rerender(); const r = await agentClient.net(NET_TARGETS); S.net = Array.isArray(r) ? r : r.results; }
      if (act.startsWith('opt-') && !['opt-go', 'opt-cancel', 'opt-undo'].includes(act)) {
        S.busy = 'opt'; S.err = ''; S.optJob = null; ctx.rerender();
        const steps = act === 'opt-pc' ? [{ op: 'temp_quarantine', days: 7 }, { op: 'power_plan', plan: 'balanced' }]
          : act === 'opt-temp' ? [{ op: 'temp_quarantine', days: 7 }]
          : act === 'opt-gaming' ? [{ op: 'power_plan', plan: 'high' }]
          : act === 'opt-balanced' ? [{ op: 'power_plan', plan: 'balanced' }]
          : [{ op: 'autostart_disable', name: el.dataset.name }];
        const r = await agentClient.ultPlan('Optimierung', steps);
        S.opt = { id: r.id, preview: (r.steps || []).map((x) => x.preview) };
      }
      if (act === 'opt-cancel') S.opt = null;
      if (act === 'opt-go' && S.opt) {
        S.busy = 'opt'; ctx.rerender(); S.before = S.p;
        const id = S.opt.id; await agentClient.ultApprove(id); S.opt = null;
        for (let i = 0; i < 120; i++) {
          const j = (await agentClient.ultJob(id)).job; S.optJob = { ...j, planId: id };
          if (j.status !== 'läuft') break;
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      if (act === 'opt-undo' && S.optJob) { await agentClient.ultUndo(S.optJob.planId); S.optJob = { ...S.optJob, undone: true }; toast('Rückgängig gemacht.', 'info'); }
      if (act === 'net-save' && S.net) { actions.setSettings({ netBaseline: { ts: Date.now(), rows: S.net } }); toast('Messung gespeichert.', 'info'); }
    } catch (e) { S.err = e.message; }
    S.busy = ''; ctx.rerender();
  },
};
