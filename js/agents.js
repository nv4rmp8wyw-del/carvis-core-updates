// Agentensystem: Register der Agenten und Ablaufsteuerung (Workflows) mit Vorschau, Bestätigung, Not-Stopp und Protokoll.
// Ehrlichkeit: Agenten sind hier regelbasierte Module. Nur was tatsächlich läuft, hat den Status „aktiv“.
import { store, actions } from './store.js';
import { agentClient } from './agent-client.js';
import { wikiSearch } from './ai/research.js';
import { aiOverview } from './views/models.js';

export const STATUS = {
  aktiv: { label: 'AKTIV', cls: 'tag-ok' },
  modell: { label: 'BRAUCHT KI-MODELL', cls: 'tag-warn' },
  agent: { label: 'BRAUCHT DESKTOP-AGENT', cls: 'tag-warn' },
  geplant: { label: 'GEPLANT', cls: 'tag-plan' },
};

/** Jeder Agent: was er wirklich kann und welchen Status er gerade hat. */
export const AGENTS = [
  { id: 'research', name: 'Research Agent', icon: 'globe', desc: 'Recherchiert in der Wikipedia und nennt Quellen. Keine KI-Zusammenfassung ohne Modell.', status: () => (navigator.onLine ? 'aktiv' : 'geplant'), go: '#/gpt/chat' },
  { id: 'coding', name: 'Coding Agent', icon: 'code', desc: 'Schreibt und erklärt Code über ein verbundenes KI-Modell (Chat). Ohne Modell nur simulierte Antworten.', status: (s) => (aiOverview(s).available ? 'aktiv' : 'modell'), go: '#/gpt/models' },
  { id: 'computer', name: 'Computer Agent', icon: 'dashboard', desc: 'Systemdaten, Netzwerkdiagnose und freigegebene Ordner über den lokalen Desktop-Agenten.', status: () => (agentClient.connected ? 'aktiv' : 'agent'), go: '#/gpt/computer' },
  { id: 'browser', name: 'Browser Agent', icon: 'globe', desc: 'Webseiten bedienen und Formulare ausfüllen. Noch nicht implementiert.', status: () => 'geplant' },
  { id: 'finance', name: 'Finance Agent', icon: 'doc', desc: 'Budget, Sparpotenzial, Szenarien und Risikorechner. Rechnet lokal, gibt keine Anlageempfehlung.', status: () => 'aktiv', go: '#/gpt/finance' },
  { id: 'shopping', name: 'Shopping Agent', icon: 'task', desc: 'Einkaufsliste mit Preisvergleich nach deinen Eingaben und Zielpreis. Automatische Preise sind nicht verfügbar.', status: () => 'aktiv', go: '#/gpt/finance' },
  { id: 'productivity', name: 'Productivity Agent', icon: 'project', desc: 'Aufgaben, Projekte, Dokumente und Übersichten.', status: () => 'aktiv', go: '#/gpt/tasks' },
  { id: 'assistant', name: 'Personal Assistant Agent', icon: 'core', desc: 'Gespräch, Sprache und gemeinsames Gedächtnis. Kalender- und E-Mail-Anbindung sind nicht verbunden.', status: () => 'aktiv', go: '#/carvis' },
  { id: 'qa', name: 'Quality Assurance Agent', icon: 'preview', desc: 'Prüft Ergebnisse von Abläufen auf Lücken (leer, ohne Quellen, unplausible Zahlen). Regelbasiert.', status: () => 'aktiv' },
];

// ---------- Qualitätsprüfung (QA-Agent) ----------
export function qaCheck(text, { needSources = false, minLen = 40 } = {}) {
  const issues = [];
  if (!text || text.trim().length < minLen) issues.push('Ergebnis ist leer oder sehr kurz.');
  if (needSources && !/https?:\/\//.test(text)) issues.push('Keine Quelle (Link) im Ergebnis.');
  if (/\b(NaN|undefined|null)\b/.test(text)) issues.push('Ergebnis enthält ungültige Werte (NaN/undefined/null).');
  return { ok: issues.length === 0, issues };
}

const fmtB = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);

