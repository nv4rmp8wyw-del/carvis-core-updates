import { VERSION } from '../version.js';
import { icon } from '../ui.js';

export const ULTIMATE_FEATURES = [
  { name: 'Browserautomatisierung', icon: 'globe', desc: 'Webseiten öffnen, Formulare vorbereiten, Recherchen ausführen – jeweils mit Bestätigung.' },
  { name: 'E-Mail-Verwaltung', icon: 'mail', desc: 'Posteingang zusammenfassen, Antworten entwerfen. Senden nur nach Freigabe.' },
  { name: 'Terminverwaltung', icon: 'calendar', desc: 'Kalender lesen, freie Zeiten finden, Termine vorschlagen.' },
  { name: 'Webseitenentwicklung', icon: 'code', desc: 'Webseiten aus Beschreibungen generieren und veröffentlichen.' },
  { name: 'App-Entwicklung', icon: 'phone', desc: 'App-Prototypen erzeugen, testen und iterieren.' },
  { name: 'Projektautomatisierung', icon: 'bolt', desc: 'Wiederkehrende Abläufe automatisch ausführen.' },
  { name: 'Dateiverarbeitung', icon: 'file', desc: 'PDFs, Tabellen und Bilder auswerten und umwandeln.' },
  { name: 'Externe Integrationen', icon: 'plug', desc: 'Anbindung an Dienste wie GitHub, Notizen oder Smart Home.' },
];

export default {
  id: 'ultimate',
  title: 'Roadmap',
  icon: 'ultimate',
  render() {
    return `<div class="page">
      <header class="page-head"><div><p class="eyebrow">Roadmap</p><h1>Roadmap: geplante Funktionen</h1>
        <p class="muted">Geplante Erweiterungen. Die Karten unten sind <b>nicht implementiert</b>. Was aktuell wirklich geht (Aktionsmodus mit lokalem Agenten: Dateien, Programme, Browser-Schritte, Diagnose), steht im <button class="link-btn" data-go="#/gpt/ucc">Aktionen-Center ›</button>. E-Mail, Kalender, Einkäufe und Zahlungen sind weiter nicht implementiert.</p></div></header>
      <div class="ult-grid">${ULTIMATE_FEATURES.map((f) => `<article class="ult glass">
          <div class="ult-icon">${icon(f.icon)}</div>
          <h3>${f.name}</h3><p class="muted">${f.desc}</p>
          <span class="tag tag-plan">${icon('lock', 'lock')} GEPLANT</span>
        </article>`).join('')}</div>
      <section class="card glass" style="margin-top:20px">
        <header class="card-head"><h2>Aktueller Stand</h2></header>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Funktion</th><th>Stand</th></tr></thead><tbody>
          <tr><td>Chat, Aufgaben, Projekte, Dokumente</td><td>✓ verfügbar</td></tr>
          <tr><td>Lokale KI über Ollama (Windows-App: über den integrierten Agenten)</td><td>✓ Verbindung getestet mit Testserver; echtes Modell: Test mit dem Inhaber offen</td></tr>
          <tr><td>Dateien, Programme, Diagnose im Agenten</td><td>✓ nur nach deiner Freigabe, mit Protokoll und Not-Stopp</td></tr>
          <tr><td>Browser-Schritte</td><td>✓ nur mit installiertem Playwright, nicht in der EXE enthalten</td></tr>
          <tr><td>Sprachsteuerung</td><td>✓ Browser-Funktionen (nicht lokal, Qualität je nach System); lokale Erkennung geplant</td></tr>
          <tr><td>E-Mail, Termine</td><td>✗ nicht verfügbar</td></tr>
          <tr><td>Kosten</td><td>0,00 € – alles Implementierte ist für alle frei</td></tr>
        </tbody></table></div>
        <p class="muted small">Sicherheitsprinzip für alle zukünftigen Funktionen: keine Zahlungen, keine Trading-Orders, keine Passwortspeicherung, Bestätigung vor jeder kritischen Aktion.</p>
      </section>
    </div>`;
  },
};
