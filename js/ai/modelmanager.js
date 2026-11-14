// Modellmanager (CARVIS CORE 4.0): ein Statusmodell für alle lokalen KI-Modelle, Hardware-Prüfung,
// Empfehlung einer kostenlosen Grundausstattung und Ein-Klick-Einrichtung – immer mit Zustimmung vor Downloads.
//
// Status je Modell (bewusst getrennt, „installiert“ heißt nicht „aktiv“):
//   verfuegbar     – im Katalog, nicht installiert (Download möglich)
//   installiert    – liegt in Ollama, aber nicht als Experte verbunden
//   verbunden      – als Experte eingerichtet und eingeschaltet
//   geladen        – liegt gerade im Arbeits-/Grafikspeicher (Ollama /api/ps)
//   aktiv          – bearbeitet in diesem Moment eine Anfrage
//   fehlerhaft     – letzter Aufruf gescheitert
//   inkompatibel   – zu wenig Arbeitsspeicher für dieses Modell
import { store, actions } from '../store.js';
import { ollamaRequest, discoverOllama, makeExpert, activeExperts } from './providers.js';
import { agentClient } from '../agent-client.js';

const GB = 1024 ** 3;

/** Kostenlose Startmodelle mit Lizenz, Größe (ca., laut Ollama-Bibliothek) und Mindest-RAM.
 *  Nur Lizenzen, die eine spätere kommerzielle Nutzung von CARVIS CORE erlauben. */
export const STARTER = [
  { name: 'qwen2.5:0.5b', label: 'Qwen2.5 0.5B', sizeGB: 0.4, minRamGB: 4, license: 'Apache-2.0', commercial: true, note: 'sehr klein, einfache Fragen' },
  { name: 'qwen2.5:1.5b', label: 'Qwen2.5 1.5B', sizeGB: 1.0, minRamGB: 6, license: 'Apache-2.0', commercial: true, note: 'schnell, guter Einstieg' },
  { name: 'llama3.2:3b', label: 'Llama 3.2 3B', sizeGB: 2.0, minRamGB: 8, license: 'Llama 3.2 Community License', commercial: true, note: 'ausgewogen; Lizenzauflagen beachten (Namensnennung, Nutzungsrichtlinie)' },
  { name: 'qwen2.5:7b', label: 'Qwen2.5 7B', sizeGB: 4.7, minRamGB: 16, license: 'Apache-2.0', commercial: true, note: 'beste Qualität der Liste' },
  { name: 'qwen2.5-coder:7b', label: 'Qwen2.5-Coder 7B', sizeGB: 4.7, minRamGB: 16, license: 'Apache-2.0', commercial: true, note: 'Programmieren' },
];

/** Empfehlung nach Arbeitsspeicher (konservativ: Modell + System + App müssen gleichzeitig passen). */
export function recommend(ramGB) {
  if (!ramGB) return STARTER[1];
  const fit = STARTER.filter((m) => m.name !== 'qwen2.5-coder:7b' && m.minRamGB <= ramGB);
  return fit[fit.length - 1] || null;
}

let cache = { hw: null, ollama: null, at: 0 };

/** Hardware: in der Windows-App über den Agenten (echte Werte), im Browser nur, was der Browser verrät. */
export async function detectHardware() {
  let hw = null;
  if (agentClient.connected) {
    try { hw = await agentClient.hardware(); hw.source = 'agent'; } catch { hw = null; }
  }
  if (!hw) {
    hw = { source: 'browser', cores: navigator.hardwareConcurrency || null, memory: navigator.deviceMemory ? { total: navigator.deviceMemory * GB, approx: true } : null, gpu: null, diskFree: null, ollama: null };
    try { const est = await navigator.storage?.estimate?.(); if (est?.quota) hw.browserQuota = est.quota - (est.usage || 0); } catch { /* egal */ }
  }
  hw.webgpu = !!navigator.gpu;
  if (navigator.gpu) { try { hw.webgpuAdapter = !!(await navigator.gpu.requestAdapter()); } catch { hw.webgpuAdapter = false; } }
  hw.ramGB = hw.memory?.total ? Math.round(hw.memory.total / GB) : null;
  return hw;
}

/** Ollama-Zustand: läuft? Version, installierte und geladene Modelle. Wirft keine Fehler. */
export async function ollamaState() {
  const url = store.get().settings.ollamaUrl;
  const out = { running: false, version: null, installed: [], loaded: [], error: '' };
  try {
    out.version = (await (await ollamaRequest(url, '/api/version', { timeout: 4000 })).json()).version || null;
    out.running = true;
    const tags = await (await ollamaRequest(url, '/api/tags', { timeout: 8000 })).json();
    out.installed = (tags.models || []).filter((m) => !/embed/i.test(m.name)).map((m) => ({ name: m.name, size: m.size || 0, params: m.details?.parameter_size || '', quant: m.details?.quantization_level || '' }));
    try { out.loaded = ((await (await ollamaRequest(url, '/api/ps', { timeout: 4000 })).json()).models || []).map((m) => ({ name: m.name, size: m.size || 0, vram: m.size_vram || 0 })); } catch { /* ältere Ollama-Version */ }
  } catch (e) { out.error = e.message; }
  return out;
}