// ---------- Optimierungsvorschläge aus echten Messwerten ----------
export function suggestions(sys, net) {
  const out = [];
  if (sys) {
    if (sys.cpu?.percent != null && sys.cpu.percent > 85) out.push({ tone: 'warn', text: `CPU-Auslastung ${sys.cpu.percent} %: Prozesse mit hohem Verbrauch schließen oder neu starten.` });
    if (sys.memory) {
      const free = sys.memory.available / sys.memory.total;
      if (free < 0.15) out.push({ tone: 'warn', text: `Nur ${Math.round(free * 100)} % RAM frei (${fmtB(sys.memory.available)} von ${fmtB(sys.memory.total)}). Größten Prozess prüfen: ${sys.processes?.[0]?.name || 'unbekannt'}.` });
    }
    for (const d of sys.disks || []) {
      const free = d.free / d.total;
      if (free < 0.1) out.push({ tone: 'danger', text: `Auf „${d.path}“ sind nur ${Math.round(free * 100)} % frei (${fmtB(d.free)}). Große Dateien suchen und aufräumen.` });
    }
    if ((sys.autostart || []).length > 10) out.push({ tone: 'info', text: `${sys.autostart.length} Autostart-Einträge. Nicht benötigte Programme im Autostart deaktivieren (das macht CC nicht automatisch).` });
  }
  for (const r of net?.results || []) {
    if (r.loss > 0) out.push({ tone: 'warn', text: `Verbindung zu ${r.host}: ${r.loss} % fehlgeschlagene Verbindungsversuche. Router/WLAN prüfen, Kabel statt WLAN testen.` });
    else if (r.medianMs != null && r.medianMs > 150) out.push({ tone: 'warn', text: `Hohe Antwortzeit zu ${r.host}: ${r.medianMs} ms. Router neu starten oder näher an den Router gehen.` });
    if (r.dnsMs != null && r.dnsMs > 150) out.push({ tone: 'info', text: `Namensauflösung (DNS) für ${r.host} dauert ${r.dnsMs} ms. Ein anderer DNS-Server kann helfen.` });
    if (r.dnsError) out.push({ tone: 'danger', text: `DNS-Fehler für ${r.host}: ${r.dnsError}` });
  }
  if (!out.length) out.push({ tone: 'ok', text: 'Keine Auffälligkeiten in den gemessenen Werten.' });
  return out;
}

// ---------- Ablaufsteuerung ----------
export const run = { current: null, stop: false };

export function requestStop() {
  run.stop = true;
  if (agentClient.connected) agentClient.stop().catch(() => {});
}

const logAct = (text, icon = 'bolt') => store.update(() => {}, { text, icon });

function sysText(sys, net) {
  const L = [`Plattform: ${sys.platform}, ${sys.cores} Kerne`];
  if (sys.cpu?.percent != null) L.push(`CPU: ${sys.cpu.percent} % (${sys.cpu.method})`);
  if (sys.memory) L.push(`RAM: ${fmtB(sys.memory.total - sys.memory.available)} von ${fmtB(sys.memory.total)} belegt`);
  for (const d of sys.disks || []) L.push(`Speicher ${d.path}: ${fmtB(d.free)} frei von ${fmtB(d.total)}`);
  if (sys.processes?.length) L.push('Größte Prozesse: ' + sys.processes.slice(0, 5).map((p) => `${p.name} (${fmtB(p.bytes)})`).join(', '));
  L.push(`Autostart-Einträge: ${(sys.autostart || []).length}`);
  for (const r of net?.results || []) L.push(`Netz ${r.host}:${r.port}: ${r.medianMs ?? 'keine Antwort'} ms Median, ${r.loss} % Verlust, DNS ${r.dnsMs ?? '–'} ms`);
  return L.join('\n');
}

