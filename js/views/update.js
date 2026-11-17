// Ein einziger Update-Bereich: aktuelle Version, neueste Version, vorherige reguläre Version.
// Quellcode privat, Download-Kanal öffentlich. Keine Entwicklungskanäle im UI.
import { esc, relTime } from '../util.js';
import { actions, store } from '../store.js';
import { confirmDialog, toast, icon } from '../ui.js';
import { VERSION, displayVersion, shortVersion } from '../version.js';
import { checkUpdate, listStableReleases, downloadVerified, UpdateError, cmpVer, currentVersion, isTestVer } from '../update.js';
import { agentClient } from '../agent-client.js';
import { t, lang } from '../i18n.js';

const P = { st: null, login: null, rel: null, dl: null, err: '', busy: '', confirm: false, checked: false };
const mb = (n) => (n / 1048576).toFixed(1);
const S = { advOpen: false, info: null, releases: [], error: '', busy: '', progress: 0, file: null, url: '', checked: false };
const audit = (event, detail = '') => actions.setSettings({ updateAudit: [...((store.get().settings || {}).updateAudit || []), { t: Date.now(), ev: event, detail: String(detail).slice(0, 160) }].slice(-60) });

async function installRelease(release, ctx) {
  if (!agentClient.connected) throw new UpdateError(t('upd.errNeedAgent'));
  const response = await agentClient.updPublicCheck();
  const available = (response.releases || []).find((r) => r.tag === release.tag && r.installer && r.sums);
  if (!available) throw new UpdateError(t('upd.errNotInChannel'));
  let dl = await agentClient.updPublicDownload(available.installer.id, available.sums.id, available.installer.name);
  while (dl.state === 'lädt') {
    await new Promise((r) => setTimeout(r, 400));
    dl = await agentClient.updProgress();
    S.progress = dl.total ? Math.min(100, Math.round(100 * dl.received / dl.total)) : 0;
    ctx.rerender();
  }
  if (dl.state !== 'fertig' || !dl.verified) throw new UpdateError(dl.error || t('upd.errNotVerified'));
  audit('Update-Datei geprüft', available.installer.name);
  await agentClient.updInstall(available.installer.name);
  audit('Installation gestartet', release.tag);
  toast(t('upd.restarting'), 'info');
}

