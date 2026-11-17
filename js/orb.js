// CARVIS-Orb (4.1): eigenständiger, flüssiger Lichtkörper – Canvas 2D, ohne Bibliotheken, ohne fremde Grafiken.
// Aufbau: dunkle Glaskugel mit innen kreisenden Farbströmen (Cyan · Blau · Violett · Rosé), weicher Randschimmer,
// je Zustand andere Farben, Tempo und Ausdehnung. Reagiert auf den echten Mikrofonpegel (setLevel) und auf
// Wortgrenzen der Sprachausgabe (kick). Gleiche Schnittstelle wie der frühere HoloCore (Austausch ohne Umbau).
// Zustände: idle (bereit) · listening (hört zu) · heard (Sprache erkannt) · thinking (verarbeitet) · speaking (antwortet)
// · executing (Aktion) · success (Erfolg) · error. Pegel: echtes Mikrofon (setLevel); Sprachausgabe: Wortgrenzen (kick) –
// Browser und Windows liefern keinen echten Ausgabepegel, deshalb kein vorgetäuschter Pegel (nur Rhythmus).

const STATES = {
  idle:      { hues: [186, 222, 258, 272], speed: 0.35, swell: 0.0,  bright: 0.78, spin: 0.15, ring: 0.25 },
  listening: { hues: [180, 205, 240, 268], speed: 0.6,  swell: 0.12, bright: 1.0,  spin: 0.25, ring: 0.9 },
  heard:     { hues: [176, 200, 232, 266], speed: 0.9,  swell: 0.16, bright: 1.1,  spin: 0.4,  ring: 1.0 },
  thinking:  { hues: [228, 256, 282, 205], speed: 1.6,  swell: 0.04, bright: 0.92, spin: 1.2,  ring: 0.55 },
  speaking:  { hues: [188, 214, 252, 274], speed: 0.85, swell: 0.1,  bright: 1.05, spin: 0.35, ring: 0.7 },
  executing: { hues: [158, 175, 200, 140], speed: 1.0,  swell: 0.08, bright: 1.0,  spin: 0.6,  ring: 0.8 },
  success:   { hues: [150, 168, 190, 130], speed: 0.7,  swell: 0.1,  bright: 1.1,  spin: 0.3,  ring: 0.9 },
  error:     { hues: [355, 12, 330, 25],   speed: 0.3,  swell: 0.0,  bright: 0.85, spin: 0.1,  ring: 0.8 },
};
const lerp = (a, b, k) => a + (b - a) * k;
// Farbtöne auf dem kürzeren Weg überblenden
const lerpHue = (a, b, k) => { const d = ((b - a + 540) % 360) - 180; return (a + d * k + 360) % 360; };

