// Einheitliche Schnittstelle für alle KI-Anbieter.
// Jedes "Expertenmodell" (Expert) wird über genau einen Adapter angesprochen:
//   ollama  – lokales Ollama (kostenlos, ohne Schlüssel)
//   openai  – beliebiger OpenAI-kompatibler Endpunkt ohne Schlüssel (z. B. LM Studio, lokal)
//   proxy   – eigener CCC-Proxy (z. B. Cloudflare Worker). Die API-Schlüssel liegen NUR dort.
// Neue Anbieter: Eintrag in CATALOG + ggf. Adapter in callExpert() bzw. im Proxy ergänzen.

export const CATALOG = [
  { key: 'webllm', name: 'KI im Browser (dieses Gerät)', vendor: 'WebLLM + WebGPU: Qwen2.5, Llama 3.2', how: 'local', cost: 'free', costNote: '0 € – kein Konto, Daten bleiben auf dem Gerät' },
  { key: 'ollama', name: 'Ollama (lokal)', vendor: 'Open Source: Llama, Mistral, DeepSeek, Gemma, Qwen …', how: 'local', cost: 'free', costNote: '0 € – läuft auf deinem Rechner' },
  { key: 'openai-compat', name: 'LM Studio / lokaler Server', vendor: 'OpenAI-kompatibel, ohne Schlüssel', how: 'local', cost: 'free', costNote: '0 € – lokal' },
  { key: 'gemini', name: 'Google Gemini', vendor: 'Google', how: 'proxy', cost: 'free-tier', costNote: 'Kostenloses Kontingent laut Anbieter – Bedingungen selbst prüfen' },
  { key: 'groq', name: 'Groq', vendor: 'Llama, Mistral u. a. (gehostet)', how: 'proxy', cost: 'free-tier', costNote: 'Kostenloses Kontingent laut Anbieter – Bedingungen selbst prüfen' },
  { key: 'openrouter', name: 'OpenRouter', vendor: 'u. a. kostenlose DeepSeek-/Llama-Varianten', how: 'proxy', cost: 'free-tier', costNote: 'Nur Modelle mit „:free“ sind kostenlos' },
  { key: 'mistral', name: 'Mistral AI', vendor: 'Mistral', how: 'proxy', cost: 'free-tier', costNote: 'Kostenloses Kontingent laut Anbieter – Bedingungen selbst prüfen' },
  { key: 'openai', name: 'OpenAI GPT', vendor: 'OpenAI', how: 'proxy', cost: 'paid', costNote: 'Kostenpflichtig pro Anfrage' },
  { key: 'anthropic', name: 'Anthropic Claude', vendor: 'Anthropic', how: 'proxy', cost: 'paid', costNote: 'Kostenpflichtig pro Anfrage' },
  { key: 'xai', name: 'xAI Grok', vendor: 'xAI', how: 'proxy', cost: 'paid', costNote: 'Kostenpflichtig pro Anfrage' },
  { key: 'deepseek', name: 'DeepSeek API', vendor: 'DeepSeek', how: 'proxy', cost: 'paid', costNote: 'Kostenpflichtig pro Anfrage (Open-Weights-Modelle auch lokal über Ollama)' },
];

export const COST_LABEL = { free: 'kostenlos', 'free-tier': 'Kontingent, Kosten möglich', paid: 'kostenpflichtig' };

// Startwerte (Annahmen!) für die Eignung je Aufgabentyp. Sie werden mit echten Messwerten
// aus der Qualitätsbewertung verrechnet, sobald genug Anfragen gelaufen sind.
const PRIORS = [
  [/claude/i, { code: 0.95, reasoning: 0.95, planning: 0.95, creative: 0.9, research: 0.85, chat: 0.9 }],
  [/gpt|^o\d/i, { code: 0.92, reasoning: 0.92, planning: 0.9, creative: 0.9, research: 0.85, chat: 0.9 }],
  [/gemini/i, { code: 0.85, reasoning: 0.88, planning: 0.85, creative: 0.85, research: 0.93, chat: 0.85 }],
  [/grok/i, { code: 0.85, reasoning: 0.88, planning: 0.8, creative: 0.85, research: 0.85, chat: 0.85 }],
  [/deepseek-r1|qwq|reason/i, { code: 0.82, reasoning: 0.92, planning: 0.85, creative: 0.55, research: 0.7, chat: 0.55 }],
  [/coder|codestral|devstral|starcoder|codellama/i, { code: 0.92, reasoning: 0.7, planning: 0.65, creative: 0.35, research: 0.45, chat: 0.45 }],
  [/deepseek/i, { code: 0.85, reasoning: 0.85, planning: 0.8, creative: 0.7, research: 0.75, chat: 0.75 }],
  [/qwen/i, { code: 0.8, reasoning: 0.78, planning: 0.75, creative: 0.7, research: 0.72, chat: 0.75 }],
  [/mistral|mixtral|magistral/i, { code: 0.72, reasoning: 0.72, planning: 0.72, creative: 0.8, research: 0.7, chat: 0.82 }],
  [/llama/i, { code: 0.7, reasoning: 0.7, planning: 0.72, creative: 0.78, research: 0.7, chat: 0.82 }],
  [/gemma/i, { code: 0.65, reasoning: 0.68, planning: 0.68, creative: 0.75, research: 0.68, chat: 0.8 }],
  [/phi|tinyllama|smol/i, { code: 0.55, reasoning: 0.55, planning: 0.5, creative: 0.5, research: 0.45, chat: 0.65 }],
];
const DEFAULT_PRIOR = { code: 0.6, reasoning: 0.6, planning: 0.6, creative: 0.6, research: 0.6, chat: 0.6 };

