// Erkennung möglicherweise sensibler Inhalte, bevor etwas an externe Anbieter geht.
const PATTERNS = [
  { re: /\b(passwort|password|kennwort|pin|tan|zugangsdaten|login)\b/i, label: 'Passwort/Zugangsdaten' },
  { re: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}\b/, label: 'IBAN' },
  { re: /\b(?:\d[ -]?){13,19}\b/, label: 'Kartennummer' },
  { re: /[\w.+-]+@[\w-]+\.[\w.]{2,}/, label: 'E-Mail-Adresse' },
  { re: /(?:\+49|0049|\b0)\s?\d{2,5}[\s/-]?\d{3,}/, label: 'Telefonnummer' },
  { re: /\b(sk-[\w-]{16,}|AIza[\w-]{20,}|ghp_\w{20,}|xox[bp]-[\w-]+)\b/, label: 'API-Schlüssel' },
  { re: /\b(steuer-?id|sozialversicherung|personalausweis|reisepass)\b/i, label: 'Ausweis-/Steuerdaten' },
  { re: /\b(diagnose|krankheit|medikament)\b/i, label: 'Gesundheitsdaten' },
];

export function findSensitive(text) {
  return PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label);
}

/** Entfernt offensichtliche Geheimnisse (z. B. Schlüssel) vollständig. */
export function redactSecrets(text) {
  return String(text).replace(/\b(sk-[\w-]{16,}|AIza[\w-]{20,}|ghp_\w{20,}|xox[bp]-[\w-]+)\b/g, '[ENTFERNT]');
}
