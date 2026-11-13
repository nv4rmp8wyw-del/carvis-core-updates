// CARVIS – zentrale Koordination mehrerer KI-Modelle.
// Ablauf: Anfrage analysieren → geeignete Modelle wählen → (parallel) befragen →
// Antworten messbar bewerten & vergleichen → Widersprüche erkennen → zusammenführen.
import { store, actions } from '../store.js';
import { callExpert, suitability, COST_LABEL } from './providers.js';
import { score, agreementMatrix, numberConflicts } from './quality.js';
import { findSensitive, redactSecrets } from './privacy.js';
import { wikiSearch, researchTopic } from './research.js';

const TYPES = [
  ['code', /\b(code|programm|funktion|javascript|typescript|python|java\b|html|css|sql|api|bug|debug|regex|skript|script|app\b|algorithmus|compiler|git)\b/i],
  ['planning', /\b(plan|planen|strategie|vorgehen|schritte|architektur|konzept|roadmap|projekt|organisier|struktur)/i],
  ['reasoning', /\b(warum|wieso|berechne|logik|beweis|wahrscheinlich|vergleich|abwägen|vor- und nachteile|entscheid|analysier|bewerte)/i],
  ['research', /\b(was ist|was sind|wer ist|wer war|wann|wo liegt|geschichte|fakten|recherch|erkläre|erklär|definition|bedeutet)/i],
  ['creative', /\b(schreib|gedicht|geschichte erzählen|slogan|idee|ideen|kreativ|text für|formulier|brief|rede|story)/i],
];

export const TYPE_LABEL = { code: 'Programmierung', planning: 'Planung', reasoning: 'Analyse/Logik', research: 'Wissen/Recherche', creative: 'Kreativ/Text', chat: 'Gespräch' };

/** 1) Anfrage verstehen: Typ und Komplexität. */
export function analyze(text) {
  const words = text.trim().split(/\s+/).length;
  const found = TYPES.filter(([, re]) => re.test(text)).map(([t]) => t);
  const type = found[0] || 'chat';
  const reasons = [];
  if (words > 25) reasons.push(`${words} Wörter`);
  if (/\b(entwickle|architektur|analysiere|vergleiche|strategie|konzept|professionell|ausführlich|detailliert|bewerte|optimiere)/i.test(text)) reasons.push('anspruchsvolle Aufgabe');
  if ((text.match(/\?/g) || []).length >= 2) reasons.push('mehrere Fragen');
  if (found.length >= 2) reasons.push(`mehrere Bereiche (${found.map((t) => TYPE_LABEL[t]).join(', ')})`);
  return { type, types: found, complex: reasons.length > 0, reasons, words };
}

/** 2) Verfügbare Modelle nach Eignung auswählen. */
const SLOW_THINKERS = /deepseek-r1|qwq|reason|magistral/i;

export function route(task, experts, settings, mode = 'gpt') {
  // CARVIS 3.8: Nur lokal ausgeführte, explizit kostenlose Modelle automatisch wählen.
  // Gratis-Kontingente und kostenpflichtige Proxy-Anbieter niemals stillschweigend aufrufen.
  const usable = experts.filter((e) => e.enabled && e.local === true && e.cost === 'free');
  const avgSecs = (e) => (e.stats?.ok ? e.stats.msSum / e.stats.ok / 1000 : 0);
  const ranked = usable
    .map((e) => ({
      e,
      fit: suitability(e, task.type)
        - (e.status === 'error' ? 0.25 : 0)
        + (e.local ? 0.02 : 0)
        // Im Sprachmodus zählt Tempo: langsame Denk-Modelle und gemessen langsame Modelle nachrangig
        - (mode === 'carvis' && SLOW_THINKERS.test(e.model) ? 0.3 : 0)
        - (mode === 'carvis' && avgSecs(e) > 20 ? 0.1 : 0),
    }))
    .sort((a, b) => b.fit - a.fit);
  let n = 1;
  let why = 'einfache Anfrage → ein Modell genügt';
  if (settings.collab === 'always') { n = settings.maxExperts; why = 'Zusammenarbeit immer aktiv'; }
  else if (settings.collab === 'auto' && task.complex) { n = settings.maxExperts; why = `komplexe Anfrage (${task.reasons.join(', ')}) → mehrere Modelle`; }
  else if (settings.collab === 'never') why = 'Zusammenarbeit ausgeschaltet';
  n = Math.max(1, Math.min(n, ranked.length));
  if (n > 1 && ranked.length < 2) why += ' – aber nur ein Modell verfügbar';
  return { selected: ranked.slice(0, n).map((r) => r.e), ranked, why };
}

