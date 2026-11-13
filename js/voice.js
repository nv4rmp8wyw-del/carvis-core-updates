// Sprachsteuerung mit kostenlosen Browser-APIs.
// - Spracherkennung: Web Speech API (Chrome/Edge/Safari). Hinweis: Chrome & Edge senden Audio
//   zur Erkennung an Server von Google bzw. Microsoft; Safari nutzt Apple-Dienste.
// - Sprachausgabe: speechSynthesis (lokal/systemabhängig).
// - Mikrofonpegel: getUserMedia + AnalyserNode (nur Desktop; auf iOS deaktiviert, weil es dort mit
//   der Spracherkennung kollidieren kann).
import { isIOS } from './util.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

const ERRORS = {
  'not-allowed': 'Mikrofonzugriff wurde verweigert. Bitte im Browser erlauben.',
  'service-not-allowed': 'Spracherkennung ist in diesem Browser/Modus nicht erlaubt.',
  'no-speech': 'Ich habe nichts gehört.',
  'audio-capture': 'Kein Mikrofon gefunden.',
  network: 'Spracherkennung braucht eine Internetverbindung.',
  aborted: null,
  'language-not-supported': 'Deutsch wird für die Spracherkennung nicht unterstützt.',
};

export const voice = {
  sttSupported: !!SR,
  ttsSupported: 'speechSynthesis' in window,
  wakeSupported: !!SR && !isIOS(),
  listening: false,
  rec: null,
  wake: null,
  wakeOn: false,
  audio: null,

  /** Einmal pro Nutzergeste aufrufen, damit iOS später Sprache ausgeben darf. */
  unlock() {
    if (this._unlocked || !this.ttsSupported) return;
    this._unlocked = true;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    } catch { /* ignorieren */ }
  },

  listen({ lang = 'de-DE', onStart, onInterim, onFinal, onEnd, onError, onLevel } = {}) {
    if (!SR) { onError?.('Spracherkennung wird von diesem Browser nicht unterstützt (z. B. Firefox). Nutze Chrome, Edge oder Safari.'); return; }
    if (this.listening) return;
    this.pauseWake();
    this.cancelSpeak();
    const rec = new SR();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = '';
    let errored = false;
    rec.onstart = () => {
      this.listening = true;
      onStart?.();
      if (onLevel && !isIOS()) this.startLevel(onLevel);
    };
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      onInterim?.((finalText + ' ' + interim).trim());
      if (onLevel && isIOS()) onLevel(0.5 + Math.random() * 0.4); // Ersatzpegel bei erkannter Sprache
    };
    rec.onerror = (e) => {
      errored = true;
      const msg = ERRORS[e.error] === undefined ? `Spracherkennung: ${e.error}` : ERRORS[e.error];
      if (msg) onError?.(msg, e.error);
    };
    rec.onend = () => {
      this.listening = false;
      this.rec = null;
      this.stopLevel();
      onEnd?.(finalText.trim(), errored);
      if (finalText.trim()) onFinal?.(finalText.trim());
      this.resumeWake();
    };
    this.rec = rec;
    try { rec.start(); } catch (e) { onError?.('Spracherkennung konnte nicht gestartet werden.'); this.listening = false; }
  },

  stop() { try { this.rec?.stop(); } catch { /* ignorieren */ } },

  async startLevel(onLevel) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (!this.listening) { stream.getTracks().forEach((t) => t.stop()); return; }
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      const tick = () => {
        if (!this.audio) return;
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 5));
        this.audio.raf = requestAnimationFrame(tick);
      };
      this.audio = { stream, ctx };
      tick();
    } catch {
      /* Pegel ist optional – Spracherkennung läuft trotzdem */
    }
  },

  stopLevel() {
    if (!this.audio) return;
    cancelAnimationFrame(this.audio.raf);
    this.audio.stream.getTracks().forEach((t) => t.stop());
    this.audio.ctx.close().catch(() => {});
    this.audio = null;
  },

  // ---- Sprachausgabe ----
  voices() { return this.ttsSupported ? speechSynthesis.getVoices() : []; },

  pickVoice(name, lang = 'de-DE') {
    const list = this.voices();
    return list.find((v) => v.name === name) || list.find((v) => v.lang === lang && /premium|enhanced|natural|neural/i.test(v.name)) || list.find((v) => v.lang === lang) || list.find((v) => v.lang?.startsWith(lang.slice(0, 2)));
  },

  /** Geschlecht der Stimme: Browser melden es nicht. Grobe Schätzung nach bekannten Stimmennamen, kann falsch sein. */
  guessGender(name = '') {
    if (/\b(anna|petra|marlene|vicki|katja|hedda|amala|seraphina|zira|samantha|victoria|karen|serena|susan|hazel|helena|ingrid|female|weiblich|google deutsch|elsa|ava|jenny|aria|sonia|libby|emma|katharina|maja|vera|lena)\b/i.test(name)) return 'weiblich';
    if (/\b(markus|yannick|stefan|daniel|conrad|killian|florian|jonas|alex|tom|david|mark|male|männlich|hans|stefan|ryan|guy|george|james|thomas|reed|rishi|bernd|jan|klaus)\b/i.test(name)) return 'männlich';
    return 'unbekannt';
  },

  _gen: 0,
  _finish: null,

  /** Zerlegt Text in Sätze mit kurzen Sprechpausen und leichter Betonung (Frage: höher, Ausruf: etwas schneller). */
  splitSpeech(text) {
    const clean = String(text).replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();
    const raw = clean.match(/[^.!?…:;]+[.!?…:;]*\s*/g) || [clean];
    const out = [];
    for (const r of raw) {
      const t = r.trim();
      if (!t) continue;
      const end = t.slice(-1);
      const prev = out[out.length - 1];
      if (prev && prev.t.length < 18 && !/[.!?…]$/.test(prev.t)) { prev.t += ' ' + t; prev.pause = 0; continue; }
      out.push({ t, pause: end === '?' ? 320 : end === '!' ? 260 : end === ':' || end === ';' ? 160 : 230, rate: end === '!' ? 1.04 : 1, pitch: end === '?' ? 1.06 : 1 });
    }
    if (out.length) out[out.length - 1].pause = 0;
    return out;
  },

  /**
   * onBlocked wird aufgerufen, wenn der Browser die Ausgabe ohne vorherige Nutzerinteraktion
   * verweigert (Autoplay-Regel) – dann muss der Nutzer einmal tippen/klicken.
   * Der Text wird satzweise mit kurzen Pausen gesprochen. Die Klangqualität bestimmt die gewählte Systemstimme.
   */
  speak(text, { voiceName, lang = 'de-DE', rate = 1, pitch = 1, onStart, onEnd, onBoundary, onBlocked } = {}) {
    if (!this.ttsSupported || !text) { onEnd?.(); return; }
    this.cancelSpeak();
    const gen = ++this._gen;
    const parts = this.splitSpeech(text);
    if (!parts.length) { onEnd?.(); return; }
    const v = this.pickVoice(voiceName, lang);
    let done = false;
    let started = false;
    let inPause = false;
    let i = 0;
    let pauseT = 0;
    const finish = () => { if (done) return; done = true; clearInterval(watch); clearTimeout(startTimer); clearTimeout(pauseT); if (this._finish === finish) this._finish = null; onEnd?.(); };
    this._finish = finish;
    const next = () => {
      inPause = false;
      if (gen !== this._gen || done) return;
      if (i >= parts.length) { finish(); return; }
      const part = parts[i++];
      const u = new SpeechSynthesisUtterance(part.t);
      u.lang = lang;
      u.rate = Math.max(0.5, Math.min(2, rate * part.rate));
      u.pitch = Math.max(0, Math.min(2, pitch * part.pitch));
      if (v) u.voice = v;
      u.onstart = () => { if (!started) { started = true; onStart?.(); } };
      u.onboundary = () => onBoundary?.();
      u.onend = () => { if (gen !== this._gen || done) return; inPause = true; pauseT = setTimeout(next, part.pause); };
      u.onerror = (e) => {
        if (gen !== this._gen || done) return;
        if (!started && (e.error === 'not-allowed' || !this._unlocked)) { done = true; clearInterval(watch); clearTimeout(startTimer); onBlocked?.(); return; }
        if (e.error === 'interrupted' || e.error === 'canceled') return;
        next();
      };
      speechSynthesis.speak(u);
    };
    // Safari meldet eine Blockade nicht – startet die Ausgabe nicht, gilt sie als blockiert
    const startTimer = setTimeout(() => {
      if (!started && !done && !this._unlocked) { done = true; clearInterval(watch); speechSynthesis.cancel(); onBlocked?.(); }
    }, 1800);
    // Sicherheitsnetz: manche Browser feuern onend nicht zuverlässig
    const t0 = Date.now();
    const watch = setInterval(() => {
      if (started && !inPause && !speechSynthesis.speaking && !speechSynthesis.pending) finish();
      else if (!started && Date.now() - t0 > 8000) finish(); // Ausgabe kam nie zustande
    }, 400);
    next();
  },

  cancelSpeak() {
    if (!this.ttsSupported) return;
    const f = this._finish;
    this._gen++;
    speechSynthesis.cancel();
    f?.(); // meldet das Ende der unterbrochenen Ausgabe wie bisher
  },
  isSpeaking() { return this.ttsSupported && (speechSynthesis.speaking || speechSynthesis.pending); },

  // ---- Wake-Word „Hey C“ (experimentell, nur Desktop, nur solange der Tab offen & sichtbar ist) ----
  startWake(onWake, { lang = 'de-DE', onState } = {}) {
    if (!this.wakeSupported) return false;
    this.wakeOn = true;
    this._onWake = onWake;
    this._wakeLang = lang;
    this._onWakeState = onState;
    this.resumeWake();
    return true;
  },

  stopWake() {
    this.wakeOn = false;
    this.pauseWake();
    this._onWakeState?.(false);
  },

  pauseWake() {
    if (this.wake) {
      const w = this.wake;
      this.wake = null;
      w.onend = null;
      try { w.abort(); } catch { /* ignorieren */ }
    }
  },

  resumeWake() {
    if (!this.wakeOn || this.wake || this.listening || document.hidden) return;
    const w = new SR();
    w.lang = this._wakeLang;
    w.continuous = true;
    w.interimResults = true;
    w.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const txt = e.results[i][0].transcript.toLowerCase();
        const m = txt.match(/\b(?:hey|hallo|hi|okay|ok)[,\s]+(?:c|cee|see|zeh|ce|sie|zee|ze|carvis)\b[,.!\s]*(.*)$/);
        if (m && (e.results[i].isFinal || !m[1])) {
          const rest = (m[1] || '').trim();
          this.pauseWake();
          this._onWake?.(rest);
          return;
        }
      }
    };
    w.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.wakeOn = false;
        this._onWakeState?.(false, 'Mikrofon für Wake-Word nicht erlaubt.');
      }
    };
    w.onend = () => {
      this.wake = null;
      setTimeout(() => this.resumeWake(), 350); // Browser beenden die Erkennung regelmäßig – neu starten
    };
    this.wake = w;
    try { w.start(); this._onWakeState?.(true); } catch { this.wake = null; }
  },
};

document.addEventListener('visibilitychange', () => {
  if (document.hidden) voice.pauseWake();
  else voice.resumeWake();
});
