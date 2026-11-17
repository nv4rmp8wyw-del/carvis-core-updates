// Frühe Fehlersammlung (vor allen Modulen, ohne Abhängigkeiten): Start- und Ladefehler bleiben für die Diagnose
// sichtbar (window.__ccErr), auch wenn das Hauptmodul gar nicht startet. Keine Daten verlassen das Gerät.
window.__ccErr = [];
window.addEventListener('error', (e) => {
  const t = e.target;
  const what = t && t !== window && (t.src || t.href) ? `Laden fehlgeschlagen: ${t.src || t.href}` : `${e.message || e.error} @ ${e.filename || ''}:${e.lineno || ''}`;
  if (window.__ccErr.length < 20) window.__ccErr.push(what);
}, true);
window.addEventListener('unhandledrejection', (e) => { if (window.__ccErr.length < 20) window.__ccErr.push(`Promise: ${e.reason && e.reason.message ? e.reason.message : e.reason}`); });

// Windows-App-Diagnose ohne Entwicklerwerkzeuge: Bleibt der Start hängen oder scheitert er, steht der Grund im
// Fenstertitel („CC-DIAG …“). Der Windows-Test liest ihn über tasklist aus. Normalfall: Titel bleibt die Version.
window.__ccDiagTitle = (msg) => {
  try { window.__TAURI__?.window?.getCurrentWindow?.().setTitle(`CC-DIAG ${String(msg).replace(/\s+/g, ' ').slice(0, 600)}`).catch(() => {}); } catch (e) { /* Browser */ }
};
// Prüft jedes Modul im Importgraph von js/app.js einzeln: HTTP-Status und Inhaltstyp (Module brauchen JavaScript-MIME).
window.__ccCheckModules = ccCheckModules;
async function ccCheckModules() {
  const seen = new Set(); const bad = []; const queue = ['js/app.js'];
  while (queue.length && seen.size < 80) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    seen.add(f);
    try {
      const r = await fetch(f, { cache: 'no-store' });
      const ct = r.headers.get('content-type') || '?';
      if (!r.ok || !/javascript/.test(ct)) { bad.push(`${f} ${r.status} ${ct}`); continue; }
      const src = await r.text();
      const dir = f.slice(0, f.lastIndexOf('/') + 1);
      for (const m of src.matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?['"](\.[^'"]+)['"]/gm)) {
        const parts = (dir + m[1]).split('/'); const out = [];
        for (const x of parts) { if (x === '..') out.pop(); else if (x !== '.') out.push(x); }
        queue.push(out.join('/'));
      }
    } catch (e) { bad.push(`${f} ${e && e.message ? e.message : e}`); }
  }
  return { n: seen.size, bad };
}
setTimeout(async () => {
  if (window.__ccAppReady) return;
  let mods = '';
  try { const r = await ccCheckModules(); mods = r.bad.length ? ` · Module: ${r.bad.join(' ; ')}` : ` · alle ${r.n} Module laden einzeln (Inhalt/Parsing prüfen)`; } catch (e) { mods = ` · Modulprüfung: ${e}`; }
  window.__ccDiagTitle(`App nicht gestartet (20 s): ${(window.__ccErr || []).join(' | ') || 'kein Fehler gemeldet'}${mods}`);
}, 20000);