function systemPrompt({ mode, task, memory, sources, userName }) {
  const brief = mode === 'carvis'
    ? 'Du sprichst gerade per Sprache mit dem Nutzer: antworte kurz, natürlich und direkt (höchstens 3–4 Sätze, keine Tabellen).'
    : 'Antworte klar strukturiert (Markdown-Listen/Überschriften wenn hilfreich).';
  return [
    `Du bist C, der persönliche KI-Assistent „CARVIS CORE“.${userName ? ` Du sprichst mit ${userName}.` : ''} Antworte auf Deutsch, freundlich und natürlich, und sprich den Nutzer mit „du“ an.`,
    brief,
    `Aufgabentyp: ${TYPE_LABEL[task.type]}.`,
    'Kennzeichne Unsicherheiten ehrlich und erfinde keine Fakten, Quellen oder Zahlen.',
    'Führe nur Aktionen aus, für die tatsächlich eine verbundene und freigegebene Agentenfunktion existiert. Behaupte niemals, eine Aktion ausgeführt zu haben, wenn sie nicht bestätigt wurde. Fordere für kritische Aktionen eine separate Freigabe an.',
    memory ? `Bekannte Fakten über den Nutzer:\n${memory}` : '',
    sources ? `Recherche-Quellen (Wikipedia, nutze sie und nenne sie):\n${sources}` : '',
  ].filter(Boolean).join('\n');
}

const JUDGE_SYSTEM = `Du bist CARVIS, die zentrale Instanz von CARVIS CORE. Mehrere KI-Modelle haben dieselbe Frage beantwortet.
Prüfe ihre Antworten kritisch: erkenne Fehler, Widersprüche und Unsicherheiten. Übernimm nichts ungeprüft.
Schreibe dann EINE bestmögliche, verständliche Antwort auf Deutsch, die die stärksten Teile vereint.
Erwähne die Modelle in der Antwort nicht namentlich.
Füge danach eine Zeile "### PRÜFBERICHT" an und darunter genau ein JSON-Objekt:
{"widersprueche": ["…"], "unsicherheiten": ["…"], "beste_quelle": "A"}`;

