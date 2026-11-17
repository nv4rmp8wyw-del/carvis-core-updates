// Versionsarchiv und Versionsvergleich (v1.2, D-056). Öffentliche Versionen werden live aus dem öffentlichen
// Update-Repo gelesen (Portable, Installer, Prüfsummen). Private TEST-Versionen erscheinen nur als Eintrag –
// ihre Dateien bleiben im privaten Repo (Entwicklerkanal im Update-Center, Anmeldung nötig).
// Inhalte je Version: nur belegte Fakten (docs/DECISIONS.md, Testläufe) – keine erfundenen Funktionen.
import { esc } from '../util.js';
import { icon } from '../ui.js';
import { t } from '../i18n.js';
import { VERSION, RELEASED, displayVersion } from '../version.js';
import { publicVersions, allReleasesUrl } from '../downloads.js';

// Belegte Stände (Build → sichtbare Version). Kanal „public“ = öffentlich, „test“ = privat.
export const HISTORY = [
  { build: '4.2.0', channel: 'test', date: '2026-11-16', notes: ['vh.v12.design', 'vh.v12.nav', 'vh.v12.lang', 'vh.v12.ai', 'vh.v12.fix'], limits: ['vh.v12.lim1', 'vh.v12.lim2', 'vh.v12.lim3'], tests: 'vh.v12.tests' },
  { build: '4.1.0', channel: 'test', date: '2026-11-15', notes: ['vh.v11.design', 'vh.v11.ai', 'vh.v11.engines', 'vh.v11.test'], limits: ['vh.v11.lim1'], tests: 'vh.v11.tests' },
  { build: '4.0.0', channel: 'public', date: '2026-11-14', notes: ['vh.v10.first', 'vh.v10.heal', 'vh.v10.ai'], limits: ['vh.v10.lim1'], tests: 'vh.v10.tests' },
];
// Vergleich: Zeilen = Bereich, Werte je Build (Schlüssel)
const COMPARE = [
  ['vh.cmp.design', { '4.0.0': 'vh.c.design10', '4.1.0': 'vh.c.design11', '4.2.0': 'vh.c.design12' }],
  ['vh.cmp.nav', { '4.0.0': 'vh.c.nav10', '4.1.0': 'vh.c.nav10', '4.2.0': 'vh.c.nav12' }],
  ['vh.cmp.ai', { '4.0.0': 'vh.c.ai10', '4.1.0': 'vh.c.ai11', '4.2.0': 'vh.c.ai12' }],
  ['vh.cmp.lang', { '4.0.0': 'vh.c.lang10', '4.1.0': 'vh.c.lang10', '4.2.0': 'vh.c.lang12' }],
  ['vh.cmp.dl', { '4.0.0': 'vh.c.dl10', '4.1.0': 'vh.c.dl11', '4.2.0': 'vh.c.dl11' }],
];

const S = { loaded: false, busy: false, list: [], error: '' };
const isPublic = (b) => b === RELEASED || S.list.some((x) => x.version === b);

export default {
  id: 'versions',
  get title() { return t('vh.title'); },
  icon: 'history',
  render() {
    const pub = (b) => S.list.find((x) => x.version === b);
    const rows = HISTORY.map((h) => {
      // Download nur für die aktuelle öffentliche STABLE – frühere Versionen bleiben als Archiv sichtbar, aber ohne
      // Benutzer-Downgrade (Inhaber-Auftrag 16.11.); die Releases selbst bleiben auf GitHub erhalten.
      const p = h.build === RELEASED ? pub(h.build) : null;
      const ch = p || isPublic(h.build) ? t('vh.public') : t('vh.private');
      const cur = h.build === VERSION ? ` <span class="tag tag-ok">${esc(t('vh.thisApp'))}</span>` : '';
      return `<section class="card vh-card" data-version="${h.build}">
        <header class="card-head"><h2>${esc(displayVersion(h.build).replace(/ TEST$/, ''))} <span class="tag ${p ? 'tag-ok' : 'tag-idle'}">${esc(ch)}</span>${cur}</h2><time class="muted small">${esc(h.date)}</time></header>
        <ul class="vh-notes">${h.notes.map((k) => `<li>${esc(t(k))}</li>`).join('')}</ul>
        ${h.limits.length ? `<p class="small muted"><b>${esc(t('vh.limits'))}:</b> ${h.limits.map((k) => esc(t(k))).join(' · ')}</p>` : ''}
        <p class="small muted"><b>${esc(t('vh.tested'))}:</b> ${esc(t(h.tests))}</p>
        <div class="row-actions">${p
          ? `<a class="btn btn-primary btn-sm" href="${p.portable}" download>${icon('update')} ${esc(t('dl.portable'))}</a><a class="btn btn-ghost btn-sm" href="${p.installer}">${esc(t('dl.installer'))}</a><a class="btn btn-ghost btn-sm" href="${p.sums}">SHA256</a><a class="link-btn small" href="${p.page}" target="_blank" rel="noopener">${esc(t('dl.notes'))}</a>`
          : `<span class="small muted">${esc(isPublic(h.build) ? t('vh.archived') : t('vh.privateHint'))}</span>`}</div>
      </section>`;
    }).join('');
    const builds = HISTORY.map((h) => h.build).reverse();
    const table = `<div class="vh-table-wrap"><table class="vh-table"><thead><tr><th></th>${builds.map((b) => `<th>${esc(displayVersion(b).replace(/ TEST$/, ''))}</th>`).join('')}</tr></thead>
      <tbody>${COMPARE.map(([k, vals]) => `<tr><th>${esc(t(k))}</th>${builds.map((b) => `<td>${esc(t(vals[b]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    return `<div class="page vh">
      <header class="page-head"><div><p class="eyebrow">CARVIS CORE</p><h1>${esc(t('vh.title'))}</h1><p class="muted">${esc(t('vh.sub'))}</p></div></header>
      ${S.error ? `<p class="notice notice-warn small">${esc(S.error)}</p>` : ''}
      ${!S.loaded ? `<p class="muted small">${esc(t('upd.checking'))}</p>` : ''}
      <section class="card"><header class="card-head"><h2>${icon('compare')} ${esc(t('vh.compare'))}</h2></header>${table}</section>
      ${rows}
      <p class="small"><a class="link-btn" href="${allReleasesUrl()}" target="_blank" rel="noopener">${esc(t('vh.all'))}</a></p>
    </div>`;
  },
  onMount(root, ctx) {
    if (S.loaded || S.busy) return;
    S.busy = true;
    publicVersions().then((l) => { S.list = l; }).catch((e) => { S.error = t('vh.offline', { e: e.message || e }); })
      .finally(() => { S.busy = false; S.loaded = true; (ctx.softRerender || ctx.rerender)?.(); });
  },
};
