// Verbindung zum lokalen CARVIS Desktop-Agenten (tools/desktop-agent.py).
// Der Token liegt nur in sessionStorage (verschwindet beim Schließen des Tabs) und wird nie dauerhaft gespeichert.

const K = 'ccc.agent.session';
const DEFAULT_URL = 'http://127.0.0.1:8777';

function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(K) || '{}'); } catch { return {}; }
}
function saveSession(v) {
  try { sessionStorage.setItem(K, JSON.stringify(v)); } catch { /* privater Modus */ }
}

const sess = loadSession();
export const agentState = { url: sess.url || DEFAULT_URL, token: sess.token || '', connected: false, info: null, perms: null, stopped: false, error: '' };

async function call(method, path, body, { auth = true, ms = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(agentState.url.replace(/\/$/, '') + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${agentState.token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
      cache: 'no-store',
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(data.error || `HTTP ${r.status}`);
      e.status = r.status;
      throw e;
    }
    return data;
  } catch (e) {
    if (e.status) throw e;
    throw new Error(e.name === 'AbortError' ? 'Zeitüberschreitung' : 'Agent nicht erreichbar. Läuft er? Safari/iPhone blockiert Verbindungen zu lokalen Programmen.');
  } finally {
    clearTimeout(t);
  }
}

// Windows-App: Die Hülle (Tauri) startet den integrierten Agenten selbst und gibt Port + Token über `agent_info` weiter.
// Im Browser (kein Tauri) passiert nichts – dort bleibt es bei der manuellen Verbindung.
export const inApp = () => !!(window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke);

export async function autoConnectApp(maxMs = 60000) {
  if (!inApp()) return { app: false };
  // Robust (4.0): Einzelne Fehlschläge beim Start (Tauri-Aufruf noch nicht bereit, Agent antwortet verzögert,
  // Zeitüberschreitung) führen nicht mehr zum Abbruch – es wird bis maxMs erneut versucht.
  // Endgültig abgebrochen wird nur bei einem gemeldeten Startfehler des Agenten oder falschem Token (401).
  const t0 = Date.now();
  let lastErr = '';
  agentState.attempts = 0;
  while (Date.now() - t0 < maxMs) {
    agentState.attempts += 1;
    let r = null;
    try { r = await window.__TAURI__.core.invoke('agent_info'); } catch (e) { lastErr = `agent_info: ${e && e.message ? e.message : e}`; }
    if (r && r.error) { agentState.error = r.error; return { app: true, ok: false, error: r.error }; }
    if (r && r.info) {
      try {
        const i = JSON.parse(r.info);
        await agentClient.connect(`http://127.0.0.1:${i.port}`, i.token, { helloMs: 8000 });
        (await import('./ai/providers.js')).setOllamaGateway(`http://127.0.0.1:${i.port}`, i.token);
        return { app: true, ok: true, attempts: agentState.attempts };
      } catch (e) {
        lastErr = e.message;
        if (/Token falsch/.test(lastErr)) return { app: true, ok: false, error: lastErr };
      }
    }
    await new Promise((res) => setTimeout(res, Math.min(400 * agentState.attempts, 3000)));
  }
  agentState.error = lastErr ? `Der integrierte Agent ist nicht erreichbar (${lastErr}).` : 'Der integrierte Agent ist nicht rechtzeitig bereit geworden.';
  return { app: true, ok: false, error: agentState.error };
}

export const agentClient = {
  state: agentState,

  async connect(url, token, { helloMs = 4000 } = {}) {
    agentState.url = (url || DEFAULT_URL).trim();
    agentState.token = (token || '').trim();
    agentState.error = '';
    try {
      const hello = await call('GET', '/hello', undefined, { auth: false, ms: helloMs });
      if (hello.agent !== 'ccc-desktop-agent') throw new Error('Unter dieser Adresse läuft kein CARVIS-Agent.');
      agentState.info = hello;
      agentState.perms = await call('GET', '/perms');
      agentState.stopped = !!agentState.perms.stopped;
      agentState.connected = true;
      saveSession({ url: agentState.url, token: agentState.token });
    } catch (e) {
      agentState.connected = false;
      agentState.error = e.status === 401 ? 'Token falsch. Den Token zeigt der Agent beim Start an.' : e.message;
      throw new Error(agentState.error);
    }
  },

  disconnect() {
    Object.assign(agentState, { token: '', connected: false, info: null, perms: null, error: '' });
    saveSession({ url: agentState.url });
  },

  get connected() { return agentState.connected; },

  perf: () => call('GET', '/perf', undefined, { ms: 25000 }),
  system: () => call('GET', '/system', undefined, { ms: 20000 }),
  hardware: () => call('GET', '/hardware', undefined, { ms: 15000 }),
  webFetch: (url) => call('POST', '/web/fetch', { url }, { ms: 40000 }),
  speechStatus: () => call('GET', '/speech/status', undefined, { ms: 45000 }),
  speechRecognize: (wav, lang) => call('POST', '/speech/recognize', { wav, lang }, { ms: 130000 }),
  net: (targets) => call('POST', '/net', { targets }, { ms: 30000 }),
  list: (path = '') => call('GET', `/fs/list?path=${encodeURIComponent(path)}`),
  read: (path) => call('GET', `/fs/read?path=${encodeURIComponent(path)}`),
  propose: (path, content) => call('POST', '/action/propose', { type: 'write_file', path, content }),
  confirm: (id) => call('POST', '/action/confirm', { id }),
  cancel: (id) => call('POST', '/action/cancel', { id }),
  log: () => call('GET', '/log'),
  async stop() {
    const r = await call('POST', '/stop', {});
    agentState.stopped = true;
    return r;
  },
  // Aktionsmodus: erst planen (Prüfung + Vorschau), dann freigeben, dann Status abfragen.
  ultPlan: (title, steps) => call('POST', '/ultimate/plan', { title, steps }),
  ultApprove: (id) => call('POST', '/ultimate/approve', { id }),
  ultJob: (id = '') => call('GET', `/ultimate/job${id ? `?id=${encodeURIComponent(id)}` : ''}`),
  ultJobs: () => call('GET', '/ultimate/jobs'),
  ultUndo: (id) => call('POST', '/ultimate/undo', { id }),
  // Privater Update-Kanal (GitHub-Gerätecode-Anmeldung; das Token bleibt im Agenten, die Oberfläche sieht es nie)
  updStatus: () => call('GET', '/update/status'),
  updLoginStart: (clientId) => call('POST', '/update/login/start', { clientId }),
  updLoginPoll: () => call('POST', '/update/login/poll', {}),
  updLogout: () => call('POST', '/update/logout', {}),
  updCheck: () => call('GET', '/update/check', undefined, { ms: 40000 }),
  // Öffentlicher Download-Kanal: keine GitHub-Anmeldung erforderlich.
  updPublicCheck: () => call('GET', '/update/public/check', undefined, { ms: 40000 }),
  updPublicDownload: (installerId, sumsId, name) => call('POST', '/update/public/download', { installerId, sumsId, name }),
  updDownload: (installerId, sumsId, name) => call('POST', '/update/download', { installerId, sumsId, name }),
  updProgress: () => call('GET', '/update/progress'),
  updInstall: (name) => call('POST', '/update/install', { name, confirm: true }),
  async refreshPerms() { agentState.perms = await call('GET', '/perms'); agentState.stopped = !!agentState.perms.stopped; return agentState.perms; },
  async resume() {
    const r = await call('POST', '/resume', {});
    agentState.stopped = false;
    return r;
  },
};