function parseJudge(raw) {
  const [answer, report = ''] = String(raw).split(/#{2,4}\s*PR[ÜU]FBERICHT/i);
  let meta = {};
  const m = report.match(/\{[\s\S]*\}/);
  if (m) { try { meta = JSON.parse(m[0]); } catch { /* Bericht nicht lesbar – Antwort trotzdem nutzen */ } }
  return { answer: answer.trim(), contradictions: meta.widersprueche || [], uncertainties: meta.unsicherheiten || [], best: meta.beste_quelle || '' };
}

/**
 * Haupteinstieg.
 * @param opts.mode     'carvis' | 'gpt'
 * @param opts.confirm  async (text, opts) => boolean   – Nutzerbestätigung
 * @param opts.onStage  (text) => void                    – Fortschrittsanzeige
 * @param opts.collab   optional 'always' – Zusammenarbeit nur für diese Anfrage
 * @returns null, wenn kein Modell verfügbar ist
 */
export async function orchestrate(text, { mode = 'gpt', confirm, onStage = () => {}, collab } = {}) {
  const st = store.get();
  // GPT-Modus „Team“: Zusammenarbeit für diese eine Anfrage erzwingen (ohne die Einstellung zu ändern)
  const s = collab ? { ...st.settings, collab, maxExperts: Math.max(2, st.settings.maxExperts || 2) } : st.settings;
  const task = analyze(text);
  onStage(`Analysiere: ${TYPE_LABEL[task.type]}${task.complex ? ' · komplex' : ''}`);

  let { selected, why } = route(task, st.experts, s, mode);
  if (!selected.length) return null;

  // Datenschutz: externe (nicht lokale) Modelle nur mit Zustimmung
  const external = selected.filter((e) => !e.local);
  if (external.length) {
    const sensitive = findSensitive(text);
    if (sensitive.length) {
      const ok = await confirm(`Deine Anfrage enthält möglicherweise sensible Daten (${sensitive.join(', ')}). Sie würde an externe Anbieter gesendet: ${[...new Set(external.map((e) => e.vendorKey))].join(', ')}. Trotzdem senden?`, { ok: 'Trotzdem senden', title: 'Sensible Daten' });
      if (!ok) {
        // Neu auswählen – nur unter lokalen Modellen
        selected = route(task, st.experts.filter((e) => e.local), s, mode).selected;
        why += ' · externe Modelle wegen sensibler Daten ausgelassen';
      }
    }
    const blocked = new Set();
    for (const e of selected.filter((x) => !x.local)) {
      if (st.consents[e.vendorKey] || blocked.has(e.vendorKey)) continue;
      const ok = await confirm(`CC möchte deine Anfrage an „${e.vendorKey}“ senden (${e.label}${e.provider === "proxy" ? ", über deinen Proxy" : ""}). Dort gelten die Datenschutzbedingungen des Anbieters. ${e.cost === 'paid' ? 'ACHTUNG: Dieser Anbieter ist kostenpflichtig. ' : ''}Erlauben? (Wird gespeichert, in den KI-Modellen widerrufbar.)`, { ok: 'Erlauben', title: 'Externer KI-Anbieter', danger: e.cost === 'paid' });
      if (ok) actions.setConsent(e.vendorKey, true);
      else blocked.add(e.vendorKey);
    }
    if (blocked.size) {
      selected = route(task, st.experts.filter((e) => e.local || !blocked.has(e.vendorKey)), s, mode).selected;
      why += ` · ohne ${[...blocked].join(', ')} (nicht freigegeben)`;
    }
    if (!selected.length) return null;
  }

  // Optionale Recherche (Wikipedia) als Faktenbasis
  let sources = [];
  if (task.type === 'research' && s.allowResearch && !findSensitive(text).length) {
    const topic = researchTopic(text);
    onStage(`Recherchiere „${topic}“ (Wikipedia) …`);
    try {
      sources = await wikiSearch(topic, { limit: 2 });
      actions.logAI({ target: 'Wikipedia', model: 'Suche', chars: topic.length, ms: 0, status: 'ok', note: topic });
    } catch (e) {
      actions.logAI({ target: 'Wikipedia', model: 'Suche', chars: topic.length, ms: 0, status: 'error', note: e.message });
    }
  }
  const srcText = sources.map((x, i) => `[${i + 1}] ${x.title}: ${x.extract}`).join('\n');

  const memLines = s.useMemory ? st.memory.slice(0, 20).map((m) => `- ${m.text}`).join('\n') : '';
  const history = st.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.text }));
  if (!history.length || history[history.length - 1].content !== text) history.push({ role: 'user', content: text });

  const buildMessages = (ex) => {
    const mem = ex.local || s.shareMemoryExternal ? memLines : '';
    const hist = ex.local ? history : history.map((h) => ({ ...h, content: redactSecrets(h.content) }));
    return [{ role: 'system', content: systemPrompt({ mode, task, memory: mem, sources: srcText, userName: ex.local || s.shareMemoryExternal ? s.userName : '' }) }, ...hist];
  };

  // 3/4) Befragen. Externe Anbieter parallel; lokale Modelle standardmäßig nacheinander,
  // weil mehrere gleichzeitig laufende lokale Modelle den Arbeitsspeicher überlasten
  // (gemessen: M2 Pro/32 GB, 3 Modelle parallel → nur 2–4 Token/s).
  const cold = selected.some((e) => e.local && !e.stats?.ok);
  const coldNote = cold ? ' – beim ersten Mal muss ein Modell geladen werden, das kann einige Minuten dauern' : '';
  const locals = selected.filter((e) => e.local);
  const sequential = s.localSequential !== false && locals.length > 1;
  onStage((selected.length > 1 ? `Frage ${selected.length} Modelle ${sequential ? 'nacheinander' : 'parallel'}: ${selected.map((e) => e.label).join(', ')}` : `Frage ${selected[0].label} …`) + coldNote);
  const resultOf = new Map();
  const call = (ex) => callExpert(ex, buildMessages(ex), s).then((v) => ({ status: 'fulfilled', value: v }), (e) => ({ status: 'rejected', reason: e }));
  const externalRuns = Promise.all(selected.filter((e) => !e.local || !sequential).map(async (ex) => resultOf.set(ex, await call(ex))));
  if (sequential) {
    for (const [i, ex] of locals.entries()) {
      onStage(`Frage ${ex.label} (${i + 1}/${locals.length} lokal)${!ex.stats?.ok ? coldNote : ''}`);
      resultOf.set(ex, await call(ex));
    }
  }
  await externalRuns;
  const settled = selected.map((ex) => resultOf.get(ex));
  const runs = selected.map((ex, i) => {
    const r = settled[i];
    const chars = buildMessages(ex).reduce((a, m) => a + m.content.length, 0);
    actions.logAI({ target: ex.local ? `lokal · ${ex.provider}` : `extern · ${ex.vendorKey}`, model: ex.model, chars, ms: r.value?.ms ?? 0, status: r.status === 'fulfilled' ? 'ok' : 'error', note: r.reason?.message || '' });
    return r.status === 'fulfilled' ? { ex, ok: true, content: r.value.content, ms: r.value.ms } : { ex, ok: false, error: r.reason?.message || 'Fehler' };
  });
  const good = runs.filter((r) => r.ok);
  if (!good.length) {
    runs.forEach((r) => actions.recordExpert(r.ex.id, { ok: false, error: r.error }));
    const err = new Error(runs.map((r) => `${r.ex.label}: ${r.error}`).join('; '));
    err.runs = runs;
    throw err;
  }

  // 5–7) Bewerten & vergleichen
  onStage(good.length > 1 ? 'Vergleiche und bewerte Antworten …' : 'Prüfe Antwort …');
  good.forEach((r) => (r.q = score(r.content, text, task, good.filter((o) => o !== r).map((o) => o.content))));
  const matrix = agreementMatrix(good.map((r) => r.content));
  const disputedNumbers = good.length > 1 ? numberConflicts(good.map((r) => r.content)) : [];
  const ranking = [...good].sort((a, b) => b.q.total - a.q.total);
  const letters = 'ABCDEFG';
  good.forEach((r, i) => (r.letter = letters[i]));

  // 8) Zusammenführen
  let finalText = ranking[0].content;
  let judge = null;
  let contradictions = [];
  let uncertainties = [];
  let method = good.length > 1 ? 'beste Einzelantwort (höchste Bewertung)' : 'Einzelmodell';
  if (good.length > 1 && s.synthesize) {
    const j = ranking[0].ex; // bestbewertetes Modell führt zusammen
    onStage(`Führe Ergebnisse zusammen (${j.label}) …`);
    const prompt = `Frage des Nutzers:\n${text}\n\n${good.map((r) => `--- Antwort ${r.letter} ---\n${r.content}`).join('\n\n')}`;
    try {
      const out = await callExpert(j, [{ role: 'system', content: JUDGE_SYSTEM + (mode === 'carvis' ? '\nDie Antwort wird vorgelesen: höchstens 4 Sätze.' : '') }, { role: 'user', content: j.local || s.shareMemoryExternal ? prompt : redactSecrets(prompt) }], s);
      actions.logAI({ target: j.local ? `lokal · ${j.provider}` : `extern · ${j.vendorKey}`, model: j.model, chars: prompt.length, ms: out.ms, status: 'ok', note: 'Zusammenführung' });
      const p = parseJudge(out.content);
      if (p.answer.length > 20) {
        finalText = p.answer;
        contradictions = p.contradictions;
        uncertainties = p.uncertainties;
        judge = { label: j.label, ms: out.ms, best: p.best };
        method = `zusammengeführt von ${j.label}`;
      }
    } catch (e) {
      actions.logAI({ target: j.local ? `lokal · ${j.provider}` : `extern · ${j.vendorKey}`, model: j.model, chars: prompt.length, ms: 0, status: 'error', note: `Zusammenführung: ${e.message}` });
      method = `beste Einzelantwort (Zusammenführung fehlgeschlagen: ${e.message})`;
    }
  }

  // Lernen: Messwerte je Modell speichern
  runs.forEach((r) => actions.recordExpert(r.ex.id, r.ok ? { ok: true, score: r.q.total, ms: r.ms, win: r === ranking[0] && good.length > 1 } : { ok: false, error: r.error }));

  const lowAgreement = good.length > 1 && matrix.mean < 0.25;
  const coord = {
    type: 'coord',
    task: { type: TYPE_LABEL[task.type], complex: task.complex },
    why,
    method,
    agreement: good.length > 1 ? Math.round(matrix.mean * 100) : null,
    lowAgreement,
    disputedNumbers,
    contradictions,
    uncertainties,
    sources: sources.map((x) => ({ title: x.title, url: x.url })),
    rows: runs.map((r) => ({
      letter: r.letter || '–',
      label: r.ex.label,
      provider: r.ex.local ? 'lokal' : r.ex.vendorKey,
      cost: COST_LABEL[r.ex.cost],
      ok: r.ok,
      ms: r.ms,
      error: r.error,
      score: r.q?.total,
      parts: r.q?.parts,
      flags: r.q?.flags || [],
      best: r === ranking[0],
    })),
  };
  const models = good.map((r) => r.ex.label);
  return {
    text: finalText,
    blocks: [coord],
    source: good.length > 1 ? 'collab' : 'llm',
    model: good.length > 1 ? `${models.length} Modelle` : models[0],
  };
}
