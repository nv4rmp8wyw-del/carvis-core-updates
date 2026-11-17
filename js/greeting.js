// Abwechslungsreiche, kurze Begrüßungen (ruhig, kompetent, freundlich). Rein regelbasiert, keine KI, keine kopierten
// Filmzitate. Texte kommen aus dem Sprachsystem (js/lang/<sprache>.js: greet.*), damit jede Sprache korrekt grüßt.
import { t } from './i18n.js';

const K = 'ccc.greet.last';
const TIME = (h) => (h < 5 ? 'night' : h < 11 ? 'morning' : h < 18 ? 'day' : 'evening');

/** Tagesgruß in der gewählten Sprache („Good evening“, „Guten Abend“ …) */
export const greetingWord = (hour = new Date().getHours()) => t(`greet.${TIME(hour)}`);

const list = (key) => { const v = t(key); return Array.isArray(v) && v.length ? v : t(key.replace('Formal', '')); };
export const GREETING_COUNT = {
  get de() { return list('greet.firstFormal').length + list('greet.backFormal').length; },
  get du() { return list('greet.first').length + list('greet.back').length; },
};

/** @param o {name, formal=false, back=false, hour, last=-1, rnd=Math.random} – formal nur, wo die Sprache eine Höflichkeitsform hat */
export function makeGreeting({ name = '', formal = false, back = false, hour = new Date().getHours(), last = -1, rnd = Math.random } = {}) {
  const items = list(`greet.${back ? 'back' : 'first'}${formal ? 'Formal' : ''}`);
  let i = Math.floor(rnd() * items.length);
  if (items.length > 1 && i === last) i = (i + 1) % items.length;
  const n = name ? `, ${name}` : '';
  return { text: items[i].replace('{h}', greetingWord(hour)).replace('{n}', n), index: i };
}

export function nextGreeting(opts) {
  let last = -1;
  try { last = parseInt(localStorage.getItem(K) ?? '-1', 10); } catch { /* privat */ }
  const g = makeGreeting({ ...opts, last });
  try { localStorage.setItem(K, String(g.index)); } catch { /* privat */ }
  return g.text;
}
