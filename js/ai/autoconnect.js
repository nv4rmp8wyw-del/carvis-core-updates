// KI-Verbindungsmanager (CARVIS CORE 4.1, Master-Auftrag §004/§005).
// Ablauf beim Start (und auf Knopfdruck „KI verbinden“):
//   1 Hardware erkennen → 2 Ollama vorhanden/erreichbar? → 3 installierte Modelle → 4 passendes Modell wählen
//   → 5 als Modell verbinden → 6 ECHTEN Testprompt senden → 7 erst bei echter Antwort „KI bereit“.
// Fehlt Ollama oder ein Modell: verständliche Ein-Klick-Einrichtung (Download nur nach Zustimmung, Größe sichtbar,
// Fortschritt, danach automatisch verbinden und testen). Keine Cloud-APIs, keine Schlüssel, keine Kosten.
// Baut auf dem Modellmanager (js/ai/modelmanager.js) und der Ollama-Anbindung (js/ai/providers.js) auf.
import { store, actions } from '../store.js';
import { detectHardware, ollamaState, recommend, pullModel, STARTER } from './modelmanager.js';
import { makeExpert, callExpert, CHECK_TOKENS } from './providers.js';
import { answering } from './busy.js';
import { t } from '../i18n.js';

// Anzeigenamen der Phasen kommen aus dem Sprachsystem (ai.phase.<phase>) – PHASE[x] bleibt wie bisher nutzbar
export const PHASE = new Proxy({}, { get: (_, k) => (typeof k === 'string' ? t(`ai.phase.${k}`) : undefined) });
const SLOW = /deepseek-r1|qwq|reason|magistral|embed/i;
const subs = new Set();
export const ai = { servers: {}, ollama: null, phase: 'idle', model: '', detail: '', hw: null, installed: [], recommended: null, verifiedAt: 0, ms: 0, progress: null, running: false };
const set = (patch) => { Object.assign(ai, patch); subs.forEach((f) => { try { f(ai); } catch { /* Abonnent */ } }); };
export const onAI = (f) => { subs.add(f); return () => subs.delete(f); };
export const aiReady = () => ai.phase === 'bereit';

// Weitere kostenlose lokale Engines mit OpenAI-kompatibler Schnittstelle (ohne Schlüssel). Werden genutzt, wenn Ollama
// fehlt, kein Modell hat oder keines antwortet – „bereit“ erst nach echter Testantwort, wie bei Ollama.
export const LOCAL_SERVERS = [
  { name: 'LM Studio', base: 'http://127.0.0.1:1234' },
  { name: 'llama.cpp', base: 'http://127.0.0.1:8080' },
];
async function serverModels(base, ms = 2500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`${base}/v1/models`, { signal: ctrl.signal });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.data || d.models || []).map((m) => String(m.id || m.name || '')).filter((id) => id && !/embed/i.test(id));
  } catch { return []; } finally { clearTimeout(t); }
}
/** Sucht LM Studio / llama.cpp, verbindet das erste Modell, das eine ECHTE Testantwort liefert. */
export async function connectLocalServers() {
  const list = store.get().settings.localServers || LOCAL_SERVERS;
  for (const srv of list) {
    const ids = await serverModels(srv.base);
    set({ servers: { ...(ai.servers || {}), [srv.name]: ids.length ? 'found' : 'none' } }); // ehrlicher Einzelstatus fürs Dashboard
    for (const id of ids.slice(0, 2)) {
      let ex = makeExpert({ provider: 'openai', vendorKey: 'openai-compat', model: id, endpoint: `${srv.base}/v1/chat/completions`, label: `${id} · ${srv.name}`, cost: 'free', local: true });
      if (!store.get().experts.some((e) => e.id === ex.id)) actions.upsertExpert(ex);
      ex = store.get().experts.find((e) => e.id === ex.id);
      if (!ex.enabled) actions.updateExpert(ex.id, { enabled: true });
      set({ phase: 'testen', model: id, detail: t('ai.realTest', { model: `${id} (${srv.name})` }) });
      try {
        await answering.idle();
        const t0 = performance.now();
        const r = await callExpert(ex, [{ role: 'user', content: 'Antworte nur mit dem Wort OK.' }], store.get().settings, { timeout: 60000, maxTokens: CHECK_TOKENS });
        if (!String(r?.content || '').trim()) throw new Error('leere Antwort');
        const ms = Math.round(performance.now() - t0);
        actions.recordExpert(ex.id, { ok: true, ms });
        return { model: id, server: srv.name, ms };
      } catch (e) {
        actions.recordExpert(ex.id, { ok: false, error: e.message });
      }
    }
  }
  return null;
}

/** Größe in GB grob aus dem Ollama-Eintrag (Bytes) */
const gb = (b) => (b ? Math.round((b / 1024 ** 3) * 10) / 10 : null);

