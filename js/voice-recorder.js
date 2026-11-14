// Mikrofonaufnahme für die lokale Spracherkennung (Windows-App: der Agent erkennt mit System.Speech).
// Nimmt nur nach ausdrücklichem Start auf, zeigt den Pegel, stoppt automatisch nach Sprechpause oder Höchstdauer
// und liefert eine WAV-Datei (16 kHz, mono, 16 Bit). Nichts wird gespeichert oder versendet außer an den lokalen Agenten.

const RATE = 16000;

/** Startet eine Aufnahme. Rückgabe: { done: Promise<Uint8Array|null>, stop(), cancel() }.
 *  done liefert null, wenn nichts gesprochen wurde oder abgebrochen ist. */
export function startRecording({ onLevel, onSpeech, maxMs = 20000, silenceMs = 1300, noSpeechMs = 7000, threshold = 0.025 } = {}) {
  let stream, ctx, proc, src, timer;
  const chunks = [];
  let inRate = 48000;
  let spoke = false, lastVoice = 0, finished = false;
  let resolveDone, rejectDone;
  const done = new Promise((res, rej) => { resolveDone = res; rejectDone = rej; });
  const cleanup = () => {
    clearTimeout(timer);
    try { proc && (proc.onaudioprocess = null); proc?.disconnect(); src?.disconnect(); } catch { /* egal */ }
    stream?.getTracks().forEach((t) => t.stop());
    ctx?.close().catch(() => {});
  };
  const finish = (keep) => {
    if (finished) return;
    finished = true;
    cleanup();
    if (!keep || !spoke || !chunks.length) return resolveDone(null);
    resolveDone(encodeWav(downsample(concat(chunks), inRate, RATE), RATE));
  };
  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    } catch (e) {
      finished = true;
      const err = new Error(e.name === 'NotAllowedError' ? 'Mikrofonzugriff wurde verweigert.' : e.name === 'NotFoundError' ? 'Kein Mikrofon gefunden.' : `Mikrofon nicht verfügbar (${e.name || e.message}).`);
      err.code = e.name === 'NotAllowedError' ? 'not-allowed' : 'audio-capture';
      return rejectDone(err);
    }
    if (finished) { stream.getTracks().forEach((t) => t.stop()); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    inRate = ctx.sampleRate;
    src = ctx.createMediaStreamSource(stream);
    proc = ctx.createScriptProcessor(4096, 1, 1);
    const t0 = performance.now();
    proc.onaudioprocess = (e) => {
      if (finished) return;
      const d = e.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(d));
      let sum = 0;
      for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
      const rms = Math.sqrt(sum / d.length);
      onLevel?.(Math.min(1, rms * 8));
      const now = performance.now();
      if (rms > threshold) { lastVoice = now; if (!spoke) { spoke = true; onSpeech?.(); } }
      if (spoke && now - lastVoice > silenceMs) finish(true);           // Sprechpause → fertig
      else if (!spoke && now - t0 > noSpeechMs) finish(false);           // nichts gesagt
    };
    src.connect(proc);
    proc.connect(ctx.destination);
    timer = setTimeout(() => finish(true), maxMs);                       // Höchstdauer
  })();
  return { done, stop: () => finish(true), cancel: () => finish(false) };
}

function concat(list) {
  const out = new Float32Array(list.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of list) { out.set(a, o); o += a.length; }
  return out;
}

function downsample(data, from, to) {
  if (from === to) return data;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(data.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio), end = Math.min(data.length, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = start; j < end; j++) s += data[j];
    out[i] = s / Math.max(1, end - start);
  }
  return out;
}

export function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
