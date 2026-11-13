// Holografischer KI-Kern – Canvas 2D, ohne Bibliotheken.
// Zustände: idle | listening | thinking | speaking | error

const PRESETS = {
  idle:      { hue: 192, sat: 100, speed: 0.22, intensity: 0.78, spread: 1.0,  particles: 0.45, wave: 0.15, jitter: 0 },
  listening: { hue: 186, sat: 100, speed: 0.42, intensity: 1.0,  spread: 1.07, particles: 0.75, wave: 1.0,  jitter: 0 },
  thinking:  { hue: 218, sat: 100, speed: 1.55, intensity: 0.95, spread: 0.92, particles: 1.0,  wave: 0.35, jitter: 0 },
  speaking:  { hue: 196, sat: 100, speed: 0.6,  intensity: 1.08, spread: 1.04, particles: 0.8,  wave: 1.0,  jitter: 0 },
  executing: { hue: 165, sat: 95,  speed: 1.1,  intensity: 1.05, spread: 1.12, particles: 1.0,  wave: 0.6,  jitter: 0 },
  error:     { hue: 352, sat: 95,  speed: 0.28, intensity: 0.9,  spread: 1.0,  particles: 0.3,  wave: 0.2,  jitter: 1 },
};

const RINGS = [
  { r: 1.18, tx: 1.15, tz: 0.25, sp: 0.9,  w: 1.6, dash: 0 },
  { r: 1.30, tx: 1.35, tz: -0.9, sp: -0.6, w: 1.1, dash: 1 },
  { r: 1.42, tx: 0.55, tz: 1.6,  sp: 0.45, w: 1.3, dash: 0 },
];

export class HoloCore {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = 'idle';
    this.p = { ...PRESETS.idle };
    this.level = 0;
    this.levelTarget = 0;
    this.externalLevel = false;
    this.t = 0;
    this.last = performance.now();
    this.pulses = [];
    this.pulseClock = 0;
    this.reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.hueOffset = 0; this.satK = 1; this.glowK = 1; this.speedK = 1; // Theme (setTheme)
    this.visible = true; // im GPT-Modus liegt der Kern außerhalb des Bildschirms: dann nicht zeichnen
    this.q = 1; // adaptive Qualität (Partikelanteil)
    this.cost = 4; // gleitender Mittelwert der Bildzeit in ms
    this.parts = Array.from({ length: 90 }, () => ({
      r: 0.75 + Math.random() * 0.95,
      a: Math.random() * Math.PI * 2,
      inc: (Math.random() - 0.5) * 2.4,
      sp: 0.4 + Math.random() * 1.2,
      s: 0.6 + Math.random() * 1.6,
      ph: Math.random() * 10,
    }));
    this.glow = this.makeGlow();
    this.resize = this.resize.bind(this);
    this.frame = this.frame.bind(this);
    new ResizeObserver(this.resize).observe(canvas);
    this.resize();
    const wake = () => { this.last = performance.now(); this.raf ||= requestAnimationFrame(this.frame); };
    document.addEventListener('visibilitychange', () => !document.hidden && this.visible && wake());
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Von der App gesteuert: false, wenn der CARVIS-Modus nicht sichtbar ist (Schleife ruht dann komplett). */
  setActive(v) {
    this.visible = v;
    if (v && !document.hidden) { this.last = performance.now(); this.raf ||= requestAnimationFrame(this.frame); }
  }

  setReducedMotion(v) { this.reduceMotion = v || (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false); }

  setState(s) {
    if (!PRESETS[s] || s === this.state) return;
    this.state = s;
    if (s === 'speaking' || s === 'listening') this.pulse(0.9);
    if (s === 'error') this.pulse(1);
    if (s === 'executing') { this.pulse(1); this.pulse(0.7); }
  }

  /** Echter Audiopegel 0..1 (z. B. Mikrofon). */
  setLevel(v) { this.externalLevel = true; this.levelTarget = Math.max(0, Math.min(1, v)); }
  clearLevel() { this.externalLevel = false; this.levelTarget = 0; }
  /** Kurzer Impuls, z. B. bei Wortgrenzen der Sprachausgabe. */
  kick(v = 0.6) { this.level = Math.max(this.level, v); if (Math.random() < 0.35) this.pulse(0.5); }
  pulse(strength = 0.7) { this.pulses.push({ r: 0.55, a: strength }); }