export const WORKFLOWS = [
  {
    id: 'week',
    name: 'Wochenübersicht erstellen',
    desc: 'Sammelt offene Aufgaben und Projekte und legt ein Dokument an. Läuft komplett lokal.',
    needs: [],
    steps: [
      { agent: 'productivity', title: 'Offene Aufgaben und Projekte sammeln', run: (c) => {
        const s = store.get();
        const open = s.tasks.filter((t) => !t.done);
        c.text = `# Wochenübersicht\n\n${open.length} offene Aufgaben in ${s.projects.length} Projekten.\n\n` +
          s.projects.map((p) => `## ${p.name}\n` + (s.tasks.filter((t) => t.projectId === p.id && !t.done).map((t) => `- [${t.priority}] ${t.title}${t.due ? ` (fällig ${t.due})` : ''}`).join('\n') || '- keine offenen Aufgaben')).join('\n\n');
        return `${open.length} offene Aufgaben gefunden`;
      } },
      { agent: 'productivity', title: 'Dokument „Wochenübersicht“ anlegen', run: (c) => { c.doc = actions.addDocument({ title: `Wochenübersicht ${new Date().toLocaleDateString('de-DE')}`, content: c.text }); return 'Dokument angelegt'; } },
      { agent: 'qa', title: 'Ergebnis prüfen', run: (c) => { const q = qaCheck(c.text); if (!q.ok) throw new Error(q.issues.join(' ')); return 'Prüfung bestanden'; } },
    ],
  },
  {
    id: 'research',
    name: 'Recherche zu einem Thema',
    desc: 'Sucht in der Wikipedia, legt ein Dokument mit Quellen an. Braucht Internet.',
    needs: [],
    params: [{ name: 'thema', label: 'Thema', placeholder: 'z. B. Photovoltaik' }],
    steps: [
      { agent: 'research', title: 'Wikipedia durchsuchen', run: async (c) => {
        const hits = await wikiSearch(c.params.thema, { limit: 3 });
        if (!hits.length) throw new Error('Keine Treffer gefunden.');
        c.hits = hits;
        return `${hits.length} Treffer`;
      } },
      { agent: 'productivity', title: 'Dokument mit Quellen anlegen', run: (c) => {
        c.text = `# Recherche: ${c.params.thema}\n\n` + c.hits.map((h) => `## ${h.title}\n${h.extract || h.text || ''}\n\nQuelle: ${h.url}`).join('\n\n');
        c.doc = actions.addDocument({ title: `Recherche: ${c.params.thema}`, content: c.text });
        return 'Dokument angelegt';
      } },
      { agent: 'qa', title: 'Quellen und Inhalt prüfen', run: (c) => { const q = qaCheck(c.text, { needSources: true }); if (!q.ok) throw new Error(q.issues.join(' ')); return 'Prüfung bestanden'; } },
    ],
  },
  {
    id: 'syscheck',
    name: 'PC- und Netzwerk-Check',
    desc: 'Misst CPU, RAM, Speicher, Prozesse, Autostart und Netzwerk über den Desktop-Agenten und legt einen Bericht an.',
    needs: ['agent'],
    steps: [
      { agent: 'computer', title: 'Systemdaten lesen', run: async (c) => { c.sys = await agentClient.system(); return `${c.sys.platform}, ${c.sys.cores} Kerne`; } },
      { agent: 'computer', title: 'Netzwerk messen', run: async (c) => { c.net = await agentClient.net(['1.1.1.1:443', 'github.com:443']); return `${c.net.results.length} Ziele gemessen`; } },
      { agent: 'productivity', title: 'Bericht als Dokument anlegen', run: (c) => {
        const tips = suggestions(c.sys, c.net).map((x) => `- ${x.text}`).join('\n');
        c.text = `# PC- und Netzwerk-Check\n\n${sysText(c.sys, c.net)}\n\n## Vorschläge (CC ändert nichts am System)\n${tips}`;
        c.doc = actions.addDocument({ title: `PC-Check ${new Date().toLocaleString('de-DE')}`, content: c.text });
        return 'Bericht angelegt';
      } },
      { agent: 'qa', title: 'Bericht prüfen', run: (c) => { const q = qaCheck(c.text); if (!q.ok) throw new Error(q.issues.join(' ')); return 'Prüfung bestanden'; } },
    ],
  },
  {
    id: 'savedoc',
    name: 'Dokument im Arbeitsordner speichern',
    desc: 'Speichert ein CCC-Dokument als Textdatei im freigegebenen Ordner. Zeigt vorher eine Vorschau und fragt nach.',
    needs: ['agent'],
    params: [{ name: 'dokument', label: 'Dokument', type: 'doc' }, { name: 'datei', label: 'Dateiname', placeholder: 'notiz.txt' }],
    steps: [
      { agent: 'productivity', title: 'Dokument laden', run: (c) => {
        const d = store.get().documents.find((x) => x.id === c.params.dokument);
        if (!d) throw new Error('Dokument nicht gefunden.');
        if (!/^[\w .-]{1,80}$/.test(c.params.datei || '') || c.params.datei.startsWith('.')) throw new Error('Dateiname ungültig (nur Buchstaben, Zahlen, Leerzeichen, Punkt, Bindestrich).');
        c.text = `${d.title}\n\n${d.content}`;
        return `„${d.title}“ geladen`;
      } },
      { agent: 'computer', title: 'Speichern vorschlagen', run: async (c) => { c.prop = await agentClient.propose(c.params.datei, c.text); return `Vorschau: ${c.prop.preview.path}`; } },
      { agent: 'computer', title: 'Datei anlegen (nach Bestätigung)', confirm: (c) => `Der Agent legt diese Datei NEU an (${c.prop.preview.bytes} Bytes):\n${c.prop.preview.path}\nEs wird nichts überschrieben.`, run: async (c) => { await agentClient.confirm(c.prop.id); return 'Datei angelegt'; }, onDeny: async (c) => { await agentClient.cancel(c.prop.id).catch(() => {}); } },
    ],
  },
];

