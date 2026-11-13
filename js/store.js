// Zentraler, lokaler Zustand (localStorage). Beide Modi (CARVIS & GPT) teilen ihn.
import { uid } from './util.js';

const KEY = 'ccc.state.v1';
const MAX_MESSAGES = 300;
const MAX_ACTIVITY = 60;

export const defaultSettings = () => ({
  userName: '',
  voiceOutput: true,
  voiceName: '',
  rate: 1,
  pitch: 1,
  lang: 'de-DE',
  wakeWord: false,
  autoSendVoice: true,
  reduceMotion: false,
  useMemory: true,
  // Sprache & Gespräch
  greetOnOpen: true,
  conversationMode: false,
  // Multi-KI
  ollamaUrl: 'http://localhost:11434',
  proxyUrl: '',
  collab: 'auto', // 'auto' | 'always' | 'never'
  maxExperts: 3,
  localSequential: true, // lokale Modelle nacheinander (schont den Arbeitsspeicher)
  synthesize: true,
  allowPaid: false,
  // Datenschutz
  allowResearch: true,
  shareMemoryExternal: false,
  // Erscheinungsbild (3.3.4)
  theme: { mode: 'dark', preset: 'cyan', accent: '#22e4ff', glow: 1, speed: 1, hidden: [] },
  // Aktionsmodus (nur lokal, nur mit Desktop-Agent im Aktionsmodus)
  ultimateDev: false,
  addressForm: 'sie',
  autoUpdateCheck: false,
  updateTests: false, // Testversionen (veröffentlichte Vorabversionen) in die Suche einbeziehen
  updateAudit: [], // lokales Protokoll der Update-Aktionen (höchstens 60 Einträge)
  netBaseline: null,
  lastUpdateCheck: 0,
});

function seed() {
  const now = Date.now();
  const pid = uid();
  return {
    version: 1,
    settings: defaultSettings(),
    messages: [],
    projects: [
      {
        id: pid,
        name: 'Erste Schritte',
        description: 'Beispielprojekt: Persönlichen KI-Assistenten aufbauen. Darf gelöscht werden.',
        status: 'aktiv',
        created: now,
        updated: now,
      },
    ],
    tasks: [
      { id: uid(), title: 'CC als App auf dem iPhone installieren', projectId: pid, done: false, priority: 'mittel', due: '', created: now },
      { id: uid(), title: 'Spracheingabe ausprobieren', projectId: pid, done: false, priority: 'hoch', due: '', created: now },
      { id: uid(), title: 'CARVIS CORE kennenlernen', projectId: pid, done: true, priority: 'hoch', due: '', created: now },
    ],
    documents: [],
    previews: [],
    memory: [],
    finance: { items: [], shopping: [] },
    experts: [],
    aiLog: [],
    consents: {},
    lastVisit: 0,
    activity: [{ id: uid(), text: 'CARVIS CORE eingerichtet', icon: 'core', ts: now }],
  };
}

// Übernahme älterer Einstellungen (Beta 1.00, erste Fassung: ein einzelnes LLM)
function migrate(s) {
  const old = s.settings || {};
  if (old.engine === 'llm' && old.endpoint && !(s.experts || []).length) {
    s.experts = [{
      id: `openai::${old.model}`, provider: 'openai', vendorKey: 'openai-compat', model: old.model || 'llama3.2', endpoint: old.endpoint,
      label: `${old.model} (lokal)`, cost: 'free', local: true, enabled: true, status: 'unknown', lastError: '',
      strengths: { code: 0.7, reasoning: 0.7, planning: 0.72, creative: 0.78, research: 0.7, chat: 0.82 },
      stats: { calls: 0, ok: 0, scoreSum: 0, msSum: 0, wins: 0 },
    }];
  }
  ['engine', 'endpoint', 'model'].forEach((k) => delete old[k]);
  return s;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return seed();
    const data = migrate(JSON.parse(raw));
    const base = seed();
    return {
      ...base,
      ...data,
      settings: { ...defaultSettings(), ...(data.settings || {}) },
      finance: { items: [], shopping: [], ...(data.finance || {}) },
    };
  } catch {
    return seed();
  }
}

let state = load();
let storageOk = true;
const listeners = new Set();
let saveTimer = null;

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      storageOk = true;
    } catch {
      storageOk = false;
    }
  }, 120);
}

export const store = {
  get: () => state,
  storageOk: () => storageOk,
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** mutator bekommt den Zustand und darf ihn direkt verändern. */
  update(mutator, activity) {
    mutator(state);
    if (activity) logActivity(activity);
    if (state.messages.length > MAX_MESSAGES) state.messages = state.messages.slice(-MAX_MESSAGES);
    persist();
    listeners.forEach((fn) => fn(state));
  },
  replace(next) {
    const base = seed();
    state = { ...base, ...next, settings: { ...defaultSettings(), ...(next.settings || {}) }, finance: { items: [], shopping: [], ...(next.finance || {}) } };
    persist();
    listeners.forEach((fn) => fn(state));
  },
  reset() {
    state = seed();
    persist();
    listeners.forEach((fn) => fn(state));
  },
  sizeKB() {
    try {
      return Math.round((JSON.stringify(state).length * 2) / 1024);
    } catch {
      return 0;
    }
  },
};

function logActivity(a) {
  const entry = typeof a === 'string' ? { text: a, icon: 'dot' } : a;
  state.activity.unshift({ id: uid(), ts: Date.now(), ...entry });
  state.activity = state.activity.slice(0, MAX_ACTIVITY);
}

