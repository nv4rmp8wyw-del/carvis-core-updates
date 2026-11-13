// Kostenlose, schlüssellose Recherche über die öffentliche Wikipedia-API (CORS-fähig).
// Jede Anfrage ist eine externe Anfrage an wikipedia.org und wird protokolliert.

const API = (lang) => `https://${lang}.wikipedia.org/w/api.php`;

async function getJSON(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Zeitüberschreitung' : e instanceof TypeError ? 'keine Verbindung' : e.message);
  } finally {
    clearTimeout(t);
  }
}

/** Sucht passende Artikel und liefert Kurzfassungen mit Quelle. */
export async function wikiSearch(query, { lang = 'de', limit = 3 } = {}) {
  const q = encodeURIComponent(query);
  const search = await getJSON(`${API(lang)}?action=query&list=search&srsearch=${q}&srlimit=${limit}&format=json&origin=*`);
  const hits = search?.query?.search || [];
  if (!hits.length) return [];
  const titles = hits.map((h) => h.title).join('|');
  const ex = await getJSON(`${API(lang)}?action=query&prop=extracts|info&inprop=url&exintro=1&explaintext=1&exsentences=5&titles=${encodeURIComponent(titles)}&format=json&origin=*`);
  const pages = Object.values(ex?.query?.pages || {});
  return hits
    .map((h) => pages.find((p) => p.title === h.title))
    .filter((p) => p && p.extract)
    .map((p) => ({ title: p.title, extract: p.extract.trim(), url: p.fullurl || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title)}` }));
}

/** Extrahiert das Recherchethema aus einer Frage. */
export function researchTopic(text) {
  return text
    .replace(/^\s*(bitte\s+)?(c,?\s+)?/i, '')
    .replace(/^(recherchiere|suche|such|finde|erkläre( mir)?|erzähl( mir)?( etwas)?|was weißt du|was ist|was sind|wer ist|wer war|was war|was bedeutet|informiere mich)\s*(über|zu|nach|von|mir)?\s*/i, '')
    .replace(/^(ein|eine|einen|der|die|das|den)\s+/i, '')
    .replace(/[?.!]+$/, '')
    .trim();
}
