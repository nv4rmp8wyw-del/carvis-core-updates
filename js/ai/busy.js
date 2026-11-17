// Läuft gerade eine Antwort an den Nutzer? Hintergrund-Prüfungen (Verbindungsmanager, Selbstheilung) warten dann,
// damit sie kein zweites Modell dazwischenladen (Ollama hält standardmäßig nur ein Modell im Speicher).
let active = 0;
let waiters = [];
export const answering = {
  begin() { active++; },
  end() { active = Math.max(0, active - 1); if (!active) { waiters.forEach((r) => r()); waiters = []; } },
  get on() { return active > 0; },
  /** Wartet, bis keine Antwort mehr läuft (höchstens maxMs, danach geht es trotzdem weiter). */
  idle(maxMs = 120000) {
    if (!active) return Promise.resolve();
    return new Promise((res) => { const t = setTimeout(res, maxMs); waiters.push(() => { clearTimeout(t); res(); }); });
  },
};