export class Orb {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = 'idle';
    this.cur = { ...STATES.idle, hues: [...STATES.idle.hues] };
    this.level = 0; this.levelTarget = 0; this.externalLevel = false;
    this.t = Math.random() * 100;
    this.last = performance.now();
    this.pulses = [];
    this.light = false;
    this.speedK = 1; this.glowK = 1;
    this.visible = true;
    this.reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    // Farbströme: Phase, Bahnradius, Größe, Eigenrotation
    this.blobs = Array.from({ length: 4 }, (_, i) => ({ ph: i * 1.7 + Math.random(), orbit: 0.22 + i * 0.05, size: 0.62 - i * 0.05, rate: 0.55 + i * 0.18, dir: i % 2 ? -1 : 1 }));
    // v1.2 (D-054): Die Kugel ist das offizielle Logo (icons/brand/cc-orb-core.png, unverändert). Zustände zeigen sich
    // über Halo, Ringe und Impulse um das Logo. Bis das Bild geladen ist: bisherige gezeichnete Kugel als Rückfall.
    this.logo = new Image();
    this.logo.decoding = 'async';
    this.logo.onload = () => { this.logoOk = true; if (this.reduceMotion) this.draw(); };
    this.logo.src = 'icons/brand/cc-orb-core.png';
    this.resize = this.resize.bind(this);
    this.frame = this.frame.bind(this);
    new ResizeObserver(this.resize).observe(canvas);
    this.resize();
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.visible) { this.last = performance.now(); this.raf ||= requestAnimationFrame(this.frame); } });
    this.raf = requestAnimationFrame(this.frame);
  }

  setActive(v) { this.visible = v; if (v && !document.hidden) { this.last = performance.now(); this.raf ||= requestAnimationFrame(this.frame); } }
  setReducedMotion(v) { this.reduceMotion = v || (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false); }
  setState(s) {
    if (!STATES[s] || s === this.state) return;
    this.state = s;
    this.c.dataset.state = s;
    if (s === 'listening' || s === 'speaking') this.pulse(0.7);
    if (s === 'error' || s === 'executing' || s === 'success' || s === 'heard') this.pulse(s === 'heard' ? 0.6 : 1);
  }
  /** Echter Audiopegel 0..1 (Mikrofon). */
  setLevel(v) { this.externalLevel = true; this.levelTarget = Math.max(0, Math.min(1, v)); }
  clearLevel() { this.externalLevel = false; this.levelTarget = 0; }
  /** Impuls bei Wortgrenzen der Sprachausgabe */
  kick(v = 0.6) { this.level = Math.max(this.level, v); }
  pulse(a = 0.7) { if (this.pulses.length < 4) this.pulses.push({ r: 0.5, a }); }
  /** Theme: Hell/Dunkel und Tempo (glow/speed aus der Design-Einstellung) */
  setTheme({ glow = 1, speed = 1, light } = {}) { this.glowK = Math.max(0.3, Math.min(1.5, glow * 1.6)); this.speedK = speed; if (light !== undefined) this.light = light; else this.light = document.documentElement.dataset.theme === 'light'; }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.c.getBoundingClientRect();
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.c.width = Math.round(this.w * dpr); this.c.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.reduceMotion) this.draw();
  }

  frame(now) {
    this.raf = null;
    if (document.hidden || !this.visible) return;
    if (now - this.last < 15) { this.raf = requestAnimationFrame(this.frame); return; } // max. ca. 60 FPS
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.update(dt);
    this.draw();
    // Bei reduzierter Bewegung nur wenige Bilder pro Sekunde (Zustandswechsel bleiben sichtbar)
    if (this.reduceMotion) { setTimeout(() => { this.raf ||= requestAnimationFrame(this.frame); }, 250); return; }
    this.raf = requestAnimationFrame(this.frame);
  }

  update(dt) {
    const tg = STATES[this.state];
    const k = 1 - Math.pow(0.03, dt);
    for (const key of ['speed', 'swell', 'bright', 'spin', 'ring']) this.cur[key] = lerp(this.cur[key], tg[key], k);
    this.cur.hues = this.cur.hues.map((h, i) => lerpHue(h, tg.hues[i], k));
    if (!this.externalLevel) {
      // ohne Mikrofon: ruhiges Atmen bzw. Sprech-Rhythmus
      const auto = this.state === 'speaking' ? 0.25 + 0.2 * Math.abs(Math.sin(this.t * 7)) : this.state === 'thinking' ? 0.15 : 0.04 + 0.04 * Math.sin(this.t * 1.3);
      this.levelTarget = Math.max(auto, this.levelTarget * 0.9);
    }
    this.level = lerp(this.level, this.levelTarget, 1 - Math.pow(0.0005, dt));
    this.t += dt * (this.reduceMotion ? 0.15 : this.cur.speed * this.speedK);
    this.pulses.forEach((p) => { p.r += dt * 0.55; p.a *= Math.pow(0.18, dt); });
    this.pulses = this.pulses.filter((p) => p.a > 0.02 && p.r < 1.6);
  }

  draw() {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const base = Math.min(w, h) * 0.3;
    const lvl = this.level;
    const R = base * (1 + this.cur.swell * 0.6 + lvl * 0.22 + (this.state === 'error' ? Math.sin(this.t * 40) * 0.004 : 0));
    const [h1, h2, h3, h4] = this.cur.hues;
    const L = this.light;

    // 1 Weicher Außenschimmer (Halo)
    const halo = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * (1.9 + lvl * 0.6));
    halo.addColorStop(0, `hsla(${h2}, 90%, ${L ? 62 : 60}%, ${0.32 * this.cur.bright * this.glowK})`);
    halo.addColorStop(0.5, `hsla(${h3}, 90%, 60%, ${0.1 * this.glowK})`);
    halo.addColorStop(1, 'hsla(0,0%,0%,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cx, cy, R * 2.6, 0, Math.PI * 2); ctx.fill();

    // 2 Offizielles Logo als Kugel (atmet leicht); sonst gezeichneter Rückfall (Schritte 2–4b)
    if (this.logoOk) {
      const sz = R * (272 / 266) * (1 + (this.reduceMotion ? 0 : 0.008 * Math.sin(this.t * 1.6)));
      ctx.drawImage(this.logo, cx - sz, cy - sz, sz * 2, sz * 2);
    } else {
    // 2 Kugelkörper
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    const body = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.35, R * 0.1, cx, cy, R);
    body.addColorStop(0, L ? `hsl(${h3}, 55%, 52%)` : `hsl(${h2}, 45%, 16%)`); // Hell: farbiger Körper, damit das weiße CC lesbar bleibt
    body.addColorStop(1, L ? 'hsl(238, 50%, 34%)' : 'hsl(250, 45%, 6%)');
    ctx.fillStyle = body; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

    // 3 Farbströme (additiv)
    ctx.globalCompositeOperation = 'lighter';
    const hues = [h1, h2, h3, h4];
    this.blobs.forEach((b, i) => {
      const a = this.t * b.rate * b.dir + b.ph;
      const orbit = R * (b.orbit + lvl * 0.12 + this.cur.swell * 0.4);
      const x = cx + Math.cos(a) * orbit, y = cy + Math.sin(a * 1.3 + i) * orbit * 0.8;
      const sz = R * (b.size + lvl * 0.25 + 0.05 * Math.sin(this.t * 2 + i));
      const g = ctx.createRadialGradient(x, y, 0, x, y, sz);
      const alpha = (L ? 0.6 : 0.75) * this.cur.bright;
      g.addColorStop(0, `hsla(${hues[i]}, 95%, ${L ? 62 : 58}%, ${alpha})`);
      g.addColorStop(0.55, `hsla(${hues[i]}, 95%, 50%, ${alpha * 0.35})`);
      g.addColorStop(1, `hsla(${hues[i]}, 95%, 50%, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, sz, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalCompositeOperation = 'source-over';

    // 4 Glanzlicht und Innenrand (Glas)
    const gloss = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.45, 0, cx - R * 0.35, cy - R * 0.45, R * 0.75);
    gloss.addColorStop(0, `rgba(255,255,255,${L ? 0.55 : 0.28})`);
    gloss.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gloss; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    ctx.restore();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = L ? 'rgba(30,40,80,0.12)' : `hsla(${h1}, 80%, 80%, ${0.18 + this.cur.ring * 0.2})`;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();

    // 4b CC-Zeichen in der Mitte (Geometrie aus icons/mark.svg: zwei Bögen r=108 um x=200/350 bei 512er-Fläche)
    {
      const k = (R * 0.62) / 183; // Zeichenbreite ≈ 62 % des Orb-Durchmessers
      const breath = 1 + (this.reduceMotion ? 0 : 0.015 * Math.sin(this.t * 1.6)) + lvl * 0.03;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineWidth = 40 * k * breath;
      ctx.strokeStyle = 'rgba(255,255,255,0.94)';
      ctx.shadowColor = L ? 'rgba(40,20,120,0.35)' : `hsla(${h3}, 90%, 70%, 0.55)`;
      ctx.shadowBlur = R * 0.08;
      for (const x0 of [200, 350]) {
        ctx.beginPath();
        ctx.arc(cx + (x0 - 275) * k * breath, cy, 108 * k * breath, 0.872, Math.PI * 2 - 0.872);
        ctx.stroke();
      }
      ctx.restore();
    }

    }

    // 4c feine konzentrische Lichtkreise (ruhig atmend)
    for (let i = 1; i <= 3; i++) {
      const rr = R * (1.22 + i * 0.16 + (this.reduceMotion ? 0 : 0.02 * Math.sin(this.t * 0.9 + i)));
      ctx.lineWidth = 1;
      ctx.strokeStyle = L ? `hsla(${[h2, h3, h4][i - 1]}, 70%, 45%, ${0.16 - i * 0.035})` : `hsla(${[h2, h3, h4][i - 1]}, 90%, 75%, ${0.2 - i * 0.045})`;
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
    }

    // 5 Zustandsring: hört zu (Pegel), verarbeitet (umlaufender Bogen)
    if (this.state === 'thinking') {
      const a0 = this.t * 2.2;
      ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.strokeStyle = `hsla(${h2}, 90%, ${L ? 50 : 70}%, 0.75)`;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.16, a0, a0 + Math.PI * 0.55); ctx.stroke();
    }
    if (this.state === 'listening' || this.state === 'speaking') {
      ctx.lineWidth = 1.5 + lvl * 3;
      ctx.strokeStyle = `hsla(${h1}, 95%, ${L ? 48 : 68}%, ${0.25 + lvl * 0.6})`;
      ctx.beginPath(); ctx.arc(cx, cy, R * (1.1 + lvl * 0.12), 0, Math.PI * 2); ctx.stroke();
    }
    // 6 Impulse (Zustandswechsel, Fehler)
    for (const p of this.pulses) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `hsla(${h1}, 95%, ${L ? 50 : 70}%, ${p.a * 0.5})`;
      ctx.beginPath(); ctx.arc(cx, cy, R * (1 + p.r), 0, Math.PI * 2); ctx.stroke();
    }
  }
}
