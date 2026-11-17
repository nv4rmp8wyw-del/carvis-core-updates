// Öffentliche Website-Startseite (Inhaber-Auftrag 16.11.2026): schlicht, hochwertig, ehrlich.
// Nur auf der öffentlichen Website (nicht in der Windows-App, nicht auf localhost) und nur ohne Ziel-Route.
// Navigation: Features · CARVIS · Download · Sprache · Theme. Hauptaktion: „Download for Windows“ = portable EXE.
// Keine früheren Versionen, keine technischen Versionsnummern (sichtbar nur „CARVIS CORE v1.2“).
import { esc } from './util.js';
import { icon } from './ui.js';
import { t, lang } from './i18n.js';
import { displayVersion, RELEASED, UPDATE_REPO } from './version.js';
import { portableUrl, installerUrl, releaseNotesUrl } from './downloads.js';

export const isSite = () => {
  try { if (new URLSearchParams(location.search).has('site')) return true; } catch { /* alt */ }
  return !(window.__TAURI__ && window.__TAURI__.core) && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
};
export const isLandingRoute = () => ['', '#', '#/', '#/home'].includes(location.hash);

const sumsUrl = () => `https://github.com/${UPDATE_REPO}/releases/latest/download/SHA256SUMS.txt`;
const FEATURES = [['core', 'f1'], ['bolt', 'f2'], ['reset', 'f3'], ['lock', 'f4'], ['globe', 'f5'], ['sun', 'f6']];

function html() {
  const ver = displayVersion(RELEASED);
  return `<div class="lp" data-landing>
    <header class="lp-top">
      <a class="lp-brand" href="#/" aria-label="CARVIS CORE"><img src="icons/cc-orb-128.png" alt="" width="34" height="34"><b>CARVIS CORE</b></a>
      <nav class="lp-nav" aria-label="${esc(t('lp.navAria'))}">
        <a href="#lp-features" data-lp-jump="lp-features">${esc(t('lp.navFeatures'))}</a>
        <a href="#/carvis">CARVIS</a>
        <a href="#lp-download" data-lp-jump="lp-download">${esc(t('lp.navDownload'))}</a>
      </nav>
      <div class="lp-tools">
        <button type="button" class="icon-btn" data-act="lang-menu" aria-label="${esc(t('nav.language'))}">${icon('globe')}<span class="lp-lang">${esc(lang().toUpperCase())}</span></button>
        <button type="button" class="icon-btn" data-act="toggle-theme" aria-label="${esc(t('lp.theme'))}">${icon(document.documentElement.dataset.theme === 'light' ? 'moon' : 'sun')}</button>
      </div>
    </header>
    <section class="lp-hero">
      <div class="lp-hero-text">
        <p class="lp-eyebrow">${esc(ver)}</p>
        <h1>${esc(t('lp.title'))}</h1>
        <p class="lp-sub">${esc(t('lp.sub'))}</p>
        <div class="lp-cta">
          <a class="btn btn-primary lp-dl" id="lp-dl-main" href="${portableUrl()}" download>${icon('update')} ${esc(t('dl.windows'))}</a>
          <a class="btn btn-ghost" href="#/carvis">${esc(t('lp.openWeb'))}</a>
        </div>
        <p class="lp-meta">${esc(t('lp.meta'))}</p>
      </div>
      <div class="lp-orb" aria-hidden="true"><img src="icons/cc-orb-glow-512.png" alt="" width="420" height="420"></div>
    </section>
    <section class="lp-section" id="lp-features">
      <h2>${esc(t('lp.featTitle'))}</h2>
      <div class="lp-grid">${FEATURES.map(([ic, k]) => `<article class="lp-card">${icon(ic)}<h3>${esc(t(`lp.${k}`))}</h3><p>${esc(t(`lp.${k}d`))}</p></article>`).join('')}</div>
    </section>
    <section class="lp-section lp-carvis">
      <h2>CARVIS</h2>
      <p>${esc(t('lp.carvisText'))}</p>
      <a class="btn btn-primary" href="#/carvis">${esc(t('lp.openWeb'))}</a>
    </section>
    <section class="lp-section" id="lp-download">
      <h2>${esc(t('lp.navDownload'))}</h2>
      <div class="lp-dl-card">
        <div><h3>${esc(ver)} · Windows x64</h3><p>${esc(t('lp.portableText'))}</p></div>
        <a class="btn btn-primary lp-dl" href="${portableUrl()}" download>${icon('update')} ${esc(t('dl.windows'))}</a>
      </div>
      <p class="lp-small"><a href="${installerUrl()}">${esc(t('lp.installer'))}</a> · <a href="${sumsUrl()}" target="_blank" rel="noopener">SHA256</a> · <a href="${releaseNotesUrl()}" target="_blank" rel="noopener">${esc(t('dl.notes'))}</a></p>
      <p class="lp-small lp-muted">${esc(t('lp.unsigned'))}</p>
    </section>
    <footer class="lp-foot"><span>© CARVIS CORE</span><span>${esc(t('lp.footer'))}</span></footer>
  </div>`;
}

let el = null;
export function showLanding() {
  if (!el) {
    el = document.createElement('div');
    el.id = 'landing';
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      const j = e.target.closest('[data-lp-jump]');
      if (j) { e.preventDefault(); document.getElementById(j.dataset.lpJump)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
  }
  el.innerHTML = html();
  el.hidden = false;
  document.documentElement.classList.add('is-landing');
  document.title = 'CARVIS CORE';
}
export function hideLanding() {
  if (el) el.hidden = true;
  document.documentElement.classList.remove('is-landing');
}
export const refreshLanding = () => { if (el && !el.hidden) showLanding(); };
