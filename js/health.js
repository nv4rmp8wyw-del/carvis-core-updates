// CARVIS CORE 4.0 – Self-Healing Engine (Systemgesundheit, Selbstreparatur, Feedback-Kreislauf).
// Teil der bestehenden Architektur: nutzt Store, Agent-Client, Ollama-Anbindung und Modellmanager – kein zweites System.
//
// Verbindlicher Ablauf je Fehler (Master-Auftrag 5.2, §17):
//   1 erkennen → 2 klassifizieren (CLASSES) → 3 Ursache (Prüfergebnis) → 4 Reparatur ermitteln (REPAIRS)
//   → 5 sicher reparieren ODER Freigabe einholen → 6 Funktion ERNEUT PRÜFEN (dieselbe Prüfung, kein Scheinerfolg)
//   → 7 dokumentieren (Verlauf) → 8 nach maxAttempts eskalieren: Stopp + „Manuelle Prüfung erforderlich“.
// Sicherheit (§21): nur bekannte, sichere, umkehrbare Maßnahmen laufen automatisch; alles andere braucht eine Freigabe.
// Jede Reparatur hat Zeitlimit, begrenzte Versuche, Erfolgskontrolle, Protokoll und – wo sinnvoll – Rückgängig.
// Keine Treiberinstallation, kein Löschen, keine Sicherheitsänderung, nichts Kostenpflichtiges.
import { store, actions } from './store.js';
import { VERSION, versionLabel } from './version.js';
import { t } from './i18n.js';

// Anzeigenamen aus dem Sprachsystem (health.status.<zustand>), D-053
export const STATUS = new Proxy({}, { get: (_, k) => (typeof k === 'string' ? t(`health.status.${k}`) : undefined) });
export const STATUS_LED = { ok: 'ok', checking: 'idle', detected: 'warn', repairing: 'idle', fixed: 'ok', consent: 'warn', manual: 'danger' };

// Klassifikation: Bereich, Schweregrad, betroffene Funktionen, Empfehlung für den Nutzer
export const CLASSES = {
  'ollama-down': { area: 'Ollama', sev: 'error', affects: ['Lokale KI', 'GPT-Chat', 'CARVIS-Antworten mit KI'], advice: 'Ollama starten (Startmenü → Ollama) oder kostenlos installieren: ollama.com. Danach „Erneut prüfen“.' },
  'model-missing': { area: 'KI-Modelle', sev: 'warn', affects: ['Ausgewähltes KI-Modell'], advice: 'Ein vorhandenes Modell verwenden oder das Modell im Bereich KI-Modelle mit einem Klick laden.' },
  'model-error': { area: 'KI-Modelle', sev: 'warn', affects: ['Ausgewähltes KI-Modell'], advice: 'Modell entladen und neu verbinden; bei wenig Arbeitsspeicher ein kleineres Modell wählen.' },
  'model-switch-failed': { area: 'KI-Modelle', sev: 'warn', affects: ['Modellwechsel'], advice: 'Ein anderes vorhandenes kostenloses Modell verwenden.' },
  'agent-timeout': { area: 'Windows-Agent', sev: 'error', affects: ['PC-Funktionen', 'Optimierung', 'Spracherkennung (App)', 'Ollama über die App'], advice: 'Agent neu starten. Im Browser: Agent von Hand neu starten (python tools/desktop-agent.py).' },
  'agent-disconnected': { area: 'Windows-Agent', sev: 'error', affects: ['PC-Funktionen', 'Optimierung', 'Spracherkennung (App)', 'Ollama über die App'], advice: 'Integrierten Agenten erneut verbinden oder neu starten.' },
  offline: { area: 'Internet', sev: 'info', affects: ['Recherche', 'Updates', 'Cloud-Dienste'], advice: 'Lokale KI bleibt verfügbar. Lesende Anfragen werden nach der Wiederverbindung automatisch wiederholt.' },
  'ui-error': { area: 'Oberfläche', sev: 'warn', affects: ['Betroffene Ansicht'], advice: 'Ansicht wird aus dem gespeicherten Zustand neu aufgebaut; Daten bleiben erhalten.' },
  'view-load': { area: 'Navigation', sev: 'warn', affects: ['Betroffene Ansicht'], advice: 'Erneut laden; bei der Website: Internetverbindung prüfen.' },
  'stt-unavailable': { area: 'Sprachassistent', sev: 'info', affects: ['Spracheingabe'], advice: 'Windows: Spracherkennung unter Einstellungen → Zeit und Sprache installieren. Browser: Chrome oder Edge verwenden.' },
  'tts-unavailable': { area: 'Sprachassistent', sev: 'info', affects: ['Sprachausgabe'], advice: 'Eine Windows-Stimme installieren (Einstellungen → Zeit und Sprache → Sprache).' },
  'mic-denied': { area: 'Mikrofon', sev: 'warn', affects: ['Spracheingabe'], advice: 'Mikrofonzugriff erlauben (Windows: Einstellungen → Datenschutz → Mikrofon; Browser: Schloss-Symbol).' },
  'storage-error': { area: 'Daten', sev: 'error', affects: ['Speichern von Einstellungen und Projekten'], advice: 'Backup exportieren (Einstellungen) und Speicherplatz bzw. Browser-Speicher prüfen.' },
  'memory-high': { area: 'Ressourcen', sev: 'info', affects: ['Reaktionszeit'], advice: 'Nicht benötigte KI-Fenster schließen oder geladene Modelle entladen.' },
  'update-error': { area: 'Update Center', sev: 'info', affects: ['Updateprüfung'], advice: 'Später erneut prüfen; Internetverbindung kontrollieren.' },
  'agent-task-failed': { area: 'Agentenaufgaben', sev: 'warn', affects: ['Agentenaufgabe'], advice: 'Aufgabe im Bereich Agenten prüfen und bei Bedarf erneut starten.' },
};