export const priorFor = (model) => ({ ...(PRIORS.find(([re]) => re.test(model))?.[1] || DEFAULT_PRIOR) });

export function makeExpert({ provider, vendorKey, model, endpoint = '', label, cost = 'free', local = true }) {
  return {
    id: `${provider}:${vendorKey || ''}:${model}`,
    provider,
    vendorKey: vendorKey || provider,
    model,
    endpoint,
    label: label || model,
    cost,
    local,
    enabled: cost !== 'paid', // kostenpflichtige Modelle nie automatisch aktivieren
    status: 'unknown',
    lastError: '',
    strengths: priorFor(model),
    stats: { calls: 0, ok: 0, scoreSum: 0, msSum: 0, wins: 0 },
  };
}

/** Eignung eines Modells für einen Aufgabentyp: Startwert + gemessene Qualität. */
export function suitability(ex, type) {
  const prior = ex.strengths?.[type] ?? 0.6;
  const s = ex.stats || {};
  if (!s.ok || s.ok < 3) return prior;
  const measured = s.scoreSum / s.ok / 100;
  return prior * 0.6 + measured * 0.4;
}

// ------------------------------------------------------------------
// Adapter
// ------------------------------------------------------------------
// Windows-App: Ollama wird über den integrierten Agenten erreicht (kein CORS-Problem, Token-geschützt).
// Im Browser bleibt es bei der eingestellten Ollama-Adresse.
let gateway = null;
export function setOllamaGateway(base, token) { gateway = base ? { base: String(base).replace(/\/+$/, '') + '/ollama', headers: { Authorization: `Bearer ${token}` } } : null; }
export const ollamaViaAgent = () => !!gateway;
const ollamaRoute = (url) => (gateway ? gateway : { base: trimSlash(url), headers: {} });