  makeGlow(hue = 192) {
    this.glowHue = hue;
    const g = this.glowCanvas || (this.glowCanvas = document.createElement('canvas'));
    g.width = g.height = 64;
    const x = g.getContext('2d');
    const grd = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.22, `hsla(${hue},100%,72%,.55)`);
    grd.addColorStop(1, `hsla(${hue},100%,50%,0)`);
    x.clearRect(0, 0, 64, 64);
    x.fillStyle = grd;
    x.fillRect(0, 0, 64, 64);
    return g;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { width, height } = this.c.getBoundingClientRect();
    this.w = Math.max(1, width);
    this.h = Math.max(1, height);
    this.c.width = Math.round(this.w * dpr);
    this.c.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  frame(now) {
    this.raf = null;
    if (document.hidden || !this.visible) return; // Schleife ruht, bis der Kern wieder sichtbar ist
    if (now - this.last < 12) { this.raf = requestAnimationFrame(this.frame); return; } // 120-Hz-Displays: auf ca. 60 FPS begrenzen
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t0 = performance.now();
    this.update(dt);
    this.draw();
    this.cost += (performance.now() - t0 - this.cost) * 0.05;
    if (this.cost > 9) this.q = Math.max(0.35, this.q - 0.02); // Gerät zu langsam: weniger Partikel
    else if (this.cost < 4.5) this.q = Math.min(1, this.q + 0.01);
    this.raf = requestAnimationFrame(this.frame);
  }

  update(dt) {
    const target = PRESETS[this.state];
    const k = 1 - Math.pow(0.02, dt); // weiches Überblenden
    for (const key in target) this.p[key] += (target[key] - this.p[key]) * k;
    const motion = this.reduceMotion ? 0.25 : 1;
    this.t += dt * (0.4 + this.p.speed) * motion * this.speedK;

    // Pegel: echt (Mikrofon) oder synthetisch (Sprachausgabe / Hintergrund)
    if (!this.externalLevel) {
      if (this.state === 'speaking') {
        const s = performance.now() / 1000;
        this.levelTarget = 0.35 + 0.4 * Math.abs(Math.sin(s * 8.3)) * Math.abs(Math.sin(s * 2.9 + 1));
      } else if (this.state === 'thinking') this.levelTarget = 0.25 + 0.15 * Math.sin(this.t * 6);
      else this.levelTarget = 0.06;
    }
    this.level += (this.levelTarget - this.level) * Math.min(1, dt * 14);

    // Energiewellen
    this.pulseClock += dt;
    const every = this.state === 'thinking' ? 0.55 : this.state === 'idle' ? 3.2 : 1.1;
    if (this.pulseClock > every && !this.reduceMotion) {
      this.pulseClock = 0;
      this.pulse(this.state === 'idle' ? 0.35 : 0.4 + this.level * 0.6);
    }
    for (const pu of this.pulses) {
      pu.r += dt * (0.55 + this.p.speed * 0.3);
      pu.a -= dt * 0.45;
    }
    this.pulses = this.pulses.filter((pu) => pu.a > 0 && pu.r < 2.3);
  }

  /** Akzentfarbe des Themes: Farbton-Verschiebung gegenüber Cyan (192°), Sättigung, Leuchtstärke, Tempo. */
  setTheme({ hue = 192, sat = 100, glow = 1, speed = 1 } = {}) {
    this.hueOffset = hue - 192;
    this.satK = Math.max(0, Math.min(1, sat / 100));
    this.glowK = glow;
    this.speedK = speed;
    this.glow = this.makeGlow(this.p.hue + this.hueOffset);
    this.glowHue = this.p.hue;
  }

  col(l, a, hueShift = 0) {
    const off = this.state === 'error' ? 0 : this.hueOffset; // Fehler bleiben immer rot
    const sat = this.state === 'error' ? this.p.sat : Math.round(this.p.sat * this.satK);
    return `hsla(${this.p.hue + hueShift + off},${sat}%,${l}%,${Math.min(1, a * this.glowK)})`;
  }