const LS = 'ccc.health.v1';
const MAX_ISSUES = 60, MAX_HIST = 25, MAX_LOG = 200, MAX_QUEUE = 10;
const STABLE_RESET = 30 * 60 * 1000; // nach 30 min ohne Rückfall zählen Versuche wieder von vorn
const now = () => Date.now();

const H = {
  issues: new Map(),      // key -> Issue (gleiche Fehler gruppiert)
  log: [],                // Reparatur-/Prüfhistorie (gekürzt, ohne private Inhalte)
  checks: new Map(),      // id -> { ...check, last, lastResult, running }
  lastRun: 0,
  running: false,
  auto: true,             // automatische sichere Reparaturen
  stopped: false,         // Not-Stopp: keine Reparaturen
  timer: null,
  subs: new Set(),
  deps: {},               // von app.js: { toast, agentClient, agentState, inApp, autoConnectApp, voice, providers, mm, rerender }
  queue: [],              // lesende Anfragen, die nach der Wiederverbindung wiederholt werden
};

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(LS) || '{}');
    (d.issues || []).forEach((i) => H.issues.set(i.key, i));
    H.log = d.log || [];
    H.auto = d.auto !== false;
    H.stopped = !!d.stopped;
  } catch { /* privater Modus: nur im Speicher */ }
}
let saveT = null;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try { localStorage.setItem(LS, JSON.stringify({ issues: [...H.issues.values()].slice(-MAX_ISSUES), log: H.log.slice(-MAX_LOG), auto: H.auto, stopped: H.stopped })); } catch { /* egal */ }
  }, 300);
}
let emitT = null;
function emit() { save(); clearTimeout(emitT); emitT = setTimeout(() => H.subs.forEach((f) => { try { f(); } catch { /* Abonnent */ } }), 50); }
function note(text, ok = null, key = '') { H.log.push({ t: now(), text: redact(text), ok, key }); if (H.log.length > MAX_LOG) H.log.splice(0, H.log.length - MAX_LOG); }

