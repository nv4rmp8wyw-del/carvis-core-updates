// Design-Engine: eine Quelle für alle Design-Werte. Wirkt live über CSS-Variablen auf die ganze App
// (kein Neustart, kein zweites Stylesheet). Modi: Dunkel · Hell · System · Eigen (eigene Hintergrund-/Flächenfarbe).

/** Akzentfarben (gedämpft). Die IDs bleiben stabil, weil sie gespeichert werden. */
export const PRESETS = [
  { id: 'tuerkis', label: 'Türkis (Standard)', color: '#8fcfc7' },
  { id: 'silber', label: 'Silber', color: '#c9c6bf' },
  { id: 'eis', label: 'Eisweiß', color: '#e4eeee' },
  { id: 'sand', label: 'Sand', color: '#d4bf9a' },
  { id: 'salbei', label: 'Salbei', color: '#a7c2a0' },
  { id: 'lila', label: 'Lavendel', color: '#b4a2dc' },
  { id: 'koralle', label: 'Koralle', color: '#e0a596' },
  { id: 'schwarz', label: 'Schwarz (OLED)', color: '#c9c6bf', oled: true },
];
const DEFAULT_ACCENT = '#8fcfc7';
// Frühere Standardfarben (blau/cyan) gelten als „nie selbst gewählt“ und wechseln auf das neue Design.
const LEGACY_DEFAULTS = new Set(['#4cc3ff', '#22e4ff']);

export const defaultTheme = () => ({
  mode: 'dark', preset: 'tuerkis', accent: DEFAULT_ACCENT, profile: 'graphit',
  bg: '', surface: '',                 // nur Modus „Eigen“
  textScale: 1, weight: 400, radius: 1, shadow: 1, density: 1,
  transparency: 0, glass: 0, speed: 1, glow: 0.4,
  panelMin: 260, coreView: 'full', hidden: [], order: [],
});

/** Fertige Designprofile: setzen mehrere Werte auf einmal (One-Click-Designwechsel). */
export const PROFILES = [
  { id: 'graphit', label: 'Graphit', note: 'Standard · dunkel, ruhig', t: { mode: 'dark', preset: 'tuerkis', accent: '#8fcfc7', bg: '', surface: '', radius: 1, shadow: 1, transparency: 0, glass: 0, density: 1, weight: 400 } },
  { id: 'onyx', label: 'Onyx', note: 'OLED-Schwarz, Silber', t: { mode: 'dark', preset: 'schwarz', accent: '#c9c6bf', bg: '', surface: '', radius: 0.85, shadow: 0.6, transparency: 0, glass: 0, density: 1, weight: 400 } },
  { id: 'porzellan', label: 'Porzellan', note: 'hell, Off-White', t: { mode: 'light', preset: 'tuerkis', accent: '#4f9c93', bg: '', surface: '', radius: 1.1, shadow: 1, transparency: 0, glass: 0, density: 1, weight: 400 } },
  { id: 'nebel', label: 'Nebel', note: 'dunkel, dezentes Glas', t: { mode: 'dark', preset: 'eis', accent: '#e4eeee', bg: '', surface: '', radius: 1.25, shadow: 1.2, transparency: 0.28, glass: 14, density: 1, weight: 400 } },
  { id: 'kompakt', label: 'Kompakt', note: 'viel Inhalt, kleine Abstände', t: { mode: 'dark', preset: 'silber', accent: '#c9c6bf', bg: '', surface: '', radius: 0.75, shadow: 0.7, transparency: 0, glass: 0, density: 0.8, weight: 400 } },
  { id: 'system', label: 'System', note: 'folgt Windows hell/dunkel', t: { mode: 'system', preset: 'tuerkis', accent: '#8fcfc7', bg: '', surface: '', radius: 1, shadow: 1, transparency: 0, glass: 0, density: 1, weight: 400 } },
];

export const DASH_PARTS = [
  ['activity', 'Aktivität'], ['device', 'Gerät'], ['net', 'Netzwerk'], ['memory', 'Gedächtnis'], ['status', 'Systemstatus'], ['ai', 'KI-Modelle'],
  ['projects', 'Projekte'], ['tasks', 'Aufgaben'], ['optimize', 'Optimierung'], ['ucc', 'Aktionen'],
];

