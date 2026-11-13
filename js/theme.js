// Erscheinungsbild: Akzentfarbe, Hell/Dunkel/Auto, Leuchtstärke, Animationsgeschwindigkeit. Wirkt systemweit über CSS-Variablen.

export const PRESETS = [
  { id: 'cyan', label: 'Cyan', color: '#4cc3ff' },
  { id: 'blau', label: 'Blau', color: '#2f6bff' },
  { id: 'rot', label: 'Rot', color: '#ff4d5e' },
  { id: 'lila', label: 'Lila', color: '#9b6bff' },
  { id: 'gruen', label: 'Grün', color: '#2ff3a0' },
  { id: 'schwarz', label: 'Schwarz (OLED, Silber)', color: '#d4dae3', oled: true },
  { id: 'weiss', label: 'Weiß', color: '#f4f7fb' },
];

export const defaultTheme = () => ({ mode: 'dark', preset: 'cyan', accent: '#4cc3ff', glow: 1, speed: 1, hidden: [] });

export function hexToHsl(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
  if (!m) return { h: 192, s: 100, l: 56 };
  const [r, g, b] = [1, 2, 3].map((i) => parseInt(m[i], 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const l = (mx + mn) / 2;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return { h: Math.round(((h * 60) + 360) % 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
const hex = (rgb) => '#' + rgb.map((x) => x.toString(16).padStart(2, '0')).join('');

/** Berechnet alle Farbvariablen aus der Akzentfarbe. */
export function palette(accentHex, light) {
  const { h, s, l } = hexToHsl(accentHex);
  const sat = Math.max(s, s < 12 ? s : 40); // fast graue Farben (Silber/Weiß) bleiben grau
  const main = light ? hslToRgb(h, sat, Math.min(l, 38)) : hslToRgb(h, sat, Math.max(l, 55));
  const second = hslToRgb((h + 28) % 360, s < 12 ? s : Math.max(sat, 70), light ? 36 : 58);
  const soft = light ? hslToRgb(h, sat, 28) : hslToRgb(h, Math.max(0, sat - 10), Math.min(86, Math.max(l, 55) + 18));
  return { h, s, main, second, soft, cyan: hex(main), cyan2: hex(soft), blue: hex(second) };
}

let mq = null;
export const resolvedMode = (t) => (t.mode === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t.mode);

let hook = null; // wird von app.js gesetzt: (palette, theme) => KI-Kern anpassen
export const onThemeApplied = (fn) => { hook = fn; };

export function applyTheme(theme) {
  const t = { ...defaultTheme(), ...(theme || {}) };
  const light = resolvedMode(t) === 'light';
  const preset = PRESETS.find((p) => p.id === t.preset);
  const pal = palette(t.accent, light);
  const root = document.documentElement;
  root.dataset.theme = light ? 'light' : 'dark';
  if (preset?.oled && !light) root.dataset.oled = '1'; else delete root.dataset.oled;
  const set = (k, v) => root.style.setProperty(k, v);
  set('--cyan', pal.cyan);
  set('--cyan-2', pal.cyan2);
  set('--blue', pal.blue);
  set('--accent-rgb', pal.main.join(', '));
  set('--accent2-rgb', pal.second.join(', '));
  set('--glow', String(t.glow));
  document.body?.setAttribute('data-dash', (t.hidden || []).map((x) => 'hide-' + x).join(' '));
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', light ? '#eef3f9' : preset?.oled ? '#000000' : '#02040a');
  document.querySelector('meta[name=color-scheme]')?.setAttribute('content', light ? 'light' : 'dark');
  applySpeed(t.speed);
  hook?.(pal, t, light);
  // Auto-Modus: auf Systemwechsel reagieren
  if (t.mode === 'auto' && !mq) {
    mq = matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener?.('change', () => applyTheme(window.__cccTheme?.()));
  }
  return pal;
}

/** Laufende CSS-Animationen skalieren (1 = normal). Wird nach jedem Rendern erneut angewendet. */
export function applySpeed(speed = 1) {
  try {
    const sp = Math.max(0.25, Math.min(3, speed));
    document.getAnimations?.().forEach((a) => { if (a.effect?.getTiming?.().iterations === Infinity) a.playbackRate = sp; });
  } catch { /* ältere Browser */ }
}