/** Reihenfolge für die Auswahl unter installierten Modellen: zuletzt bestätigtes > passt in den RAM > Empfehlungsliste > klein. */
export function rankInstalled(installed, ramGB, preferred = '') {
  const order = STARTER.map((m) => m.name);
  const budget = ramGB ? ramGB * 0.5 : 8; // höchstens etwa die Hälfte des RAM für das Modell
  return installed
    .filter((m) => !/embed/i.test(m.name))
    .map((m) => {
      const size = gb(m.size) || 1;
      let score = 0;
      if (preferred && (m.name === preferred || m.name === `${preferred}:latest`)) score += 100;
      if (size <= budget) score += 20; else score -= 30;
      const i = order.indexOf(m.name);
      if (i >= 0) score += 10 + i; // größere Empfehlungen zuerst, solange sie passen
      if (SLOW.test(m.name)) score -= 15; // Denk-Modelle sind für Gespräche zu langsam
      score += Math.min(size, budget) / 2; // im Budget lieber etwas größer (bessere Antworten)
      return { name: m.name, size, score };
    })
    .sort((a, b) => b.score - a.score);
}

function ensureExpert(model) {
  let ex = store.get().experts.find((e) => e.provider === 'ollama' && e.model === model);
  if (!ex) { ex = makeExpert({ provider: 'ollama', vendorKey: 'ollama', model, label: `${model} · Ollama`, cost: 'free', local: true }); actions.upsertExpert(ex); }
  if (!ex.enabled) actions.updateExpert(ex.id, { enabled: true });
  return store.get().experts.find((e) => e.id === ex.id);
}

/** Echter Testprompt: zählt nur, wenn das Modell wirklich Text liefert. */
export async function testModel(model, { timeout = 120000 } = {}) {
  await answering.idle();
  const ex = ensureExpert(model);
  const t0 = performance.now();
  const r = await callExpert(ex, [{ role: 'user', content: 'Antworte nur mit dem Wort OK.' }], store.get().settings, { timeout, maxTokens: CHECK_TOKENS });
  const ms = Math.round(performance.now() - t0);
  if (!r || !String(r.content || '').trim()) throw new Error('leere Antwort');
  actions.recordExpert(ex.id, { ok: true, ms });
  return { ms, content: String(r.content).trim().slice(0, 60) };
}

/**
 * Prüft und verbindet automatisch. Gibt den Endzustand zurück.
 * @param opts.force  auch dann neu prüfen, wenn bereits bereit
 */
export async function autoConnectAI({ force = false } = {}) {
  if (ai.running) return ai;
  if (ai.phase === 'bereit' && !force) return ai;
  set({ running: true, phase: 'pruefen', detail: '' });
  try {
    const hw = await detectHardware().catch(() => ({}));
    const rec = recommend(hw.ramGB);
    set({ hw, recommended: rec });
    const o = await ollamaState();
    set({ installed: o.installed, ollama: o.running ? (o.installed.length ? 'found' : 'empty') : 'none' });
    // Ausweichlösung: andere kostenlose lokale Engine (LM Studio, llama.cpp), echt getestet
    const fallback = async () => {
      const f = await connectLocalServers();
      if (!f) return null;
      actions.setSettings({ aiAuto: { model: f.model, verifiedAt: Date.now(), ms: f.ms } });
      return set({ phase: 'bereit', model: f.model, ms: f.ms, verifiedAt: Date.now(), server: f.server, engine: true, detail: t('ai.answeredVia', { model: f.model, server: f.server, s: (f.ms / 1000).toFixed(1) }) }), ai;
    };
    if (!o.running) return (await fallback()) || (set({ phase: 'kein-ollama', engine: false, detail: t('ai.ollamaMissing') }), ai);
    if (!o.installed.length) return (await fallback()) || (set({ phase: 'kein-modell', engine: true, detail: rec ? t('ai.recommended', { label: rec.label, gb: rec.sizeGB }) : t('ai.tooLittleRam') }), ai);
    const s = store.get().settings;
    const pref = s.modelChoice && s.modelChoice !== 'auto' ? (store.get().experts.find((e) => e.id === s.modelChoice)?.model || '') : (s.aiAuto?.model || '');
    const candidates = rankInstalled(o.installed, hw.ramGB, pref).slice(0, 3);
    let lastErr = '';
    const failed = [];
    for (const c of candidates) {
      set({ phase: 'verbinden', model: c.name, detail: `${c.name} (${c.size} GB)` });
      ensureExpert(c.name);
      set({ phase: 'testen', engine: true, detail: t('ai.realTest', { model: c.name }) });
      try {
        const r = await testModel(c.name);
        actions.setSettings({ aiAuto: { model: c.name, verifiedAt: Date.now(), ms: r.ms } });
        failed.forEach((f) => { const ex = store.get().experts.find((x) => x.provider === 'ollama' && x.model === f.model); if (ex) actions.updateExpert(ex.id, { lastError: `Automatik: ${f.error}` }); });
        if (lastErr) import('../health.js').then(({ logEvent }) => logEvent(`KI: ${lastErr.split(':')[0]} antwortete nicht – automatisch auf ${c.name} gewechselt (echt getestet)`, true)).catch(() => {});
        return set({ phase: 'bereit', model: c.name, ms: r.ms, verifiedAt: Date.now(), server: 'Ollama', engine: true, detail: t('ai.answered', { model: c.name, s: (r.ms / 1000).toFixed(1) }) }), ai;
      } catch (e) {
        lastErr = `${c.name}: ${e.message}`;
        failed.push({ model: c.name, error: e.message });
      }
    }
    // Erst wenn KEIN Modell antwortet, gelten die Modelle als fehlerhaft (sonst ist der Wechsel die Reparatur)
    failed.forEach((f) => { const ex = store.get().experts.find((x) => x.provider === 'ollama' && x.model === f.model); if (ex) actions.recordExpert(ex.id, { ok: false, error: f.error }); });
    const alt = await fallback();
    if (alt) return alt;
    return set({ phase: 'fehler', engine: true, detail: t('ai.noneAnswered', { err: lastErr }) }), ai;
  } catch (e) {
    return set({ phase: 'fehler', detail: e.message }), ai;
  } finally { set({ running: false }); }
}