// ------------------------------------------------------------------ Farbe
export function hexToHsl(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
  if (!m) return { h: 174, s: 38, l: 69 };
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
const hex = (rgb) => '#' + rgb.map((x) => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('');
const rgbOf = (h) => { const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(h || ''); return m ? [1, 2, 3].map((i) => parseInt(m[i], 16)) : null; };
const mix = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));

/** Relative Leuchtdichte und Kontrast nach WCAG 2.1. */
export function luminance(h) {
  const c = rgbOf(h);
  if (!c) return 0;
  const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
export const contrastLabel = (r) => (r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : r >= 3 ? 'nur große Schrift' : 'zu gering');

/** Berechnet die Akzentfarbe (bleibt für Lesbarkeit in einem sicheren Helligkeitsbereich). */
export function palette(accentHex, light) {
  const { h, s, l } = hexToHsl(accentHex);
  const sat = Math.max(s, s < 12 ? s : 25);
  const main = light ? hslToRgb(h, sat, Math.min(l, 38)) : hslToRgb(h, sat, Math.max(l, 55));
  const soft = light ? hslToRgb(h, sat, 28) : hslToRgb(h, Math.max(0, sat - 10), Math.min(88, Math.max(l, 55) + 18));
  return { h, s, main, soft, cyan: hex(main), cyan2: hex(soft) };
}

/** Flächen aus einer eigenen Hintergrundfarbe ableiten; Textfarbe passend zur Helligkeit. */
function customSurfaces(bgHex, surfaceHex) {
  const bg = rgbOf(bgHex);
  if (!bg) return null;
  const light = luminance(bgHex) > 0.45;
  const toward = light ? [0, 0, 0] : [255, 255, 255];
  const surf = rgbOf(surfaceHex) || mix(bg, toward, light ? 0.03 : 0.05);
  return {
    light,
    vars: {
      '--bg': hex(bg), '--bg-1': hex(mix(bg, toward, 0.025)), '--surface': hex(surf),
      '--surface-2': hex(mix(surf, toward, 0.04)), '--surface-3': hex(mix(surf, toward, 0.09)), '--surface-4': hex(mix(surf, toward, 0.15)),
    },
  };
}

// ------------------------------------------------------------------ Anwenden
let mq = null;
let hook = null; // von app.js: (palette, theme, light) => KI-Kern anpassen
export const onThemeApplied = (fn) => { hook = fn; };
export const resolvedMode = (t) => (t.mode === 'system' || t.mode === 'auto' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t.mode === 'custom' ? 'custom' : t.mode);

/** Vervollständigt gespeicherte Werte (alte Fassungen, unbekannte Felder, Grenzen). */
export function normalizeTheme(theme) {
  const t = { ...defaultTheme(), ...(theme || {}) };
  if ((t.preset === 'cyan' || !t.preset) && LEGACY_DEFAULTS.has(String(t.accent).toLowerCase())) Object.assign(t, { preset: 'tuerkis', accent: DEFAULT_ACCENT, glow: Math.min(t.glow, 0.4) });
  if (t.mode === 'auto') t.mode = 'system';
  const num = (k, a, b) => { t[k] = Math.max(a, Math.min(b, Number.isFinite(+t[k]) ? +t[k] : defaultTheme()[k])); };
  num('textScale', 0.85, 1.3); num('weight', 300, 600); num('radius', 0, 2); num('shadow', 0, 2); num('density', 0.75, 1.3);
  num('transparency', 0, 0.45); num('glass', 0, 24); num('speed', 0.25, 3); num('glow', 0, 1.8); num('panelMin', 200, 520);
  if (!['full', 'calm', 'minimal', 'off'].includes(t.coreView)) t.coreView = 'full';
  if (!Array.isArray(t.hidden)) t.hidden = [];
  if (!Array.isArray(t.order)) t.order = [];
  return t;
}

const TOKENS = ['--bg', '--bg-1', '--surface', '--surface-2', '--surface-3', '--surface-4'];
export function applyTheme(theme) {
  const t = normalizeTheme(theme);
  const root = document.documentElement;
  const set = (k, v) => root.style.setProperty(k, v);
  const preset = PRESETS.find((p) => p.id === t.preset);
  // Modus
  let mode = resolvedMode(t);
  TOKENS.forEach((k) => root.style.removeProperty(k));
  if (mode === 'custom') {
    const c = customSurfaces(t.bg || '#0b0b0c', t.surface);
    mode = c?.light ? 'light' : 'dark';
    if (c) Object.entries(c.vars).forEach(([k, v]) => set(k, v));
  }
  const light = mode === 'light';
  root.dataset.theme = light ? 'light' : 'dark';
  if (preset?.oled && !light) root.dataset.oled = '1'; else delete root.dataset.oled;
  // Akzent
  const pal = palette(t.accent, light);
  set('--accent-rgb', pal.main.join(', '));
  set('--ice', light ? '#2a3b3d' : pal.cyan2);
  // Stellgrößen
  set('--ts', String(t.textScale));
  set('--fw', String(t.weight));
  set('--rs', String(t.radius));
  set('--sk', String(t.shadow));
  set('--d', String(t.density));
  set('--alpha', String(t.transparency));
  set('--blur', `${t.glass}px`);
  set('--panel-min', `${t.panelMin}px`);
  set('--glow', String(t.glow));
  if (t.transparency > 0) root.dataset.glass = '1'; else delete root.dataset.glass;
  root.dataset.coreView = t.coreView;
  document.body?.setAttribute('data-dash', (t.hidden || []).map((x) => 'hide-' + x).join(' '));
  applyOrder(t.order, t.hidden);
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim() || (light ? '#f4f3f0' : '#0b0b0c');
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', preset?.oled && !light ? '#000000' : bg);
  document.querySelector('meta[name=color-scheme]')?.setAttribute('content', light ? 'light' : 'dark');
  applySpeed(t.speed);
  hook?.(pal, t, light);
  if ((t.mode === 'system') && !mq) {
    mq = matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener?.('change', () => applyTheme(window.__cccTheme?.()));
  }
  return pal;
}

/** Dashboard-Anordnung: Reihenfolge der Karten über CSS „order“ (kein Neuaufbau der Ansicht nötig). */
function applyOrder(order, hidden) {
  let el = document.getElementById('dash-order');
  if (!el) { el = document.createElement('style'); el.id = 'dash-order'; document.head.appendChild(el); }
  const id = (x) => String(x).replace(/[^a-z]/g, '');
  el.textContent = (order || []).map((x, i) => `[data-dash="${id(x)}"]{order:${i - 100}}`).join('')
    + (hidden || []).map((x) => `[data-dash="${id(x)}"]{display:none}`).join('');
}

/** Laufende CSS-Animationen skalieren (1 = normal). Wird nach jedem Rendern erneut angewendet. */
export function applySpeed(speed = 1) {
  try {
    const sp = Math.max(0.25, Math.min(3, speed));
    document.documentElement.style.setProperty('--speed', String(sp));
    document.getAnimations?.().forEach((a) => { if (a.effect?.getTiming?.().iterations === Infinity) a.playbackRate = sp; });
  } catch { /* ältere Browser */ }
}

/** Aktuelle Kontrastwerte der wirklich angewendeten Farben (für die Lesbarkeitsprüfung). */
export function measureContrast() {
  const cs = getComputedStyle(document.documentElement);
  const v = (k) => cs.getPropertyValue(k).trim();
  const acc = '#' + v('--accent-rgb').split(',').map((x) => (+x).toString(16).padStart(2, '0')).join('');
  return [
    ['Text auf Hintergrund', contrast(v('--text'), v('--bg'))],
    ['Text auf Karten', contrast(v('--text'), v('--surface'))],
    ['Zweittext auf Karten', contrast(v('--text-2'), v('--surface'))],
    ['Akzent auf Hintergrund', contrast(acc, v('--bg'))],
  ];
}