/** Eine Zeile je Modell mit eindeutigem Status. */
export function modelRows({ hw, ollama }) {
  const st = store.get();
  const ram = hw?.ramGB;
  const byName = new Map();
  for (const m of ollama?.installed || []) byName.set(m.name, { name: m.name, label: m.name, size: m.size, installed: true });
  for (const c of STARTER) if (!byName.has(c.name)) byName.set(c.name, { name: c.name, label: c.label, size: c.sizeGB * GB, installed: false });
  return [...byName.values()].map((m) => {
    const cat = STARTER.find((c) => c.name === m.name);
    const ex = st.experts.find((e) => e.provider === 'ollama' && e.model === m.name);
    const loaded = (ollama?.loaded || []).find((l) => l.name === m.name);
    const tooBig = cat && ram && cat.minRamGB > ram;
    let status;
    if (ex && activeExperts.has(ex.id)) status = 'aktiv';
    else if (ex && ex.status === 'error') status = 'fehlerhaft';
    else if (loaded) status = 'geladen';
    else if (ex && ex.enabled) status = 'verbunden';
    else if (m.installed) status = 'installiert';
    else if (tooBig) status = 'inkompatibel';
    else status = 'verfuegbar';
    return { ...m, cat, expert: ex || null, loaded: loaded || null, status, tooBig: !!tooBig };
  });
}

export const STATUS_LABEL = { verfuegbar: 'Verfügbar', installiert: 'Installiert', verbunden: 'Verbunden', geladen: 'Geladen', aktiv: 'Aktiv', fehlerhaft: 'Fehlerhaft', inkompatibel: 'Nicht kompatibel' };
export const STATUS_LED = { verfuegbar: 'idle', installiert: 'warn', verbunden: 'ok', geladen: 'ok', aktiv: 'ok', fehlerhaft: 'danger', inkompatibel: 'danger' };

/** Lädt ein Modell herunter (Ollama /api/pull, Fortschritt als NDJSON). Nur nach Zustimmung aufrufen. */
export async function pullModel(name, { onProgress = () => {}, signal } = {}) {
  if (!/^[a-z0-9][a-z0-9._-]*(:[a-z0-9._-]+)?$/i.test(name)) throw new Error('ungültiger Modellname');
  const res = await ollamaRequest(store.get().settings.ollamaUrl, '/api/pull', { method: 'POST', body: { model: name, stream: true }, signal, timeout: 0 });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', last = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      const d = JSON.parse(line);
      if (d.error) throw new Error(d.error);
      last = d;
      onProgress({ status: d.status, pct: d.total ? Math.round((d.completed || 0) / d.total * 100) : null, total: d.total || null });
    }
  }
  if (last?.status !== 'success') throw new Error('Download nicht abgeschlossen');
  await connectInstalled();
  return true;
}

/** Installierte Ollama-Modelle als Experten verbinden (wie beim Start). Gibt die Zahl neuer Verbindungen zurück. */
export async function connectInstalled() {
  const names = await discoverOllama(store.get().settings.ollamaUrl);
  const known = new Set(store.get().experts.map((e) => e.id));
  const fresh = names.map((n) => makeExpert({ provider: 'ollama', vendorKey: 'ollama', model: n, label: `${n} · Ollama`, cost: 'free', local: true })).filter((e) => !known.has(e.id));
  fresh.forEach((e) => actions.upsertExpert(e));
  return fresh.length;
}

/** Modell in den Speicher laden bzw. daraus entfernen (Ollama keep_alive). Löscht nichts. */
export async function setLoaded(name, load) {
  await ollamaRequest(store.get().settings.ollamaUrl, '/api/generate', { method: 'POST', body: { model: name, prompt: '', keep_alive: load ? '30m' : 0, stream: false }, timeout: load ? 300000 : 15000 });
}

/** Modell von der Festplatte löschen – nur nach ausdrücklicher Bestätigung aufrufen. */
export async function deleteModel(name) {
  await ollamaRequest(store.get().settings.ollamaUrl, '/api/delete', { method: 'DELETE', body: { model: name }, timeout: 30000 });
  const ex = store.get().experts.find((e) => e.provider === 'ollama' && e.model === name);
  if (ex) actions.removeExpert(ex.id);
}

/** Alles auf einmal (für Ansicht und Dashboard), mit kurzem Zwischenspeicher. */
export async function snapshot({ fresh = false } = {}) {
  if (!fresh && cache.hw && Date.now() - cache.at < 15000) return cache;
  const [hw, ollama] = await Promise.all([detectHardware(), ollamaState()]);
  cache = { hw, ollama, at: Date.now() };
  return cache;
}
export const lastSnapshot = () => cache;