// ---------------------------------------------------------------- Datenschutz
/** Entfernt Zugangsdaten, Tokens, E-Mail-Adressen, Benutzernamen in Pfaden und Abfrageparameter. */
export function redact(input) {
  let s = String(input ?? '');
  s = s.replace(/(authorization\s*[:=]\s*)(bearer\s+)?[^\s,"'}]+/gi, '$1***');
  s = s.replace(/\bbearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, 'Bearer ***');
  s = s.replace(/("?(?:token|access_token|refresh_token|api[_-]?key|apikey|secret|password|passwort|client_secret)"?\s*[:=]\s*"?)[^"&\s,}]+/gi, '$1***');
  s = s.replace(/\b(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,}|AIza[0-9A-Za-z_-]{20,}|xox[abprs]-[A-Za-z0-9-]{8,})\b/g, '***');
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<E-Mail>');
  s = s.replace(/([A-Za-z]:\\Users\\)[^\\/\s"]+/gi, '$1<Nutzer>').replace(/(\/(?:home|Users)\/)[^/\s"]+/g, '$1<Nutzer>');
  s = s.replace(/(https?:\/\/[^\s"?#]+)\?[^\s"#]*/g, '$1?…');
  return s;
}

// ---------------------------------------------------------------- Erkennen + Klassifizieren
function keyOf(code, subject) { return subject ? `${code}:${subject}` : code; }

/** Meldet einen Fehler (aus einer Prüfung oder einem Ereignis). Gleiche Fehler werden gruppiert. */
export function report(code, { subject = '', cause = '', detail = '', silent = false } = {}) {
  const cls = CLASSES[code] || { area: 'Allgemein', sev: 'warn', affects: [], advice: '' };
  const key = keyOf(code, subject);
  let it = H.issues.get(key);
  const t = now();
  if (!it) {
    it = { key, code, subject: redact(subject), area: cls.area, sev: cls.sev, affects: cls.affects, advice: cls.advice, status: 'detected', count: 0, first: t, last: t, attempts: 0, cause: '', detail: '', hist: [], undo: null, resolvedAt: 0 };
    H.issues.set(key, it);
    if (H.issues.size > MAX_ISSUES) H.issues.delete(H.issues.keys().next().value);
  }
  // Rückfall nach Behebung: weiter zählen (keine Endlosschleife); nach langer stabiler Zeit neu beginnen
  if (it.status === 'fixed' || it.status === 'ok') { if (t - it.resolvedAt > STABLE_RESET) it.attempts = 0; it.status = 'detected'; hist(it, 'Erneut aufgetreten', false); }
  it.count += 1; it.last = t;
  if (cause) it.cause = redact(cause);
  if (detail) it.detail = redact(String(detail)).slice(0, 400);
  if (it.count === 1) { hist(it, `Erkannt: ${it.cause || code}`, false); note(`${cls.area}: ${it.cause || code}`, false, key); }
  emit();
  if (!silent) queueMicrotask(() => handle(it));
  return it;
}

/** Ein Problem ist verschwunden (Prüfung wieder grün), ohne dass eine Reparatur lief. */
function clear(key, why) {
  const it = H.issues.get(key);
  if (!it || it.status === 'fixed' || it.status === 'ok') return;
  it.status = 'fixed'; it.resolvedAt = now();
  hist(it, why || 'Prüfung wieder erfolgreich', true); note(`${it.area}: ${why || 'wieder in Ordnung'}`, true, key);
  emit();
}
function hist(it, text, ok) { it.hist.push({ t: now(), text: redact(text), ok }); if (it.hist.length > MAX_HIST) it.hist.splice(0, it.hist.length - MAX_HIST); }

// ---------------------------------------------------------------- Prüfungen (sparsam, ereignisgesteuert + Intervalle)
/**
 * Registriert eine Prüfung. run() liefert { ok, code?, subject?, cause?, detail? } bzw. ein Array davon.
 * clears: Liste der Fehlercodes, die diese Prüfung bei Erfolg als behoben erkennt.
 */
export function addCheck(c) { H.checks.set(c.id, { interval: 60000, when: () => true, last: 0, lastResult: null, running: false, ...c }); }

async function runCheck(c, { force = false } = {}) {
  if (c.running || (!force && now() - c.last < c.interval) || !c.when()) return null;
  c.running = true; c.last = now();
  let res;
  try { res = await withTimeout(c.run(), c.timeout || 15000, 'Prüfung'); } catch (e) { res = { ok: false, code: c.failCode || 'ui-error', subject: c.id, cause: `Prüfung „${c.label}“ fehlgeschlagen: ${e.message}` }; }
  c.running = false;
  const list = Array.isArray(res) ? res : [res];
  c.lastResult = { t: now(), ok: list.every((r) => r.ok), text: list.filter((r) => !r.ok).map((r) => r.cause).join(' · ') || 'in Ordnung' };
  // Erfolg: zugehörige offene Probleme schließen (Behebung = echte, erneute Prüfung)
  const bad = new Set(list.filter((r) => !r.ok).map((r) => keyOf(r.code, r.subject || '')));
  for (const it of H.issues.values()) if ((c.clears || []).includes(it.code) && !bad.has(it.key) && ['detected', 'consent', 'manual'].includes(it.status) && (!c.subjectScoped || list.some((r) => r.ok && r.subject === it.subject) || !list.some((r) => r.subject))) clear(it.key, `Prüfung „${c.label}“ erfolgreich`);
  list.filter((r) => !r.ok).forEach((r) => report(r.code, r));
  emit();
  return c.lastResult;
}

/** Alle fälligen Prüfungen nacheinander (keine Parallel-Last). force: alle sofort. */
export async function runChecks({ force = false, only = null } = {}) {
  if (H.running) return;
  H.running = true; emit();
  try {
    for (const c of H.checks.values()) if (!only || only.includes(c.id)) await runCheck(c, { force });
    H.lastRun = now();
  } finally { H.running = false; emit(); }
}

// ---------------------------------------------------------------- Reparieren + Erfolgskontrolle
/**
 * Reparaturen je Fehlercode:
 *   risk 'safe'    → läuft automatisch (bekannt, sicher, umkehrbar oder ohne bleibende Änderung)
 *   risk 'consent' → nur nach Freigabe des Nutzers
 *   run(it) → { undo?: async () => {}, text? }   verify(it) → true/false (erneute echte Prüfung)
 */
export const REPAIRS = {};
export function addRepair(code, r) { REPAIRS[code] = { maxAttempts: 2, timeout: 30000, risk: 'safe', reversible: true, ...r }; }

function withTimeout(p, ms, what) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what}: Zeitüberschreitung nach ${Math.round(ms / 1000)} s`)), ms); })]).finally(() => clearTimeout(t));
}

async function handle(it) {
  const r = REPAIRS[it.code];
  if (!r) { if (it.status === 'detected' && CLASSES[it.code]?.sev !== 'info') { it.status = 'manual'; hist(it, 'Keine automatische Reparatur bekannt – Empfehlung anzeigen', null); emit(); } return; }
  if (['repairing', 'manual'].includes(it.status)) return;
  if (it.attempts >= r.maxAttempts) return escalate(it, r);
  if (H.stopped) { it.status = 'consent'; hist(it, 'Not-Stopp aktiv – Reparatur angehalten', null); emit(); return; }
  if (r.when && !r.when(it)) { it.status = 'manual'; hist(it, r.whyNot || 'Reparatur hier nicht möglich', null); emit(); return; }
  if (r.risk !== 'safe' || !H.auto) { if (it.status !== 'consent') { it.status = 'consent'; hist(it, `Freigabe erforderlich: ${r.label}`, null); emit(); } return; }
  await repair(it.key, { approved: false });
}

/** Führt die Reparatur aus und prüft danach die ursprüngliche Funktion erneut. */
export async function repair(key, { approved = true } = {}) {
  const it = H.issues.get(key);
  const r = it && REPAIRS[it.code];
  if (!it || !r) return { ok: false, text: 'Keine Reparatur bekannt' };
  if (H.stopped) return { ok: false, text: 'Not-Stopp aktiv' };
  if (r.risk !== 'safe' && !approved) return { ok: false, text: 'Freigabe fehlt' };
  if (it.status === 'repairing') return { ok: false, text: 'läuft bereits' };
  if (it.attempts >= r.maxAttempts && !approved) return escalate(it, r);
  it.attempts += 1; it.status = 'repairing';
  hist(it, `Reparatur ${it.attempts}/${r.maxAttempts}: ${r.label}${approved && r.risk !== 'safe' ? ' (freigegeben)' : ''}`, null);
  emit();
  let out = { ok: false, text: '' };
  try {
    const res = (await withTimeout(Promise.resolve(r.run(it, H.deps)), r.timeout, 'Reparatur')) || {};
    if (res.undo) it.undo = { label: res.undoLabel || 'Rückgängig', at: now(), fn: res.undo };
    // Schritt 6: Funktion erneut testen. Ein ausgeführter Befehl allein gilt NICHT als Behebung.
    const fine = await withTimeout(Promise.resolve(r.verify(it, H.deps)), r.timeout, 'Erfolgskontrolle').catch((e) => { hist(it, `Erfolgskontrolle: ${e.message}`, false); return false; });
    out = fine ? { ok: true, text: res.text || 'behoben und erneut geprüft' } : { ok: false, text: 'Reparatur ausgeführt, Funktion aber weiterhin gestört' };
  } catch (e) { out = { ok: false, text: e.message }; }
  if (out.ok) {
    it.status = 'fixed'; it.resolvedAt = now();
    hist(it, `Erfolgreich behoben (erneut geprüft): ${out.text}`, true); note(`${it.area}: behoben – ${out.text}`, true, key);
    H.deps.toast?.(`${it.area}: automatisch behoben`, 'ok');
  } else {
    hist(it, `Fehlgeschlagen: ${out.text}`, false); note(`${it.area}: Reparatur fehlgeschlagen – ${out.text}`, false, key);
    if (it.attempts >= r.maxAttempts) escalate(it, r);
    else {
      it.status = r.risk === 'safe' && H.auto ? 'detected' : 'consent';
      if (it.status === 'detected') setTimeout(() => { const cur = H.issues.get(key); if (cur && cur.status === 'detected' && !H.stopped) handle(cur); }, 3000 * it.attempts);
    }
  }
  emit();
  return out;
}

function escalate(it, r) {
  if (it.status !== 'manual') {
    it.status = 'manual';
    hist(it, `Gestoppt nach ${it.attempts} Versuch(en) – manuelle Prüfung erforderlich`, false);
    note(`${it.area}: Eskalation – ${r?.label || 'Reparatur'} hat ${it.attempts}× nicht geholfen`, false, it.key);
    H.deps.toast?.(`${it.area}: Problem besteht weiter. Details unter Systemzustand.`, 'warn');
    emit();
  }
  return { ok: false, text: 'eskaliert' };
}

/** Macht die letzte umkehrbare Reparatur eines Problems rückgängig. */
export async function undo(key) {
  const it = H.issues.get(key);
  if (!it?.undo?.fn) return { ok: false, text: 'Nichts rückgängig zu machen' };
  try { await it.undo.fn(); hist(it, `Rückgängig gemacht: ${it.undo.label}`, true); note(`${it.area}: Reparatur rückgängig gemacht`, true, key); it.undo = null; it.status = 'detected'; emit(); return { ok: true }; }
  catch (e) { hist(it, `Rückgängig fehlgeschlagen: ${e.message}`, false); emit(); return { ok: false, text: e.message }; }
}

/** Erneut prüfen (Knopf „Erneut prüfen“): setzt nach Eskalation die Versuche zurück – der Nutzer hat bewusst eingegriffen. */
export async function recheck(key) {
  const it = H.issues.get(key);
  if (it && it.status === 'manual') { it.attempts = 0; it.status = 'detected'; hist(it, 'Vom Nutzer erneut prüfen lassen', null); }
  const ids = [...H.checks.values()].filter((c) => !it || (c.clears || []).includes(it.code)).map((c) => c.id);
  await runChecks({ force: true, only: ids.length ? ids : null });
  return H.issues.get(key);
}

export function dismiss(key) { const it = H.issues.get(key); if (it) { hist(it, 'Vom Nutzer ausgeblendet', null); H.issues.delete(key); emit(); } }
export function setAuto(v) { H.auto = !!v; note(`Automatische Reparatur ${H.auto ? 'ein' : 'aus'}`); emit(); }
/** Not-Stopp: hält sofort alle Reparaturen an (Prüfungen laufen passiv weiter). */
export function setStopped(v) {
  H.stopped = !!v;
  note(H.stopped ? 'Not-Stopp: Selbstreparatur angehalten' : 'Selbstreparatur fortgesetzt', H.stopped ? null : true);
  if (!H.stopped) for (const it of H.issues.values()) if (it.status === 'consent' && REPAIRS[it.code]?.risk === 'safe') it.status = 'detected';
  emit();
}

// ---------------------------------------------------------------- Offline: lesende Anfragen später wiederholen
/** Merkt sich eine sichere, lesende Anfrage, die offline fehlgeschlagen ist (höchstens 10, je 2 Versuche). */
export function retryWhenOnline(label, fn) {
  if (H.queue.length >= MAX_QUEUE) H.queue.shift();
  H.queue.push({ label: redact(label), fn, tries: 0 });
  note(`Offline: „${redact(label)}“ wird nach der Wiederverbindung wiederholt`);
  emit();
}
async function flushQueue() {
  const q = H.queue.splice(0);
  for (const j of q) {
    try { j.tries += 1; await j.fn(); note(`Wiederholt nach Wiederverbindung: ${j.label}`, true); }
    catch (e) { if (j.tries < 2) H.queue.push(j); else note(`Wiederholung aufgegeben: ${j.label} (${e.message})`, false); }
  }
  emit();
}

// ---------------------------------------------------------------- Oberfläche: JS-Fehler gruppieren
export function uiError(where, err) {
  const msg = err?.message || String(err);
  const src = (err?.stack || '').split('\n').find((l) => /\.js/.test(l)) || '';
  const file = (src.match(/([\w-]+\.js):(\d+)/) || [])[0] || '';
  // gleiche Fehler (Ort + Datei + Meldung ohne Zahlen) werden gruppiert, verschiedene getrennt geführt
  const sig = redact(msg).replace(/\d+/g, '#').slice(0, 60);
  return report('ui-error', { subject: `${where}${file ? ' · ' + file : ''} · ${sig}`, cause: `${where}: ${msg}`, detail: redact(`${msg} ${file}`) });
}

// ---------------------------------------------------------------- Zustand für die Ansicht
export function overall() {
  const open = [...H.issues.values()].filter((i) => !['fixed', 'ok'].includes(i.status) && !(i.sev === 'info' && i.status === 'detected' && i.code !== 'offline'));
  if (H.running && !open.length) return 'checking';
  if (open.some((i) => i.status === 'repairing')) return 'repairing';
  if (open.some((i) => i.status === 'manual')) return 'manual';
  if (open.some((i) => i.status === 'consent')) return 'consent';
  if (open.length) return 'detected';
  return 'ok';
}
/** Ereignis ins Protokoll schreiben (z. B. automatischer Modellwechsel durch den KI-Verbindungsmanager). */
export function logEvent(text, ok = null) { note(text, ok); emit(); }

export const health = {
  get issues() { return [...H.issues.values()].sort((a, b) => b.last - a.last); },
  get log() { return H.log.slice().reverse(); },
  get checks() { return [...H.checks.values()]; },
  get auto() { return H.auto; },
  get stopped() { return H.stopped; },
  get running() { return H.running; },
  get queue() { return H.queue.map((j) => j.label); },
  get lastRun() { return H.lastRun; },
  overall, report, repair, undo, recheck, logEvent, dismiss, setAuto, setStopped, runChecks, retryWhenOnline, uiError, redact,
  subscribe(f) { H.subs.add(f); return () => H.subs.delete(f); },
};

// ---------------------------------------------------------------- Diagnosebericht (freiwillig, ohne private Inhalte)
/** Erstellt einen Diagnosebericht. Enthält KEINE Chatinhalte, Notizen, Projekte, Namen, Tokens oder Adressen mit Zugangsdaten. */
export function diagnosticReport({ description = '', kind = 'Fehler', includeLog = true } = {}) {
  const st = store.get();
  const d = H.deps;
  const rep = {
    art: kind, version: versionLabel(VERSION), zeit: new Date().toISOString(),
    umgebung: { app: !!d.inApp?.(), plattform: navigator.platform || '', browser: (navigator.userAgent.match(/(Edg|Chrome|Firefox|Safari)\/[\d.]+/) || [''])[0], online: navigator.onLine, sprache: navigator.language },
    beschreibung: redact(description).slice(0, 2000),
    status: STATUS[overall()],
    agent: { verbunden: !!d.agentState?.connected, version: d.agentState?.info?.version || null, notStopp: !!d.agentState?.stopped },
    modelle: st.experts.map((e) => ({ anbieter: e.provider, modell: redact(e.model), aktiv: !!e.enabled, status: e.status || 'unbekannt' })),
    sprache: { ausgabe: !!d.voice?.ttsSupported, eingabe: !!d.voice?.sttSupported, engine: d.voice?.sttEngine || '' },
    selbstreparatur: { automatisch: H.auto, notStopp: H.stopped },
    probleme: health.issues.map((i) => ({ code: i.code, bereich: i.area, status: STATUS[i.status], anzahl: i.count, versuche: i.attempts, ursache: i.cause, zuletzt: new Date(i.last).toISOString(), verlauf: i.hist.slice(-6).map((h) => `${new Date(h.t).toISOString().slice(11, 19)} ${h.text}`) })),
    pruefungen: health.checks.map((c) => ({ id: c.id, zuletzt: c.lastResult ? new Date(c.lastResult.t).toISOString() : null, ergebnis: c.lastResult?.text || 'noch nicht geprüft' })),
    protokoll: includeLog ? H.log.slice(-40).map((l) => `${new Date(l.t).toISOString().slice(0, 19)} ${l.ok === true ? 'OK ' : l.ok === false ? 'ERR' : '   '} ${l.text}`) : [],
    hinweis: 'Ohne Chatinhalte, Notizen, Projekte, Namen, Tokens und Zugangsdaten. Wird nur nach ausdrücklicher Zustimmung übertragen.',
  };
  // zweite Sicherung: alles noch einmal durch den Filter
  return JSON.parse(redact(JSON.stringify(rep)));
}

// ---------------------------------------------------------------- Start
let started = false;
/** Startet Überwachung und Feedback-Kreislauf. deps kommen aus app.js (keine Kreis-Importe). */
export function startHealth(deps) {
  if (started) return;
  started = true;
  H.deps = deps;
  load();
  // offene Reparaturen eines früheren Starts nicht als „läuft“ stehen lassen
  for (const it of H.issues.values()) { it.undo = null; if (it.status === 'repairing') it.status = 'detected'; }
  installChecks(deps);
  window.addEventListener('error', (e) => { if (e.error || e.message) uiError('Skriptfehler', e.error || new Error(e.message)); });
  window.addEventListener('unhandledrejection', (e) => { const m = e.reason?.message || String(e.reason || ''); if (!/abgebrochen|AbortError/i.test(m)) uiError('Unbehandelter Fehler', e.reason instanceof Error ? e.reason : new Error(m)); });
  window.addEventListener('offline', () => report('offline', { cause: 'Keine Internetverbindung' }));
  window.addEventListener('online', () => { clear('offline', 'Internetverbindung wiederhergestellt'); flushQueue(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) runChecks(); });
  if (!navigator.onLine) report('offline', { cause: 'Keine Internetverbindung' });
  // Takt: alle 30 s fällige Prüfungen – nur bei sichtbarem Fenster; jede Prüfung hat ihr eigenes Intervall
  H.timer = setInterval(() => { if (!document.hidden) runChecks(); }, 30000);
  setTimeout(() => runChecks(), deps.firstDelay ?? 6000);
}

// ---------------------------------------------------------------- Prüfungen und Reparaturen der Bereiche
function installChecks(d) {
  const st = () => store.get();
  const ollamaExperts = () => st().experts.filter((e) => e.provider === 'ollama' && e.enabled);
  const usesOllama = () => ollamaExperts().length > 0; // nur überwachen, wenn wirklich ein lokales Modell genutzt wird (keine unnötigen Warnungen)

  // Ollama + Modelle
  addCheck({
    id: 'ollama', label: 'Ollama und KI-Modelle', interval: 60000, timeout: 20000, clears: ['ollama-down', 'model-missing'], when: usesOllama,
    async run() {
      const o = await d.mm.ollamaState();
      if (!o.running) return { ok: false, code: 'ollama-down', cause: `Ollama nicht erreichbar${o.error ? ` (${o.error})` : ''}` };
      const names = new Set(o.installed.map((m) => m.name));
      const missing = ollamaExperts().filter((e) => !names.has(e.model) && !names.has(`${e.model}:latest`));
      return [{ ok: true }, ...missing.map((e) => ({ ok: false, code: 'model-missing', subject: e.model, cause: `Modell „${e.model}“ ist in Ollama nicht vorhanden` }))];
    },
  });
  addRepair('ollama-down', {
    label: 'Verbindung zu Ollama neu aufbauen und Modellstatus aktualisieren', risk: 'safe', reversible: true, maxAttempts: 2, timeout: 30000,
    async run() {
      for (const wait of [0, 1500, 4000]) { if (wait) await new Promise((r) => setTimeout(r, wait)); const o = await d.mm.ollamaState(); if (o.running) break; }
      await d.mm.connectInstalled().catch(() => 0);
      await d.mm.snapshot({ fresh: true }).catch(() => null);
      return { text: 'Ollama antwortet wieder, Modelle neu verbunden' };
    },
    async verify() { return (await d.mm.ollamaState()).running; },
  });
  const alternatives = async (bad) => { const o = await d.mm.ollamaState(); return o.installed.map((m) => m.name).filter((n) => n !== bad); };
  // Nur das eine Ersatzmodell verbinden/aktivieren und das defekte abwählen – Rückgängig stellt genau den Vorzustand her
  const switchTo = async (bad, alt) => {
    const before = st().experts.filter((e) => e.provider === 'ollama').map((e) => ({ id: e.id, enabled: e.enabled }));
    let added = null;
    if (!st().experts.some((e) => e.provider === 'ollama' && e.model === alt)) {
      const ex = d.providers.makeExpert({ provider: 'ollama', vendorKey: 'ollama', model: alt, label: `${alt} · Ollama`, cost: 'free', local: true });
      actions.upsertExpert(ex); added = ex.id;
    }
    st().experts.filter((e) => e.provider === 'ollama').forEach((e) => {
      if (e.model === bad && e.enabled) actions.updateExpert(e.id, { enabled: false });
      if (e.model === alt && !e.enabled) actions.updateExpert(e.id, { enabled: true });
    });
    return async () => {
      before.forEach((b) => actions.updateExpert(b.id, { enabled: b.enabled }));
      if (added) actions.removeExpert(added);
    };
  };
  const altRepair = (label) => ({
    label, risk: 'consent', reversible: true, maxAttempts: 2, timeout: 20000,
    async run(it) {
      const alts = await alternatives(it.subject);
      if (!alts.length) throw new Error('Kein anderes kostenloses Modell installiert');
      it.alt = alts[0];
      const undoFn = await switchTo(it.subject, alts[0]);
      return { text: `Auf „${alts[0]}“ umgestellt`, undo: undoFn, undoLabel: `Wieder „${it.subject}“ verwenden` };
    },
    async verify(it) {
      const ex = st().experts.find((e) => e.provider === 'ollama' && e.model === it.alt);
      if (!ex || !ex.enabled) return false;
      await (await import('./ai/busy.js')).answering.idle();
      const r = await d.providers.callExpert(ex, [{ role: 'user', content: 'Antworte nur mit OK.' }], st().settings, { timeout: 120000, maxTokens: 32 });
      return !!(r && r.content);
    },
  });
  addRepair('model-missing', altRepair('Ein vorhandenes kostenloses Modell verwenden'));
  addRepair('model-switch-failed', altRepair('Auf ein anderes vorhandenes Modell wechseln'));
  addRepair('model-error', {
    label: 'Modellverbindung prüfen, Modell entladen und neu verbinden', risk: 'safe', reversible: true, maxAttempts: 2, timeout: 150000,
    async run(it) {
      const o = await d.mm.ollamaState();
      if (!o.running) throw new Error('Ollama nicht erreichbar');
      if (!o.installed.some((m) => m.name === it.subject || m.name === `${it.subject}:latest`)) throw new Error('Modell nicht installiert');
      const hw = await d.mm.detectHardware().catch(() => ({}));
      if (hw.ramGB && o.loaded.length > 1) for (const m of o.loaded) if (m.name !== it.subject) await d.mm.setLoaded(m.name, false).catch(() => {});
      await d.mm.setLoaded(it.subject, false).catch(() => {});
      const ex = st().experts.find((e) => e.provider === 'ollama' && e.model === it.subject);
      if (ex) actions.updateExpert(ex.id, { status: 'unknown', lastError: '' });
      return { text: 'Modell entladen und neu verbunden' };
    },
    async verify(it) {
      const ex = st().experts.find((e) => e.provider === 'ollama' && e.model === it.subject);
      if (!ex) return false;
      await (await import('./ai/busy.js')).answering.idle();
      const r = await d.providers.callExpert(ex, [{ role: 'user', content: 'Antworte nur mit OK.' }], st().settings, { timeout: 120000, maxTokens: 32 });
      return !!(r && r.content);
    },
  });

  // Modellstatus aus dem Store (ereignisgesteuert, keine Abfrage): ein aktives lokales Modell meldet Fehler
  let scanT = null;
  // 4.1: nur das AKTIVE Modell (bestätigt per Testprompt oder manuell gewählt) ist ein Problem für den Nutzer.
  // Ein anderes installiertes, defektes Modell wird im Bereich KI-Modelle als „Fehlerhaft“ gezeigt – ohne Warnung.
  const activeModel = () => { const s = st().settings; if (s.modelChoice && s.modelChoice !== 'auto') return st().experts.find((x) => x.id === s.modelChoice)?.model || ''; return s.aiAuto?.verifiedAt ? s.aiAuto.model : ''; };
  const scanModels = () => {
    const act = activeModel();
    for (const e of st().experts) {
      if (e.provider !== 'ollama' || !e.enabled) continue;
      if (act && e.model !== act) { const it = H.issues.get(keyOf('model-error', e.model)); if (it && !['fixed', 'ok'].includes(it.status)) clear(it.key, 'Nicht das aktive Modell – Status unter KI-Modelle'); continue; }
      const key = keyOf('model-error', e.model);
      if (e.status === 'error') { const it = H.issues.get(key); if (!it || ['fixed', 'ok'].includes(it.status)) report('model-error', { subject: e.model, cause: `Modell „${e.model}“ meldet einen Fehler: ${e.lastError || 'unbekannt'}` }); }
      else if (e.status === 'ok') clear(key, 'Modell antwortet wieder');
    }
  };
  store.subscribe(() => { clearTimeout(scanT); scanT = setTimeout(scanModels, 500); });

  // Windows-Agent
  addCheck({
    id: 'agent', label: 'Windows-Agent', interval: 45000, timeout: 8000, clears: ['agent-timeout', 'agent-disconnected'],
    when: () => d.agentState.connected || d.inApp(),
    async run() {
      if (!d.agentState.connected) return { ok: false, code: 'agent-disconnected', cause: d.agentState.error || 'Integrierter Agent nicht verbunden' };
      try { await d.agentClient.ping(); return { ok: true }; } catch (e) { return { ok: false, code: 'agent-timeout', cause: `Agent reagiert nicht (${e.message})` }; }
    },
  });
  const agentRepair = {
    label: 'Agent erneut verbinden, bei Bedarf kontrolliert neu starten', risk: 'safe', reversible: true, maxAttempts: 2, timeout: 45000,
    when: () => d.inApp(), whyNot: 'Im Browser wurde der Agent von Hand gestartet – bitte dort neu starten.',
    async run(it) {
      if (d.agentState.stopped) throw new Error('Agent im Not-Stopp – erst im Bereich Aktionen fortsetzen');
      const r = await d.autoConnectApp(8000);
      if (r.ok) return { text: 'Agent wieder verbunden' };
      hist(it, 'Wiederverbindung fehlgeschlagen – kontrollierter Neustart des integrierten Agenten', null);
      await d.agentClient.restartApp();
      return { text: 'Agent neu gestartet und verbunden' };
    },
    async verify() { if (!d.agentState.connected) return false; await d.agentClient.ping(); await d.agentClient.refreshPerms(); d.providers.ollamaViaAgent(); return true; },
  };
  addRepair('agent-timeout', agentRepair);
  addRepair('agent-disconnected', agentRepair);

  // Sprachassistent (nur melden, wenn der Nutzer Sprache nutzt – keine unnötigen Warnungen)
  addCheck({
    id: 'voice', label: 'Sprachassistent', interval: 300000, clears: ['stt-unavailable', 'tts-unavailable'],
    when: () => st().settings.voiceOutput || st().settings.conversationMode,
    async run() {
      const out = [{ ok: true }];
      if (st().settings.voiceOutput && !d.voice.ttsSupported) out.push({ ok: false, code: 'tts-unavailable', cause: 'Sprachausgabe auf diesem Gerät nicht verfügbar' });
      if (st().settings.conversationMode && !d.voice.sttSupported) out.push({ ok: false, code: 'stt-unavailable', cause: d.voice.sttReason || 'Spracherkennung nicht verfügbar' });
      return out;
    },
  });
  addRepair('stt-unavailable', {
    label: 'Spracherkennung des Agenten erneut abfragen', risk: 'safe', reversible: true, maxAttempts: 1, timeout: 50000,
    when: () => d.inApp() && d.agentState.connected, whyNot: 'Spracherkennung dieses Browsers fehlt – Chrome/Edge verwenden oder die Windows-App.',
    async run() { const s = await d.agentClient.speechStatus(); d.voice.useAgent((wav, lang) => d.agentClient.speechRecognize(wav, lang), s); return { text: 'Spracherkennung neu eingerichtet' }; },
    async verify() { return !!d.voice.sttSupported; },
  });

  // Daten und Ressourcen
  addCheck({ id: 'storage', label: 'Lokale Daten', interval: 120000, clears: ['storage-error'], async run() { return store.storageOk() ? { ok: true } : { ok: false, code: 'storage-error', cause: 'Lokaler Speicher schreibt nicht' }; } });
  addCheck({
    id: 'resources', label: 'Ressourcen der Oberfläche', interval: 120000, clears: ['memory-high'],
    async run() {
      const m = performance.memory;
      if (!m || !m.jsHeapSizeLimit) return { ok: true };
      const pct = Math.round((m.usedJSHeapSize / m.jsHeapSizeLimit) * 100);
      return pct > 80 ? { ok: false, code: 'memory-high', cause: `Oberfläche nutzt ${pct} % ihres Speichers` } : { ok: true };
    },
  });
  // Oberfläche: wieder fehlerfrei gezeichnet → offene UI-Fehler der aktuellen Ansicht schließen
  addRepair('ui-error', {
    label: 'Ansicht aus dem gespeicherten Zustand neu aufbauen', risk: 'safe', reversible: true, maxAttempts: 2, timeout: 10000,
    async run() { d.rerender?.(); return { text: 'Ansicht neu aufgebaut, Daten unverändert' }; },
    async verify(it) { const before = it.count; await new Promise((r) => setTimeout(r, 400)); return d.uiHealthy?.() !== false && it.count === before; },
  });
  addRepair('view-load', {
    label: 'Ansicht erneut laden', risk: 'safe', reversible: true, maxAttempts: 2, timeout: 20000,
    async run(it) { await d.reloadView?.(it.subject); return { text: 'Ansicht geladen' }; },
    async verify(it) { return d.viewLoaded?.(it.subject) === true; },
  });
}
