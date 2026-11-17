// Ein gemeinsames Sprachsystem für CARVIS CORE (D-053).
// - Alle sichtbaren Texte über t("schluessel", {werte}); eine Datei je Sprache unter js/lang/<code>.js.
// - Standardsprache Englisch. Auswahl wird in settings.uiLang gespeichert; Sprachwechsel gilt sofort (onLang).
// - Fehlt ein Schlüssel in einer Sprache, gilt Englisch (tools/test-i18n.cjs meldet fehlende Schlüssel als Fehler).
// - Neue Sprache: Datei js/lang/<code>.js anlegen (gleiche Schlüssel wie en.js) und unten in LANGS eintragen.
import en from './lang/en.js';
import de from './lang/de.js';
import it from './lang/it.js';
import es from './lang/es.js';
import fr from './lang/fr.js';
import pt from './lang/pt.js';
import nl from './lang/nl.js';
import pl from './lang/pl.js';

export const DICT = { en, de, it, es, fr, pt, nl, pl };
// speech: Sprache für Spracheingabe/-ausgabe und für die Antworten der KI
export const LANGS = [
  { code: 'en', name: 'English', speech: 'en-US', ai: 'English' },
  { code: 'de', name: 'Deutsch', speech: 'de-DE', ai: 'German (Deutsch)' },
  { code: 'it', name: 'Italiano', speech: 'it-IT', ai: 'Italian (Italiano)' },
  { code: 'es', name: 'Español', speech: 'es-ES', ai: 'Spanish (Español)' },
  { code: 'fr', name: 'Français', speech: 'fr-FR', ai: 'French (Français)' },
  { code: 'pt', name: 'Português', speech: 'pt-PT', ai: 'Portuguese (Português)' },
  { code: 'nl', name: 'Nederlands', speech: 'nl-NL', ai: 'Dutch (Nederlands)' },
  { code: 'pl', name: 'Polski', speech: 'pl-PL', ai: 'Polish (Polski)' },
];

/** Standard: Englisch. Nur der Test-Server (tools/dev-server.py) setzt data-test-lang, damit Bestandstests ihre Sprache behalten. */
export const defaultLang = () => (typeof document !== 'undefined' && DICT[document.documentElement.dataset.testLang]) ? document.documentElement.dataset.testLang : 'en';

let cur = 'en';
const subs = new Set();
export const lang = () => cur;
export const langInfo = (code = cur) => LANGS.find((l) => l.code === code) || LANGS[0];
export const onLang = (f) => { subs.add(f); return () => subs.delete(f); };

export function initLang(stored) {
  cur = DICT[stored] ? stored : defaultLang();
  if (typeof document !== 'undefined') document.documentElement.lang = cur;
  return cur;
}
export function setLang(code) {
  if (!DICT[code] || code === cur) return cur;
  cur = code;
  if (typeof document !== 'undefined') { document.documentElement.lang = cur; applyStatic(); }
  subs.forEach((f) => { try { f(cur); } catch { /* Abonnent */ } });
  return cur;
}

const fill = (s, vars) => (vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : s);
/** Text zum Schlüssel; Platzhalter {name}. Arrays (z. B. Begrüßungsvarianten) werden unverändert zurückgegeben. */
export function t(key, vars) {
  const v = DICT[cur][key] ?? DICT.en[key];
  if (v === undefined) return key;
  return Array.isArray(v) ? v : fill(v, vars);
}
/** Mengenform: key.one / key.other mit {n}. */
export const tn = (key, n, vars = {}) => t(`${key}.${n === 1 ? 'one' : 'other'}`, { n, ...vars });
/** Datum/Zahl in der gewählten Sprache */
export const fmtNumber = (n, o) => new Intl.NumberFormat(cur, o).format(n);

/** Statische Texte im HTML: data-i18n="…" (Text) und data-i18n-attr="aria-label:…;title:…" */
export function applyStatic(root = typeof document !== 'undefined' ? document : null) {
  if (!root) return;
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    el.dataset.i18nAttr.split(';').forEach((pair) => { const [attr, key] = pair.split(':'); if (attr && key) el.setAttribute(attr.trim(), t(key.trim())); });
  });
}