  draw() {
    const { ctx, w, h, p, t } = this;
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.26;
    const lvl = this.level;
    const jx = p.jitter * (Math.random() - 0.5) * 4;
    const jy = p.jitter * (Math.random() - 0.5) * 4;
    const breathe = 1 + Math.sin(t * 1.6) * 0.025 + lvl * 0.08;
    if (Math.abs(p.hue - this.glowHue) > 4) { this.glow = this.makeGlow(p.hue + (this.state === 'error' ? 0 : this.hueOffset)); this.glowHue = p.hue; }

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(cx + jx, cy + jy);
    ctx.globalCompositeOperation = 'lighter';

    // 1) Umgebungsleuchten
    let g = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R * 2.6);
    g.addColorStop(0, this.col(55, 0.22 * p.intensity));
    g.addColorStop(0.45, this.col(45, 0.07 * p.intensity, 20));
    g.addColorStop(1, this.col(40, 0));
    ctx.fillStyle = g;
    ctx.fillRect(-w, -h, w * 2, h * 2);

    // 2) HUD-Außenring mit Skala
    this.hudRing(R * 1.72, t);

    // 3) Energiewellen
    for (const pu of this.pulses) {
      ctx.beginPath();
      ctx.arc(0, 0, R * pu.r * 1.15, 0, Math.PI * 2);
      ctx.strokeStyle = this.col(65, pu.a * 0.35 * p.intensity);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 4) Orbitale 3D-Ringe
    RINGS.forEach((ring, i) => this.orbit(R * ring.r * p.spread, ring.tx + Math.sin(t * 0.3 + i) * 0.08, ring.tz + t * ring.sp, t * 0.2 * (i % 2 ? -1 : 1), ring, lvl));

    // 5) Holografische Kugel (Gitter)
    this.sphere(R * 0.78 * breathe, t);

    // 6) Wellenform-Ring (reagiert auf Stimme)
    this.waveRing(R * 0.98, lvl, t);

    // 7) Partikel
    this.particles(R, t);