/** Führt einen Ablauf aus. hooks: { update(), confirm(text) -> Promise<boolean> } */
export async function runWorkflow(wf, params, hooks) {
  run.stop = false;
  const ctx = { params };
  const r = { wf, steps: wf.steps.map((s) => ({ agent: s.agent, title: s.title, status: 'wartet', msg: '' })), finished: false, error: '' };
  run.current = r;
  logAct(`Ablauf gestartet: ${wf.name}`);
  hooks.update();
  for (let i = 0; i < wf.steps.length; i++) {
    const st = wf.steps[i];
    const row = r.steps[i];
    if (run.stop) { row.status = 'gestoppt'; r.error = 'Not-Stopp ausgelöst.'; break; }
    if (wf.needs.includes('agent') && !agentClient.connected) { row.status = 'fehler'; r.error = 'Desktop-Agent nicht verbunden.'; break; }
    row.status = 'läuft';
    hooks.update();
    try {
      if (st.confirm) {
        const ok = await hooks.confirm(st.confirm(ctx));
        if (!ok) { row.status = 'abgelehnt'; row.msg = 'Von dir abgebrochen'; r.error = 'Abgebrochen. Es wurde nichts verändert.'; await st.onDeny?.(ctx); break; }
        if (run.stop) { row.status = 'gestoppt'; r.error = 'Not-Stopp ausgelöst.'; break; }
      }
      row.msg = (await st.run(ctx)) || '';
      row.status = 'fertig';
    } catch (e) {
      row.status = 'fehler';
      row.msg = e.message;
      r.error = `Schritt „${st.title}“ fehlgeschlagen: ${e.message}`;
      break;
    }
    hooks.update();
  }
  r.finished = true;
  logAct(r.error ? `Ablauf beendet mit Fehler: ${wf.name}` : `Ablauf abgeschlossen: ${wf.name}`, r.error ? 'trash' : 'task');
  hooks.update();
  return r;
}