export default {
  id: 'update',
  get title() { return t('upd.title'); },
  icon: 'bolt',
  render(st) {
    const s = (st && st.settings) || store.get().settings || {};
    // TEST-App (Kennung de.carviscore.app.test, vom Agenten gemeldet): Updates NUR über den privaten Testkanal –
    // nie ein öffentlicher STABLE-Installer (der würde eine zweite, andere App installieren).
    const testApp = !!P.st?.testApp;
    const latest = testApp ? null : S.info;
    const available = latest?.state === 'available' ? S.releases.find((r) => r.version === latest.latest && cmpVer(r.version, VERSION) > 0) : null;
    const label = !S.checked ? t('upd.checking') : S.error ? t('upd.unreachable') : available ? displayVersion(available.version) : latest?.state === 'none' ? t('upd.none') : displayVersion();
    return `<div class='page cc-updates' data-cc-updates='true'>
      <header class='page-head'><div><p class='eyebrow'>CARVIS CORE</p><h1>${t('upd.title')}</h1>
        <p class='muted'>${testApp ? t('upd.subTest') : t('upd.subStable')}</p></div></header>
      <section class='card glass cc-update-panel'>
        <div class='cc-update-heading'><img class='cc-update-symbol' src='icons/mark.svg' alt='' width='40' height='40'>
          <div><h2>${testApp ? 'CARVIS CORE TEST' : 'CARVIS CORE'}</h2><p>${testApp ? t('upd.testApp') : t('upd.app')}</p></div></div>
        <div class='cc-version-row'><span>${t('upd.installed')}</span><strong data-cur>${esc(displayVersion())}</strong></div>
        ${testApp ? `<div class='cc-version-row'><span>${t('upd.channel')}</span><strong data-kanal>${t('upd.channelTest')}</strong></div>` : `<div class='cc-version-row'><span>${t('upd.latest')}</span><strong data-latest>${esc(label)}</strong></div>`}
        ${S.error ? `<p class='cc-update-error' role='alert'>${esc(S.error)}</p>` : ''}
        ${S.busy === 'install' ? `<p class='cc-update-progress' role='status'>${t('upd.preparing', { pct: S.progress })}</p>` : ''}
        <div class='cc-update-actions'>
          ${available ? `<button class='btn btn-primary' data-act='update-apply' ${S.busy ? 'disabled' : ''}>${S.busy === 'install' ? t('upd.updating') : t('upd.now')}</button>` : ''}
          ${!available && S.checked && !S.error && latest?.state === 'current' ? `<p class='cc-current'>${t('upd.current')}</p>` : ''}
          ${testApp ? '' : `<button class='btn cc-check' data-act='update-check' ${S.busy ? 'disabled' : ''}>${S.busy === 'check' ? t('upd.checkBusy') : t('upd.check')}</button>`}
        </div>
        ${S.file && S.url ? `<p class='cc-update-manual'>${t('upd.saved')} <a href='${S.url}' download='${esc(S.file.name)}'>${t('upd.saveInstaller')}</a></p>` : ''}
      </section>
      <details class='card glass upd-adv' ${S.advOpen || testApp ? 'open' : ''} data-adv><summary>${t('common.advanced')}</summary>
        ${testApp ? '' : `<label class="switch"><input type="checkbox" data-set-update="updatePrivate" ${s.updatePrivate ? 'checked' : ''}><span></span> ${t('upd.devChannel')}</label>`}
        ${s.updatePrivate || testApp ? `        <section class="card" data-private-update>
          <header class="card-head"><h2>${t('upd.privTitle')}</h2></header>
          ${!agentClient.connected ? `<p class="notice notice-warn">${t('upd.needAgent')}</p>` : `
          <p class="muted small">${t('upd.loginText')}</p>
          ${P.err ? `<div class="notice notice-warn" data-priv-error>${esc(P.err)}</div>` : ''}
          ${!P.st?.loggedIn ? (P.login ? `<div class="notice" data-priv-code>${t('upd.code', { uri: `<b>${esc(P.login.verificationUri)}</b>`, code: `<b style="font-size:1.3rem;letter-spacing:.1em">${esc(P.login.userCode)}</b>` })}</div>
            <button class="btn" data-act="priv-cancel">${t('common.cancel')}</button>` : `<div class="inline-fields"><label class="field">${t('upd.clientId')}<input id="priv-client" type="text" value="${esc(P.clientDraft ?? P.st?.clientId ?? '')}" placeholder="${esc(t('upd.clientPh'))}"></label></div>
            <button class="btn btn-primary" data-act="priv-login" ${P.busy ? 'disabled' : ''}>${t('upd.login')}</button>`)
          : `<p class="small"><span class="led led-ok"></span> ${t('upd.loggedIn')}${P.st.tokenProtected ? t('upd.tokenEnc') : t('upd.tokenPlain')} · ${esc(t('upd.version', { v: shortVersion(currentVersion()) }))}</p>
            <button class="btn btn-primary" data-act="priv-check" ${P.busy ? 'disabled' : ''}>${P.busy === 'check' ? t('upd.searching') : t('upd.searchPriv')}</button>
            <button class="btn" data-act="priv-logout" ${P.busy ? 'disabled' : ''}>${t('upd.logout')}</button>
            ${P.checked && !P.rel ? `<p class="small" data-priv-none>${t('upd.noNewer')}</p>` : ''}
            ${P.rel ? `<div class="notice" data-priv-rel>${t('upd.newer', { v: `<b>${esc(displayVersion(P.rel.tag))}</b>`, build: '', mb: mb(P.rel.installer.size || 0) })}${P.rel.notes ? `<pre class="small" style="white-space:pre-wrap">${esc(P.rel.notes)}</pre>` : ''}
              ${!P.rel.sums ? `<p class="small"><b>${t('upd.noSums')}</b></p>` : !P.dl || P.dl.state === 'fehler' || P.dl.state === 'leer' ? `<button class="btn btn-primary" data-act="priv-download">${t('upd.download')}</button>` : ''}
              ${P.dl?.state === 'lädt' ? `<div role="progressbar" style="height:8px;border-radius:6px;background:rgba(255,255,255,.1);overflow:hidden"><div style="width:${P.dl.total ? Math.round(100 * P.dl.received / P.dl.total) : 5}%;height:100%;background:var(--cyan)"></div></div><p class="small">${t('upd.loading', { mb: mb(P.dl.received || 0) })}</p>` : ''}
              ${P.dl?.state === 'fehler' ? `<p class="small" data-priv-dlerr>${esc(P.dl.error)}</p>` : ''}
              ${P.dl?.state === 'fertig' ? `<p class="small" data-priv-verified>${t('upd.verified', { sha: esc((P.dl.sha256 || '').slice(0, 16)) })}</p>
                ${P.confirm ? `<p class="small">${isTestVer(P.rel.tag) && !P.st?.testApp
                  ? t('upd.confirmTest')
                  : t('upd.confirmSelf')}</p><button class="btn btn-primary" data-act="priv-install">${t('upd.yesInstall')}</button> <button class="btn" data-act="priv-noinstall">${t('common.cancel')}</button>` : `<button class="btn btn-primary" data-act="priv-askinstall">${t('upd.install')}</button>`}` : ''}
            </div>` : ''}`}`}
        </section>` : ''}
        ${(s.updateAudit || []).length ? `<div class="upd-adv-block" data-audit><h3 class="small">${t('upd.log')}</h3><ul class="status-list small">${[...s.updateAudit].reverse().slice(0, 12).map((e) => `<li><span class="k">${new Date(e.t).toLocaleString(lang())}</span><span class="v">${esc(e.ev)}${e.detail ? ' · ' + esc(e.detail) : ''}</span></li>`).join('')}</ul></div>` : ''}
      </details>
      <p class='cc-update-footnote'>${t('upd.footnote')}</p>
    </div>`;
  },
  onChange(el, ctx) {
    if (el.dataset.setUpdate) { actions.setSettings({ [el.dataset.setUpdate]: el.checked }); ctx.rerender(); }
  },
  onMount(root, ctx) {
    root.querySelector('#priv-client')?.addEventListener('input', (e) => { P.clientDraft = e.target.value; }); // Eingabe übersteht ein Neuzeichnen
    root.querySelector('[data-adv]')?.addEventListener('toggle', (e) => { S.advOpen = e.target.open; });
    if (agentClient.connected && !P.st) agentClient.updStatus().then((r) => { P.st = r; if (root.dataset.view === 'update') (ctx.softRerender || ctx.rerender)(); }).catch(() => {});
    // Erster Besuch: direkt prüfen. Ein erneutes Rendern startet keine Endlosschleife.
    if (!S.checked && !S.busy) this.onAct('update-check', null, ctx);
  },
  async onAct(action, el, ctx) {
    const act = action;
    if (act.startsWith('priv-')) {
      const rr = () => ctx.rerender();
      try {
        P.err = '';
        if (act === 'priv-login') {
          const id = (document.getElementById('priv-client')?.value || '').trim();
          P.busy = 'login'; rr(); P.login = await agentClient.updLoginStart(id); P.busy = ''; audit('Private Anmeldung gestartet'); rr();
          for (let n = 0; P.login && n < 200; n++) {
            await new Promise((r) => setTimeout(r, (P.login?.interval || 5) * 1000));
            if (!P.login) break;
            const r = await agentClient.updLoginPoll();
            if (r.state === 'angemeldet') { P.login = null; P.st = await agentClient.updStatus(); audit('Private Anmeldung abgeschlossen'); break; }
            if (r.state === 'abgelaufen' || r.state === 'abgelehnt') { P.login = null; P.err = r.state === 'abgelehnt' ? t('upd.loginDenied') : t('upd.codeExpired'); break; }
            if (r.interval && P.login) P.login.interval = r.interval;
          }
        }
        if (act === 'priv-cancel') P.login = null;
        if (act === 'priv-logout') { await agentClient.updLogout(); P.st = await agentClient.updStatus(); P.rel = null; P.dl = null; P.checked = false; audit('Private Abmeldung'); }
        if (act === 'priv-check') {
          P.busy = 'check'; P.rel = null; P.dl = null; P.confirm = false; rr();
          const r = await agentClient.updCheck(); const cur = currentVersion();
          // TEST-App: nur Testbuilds (-test.N) – ein STABLE-Installer würde eine andere App installieren
          P.rel = (r.releases || []).filter((x) => cmpVer(x.tag, cur) > 0 && (!P.st?.testApp || isTestVer(x.tag))).sort((a, b) => cmpVer(b.tag, a.tag))[0] || null; P.checked = true;
          audit('Private Update-Suche', P.rel ? `neu: ${P.rel.tag}` : 'nichts Neueres');
        }
        if (act === 'priv-download' && P.rel) {
          audit('Private Download gestartet (auf Klick)', P.rel.installer.name);
          P.dl = await agentClient.updDownload(P.rel.installer.id, P.rel.sums.id, P.rel.installer.name); rr();
          while (P.dl && P.dl.state === 'lädt') { await new Promise((r) => setTimeout(r, 400)); P.dl = await agentClient.updProgress(); rr(); }
          audit(P.dl?.state === 'fertig' ? 'Download geprüft' : 'Download fehlgeschlagen', P.dl?.error || P.rel.installer.name);
        }
        if (act === 'priv-askinstall') P.confirm = true;
        if (act === 'priv-noinstall') P.confirm = false;
        if (act === 'priv-install' && P.rel) { audit('Installation gestartet (auf Klick)', P.rel.tag); P.confirm = false; await agentClient.updInstall(P.rel.installer.name); toast(t('upd.restarting'), 'info'); }
      } catch (e) { P.err = e.message || String(e); P.login = act === 'priv-login' ? null : P.login; }
      P.busy = ''; rr(); return;
    }
    if (action === 'update-check') {
      if (S.busy) return;
      S.busy = 'check'; S.error = ''; ctx.rerender();
      try {
        const [info, releases] = await Promise.all([checkUpdate(), listStableReleases()]);
        S.info = info; S.releases = releases; S.checked = true;
        const newest = releases[0];
        audit('Update-Prüfung', newest?.version || 'Kein veröffentlichtes Update');
        actions.setSettings({ lastUpdateCheck: Date.now() });
      } catch (e) { S.checked = true; S.error = e instanceof UpdateError ? e.message : t('upd.checkFailed'); audit('Updateprüfung fehlgeschlagen', S.error); }
      S.busy = ''; ctx.rerender(); return;
    }
    if (action === 'update-apply' && P.st?.testApp) { toast(t('upd.testOnly'), 'info'); return; }
    if (action === 'update-apply') {
      if (S.busy) return;
      const target = S.releases[0]; // nur die neueste öffentliche STABLE – kein Benutzer-Downgrade (Inhaber-Auftrag 16.11.)
      if (!target || cmpVer(target.version, VERSION) <= 0) { toast(t('upd.current'), 'info'); return; } // nie gleiche oder ältere Version installieren
      if (!target) return;
      S.busy = 'install'; S.error = ''; S.progress = 0; ctx.rerender();
      try {
        if (agentClient.connected) await installRelease(target, ctx);
        else if (action === 'update-apply') {
          // In der Webansicht ohne Desktop-Agent nur verifizierter manueller Download.
          const info = S.info;
          if (!info?.installer || !info.sums) throw new UpdateError(t('upd.noPackage'));
          S.file = await downloadVerified(info, { onProgress: (n,t) => { S.progress = t ? Math.round(100*n/t) : 0; ctx.rerender(); } });
          if (S.url) URL.revokeObjectURL(S.url);
          S.url = URL.createObjectURL(S.file.blob);
          audit('Installer zum Speichern geprüft', S.file.name);
        } else throw new UpdateError(t('upd.prevOnlyApp'));
      } catch (e) { S.error = e instanceof UpdateError ? e.message : (e?.message || t('upd.failed')); audit('Installation fehlgeschlagen', S.error); }
      S.busy = ''; ctx.rerender(); return;
    }
  },
};
