// Nachvollziehbare, heuristische Qualitätsbewertung von KI-Antworten.
// Keine "magische" Intelligenz-Note: jedes Kriterium ist einzeln sichtbar und erklärbar.

const STOP = new Set(('der die das und oder aber ein eine einer eines einem einen ist sind war waren wird werden mit für von zu zum zur auf aus bei nach über unter vor im in an am als auch nicht noch nur so wie was wer wenn dann dass den dem des sich sie er es ich du wir ihr man kann können muss soll sehr mehr hier dort diese dieser dieses jede jeder alle auch durch bis doch schon ohne gibt gibt\'s ' +
  'the a an and or but is are was were be been to of in on at for with by from as it this that these those you your we our can will would should not no yes').split(/\s+/));

export function terms(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[^a-zäöüß0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function vec(text) {
  const m = new Map();
  for (const t of terms(text)) m.set(t, (m.get(t) || 0) + 1);
  return m;
}

/** Kosinus-Ähnlichkeit zweier Texte (0..1) über Wortfrequenzen. */
export function similarity(a, b) {
  const va = vec(a), vb = vec(b);
  let dot = 0, na = 0, nb = 0;
  for (const [k, v] of va) { na += v * v; if (vb.has(k)) dot += v * vb.get(k); }
  for (const v of vb.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const UNCERTAIN = /(ich bin (mir )?nicht sicher|möglicherweise|vermutlich|eventuell|unklar|keine gewähr|i'm not sure|might be|possibly|not certain)/gi;
const REFUSAL = /(ich kann (dir )?(dabei )?nicht helfen|kann ich nicht beantworten|as an ai|i can(no|')t help|i'm sorry, but|i cannot)/i;

/**
 * Bewertet eine Antwort anhand messbarer Kriterien.
 * @returns {{total:number, parts:Object, flags:string[]}}
 */
export function score(answer, request, task, others = []) {
  const text = String(answer || '');
  const words = text.split(/\s+/).filter(Boolean).length;
  const flags = [];

  // 1) Abdeckung: Wie viele Schlüsselbegriffe der Anfrage greift die Antwort auf?
  const req = [...new Set(terms(request))];
  const ans = new Set(terms(text));
  const coverage = req.length ? req.filter((t) => ans.has(t) || [...ans].some((a) => a.startsWith(t.slice(0, 5)))).length / req.length : 0.5;

  // 2) Länge passend zur Aufgabe
  const [lo, hi] = task.complex ? [120, 900] : task.type === 'chat' ? [5, 120] : [30, 450];
  const length = words < lo ? Math.max(0, words / lo) : words > hi ? Math.max(0.3, hi / words) : 1;

  // 3) Struktur (Listen, Überschriften, Code wenn nötig)
  const hasList = /^\s*([-*•]|\d+[.)])\s+/m.test(text);
  const hasHead = /^#{1,4}\s/m.test(text) || /\*\*[^*]+\*\*/.test(text);
  const hasCode = /```/.test(text);
  let structure = (hasList ? 0.45 : 0) + (hasHead ? 0.35 : 0) + 0.2;
  if (task.type === 'code') structure = hasCode ? Math.max(structure, 0.9) : structure * 0.5;
  if (!task.complex && task.type === 'chat') structure = 1;
  structure = Math.min(1, structure);

  // 4) Übereinstimmung mit den anderen Modellen
  const agreement = others.length ? others.reduce((a, o) => a + similarity(text, o), 0) / others.length : null;

  // 5) Unsicherheit / Verweigerung
  const uncertainHits = (text.match(UNCERTAIN) || []).length;
  const certainty = Math.max(0, 1 - uncertainHits * 0.2);
  if (uncertainHits) flags.push(`${uncertainHits}× Unsicherheit markiert`);
  const refused = REFUSAL.test(text) && words < 80;
  if (refused) flags.push('Antwort verweigert/ausgewichen');
  if (!words) flags.push('leer');

  const w = { coverage: 0.3, length: 0.15, structure: 0.15, certainty: 0.1, agreement: 0.3 };
  let total = coverage * w.coverage + length * w.length + structure * w.structure + certainty * w.certainty;
  total += (agreement ?? 0.5) * w.agreement;
  if (refused || !words) total *= 0.2;

  return {
    total: Math.round(total * 100),
    parts: {
      coverage: Math.round(coverage * 100),
      length: Math.round(length * 100),
      structure: Math.round(structure * 100),
      certainty: Math.round(certainty * 100),
      agreement: agreement == null ? null : Math.round(agreement * 100),
    },
    flags,
    words,
  };
}

/** Paarweise Übereinstimmung aller Antworten; niedrige Werte deuten auf Widersprüche. */
export function agreementMatrix(texts) {
  const pairs = [];
  for (let i = 0; i < texts.length; i++)
    for (let j = i + 1; j < texts.length; j++) pairs.push({ i, j, sim: similarity(texts[i], texts[j]) });
  const mean = pairs.length ? pairs.reduce((a, p) => a + p.sim, 0) / pairs.length : 1;
  return { pairs, mean };
}

/** Zahlen, die nur in einem Teil der Antworten vorkommen – Hinweis auf mögliche Widersprüche. */
const UNIT = '(?:%|€|euro|eur|dollar|wochen?|tagen?|tage|monaten?|monate|jahren?|jahre|stunden?|minuten?|sekunden?|kb|mb|gb|tb|km|kg|ms|px)';
export function numberConflicts(texts) {
  // Zahlen mit Einheit (z. B. "6 Wochen") immer, nackte Zahlen erst ab 10 (Listen-Nummern ignorieren)
  const extract = (t) => {
    const clean = String(t).replace(/```[\s\S]*?```/g, '').replace(/^\s*\d+[.)]\s/gm, '');
    const withUnit = [...clean.matchAll(new RegExp(`\\b(\\d+(?:[.,]\\d+)?)\\s?(${UNIT})(?![a-zäöü])`, 'gi'))].map((m) => `${m[1]} ${m[2].toLowerCase().replace(/n$/, '')}`);
    const bare = (clean.match(/\b\d+(?:[.,]\d+)?\b/g) || []).filter((n) => +n.replace(',', '.') >= 10);
    return new Set([...withUnit, ...bare]);
  };
  const sets = texts.map(extract);
  const all = new Set(sets.flatMap((s) => [...s]));
  const disputed = [...all].filter((n) => { const c = sets.filter((s) => s.has(n)).length; return c > 0 && c < sets.length; });
  return disputed.slice(0, 8);
}
