// Design-Reiter: Profile, Modus (Dunkel/Hell/System/Eigen), Akzent, Schrift, Rundungen, Schatten, Transparenz/Glas,
// Dichte, Animation, GPT-Fenster, CARVIS-Kern, Dashboard-Widgets und -Reihenfolge, eigene Profile, Export/Import.
// Regler wirken während des Ziehens live (nur CSS-Variablen), gespeichert wird beim Loslassen.
import { esc, download, uid } from '../util.js';
import { icon, toast, confirmDialog } from '../ui.js';
import { actions, store } from '../store.js';
import { PRESETS, PROFILES, DASH_PARTS, defaultTheme, normalizeTheme, applyTheme, measureContrast, contrastLabel } from '../theme.js';

const theme = (s = store.get()) => normalizeTheme(s.settings.theme);
const save = (patch, ctx) => { actions.setSettings({ theme: { ...theme(), ...patch } }); ctx.applySettings(); };

const SLIDERS = [
  ['textScale', 'Textgröße', 0.85, 1.3, 0.05, (v) => `${Math.round(v * 100)} %`],
  ['weight', 'Schriftgewicht', 300, 600, 100, (v) => ({ 300: 'leicht', 400: 'normal', 500: 'mittel', 600: 'kräftig' }[v] || v)],
  ['radius', 'Rundungen', 0, 2, 0.05, (v) => `${Math.round(v * 100)} %`],
  ['shadow', 'Schatten', 0, 2, 0.1, (v) => `${Math.round(v * 100)} %`],
  ['transparency', 'Transparenz', 0, 0.45, 0.01, (v) => `${Math.round(v * 100)} %`],
  ['glass', 'Glaseffekt', 0, 24, 1, (v) => (v ? `${v} px` : 'aus')],
  ['speed', 'Animationstempo', 0.25, 3, 0.25, (v) => `${(+v).toFixed(2)}×`],
  ['panelMin', 'GPT-Fenster Mindestbreite', 200, 520, 20, (v) => `${v} px`],
];
const MODES = [['dark', 'Dunkel'], ['light', 'Hell'], ['system', 'System'], ['custom', 'Eigen']];
const DENSITY = [[0.8, 'Kompakt'], [1, 'Normal'], [1.2, 'Großzügig']];
const CORE = [['full', 'Voll'], ['calm', 'Ruhig'], ['minimal', 'Minimal'], ['off', 'Aus']];

function orderOf(t) {
  const known = DASH_PARTS.map(([id]) => id);
  return [...t.order.filter((id) => known.includes(id)), ...known.filter((id) => !t.order.includes(id))];
}

const slider = (t, [k, label, min, max, step, fmt]) => `<label class="field">${label} <output data-out="${k}">${esc(fmt(t[k]))}</output>
  <input type="range" min="${min}" max="${max}" step="${step}" data-theme-key="${k}" value="${t[k]}" ${k === 'glass' && !t.transparency ? 'disabled title="Wirkt erst mit Transparenz"' : ''}></label>`;