    // 8) Kern
    const cr = R * (0.42 + lvl * 0.12) * breathe;
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, cr * 1.6);
    g.addColorStop(0, `rgba(255,255,255,${0.95 * p.intensity})`);
    g.addColorStop(0.18, this.col(85, 0.9 * p.intensity));
    g.addColorStop(0.45, this.col(58, 0.45 * p.intensity));
    g.addColorStop(1, this.col(50, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, cr * 1.6, 0, Math.PI * 2);
    ctx.fill();

    // Lichtreflex
    ctx.globalAlpha = 0.25 * p.intensity;
    ctx.drawImage(this.glow, -R * 0.42, -R * 0.5, R * 0.36, R * 0.36);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  project(x, y, z, R) {
    const f = R * 4;
    const s = f / (f + z);
    return [x * s, y * s, z];
  }

  orbit(r, tiltX, rotZ, rotY, ring, lvl) {
    const { ctx } = this;
    const N = 96;
    const pts = [];
    const cX = Math.cos(tiltX), sX = Math.sin(tiltX);
    const cZ = Math.cos(rotZ), sZ = Math.sin(rotZ);
    const cY = Math.cos(rotY), sY = Math.sin(rotY);
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      let x = Math.cos(a) * r, y = Math.sin(a) * r, z = 0;
      // um Z drehen (läuft), dann X kippen, dann Y
      [x, y] = [x * cZ - y * sZ, x * sZ + y * cZ];
      [y, z] = [y * cX - z * sX, y * sX + z * cX];
      [x, z] = [x * cY + z * sY, -x * sY + z * cY];
      pts.push(this.project(x, y, z, r));
    }
    const chunk = 6;
    ctx.lineWidth = ring.w + lvl * 1.5;
    for (let i = 0; i < N; i += chunk) {
      if (ring.dash && (i / chunk) % 2) continue;
      const z = pts[i + (chunk >> 1)][2];
      const depth = 0.5 - z / (2 * r); // vorne = 1
      ctx.beginPath();
      ctx.moveTo(pts[i][0], pts[i][1]);
      for (let j = i + 1; j <= Math.min(N, i + chunk); j++) ctx.lineTo(pts[j][0], pts[j][1]);
      ctx.strokeStyle = this.col(60 + depth * 25, (0.12 + depth * 0.6) * this.p.intensity);
      ctx.stroke();
    }
    // Lichtpunkt, der auf dem Ring läuft
    const k = Math.floor(((this.t * 0.35 * (ring.sp > 0 ? 1 : -1)) % 1 + 1) % 1 * N);
    const [px, py, pz] = pts[k];
    const d = 0.5 - pz / (2 * r);
    const s = 10 + d * 14;
    ctx.globalAlpha = 0.4 + d * 0.6;
    ctx.drawImage(this.glow, px - s / 2, py - s / 2, s, s);
    ctx.globalAlpha = 1;
  }

  sphere(r, t) {
    const { ctx } = this;
    const tilt = 0.42;
    const cT = Math.cos(tilt), sT = Math.sin(tilt);
    const spin = t * 0.5;
    const line = (fn) => {
      const N = 48;
      let prev = null;
      for (let i = 0; i <= N; i++) {
        let [x, y, z] = fn((i / N) * Math.PI * 2);
        [y, z] = [y * cT - z * sT, y * sT + z * cT];
        const q = this.project(x, y, z, r);
        if (prev) {
          const depth = 0.5 - (q[2] + prev[2]) / (4 * r);
          ctx.strokeStyle = this.col(70, (0.03 + depth * 0.22) * this.p.intensity);
          ctx.beginPath();
          ctx.moveTo(prev[0], prev[1]);
          ctx.lineTo(q[0], q[1]);
          ctx.stroke();
        }
        prev = q;
      }
    };
    ctx.lineWidth = 0.8;
    for (let k = 0; k < 9; k++) {
      const lon = spin + (k / 9) * Math.PI;
      const cl = Math.cos(lon), sl = Math.sin(lon);
      line((a) => {
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        return [x * cl, y, x * sl];
      });
    }
    for (let k = 1; k < 6; k++) {
      const lat = -Math.PI / 2 + (k / 6) * Math.PI;
      const rr = Math.cos(lat) * r, yy = Math.sin(lat) * r;
      line((a) => [Math.cos(a + spin) * rr, yy, Math.sin(a + spin) * rr]);
    }
  }

  waveRing(r, lvl, t) {
    const { ctx, p } = this;
    const amp = r * 0.16 * lvl * p.wave;
    if (amp < 0.5 && p.wave < 0.3) return;
    const N = 120;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const n = Math.sin(a * 6 + t * 7) * 0.5 + Math.sin(a * 11 - t * 9) * 0.3 + Math.sin(a * 3 + t * 3) * 0.2;
      const rr = r + n * amp;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.strokeStyle = this.col(72, 0.25 + lvl * 0.55);
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  hudRing(r, t) {
    const { ctx, p } = this;
    ctx.save();
    ctx.rotate(t * 0.08);
    ctx.strokeStyle = this.col(60, 0.14 * p.intensity);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(1, r), 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const long = i % 6 === 0;
      const r1 = r + 4, r2 = r + (long ? 12 : 7);
      ctx.strokeStyle = this.col(65, (long ? 0.4 : 0.16) * p.intensity);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
      ctx.stroke();
    }
    ctx.restore();
    // Gegenläufige Bogensegmente
    ctx.save();
    ctx.rotate(-t * 0.25);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      ctx.strokeStyle = this.col(68, 0.5 * p.intensity);
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(1, r - 10), a, a + 0.55 + this.level * 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  particles(R, t) {
    const { ctx, p } = this;
    const count = Math.floor(this.parts.length * p.particles * this.q);
    for (let i = 0; i < count; i++) {
      const q = this.parts[i];
      const a = q.a + t * q.sp * (0.5 + p.speed * 0.6);
      const r = R * q.r * (1 + Math.sin(t + q.ph) * 0.04);
      let x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = Math.sin(a * 0.5 + q.ph) * r * 0.15 + q.inc * R * 0.12;
      const ci = Math.cos(q.inc * 0.5), si = Math.sin(q.inc * 0.5);
      [x, z] = [x * ci - z * si, x * si + z * ci];
      const [px, py, pz] = this.project(x, y, z, R * 1.6);
      const d = 0.5 - pz / (2 * r);
      const s = q.s * (2 + d * 5);
      ctx.globalAlpha = (0.15 + d * 0.75) * p.intensity;
      ctx.drawImage(this.glow, px - s, py - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;
  }
}