// ---- Fachliche Aktionen (alle echt, lokal) ----
export const actions = {
  addMessage(msg) {
    const m = { id: uid(), ts: Date.now(), ...msg };
    store.update((s) => s.messages.push(m));
    return m;
  },
  clearChat() {
    store.update((s) => (s.messages = []), { text: 'Chatverlauf gelöscht', icon: 'chat' });
  },
  addProject({ name, description = '', status = 'aktiv' }) {
    const p = { id: uid(), name: name.trim(), description, status, created: Date.now(), updated: Date.now() };
    store.update((s) => s.projects.unshift(p), { text: `Projekt angelegt: ${p.name}`, icon: 'project' });
    return p;
  },
  updateProject(id, patch) {
    store.update((s) => {
      const p = s.projects.find((x) => x.id === id);
      if (p) Object.assign(p, patch, { updated: Date.now() });
    });
  },
  deleteProject(id) {
    const p = state.projects.find((x) => x.id === id);
    store.update(
      (s) => {
        s.projects = s.projects.filter((x) => x.id !== id);
        s.tasks.forEach((t) => t.projectId === id && (t.projectId = null));
        s.documents.forEach((d) => d.projectId === id && (d.projectId = null));
      },
      { text: `Projekt gelöscht: ${p?.name ?? ''}`, icon: 'trash' },
    );
  },
  addTask({ title, projectId = null, priority = 'mittel', due = '' }) {
    const t = { id: uid(), title: title.trim(), projectId, done: false, priority, due, created: Date.now() };
    store.update((s) => s.tasks.unshift(t), { text: `Aufgabe erstellt: ${t.title}`, icon: 'task' });
    return t;
  },
  toggleTask(id) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return;
    store.update((s) => {
      const x = s.tasks.find((y) => y.id === id);
      x.done = !x.done;
    }, { text: `${t.done ? 'Wieder geöffnet' : 'Erledigt'}: ${t.title}`, icon: 'task' });
  },
  deleteTask(id) {
    store.update((s) => (s.tasks = s.tasks.filter((x) => x.id !== id)));
  },
  addDocument({ title, content = '', projectId = null }) {
    const d = { id: uid(), title: title.trim() || 'Unbenanntes Dokument', content, projectId, created: Date.now(), updated: Date.now() };
    store.update((s) => s.documents.unshift(d), { text: `Dokument erstellt: ${d.title}`, icon: 'doc' });
    return d;
  },
  updateDocument(id, patch) {
    store.update((s) => {
      const d = s.documents.find((x) => x.id === id);
      if (d) Object.assign(d, patch, { updated: Date.now() });
    });
  },
  deleteDocument(id) {
    store.update((s) => (s.documents = s.documents.filter((x) => x.id !== id)), { text: 'Dokument gelöscht', icon: 'trash' });
  },
  addPreview({ title, blocks, source = 'demo' }) {
    const p = { id: uid(), title, blocks, source, created: Date.now() };
    store.update((s) => {
      s.previews.unshift(p);
      s.previews = s.previews.slice(0, 50);
    }, { text: `Vorschau erstellt: ${title}`, icon: 'preview' });
    return p;
  },
  deletePreview(id) {
    store.update((s) => (s.previews = s.previews.filter((x) => x.id !== id)));
  },
  addMemory(text) {
    const m = { id: uid(), text: text.trim(), created: Date.now() };
    store.update((s) => s.memory.unshift(m), { text: 'Neue Erinnerung gespeichert', icon: 'memory' });
    return m;
  },
  deleteMemory(id) {
    store.update((s) => (s.memory = s.memory.filter((x) => x.id !== id)));
  },
  setSettings(patch) {
    store.update((s) => Object.assign(s.settings, patch));
  },
  // ---- Multi-KI ----
  upsertExpert(ex) {
    store.update((s) => {
      const cur = s.experts.find((x) => x.id === ex.id);
      if (cur) Object.assign(cur, { endpoint: ex.endpoint, label: ex.label });
      else s.experts.push(ex);
    });
  },
  updateExpert(id, patch) {
    store.update((s) => {
      const x = s.experts.find((e) => e.id === id);
      if (x) Object.assign(x, patch);
    });
  },
  removeExpert(id) {
    store.update((s) => (s.experts = s.experts.filter((e) => e.id !== id)), { text: 'KI-Modell entfernt', icon: 'trash' });
  },
  recordExpert(id, { ok, score = 0, ms = 0, win = false, error = '' }) {
    store.update((s) => {
      const x = s.experts.find((e) => e.id === id);
      if (!x) return;
      x.stats ||= { calls: 0, ok: 0, scoreSum: 0, msSum: 0, wins: 0 };
      x.stats.calls++;
      if (ok) { x.stats.ok++; x.stats.scoreSum += score; x.stats.msSum += ms; x.status = 'ok'; x.lastError = ''; }
      else { x.status = 'error'; x.lastError = error; }
      if (win) x.stats.wins++;
    });
  },
  logAI(entry) {
    store.update((s) => {
      s.aiLog.unshift({ id: uid(), ts: Date.now(), ...entry });
      s.aiLog = s.aiLog.slice(0, 80);
    });
  },
  clearAILog() {
    store.update((s) => (s.aiLog = []));
  },
  setConsent(key, val) {
    store.update((s) => (s.consents[key] = val));
  },
};

export function projectProgress(p, tasks = state.tasks) {
  const list = tasks.filter((t) => t.projectId === p.id);
  if (!list.length) return p.status === 'abgeschlossen' ? 100 : 0;
  return Math.round((list.filter((t) => t.done).length / list.length) * 100);
}
