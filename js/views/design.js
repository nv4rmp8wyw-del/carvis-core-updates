import { esc } from '../util.js';
import { icon } from '../ui.js';
import { actions, store } from '../store.js';
import { PRESETS, defaultTheme } from '../theme.js';

export const DASH_PARTS = [
  ['device', 'Gerät'], ['net', 'Netzwerk'], ['memory', 'Gedächtnis'], ['status', 'Systemstatus'], ['ai', 'KI-Modelle'],
  ['projects', 'Projekte'], ['tasks', 'Aufgaben'], ['optimize', 'Optimierung'], ['ucc', 'Aktionen'],
];

const theme = (s) => ({ ...defaultTheme(), ...(s.settings.theme || {}) });

export default {
  id: 'design',
  title: 'Design',
  icon: 'settings',
  render(s) {
    const t = theme(s);
    return `<div class="page"><header class="page-head"><div><p class="eyebrow">Version 3.3.4</p><h1>Erscheinungsbild</h1>
      <p class="muted">Alle Änderungen wirken sofort im ganzen System (Navigation, Karten, Buttons, KI-Kern, Animationen) und bleiben gespeichert.</p></div>
      <button class="btn" data-act="theme-reset">Zurücksetzen</button></header>
      <div class="grid">
        <section class="card glass span-2"><header class="card-head"><h2>${icon('core')} Farbe</h2></header>
          <div class="swatches" role="group" aria-label="Akzentfarbe">${PRESETS.map((p) => `<button class="swatch" style="background:${p.color}" data-act="theme-preset" data-id="${p.id}" aria-pressed="${t.preset === p.id}" aria-label="${esc(p.label)}" title="${esc(p.label)}"></button>`).join('')}
            <label class="swatch-custom" title="Eigene Farbe" aria-label="Eigene Farbe wählen" style="display:grid;place-items:center;overflow:hidden"><input type="color" data-theme-key="accent" value="${esc(t.accent)}" style="width:60px;height:60px;border:0;padding:0;background:none;cursor:pointer"></label></div>
          <p class="muted small">Aktuell: <b>${esc(PRESETS.find((p) => p.id === t.preset)?.label || 'Eigene Farbe')}</b> (${esc(t.accent)}). „Schwarz“ nutzt echtes OLED-Schwarz mit Silber-Akzent, „Weiß“ einen weißen Akzent.</p></section>
        <section class="card glass"><header class="card-head"><h2>${icon('preview')} Modus</h2></header>
          <div class="seg" role="group" aria-label="Modus">${[['dark', 'Dunkel'], ['light', 'Hell'], ['auto', 'System']].map(([k, l]) => `<button class="${t.mode === k ? 'on' : ''}" data-act="theme-mode" data-id="${k}">${l}</button>`).join('')}</div>
          <p class="muted small">„System“ folgt der Einstellung deines Geräts.</p></section>
        <section class="card glass"><header class="card-head"><h2>${icon('bolt')} Leuchten &amp; Tempo</h2></header>
          <label class="field">Leuchtstärke <output>${t.glow.toFixed(1)}</output><input type="range" min="0.2" max="1.8" step="0.1" data-theme-key="glow" value="${t.glow}"></label>
          <label class="field">Animationstempo <output>${t.speed.toFixed(2)}×</output><input type="range" min="0.25" max="2" step="0.25" data-theme-key="speed" value="${t.speed}"></label></section>
        <section class="card glass span-2"><header class="card-head"><h2>${icon('dashboard')} Dashboard-Elemente</h2></header>
          <div class="chips">${DASH_PARTS.map(([id, l]) => `<label class="chip" style="cursor:pointer"><input type="checkbox" data-dash-part="${id}" ${(t.hidden || []).includes(id) ? '' : 'checked'}> ${esc(l)}</label>`).join('')}</div>
          <p class="muted small">Abgehakte Elemente werden im Dashboard angezeigt.</p></section>
      </div></div>`;
  },
  onAct(act, el, ctx) {
    const s = store.get();
    const t = theme(s);
    if (act === 'theme-preset') { const p = PRESETS.find((x) => x.id === el.dataset.id); actions.setSettings({ theme: { ...t, preset: p.id, accent: p.color } }); }
    if (act === 'theme-mode') actions.setSettings({ theme: { ...t, mode: el.dataset.id } });
    if (act === 'theme-reset') actions.setSettings({ theme: defaultTheme() });
    ctx.applySettings();
    ctx.rerender();
  },
  onChange(el, ctx) {
    const t = theme(store.get());
    if (el.dataset.themeKey) {
      const v = el.type === 'range' ? parseFloat(el.value) : el.value;
      actions.setSettings({ theme: { ...t, [el.dataset.themeKey]: v, ...(el.dataset.themeKey === 'accent' ? { preset: 'custom' } : {}) } });
    }
    if (el.dataset.dashPart) {
      const hidden = new Set(t.hidden || []);
      if (el.checked) hidden.delete(el.dataset.dashPart); else hidden.add(el.dataset.dashPart);
      actions.setSettings({ theme: { ...t, hidden: [...hidden] } });
    }
    ctx.applySettings();
    if (el.type !== 'range') ctx.rerender();
  },
};
