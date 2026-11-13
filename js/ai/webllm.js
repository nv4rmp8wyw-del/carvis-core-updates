// KI direkt im Browser (WebLLM + WebGPU): kein Konto, kein Schlüssel, keine Daten verlassen das Gerät.
// Das Modell wird einmalig von Hugging Face geladen und im Browser-Cache gespeichert.
// Die Berechnung läuft in einem Web Worker, damit die Oberfläche flüssig bleibt.

export const WEBLLM_VERSION = '0.2.86';
const CDN = `https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@${WEBLLM_VERSION}/+esm`;

export const BROWSER_MODELS = [
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', name: 'Qwen2.5 1.5B', vramMB: 1630, recommended: true,
    note: 'Empfohlen – gut auf Deutsch, läuft auch auf Smartphones mit WebGPU',
    strengths: { code: 0.5, reasoning: 0.5, planning: 0.55, creative: 0.55, research: 0.5, chat: 0.62 },
  },
  {
    id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', name: 'Qwen2.5 3B', vramMB: 2505,
    note: 'Stärker, braucht mehr Speicher – für PC/Mac',
    strengths: { code: 0.58, reasoning: 0.58, planning: 0.62, creative: 0.62, research: 0.58, chat: 0.68 },
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', name: 'Llama 3.2 1B', vramMB: 880,
    note: 'Sehr klein und schnell, deutlich schwächer',
    strengths: { code: 0.4, reasoning: 0.4, planning: 0.45, creative: 0.5, research: 0.4, chat: 0.55 },
  },
];

let lib = null;
let engine = null;
let loadedId = null;
let loading = null;
const listeners = new Set();
export const progress = { active: false, id: null, value: 0, text: '' };

/** Fortschritt beim Herunterladen/Laden beobachten. */
export function onProgress(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(p) { Object.assign(progress, p); listeners.forEach((fn) => fn({ ...progress })); }

export async function webgpuStatus() {
  if (!('gpu' in navigator)) return { ok: false, reason: 'Dieser Browser unterstützt kein WebGPU (aktuelles Chrome, Edge oder Safari nötig).' };
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { ok: false, reason: 'Keine geeignete Grafikeinheit gefunden.' };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

async function getLib() {
  if (!lib) {
    try { lib = await import(CDN); }
    catch { throw new Error('WebLLM konnte nicht geladen werden (Internetverbindung?)'); }
  }
  return lib;
}

export async function isCached(id) {
  try { return await (await getLib()).hasModelInCache(id); } catch { return false; }
}

/** Lädt ein Modell (beim ersten Mal inkl. Download) in den Grafikspeicher. */
export async function load(id) {
  if (engine && loadedId === id) return engine;
  while (loading) await loading.catch(() => {});
  loading = (async () => {
    const l = await getLib();
    const cb = (r) => emit({ active: true, id, value: Math.round((r.progress || 0) * 100), text: r.text || '' });
    emit({ active: true, id, value: 0, text: 'Starte …' });
    try {
      if (!engine) {
        const worker = new Worker(new URL('./webllm-worker.js', import.meta.url), { type: 'module' });
        engine = await l.CreateWebWorkerMLCEngine(worker, id, { initProgressCallback: cb });
      } else {
        engine.setInitProgressCallback?.(cb);
        await engine.reload(id);
      }
      loadedId = id;
      emit({ active: false, id, value: 100, text: 'bereit' });
      return engine;
    } catch (e) {
      emit({ active: false, id, value: 0, text: `Fehler: ${e.message}` });
      throw e;
    }
  })();
  try { return await loading; } finally { loading = null; }
}

// WebLLM erwartet abwechselnde Rollen – aufeinanderfolgende gleiche Rollen zusammenfassen
function normalize(messages) {
  const out = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last && last.role === m.role && m.role !== 'system') last.content += `\n\n${m.content}`;
    else out.push({ role: m.role, content: m.content });
  }
  const sys = out.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const rest = out.filter((m) => m.role !== 'system');
  while (rest.length && rest[0].role !== 'user') rest.shift();
  return sys ? [{ role: 'system', content: sys }, ...rest] : rest;
}

export async function chat(id, messages, { timeout = 300000 } = {}) {
  const run = (async () => {
    const e = await load(id);
    const r = await e.chat.completions.create({ messages: normalize(messages), temperature: 0.6, max_tokens: 1024 });
    return r.choices?.[0]?.message?.content || '';
  })();
  let timer;
  const limit = new Promise((_, rej) => (timer = setTimeout(() => rej(new Error('Zeitüberschreitung')), timeout)));
  try { return await Promise.race([run, limit]); } finally { clearTimeout(timer); }
}

export async function removeModel(id) {
  if (loadedId === id) { try { await engine?.unload?.(); } catch { /* ignorieren */ } loadedId = null; }
  await (await getLib()).deleteModelAllInfoInCache(id);
}