async function post(url, body, timeout, extSignal, headers = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  extSignal?.addEventListener('abort', () => ctrl.abort());
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || data?.error || `HTTP ${res.status}`);
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(extSignal?.aborted ? 'abgebrochen' : 'Zeitüberschreitung');
    if (e instanceof TypeError) throw new Error('keine Verbindung / CORS');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function getJSON(url, timeout = 8000, headers = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Zeitüberschreitung');
    if (e instanceof TypeError) throw new Error('keine Verbindung / CORS');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const trimSlash = (u) => String(u || '').replace(/\/+$/, '');
// Längengrenze für lokale Modelle: sehr kleine Modelle hören sonst manchmal nicht auf (Wiederholungsschleifen).
export const MAX_TOKENS = 2048;
export const CHECK_TOKENS = 32; // kurze Verbindungsprüfungen („Antworte nur mit OK“)

/**
 * Ruft ein Expertenmodell auf. Einheitliches Ergebnis: { content, ms, model }.
 * @param settings  { ollamaUrl, proxyUrl }
 */
export async function callExpert(ex, messages, settings, { timeout, signal, onToken, maxTokens = MAX_TOKENS } = {}) {
  // Lokale Modelle: großzügiges Limit, da das erste Laden in den Speicher Minuten dauern kann.
  // Ein Abbruch während des Ladens zwingt Ollama sonst, von vorn zu beginnen.
  timeout ??= ex.local ? 300000 : 120000;
  const t0 = performance.now();
  activeExperts.add(ex.id);
  try { return await callExpertInner(ex, messages, settings, { timeout, signal, t0, onToken, maxTokens }); } finally { activeExperts.delete(ex.id); }
}

async function callExpertInner(ex, messages, settings, { timeout, signal, t0, onToken, maxTokens }) {
  let content;
  if (ex.provider === 'ollama' && onToken) {
    content = await ollamaStream(ex, messages, settings, { timeout, signal, onToken, maxTokens });
  } else if (ex.provider === 'ollama') {
    const r = ollamaRoute(settings.ollamaUrl);
    const d = await post(`${r.base}/api/chat`, { model: ex.model, messages, stream: false, keep_alive: '30m', options: { num_predict: maxTokens } }, timeout, signal, r.headers);
    content = d?.message?.content;
  } else if (ex.provider === 'openai') {
    const d = await post(ex.endpoint, { model: ex.model, messages, stream: false, max_tokens: maxTokens }, timeout, signal);
    content = d?.choices?.[0]?.message?.content ?? d?.message?.content;
  } else if (ex.provider === 'webllm') {
    const { chat } = await import('./webllm.js');
    content = await chat(ex.model, messages, { timeout });
  } else if (ex.provider === 'proxy') {
    if (!settings.proxyUrl) throw new Error('kein Proxy eingerichtet');
    const d = await post(`${trimSlash(settings.proxyUrl)}/chat`, { provider: ex.vendorKey, model: ex.model, messages }, timeout, signal);
    content = d?.content;
  } else {
    throw new Error(`unbekannter Adapter ${ex.provider}`);
  }
  if (!content || !String(content).trim()) throw new Error('leere Antwort');
  // Manche Reasoning-Modelle liefern ihre Gedanken in <think>…</think> mit – nicht anzeigen.
  content = String(content).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  return { content, ms: Math.round(performance.now() - t0), model: ex.model };
}

/** Ollama mit Streaming: liefert Teilantworten an onToken(textBisher). Zeitlimit gilt bis zum ersten Zeichen
 *  (Modell laden kann dauern) und danach als Ruhezeit zwischen zwei Stücken. Abbruch über signal. */
async function ollamaStream(ex, messages, settings, { timeout, signal, onToken, maxTokens = MAX_TOKENS }) {
  const r = ollamaRoute(settings.ollamaUrl);
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  signal?.addEventListener('abort', abort);
  let timer = setTimeout(abort, timeout);
  const idle = () => { clearTimeout(timer); timer = setTimeout(abort, Math.min(timeout, 120000)); };
  let text = '';
  try {
    const res = await fetch(`${r.base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...r.headers }, body: JSON.stringify({ model: ex.model, messages, stream: true, keep_alive: '30m', options: { num_predict: maxTokens } }), signal: ctrl.signal });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `HTTP ${res.status}`); }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      idle();
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        const d = JSON.parse(line);
        if (d.error) throw new Error(d.error);
        const piece = d.message?.content || '';
        if (piece) { text += piece; onToken(text.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '')); }
      }
    }
    return text;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(signal?.aborted ? 'abgebrochen' : 'Zeitüberschreitung');
    if (e instanceof TypeError) throw new Error('keine Verbindung / CORS');
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** Direkter Zugriff auf die Ollama-API (über den Agenten in der Windows-App, sonst die eingestellte Adresse). */
export async function ollamaRequest(url, path, { method = 'GET', body, signal, timeout = 10000 } = {}) {
  const r = ollamaRoute(url);
  const ctrl = new AbortController();
  const timer = timeout ? setTimeout(() => ctrl.abort(), timeout) : null;
  signal?.addEventListener('abort', () => ctrl.abort());
  try {
    const res = await fetch(`${r.base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...r.headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `HTTP ${res.status}`); }
    return res;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(signal?.aborted ? 'abgebrochen' : 'Zeitüberschreitung');
    if (e instanceof TypeError) throw new Error('keine Verbindung / CORS');
    throw e;
  } finally { if (timer) clearTimeout(timer); }
}

/** Modelle, die gerade eine Anfrage bearbeiten („aktiv“). */
export const activeExperts = new Set();

/** Listet lokal installierte Ollama-Modelle. */
export async function discoverOllama(url) {
  const r = ollamaRoute(url);
  const d = await getJSON(`${r.base}/api/tags`, 8000, r.headers);
  return (d.models || []).map((m) => m.name).filter((n) => !/embed/i.test(n));
}

/** Fragt den eigenen Proxy, welche Anbieter dort (mit Schlüssel) eingerichtet sind. Liefert keine Schlüssel. */
export async function discoverProxy(url) {
  const d = await getJSON(`${trimSlash(url)}/providers`);
  return Array.isArray(d.providers) ? d.providers : [];
}