/** Ein-Klick-Einrichtung eines Modells (nur nach Zustimmung aufrufen): laden, verbinden, echt testen. */
export async function setupModel(name, { signal } = {}) {
  set({ phase: 'laden', model: name, progress: { pct: 0 }, detail: t('ai.loadingModel', { model: name }) });
  try {
    await pullModel(name, { signal, onProgress: (p) => set({ progress: p, detail: t('ai.loadingPct', { model: name, pct: p.pct ?? 0 }) }) });
  } catch (e) {
    set({ phase: 'kein-modell', progress: null, detail: t('ai.pullFailed', { err: e.message }) });
    throw e;
  }
  set({ progress: null });
  actions.setSettings({ aiAuto: { model: name, verifiedAt: 0 } });
  return autoConnectAI({ force: true });
}

/** Nach „Ollama installieren“: alle 5 s nachsehen, ob Ollama läuft (höchstens maxMs), dann automatisch weiter. */
export async function waitForOllama({ maxMs = 15 * 60 * 1000, signal } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs && !signal?.aborted) {
    const o = await ollamaState();
    if (o.running) return autoConnectAI({ force: true });
    set({ detail: t('ai.waitOllama') });
    await new Promise((r) => setTimeout(r, 5000));
  }
  return ai;
}

/** Offizielle Bezugsquelle für Ollama (kostenlos). Es wird nichts ohne Klick des Nutzers geladen. */
export const OLLAMA_DOWNLOAD = 'https://ollama.com/download';

/**
 * Ein-Klick-Einrichtung von Ollama über den lokalen Agenten (nur Windows-App, D-053). Der Agent führt ausschließlich
 * „winget install --id Ollama.Ollama“ aus der offiziellen Quelle aus – erst nach Plan, Vorschau und dieser Freigabe.
 * Rückgabe: { ok: true } nach erfolgreicher Installation, sonst { ok: false, reason } (dann manueller Weg).
 * Aufrufer muss vorher die Zustimmung des Nutzers eingeholt haben.
 */
export async function installOllama({ onStatus = () => {}, maxMs = 25 * 60 * 1000 } = {}) {
  const { agentClient } = await import('../agent-client.js');
  if (!agentClient.connected) return { ok: false, reason: 'agent' };
  let plan;
  try { plan = await agentClient.ultPlan('Ollama einrichten', [{ op: 'setup_ollama' }]); } catch (e) { return { ok: false, reason: e.message }; }
  try { await agentClient.ultApprove(plan.id); } catch (e) { return { ok: false, reason: e.message }; }
  onStatus('running');
  set({ phase: 'pruefen', detail: t('ai.installRunning') });
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 3000));
    let job;
    try { job = (await agentClient.ultJob(plan.id)).job; } catch { continue; }
    if (!job || job.status === 'läuft') continue;
    if (job.status === 'fertig') { onStatus('done'); return { ok: true }; }
    const err = job.steps?.find((s) => s.error)?.error || job.status;
    set({ phase: 'kein-ollama', detail: t('ai.ollamaMissing') });
    return { ok: false, reason: err };
  }
  return { ok: false, reason: 'timeout' };
}
