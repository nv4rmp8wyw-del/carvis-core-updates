// Abwechslungsreiche, kurze Begrüßungen (ruhig, kompetent, freundlich). Rein regelbasiert, keine KI, keine kopierten Filmzitate.
const K = 'ccc.greet.last';

const TIME = (h) => (h < 5 ? 'night' : h < 11 ? 'morning' : h < 18 ? 'day' : 'evening');
const HELLO = { night: 'Gute Nacht', morning: 'Guten Morgen', day: 'Guten Tag', evening: 'Guten Abend' };
const HELLO_EN = { night: 'Good night', morning: 'Good morning', day: 'Good afternoon', evening: 'Good evening' };

// {h} = Tagesgruß, {n} = ", Name" (oder leer), {sie}: Sie-Form / du-Form wird über Varianten getrennt gehalten
const SIE = {
  first: ['{h}{n}. CARVIS ist bereit. Womit darf ich Ihnen helfen?', '{h}{n}. CARVIS CORE ist bereit. Was darf ich für Sie tun?', '{h}{n}. Ich bin CARVIS, Ihr persönlicher Assistent. Wie kann ich helfen?'],
  back: ['{h}{n}. Willkommen zurück. CARVIS ist bereit.', '{h}{n}. Schön, dass Sie wieder da sind. CARVIS ist bereit. Womit darf ich Ihnen heute helfen?', '{h}{n}. Willkommen zurück. Was steht heute an?', '{h}{n}. Schön, Sie zu sehen. Ich bin bereit, wenn Sie es sind.', '{h}{n}. Willkommen zurück. Soll ich dort weitermachen, wo wir aufgehört haben?'],
};
const DU = {
  first: ['{h}{n}. CARVIS ist bereit. Womit kann ich dir helfen?', '{h}{n}. Ich bin CARVIS, dein persönlicher Assistent. Was kann ich für dich tun?', '{h}{n}. CARVIS CORE ist bereit. Was steht an?'],
  back: ['{h}{n}. Willkommen zurück. CARVIS ist bereit.', '{h}{n}. Schön, dass du wieder da bist. CARVIS ist bereit. Womit darf ich dir heute helfen?', '{h}{n}. Willkommen zurück. Was steht heute an?', '{h}{n}. Schön, dich zu sehen. Ich bin bereit.', '{h}{n}. Willkommen zurück. Sollen wir dort weitermachen, wo wir aufgehört haben?'],
};
const EN = {
  first: ['{h}{n}. CARVIS is ready. How may I help?', '{h}{n}. I am CARVIS, your personal assistant. What can I do for you?'],
  back: ['{h}{n}. Good to have you back. CARVIS is ready. What can I do for you today?', '{h}{n}. Welcome back. What is on the agenda?'],
};

export const GREETING_COUNT = { de: SIE.first.length + SIE.back.length, du: DU.first.length + DU.back.length };

/** @param o {name, formal=true, back=false, hour, lang='de', last=-1, rnd=Math.random} */
export function makeGreeting({ name = '', formal = true, back = false, hour = new Date().getHours(), lang = 'de', last = -1, rnd = Math.random } = {}) {
  const set = lang.startsWith('en') ? EN : formal ? SIE : DU;
  const list = back ? set.back : set.first;
  let i = Math.floor(rnd() * list.length);
  if (list.length > 1 && i === last) i = (i + 1) % list.length;
  const h = (lang.startsWith('en') ? HELLO_EN : HELLO)[TIME(hour)];
  const n = name ? `, ${name}` : '';
  return { text: list[i].replace('{h}', h).replace('{n}', n), index: i };
}

export function nextGreeting(opts) {
  let last = -1;
  try { last = parseInt(localStorage.getItem(K) ?? '-1', 10); } catch { /* privat */ }
  const g = makeGreeting({ ...opts, last });
  try { localStorage.setItem(K, String(g.index)); } catch { /* privat */ }
  return g.text;
}
