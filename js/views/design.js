// Darstellung (CARVIS CORE 4.1): radikal vereinfacht – Hell oder Dunkel, Textgröße, Bewegung, Orb.
// Farbeditoren, Profile, Dichte- und Glasregler gibt es nicht mehr (D-044). Gespeicherte ältere Werte bleiben im
// Backup erhalten, werden aber nicht mehr angewendet. Das Designsystem ist fest abgestimmt (css/cc.css, Abschnitt 12).
import { store, actions } from '../store.js';
import { esc } from '../util.js';
import { icon, toast } from '../ui.js';
import { applyTheme, measureContrast } from '../theme.js';

const TEXT = [{ v: 0.92, label: 'Klein' }, { v: 1, label: 'Normal' }, { v: 1.12, label: 'Groß' }];
const set = (patch) => {
  const t = { ...(store.get().settings.theme || {}), ...patch };
  actions.setSettings({ theme: t });
  applyTheme(store.get().settings.theme);
};
const seg = (name, cur, opts) => `<div class="seg" role="radiogroup" aria-label="${esc(name)}">${opts.map((o) => `<button type="button" role="radio" aria-checked="${o.on}" class="${o.on ? 'on' : ''}" data-act="${o.act}" data-v="${o.v}">${o.icon ? icon(o.icon) : ''}${esc(o.label)}</button>`).join('')}</div>`;

export default {
  id: 'design',
  title: 'Darstellung',
  render(st) {
    const t = st.settings.theme || {};
    const light = document.documentElement.dataset.theme === 'light';
    const contrast = measureContrast();
    return `<div class="page page-narrow design-page">
      <header class="page-head"><div><h1>Darstellung</h1><p class="muted">Zwei abgestimmte Designs. Alles andere stellt CARVIS automatisch ein.</p></div></header>
      <section class="card design-basic">
        <div class="design-row"><b>Modus</b>${seg('Modus', light, [{ label: 'Hell', icon: 'sun', act: 'design-mode', v: 'light', on: light }, { label: 'Dunkel', icon: 'moon', act: 'design-mode', v: 'dark', on: !light }])}</div>
        <div class="design-row"><b>Textgröße</b>${seg('Textgröße', t.textScale, TEXT.map((x) => ({ label: x.label, act: 'design-text', v: x.v, on: Math.abs((t.textScale || 1) - x.v) < 0.03 })))}</div>
        <div class="design-row"><b>Bewegung</b>${seg('Bewegung', st.settings.reduceMotion, [{ label: 'Sanft', act: 'design-motion', v: 'normal', on: !st.settings.reduceMotion }, { label: 'Reduziert', act: 'design-motion', v: 'reduced', on: !!st.settings.reduceMotion }])}</div>
        <div class="design-row"><b>CARVIS-Orb</b>${seg('Orb', t.coreView, [{ label: 'Anzeigen', act: 'design-orb', v: 'full', on: t.coreView !== 'off' }, { label: 'Aus', act: 'design-orb', v: 'off', on: t.coreView === 'off' }])}</div>
      </section>
      <section class="card"><header class="card-head"><h2>${icon('preview')} Lesbarkeit</h2></header>
        <ul class="status-list">${contrast.map(([k, v]) => `<li><span class="led led-${v >= 4.5 ? 'ok' : v >= 3 ? 'warn' : 'danger'}"></span>${esc(k)}<b>${v.toFixed(1)} : 1</b></li>`).join('')}</ul>
        <p class="small muted">Gemessen an den tatsächlich angezeigten Farben (Ziel: mindestens 4,5 : 1 für Text).</p>
      </section>
    </div>`;
  },
  onAct(act, el, ctx) {
    const v = el?.dataset.v;
    if (act === 'design-mode') set({ mode: v });
    if (act === 'design-text') set({ textScale: Number(v) });
    if (act === 'design-orb') set({ coreView: v });
    if (act === 'design-motion') { actions.setSettings({ reduceMotion: v === 'reduced' }); ctx.applySettings(); }
    if (act === 'design-mode') toast(v === 'light' ? 'Helle Darstellung' : 'Dunkle Darstellung', 'info', 1200);
    document.dispatchEvent(new Event('cc-theme'));
    ctx.rerender();
  },
};
