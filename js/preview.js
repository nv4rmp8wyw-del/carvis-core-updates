// Free Preview Engine: externe Aktionen werden nur als Vorschau gezeigt. Es wird nichts gesendet, gekauft, geschrieben oder gestartet.
const T = (s) => s.toLowerCase();

const RULES = [
  { kind: 'payment', re: /(überweis|bezahl|zahle\b|zahlung|kaufe?\b|kaufen|bestell|buche\b|buchung)/, title: 'Einkauf / Zahlung vorbereiten',
    steps: ['Artikel bzw. Leistung und Anbieter festlegen', 'Preis, Versandkosten und Gesamtbetrag prüfen', 'Empfänger / Shop auf Seriosität prüfen', 'Zahlungsart wählen (du selbst, auf der Seite des Anbieters)', 'Bestellung selbst bestätigen'],
    risks: [['Betrug / Fake-Shop', 'hoch', 'Impressum, Bewertungen und Zahlungsarten prüfen'], ['Unerwartete Zusatzkosten', 'mittel', 'Gesamtbetrag vor dem Bestätigen lesen']],
    note: 'CARVIS bezahlt und kauft nie selbst. Auch nach Freigabe braucht jede Geldaktion eine gesonderte Einzelbestätigung (in dieser Version nicht implementiert, wird blockiert).' },
  { kind: 'trading', re: /(trading|trade\b|aktie|aktien|krypto|bitcoin|etf|order\b|depot)/, title: 'Trading: Analyse und Risikoszenarien',
    steps: ['Ziel, Zeithorizont und maximal tragbaren Verlust festlegen', 'Positionsgröße aus Risiko pro Trade berechnen (Finanzen-Ansicht)', 'Szenarien durchrechnen: Gewinn, Verlust, Seitwärts', 'Gebühren und Steuern berücksichtigen', 'Entscheidung und Order selbst beim Broker treffen'],
    risks: [['Totalverlust möglich', 'hoch', 'Nur Geld einsetzen, das du entbehren kannst'], ['Emotionale Entscheidungen', 'mittel', 'Regeln vorher schriftlich festlegen']],
    note: 'Keine Anlageberatung und keine Orders. Es gibt nur Rechenhilfen und Szenarien.' },
  { kind: 'email', re: /(e-?mail|mail)\b.*(send|schick|schreib|verfass|versend)|(send|schick|schreib|verfass|versend).*(e-?mail|mail)\b/, title: 'E-Mail-Entwurf',
    steps: ['Empfänger, Betreff und Ziel der Mail festlegen', 'Entwurf formulieren (siehe unten)', 'Anhänge und Tonfall prüfen', 'Selbst im eigenen Mailprogramm absenden'],
    risks: [['Falscher Empfänger', 'mittel', 'Adresse vor dem Absenden prüfen']],
    note: 'Es wird nichts versendet. E-Mail-Versand ist in dieser Version nicht implementiert.', draft: true },
  { kind: 'pc', re: /(öffne|starte|start|steuere)\s+(?:das |den |die )?(?:programm|app|anwendung|notepad|editor|excel|word|chrome|firefox|edge|explorer|taschenrechner)|pc steuern|computer steuern/, title: 'PC-Aktion: Aktionsplan',
    steps: ['Programm gegen die Freigabeliste des Desktop-Agenten prüfen', 'Plan anzeigen und auf Freigabe warten', 'Programm starten (mit verbundenem Agenten, nach Freigabe)', 'Ergebnis im Aktionsprotokoll ansehen'],
    risks: [['Unbekannte Programme', 'mittel', 'Nur feste, selbst freigegebene Pfade']],
    note: 'Es wurde nichts gestartet.' },
  { kind: 'file', re: /(datei|dokument|textdatei|notiz)\w*\s+(erstell|anleg|bearbeit|änder|ändere|speicher|schreib)|(erstell|leg|bearbeit|änder)\w*\s+(?:eine |die |meine )?(datei|textdatei)/, title: 'Datei: Änderungsvorschau',
    steps: ['Zielordner im freigegebenen Arbeitsordner wählen', 'Dateiname und Inhalt festlegen', 'Bestehende Dateien werden nie überschrieben; Änderungen erhalten eine Sicherung (.bak)', 'Datei anlegen (nur Ultimate nach Freigabe)'],
    risks: [['Überschreiben vorhandener Daten', 'mittel', 'Agent legt nur neu an und sichert vor Änderungen']],
    note: 'Es wurde keine Datei geschrieben.' },
  { kind: 'automation', re: /(automatisier|jeden (tag|morgen|montag|woche)|jede woche|regelmäßig|wiederkehrend)/, title: 'Automatisierung: Workflow',
    steps: ['Auslöser festlegen (Zeit oder Ereignis)', 'Einzelschritte mit Berechtigungen definieren', 'Probelauf mit Vorschau', 'Freigabe und Ausführung (nach Freigabe)', 'Protokoll prüfen und Fehler korrigieren'],
    risks: [['Unbeaufsichtigte Fehlläufe', 'mittel', 'Not-Stopp und Wiederholungslimit nutzen']],
    note: 'Wiederkehrende Ausführung im Hintergrund ist nicht implementiert (geplant). Nichts wurde eingerichtet.' },
];

/** Gibt eine Vorschau zurück oder null. Rein lokal, keine Seiteneffekte. */
export function previewIntent(raw) {
  const t = T(raw || '');
  const rule = RULES.find((r) => r.re.test(t));
  if (!rule) return null;
  const blocks = [
    { type: 'notice', tone: 'warn', text: 'VORSCHAU – NICHTS WURDE AUSGEFÜHRT. ' + rule.note },
    { type: 'steps', title: rule.title, items: rule.steps },
    { type: 'risks', title: 'Risiken', rows: rule.risks },
  ];
  if (rule.draft) {
    const to = (raw.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0] || '[Empfänger]';
    blocks.splice(2, 0, { type: 'table', title: 'Entwurf (nicht gesendet)', columns: ['Feld', 'Inhalt'], rows: [['An', to], ['Betreff', '[bitte ergänzen]'], ['Text', 'Guten Tag,\n\n[Ihr Anliegen]\n\nFreundliche Grüße']] });
  }
  blocks.push({ type: 'actions', items: [{ label: 'Aktionen-Center', act: 'go', payload: '#/gpt/ucc' }] });
  return { kind: rule.kind, text: `**${rule.title}** – das ist nur eine Vorschau. Ich habe nichts ausgeführt.`, blocks, source: 'local', preview: true };
}