export default {
  id: 'design',
  title: 'Design',
  icon: 'preview',
  render(s) {
    const t = theme(s);
    const own = s.settings.designProfiles || [];
    const cr = measureContrast();
    const ord = orderOf(t);
    const label = (id) => DASH_PARTS.find(([x]) => x === id)?.[1] || id;
    return `<div class="page design-page"><header class="page-head"><div><h1>Design</h1>
      <p class="muted">Jede Änderung wirkt sofort in der ganzen App und bleibt gespeichert.</p></div>
      <div class="row-actions">
        <button class="btn btn-sm" data-act="design-export">${icon('share')} Exportieren</button>
        <label class="btn btn-sm" title="Design aus einer exportierten Datei laden">${icon('update')} Importieren<input type="file" accept="application/json,.json" data-design-import hidden></label>
        <button class="btn btn-sm btn-ghost" data-act="theme-reset">${icon('reset')} Zurücksetzen</button>
      </div></header>

      <section class="card" aria-label="Designprofile"><header class="card-head"><h2>${icon('columns')} Profile</h2><button class="btn btn-sm" data-act="profile-save">${icon('plus')} Aktuelles speichern</button></header>
        <div class="profiles">${PROFILES.map((p) => `<button class="profile ${t.profile === p.id ? 'on' : ''}" data-act="theme-profile" data-id="${p.id}" aria-pressed="${t.profile === p.id}"><span class="profile-sw" data-p="${p.id}"></span><b>${esc(p.label)}</b><small>${esc(p.note)}</small></button>`).join('')}
          ${own.map((p) => `<div class="profile own ${t.profile === p.id ? 'on' : ''}"><button class="profile-hit" data-act="theme-own" data-id="${esc(p.id)}" aria-pressed="${t.profile === p.id}"><span class="profile-sw" style="--a:${esc(p.t.accent)}"></span><b>${esc(p.name)}</b><small>eigenes Profil</small></button><button class="icon-btn sm ghost" data-act="profile-del" data-id="${esc(p.id)}" aria-label="Profil ${esc(p.name)} löschen" title="Löschen">${icon('trash')}</button></div>`).join('')}</div>
      </section>

      <div class="grid design-grid">
        <section class="card"><header class="card-head"><h2>${icon('preview')} Modus</h2></header>
          <div class="seg" role="group" aria-label="Farbmodus">${MODES.map(([k, l]) => `<button class="${t.mode === k ? 'on' : ''}" data-act="theme-mode" data-id="${k}" aria-pressed="${t.mode === k}">${l}</button>`).join('')}</div>
          <p class="muted small">${t.mode === 'system' ? 'Folgt automatisch dem Hell-/Dunkel-Design von Windows.' : t.mode === 'custom' ? 'Eigene Hintergrund- und Flächenfarbe; Textfarbe passt sich der Helligkeit an.' : 'Fester Modus.'}</p>
          ${t.mode === 'custom' ? `<div class="two"><label class="field">Hintergrund<input type="color" data-theme-key="bg" value="${esc(t.bg || '#0b0b0c')}"></label><label class="field">Flächen<input type="color" data-theme-key="surface" value="${esc(t.surface || '#151516')}"></label></div>` : ''}
        </section>

        <section class="card span-2"><header class="card-head"><h2>${icon('core')} Akzentfarbe</h2></header>
          <div class="swatches" role="group" aria-label="Akzentfarbe">${PRESETS.map((p) => `<button class="swatch" style="background:${p.color}" data-act="theme-preset" data-id="${p.id}" aria-pressed="${t.preset === p.id}" aria-label="${esc(p.label)}" title="${esc(p.label)}"></button>`).join('')}
            <label class="swatch-custom" title="Eigene Farbe" aria-label="Eigene Akzentfarbe"><input type="color" data-theme-key="accent" value="${esc(t.accent)}"></label></div>
          <p class="muted small">Aktuell: <b>${esc(PRESETS.find((p) => p.id === t.preset)?.label || 'Eigene Farbe')}</b> (${esc(t.accent)}).</p>
        </section>

        <section class="card span-2"><header class="card-head"><h2>${icon('settings')} Feinabstimmung</h2></header>
          <div class="two">${SLIDERS.map((x) => slider(t, x)).join('')}</div>
          <div class="field">Dichte<div class="seg" role="group" aria-label="Dichte">${DENSITY.map(([v, l]) => `<button class="${Math.abs(t.density - v) < 0.01 ? 'on' : ''}" data-act="theme-density" data-v="${v}">${l}</button>`).join('')}</div></div>
          <label class="switch"><input type="checkbox" data-reduce-motion ${s.settings.reduceMotion ? 'checked' : ''}><span></span> Animationen reduzieren</label>
        </section>

        <section class="card"><header class="card-head"><h2>${icon('review')} Lesbarkeit</h2></header>
          <ul class="status-list">${cr.map(([k, r]) => `<li><span class="led led-${r >= 4.5 ? 'ok' : r >= 3 ? 'warn' : 'danger'}"></span><span class="k">${k}</span><span class="v">${r.toFixed(1)} : 1<small>${contrastLabel(r)}</small></span></li>`).join('')}</ul>
          ${cr.some(([, r]) => r < 4.5) ? `<div class="notice notice-warn">Einige Kombinationen sind schwer lesbar (unter 4,5 : 1). <button class="link-btn" data-act="contrast-fix">Automatisch korrigieren</button></div>` : '<p class="muted small">Alle Werte erfüllen WCAG AA (mind. 4,5 : 1).</p>'}
        </section>

        <section class="card"><header class="card-head"><h2>${icon('core')} CARVIS-Kern</h2></header>
          <div class="seg" role="group" aria-label="Darstellung des CARVIS-Kerns">${CORE.map(([k, l]) => `<button class="${t.coreView === k ? 'on' : ''}" data-act="theme-core" data-id="${k}">${l}</button>`).join('')}</div>
          <p class="muted small">„Minimal“ und „Aus“ halten die Animation vollständig an (weniger GPU-Last).</p>
        </section>

        <section class="card"><header class="card-head"><h2>${icon('dashboard')} Dashboard</h2></header>
          <ul class="dash-order">${ord.map((id, i) => `<li><label class="switch"><input type="checkbox" data-dash-part="${id}" ${t.hidden.includes(id) ? '' : 'checked'}><span></span> ${esc(label(id))}</label>
            <span class="row-actions"><button class="icon-btn sm ghost" data-act="dash-up" data-id="${id}" ${i === 0 ? 'disabled' : ''} aria-label="${esc(label(id))} nach oben">▲</button><button class="icon-btn sm ghost" data-act="dash-down" data-id="${id}" ${i === ord.length - 1 ? 'disabled' : ''} aria-label="${esc(label(id))} nach unten">▼</button></span></li>`).join('')}</ul>
        </section>

        <section class="card design-preview" aria-label="Vorschau"><header class="card-head"><h2>${icon('preview')} Vorschau</h2><span class="tag tag-ok">live</span></header>
          <p>Überschrift, <b>Fließtext</b> und <span class="muted">Nebentext</span> in der aktuellen Einstellung.</p>
          <div class="row-actions"><button class="btn btn-primary btn-sm" type="button" tabindex="-1">Primär</button><button class="btn btn-sm" type="button" tabindex="-1">Sekundär</button><span class="chip">Chip</span><span class="tag tag-warn">Hinweis</span></div>
          <div class="progress" style="--w:62%;margin-top:12px"><span></span></div>
        </section>
      </div></div>`;
  },
  onMount(root, ctx) {
    // Live-Vorschau beim Ziehen/Farbwählen: nur anwenden, noch nicht speichern
    root.querySelector('.design-page')?.addEventListener('input', (e) => {
      const el = e.target;
      const k = el.dataset.themeKey;
      if (!k) return;
      const v = el.type === 'range' ? parseFloat(el.value) : el.value;
      applyTheme({ ...theme(), [k]: v });
      const sl = SLIDERS.find(([x]) => x === k);
      const out = root.querySelector(`[data-out="${k}"]`);
      if (sl && out) out.textContent = sl[5](v);
    });
  },
  onAct(act, el, ctx) {
    const t = theme();
    const id = el.dataset.id;
    if (act === 'theme-preset') { const p = PRESETS.find((x) => x.id === id); save({ preset: p.id, accent: p.color, profile: 'custom' }, ctx); }
    if (act === 'theme-mode') save({ mode: id, profile: 'custom', ...(id === 'custom' && !t.bg ? { bg: '#0b0b0c' } : {}) }, ctx);
    if (act === 'theme-profile') { const p = PROFILES.find((x) => x.id === id); save({ ...p.t, profile: p.id }, ctx); toast(`Design „${p.label}“ aktiv`, 'ok', 1400); }
    if (act === 'theme-own') { const p = (store.get().settings.designProfiles || []).find((x) => x.id === id); if (p) { actions.setSettings({ theme: normalizeTheme({ ...p.t, profile: p.id }) }); ctx.applySettings(); } }
    if (act === 'theme-density') save({ density: +el.dataset.v }, ctx);
    if (act === 'theme-core') save({ coreView: id }, ctx);
    if (act === 'dash-up' || act === 'dash-down') {
      const o = orderOf(t); const i = o.indexOf(id); const j = act === 'dash-up' ? i - 1 : i + 1;
      if (j >= 0 && j < o.length) { [o[i], o[j]] = [o[j], o[i]]; save({ order: o }, ctx); }
    }
    if (act === 'contrast-fix') {
      // Sichere Werte: eigener Modus aus, Akzent auf Standard, keine Transparenz
      save({ mode: t.mode === 'custom' ? 'dark' : t.mode, accent: t.mode === 'light' ? '#4f9c93' : '#8fcfc7', preset: 'tuerkis', transparency: 0, glass: 0 }, ctx);
      toast('Lesbarkeit korrigiert', 'ok');
    }
    if (act === 'profile-save') {
      const name = prompt('Name für dieses Designprofil:', 'Mein Design');
      if (name?.trim()) {
        const p = { id: 'own-' + uid(), name: name.trim().slice(0, 40), t: { ...t } };
        actions.setSettings({ designProfiles: [...(store.get().settings.designProfiles || []), p].slice(-12), theme: { ...t, profile: p.id } });
        toast('Profil gespeichert', 'ok');
      }
    }
    if (act === 'profile-del') {
      confirmDialog('Dieses eigene Designprofil löschen?', { ok: 'Löschen' }).then((y) => { if (y) actions.setSettings({ designProfiles: (store.get().settings.designProfiles || []).filter((x) => x.id !== id) }); });
    }
    if (act === 'theme-reset') {
      confirmDialog('Design auf Standard (Graphit) zurücksetzen? Eigene Profile bleiben erhalten.', { ok: 'Zurücksetzen', danger: false }).then((y) => { if (y) { actions.setSettings({ theme: defaultTheme() }); ctx.applySettings(); } });
    }
    if (act === 'design-export') {
      download(`carvis-design-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ format: 'carvis-design', version: 1, theme: t, profiles: store.get().settings.designProfiles || [] }, null, 2), 'application/json');
      toast('Design exportiert', 'ok');
    }
    ctx.rerender();
  },
  onChange(el, ctx) {
    const t = theme();
    if (el.dataset.themeKey) {
      const k = el.dataset.themeKey;
      const v = el.type === 'range' ? parseFloat(el.value) : el.value;
      save({ [k]: v, profile: 'custom', ...(k === 'accent' ? { preset: 'custom' } : {}) }, ctx);
    }
    if (el.dataset.dashPart) {
      const hidden = new Set(t.hidden);
      if (el.checked) hidden.delete(el.dataset.dashPart); else hidden.add(el.dataset.dashPart);
      save({ hidden: [...hidden] }, ctx);
    }
    if (el.dataset.reduceMotion !== undefined) { actions.setSettings({ reduceMotion: el.checked }); ctx.applySettings(); }
    if (el.dataset.designImport !== undefined && el.files?.[0]) {
      el.files[0].text().then((txt) => {
        const d = JSON.parse(txt);
        if (d?.format !== 'carvis-design' || typeof d.theme !== 'object') throw new Error('keine CARVIS-Designdatei');
        const profiles = Array.isArray(d.profiles) ? d.profiles.filter((p) => p && typeof p.name === 'string' && typeof p.t === 'object').map((p) => ({ id: 'own-' + uid(), name: String(p.name).slice(0, 40), t: normalizeTheme(p.t) })) : [];
        actions.setSettings({ theme: normalizeTheme(d.theme), designProfiles: [...(store.get().settings.designProfiles || []), ...profiles].slice(-12) });
        ctx.applySettings(); ctx.rerender();
        toast('Design importiert', 'ok');
      }).catch((e) => toast(`Import fehlgeschlagen: ${e.message}`, 'danger'));
      el.value = '';
      return;
    }
    if (el.type !== 'range') ctx.rerender();
  },
};
