// Ein einziger Update-Bereich: aktuelle Version, neueste Version, vorherige reguläre Version.
// Quellcode privat, Download-Kanal öffentlich. Keine Entwicklungskanäle im UI.
import { esc, relTime } from '../util.js';
import { actions, store } from '../store.js';
import { confirmDialog, toast, icon } from '../ui.js';
import { VERSION, BUILD } from '../version.js';
import { checkUpdate, listStableReleases, downloadVerified, UpdateError, cmpVer, currentVersion } from '../update.js';
import { agentClient } from '../agent-client.js';

const P = { st: null, login: null, rel: null, dl: null, err: '', busy: '', confirm: false, checked: false };
const mb = (n) => (n / 1048576).toFixed(1);
const S = { advOpen: false, info: null, releases: [], previous: null, error: '', busy: '', progress: 0, file: null, url: '', checked: false };
const audit = (event, detail = '') => actions.setSettings({ updateAudit: [...((store.get().settings || {}).updateAudit || []), { t: Date.now(), ev: event, detail: String(detail).slice(0, 160) }].slice(-60) });

async function installRelease(release, ctx) {
  if (!agentClient.connected) throw new UpdateError('Für die Installation direkt in der App muss der integrierte Agent verbunden sein.');
  const response = await agentClient.updPublicCheck();
  const available = (response.releases || []).find((r) => r.tag === release.tag && r.installer && r.sums);
  if (!available) throw new UpdateError('Version derzeit nicht im offiziellen Update-Kanal verfügbar.');
  let dl = await agentClient.updPublicDownload(available.installer.id, available.sums.id, available.installer.name);
  while (dl.state === 'lädt') {
    await new Promise((r) => setTimeout(r, 400));
    dl = await agentClient.updProgress();
    S.progress = dl.total ? Math.min(100, Math.round(100 * dl.received / dl.total)) : 0;
    ctx.rerender();
  }
  if (dl.state !== 'fertig' || !dl.verified) throw new UpdateError(dl.error || 'Update konnte nicht verifiziert werden.');
  audit('Update-Datei geprüft', available.installer.name);
  await agentClient.updInstall(available.installer.name);
  audit('Installation gestartet', release.tag);
  toast('CARVIS CORE wird aktualisiert und startet anschließend neu.', 'info');
}

export default {
  id: 'update',
  title: 'Updates',
  icon: 'bolt',
  render(st) {
    const s = (st && st.settings) || store.get().settings || {};
    const latest = S.info;
    const available = latest?.state === 'available' ? S.releases.find((r) => r.version === latest.latest && cmpVer(r.version, VERSION) > 0) : null;
    const prev = latest?.state === 'current' ? S.previous : null;
    const label = !S.checked ? 'Wird geprüft …' : S.error ? 'Zurzeit nicht erreichbar' : available ? available.version : latest?.state === 'none' ? 'Noch keine Version verfügbar' : VERSION;
    return `<div class='page cc-updates' data-cc-updates='true'>
      <header class='page-head'><div><p class='eyebrow'>CARVIS CORE</p><h1>Updates</h1>
        <p class='muted'>Immer auf dem aktuellen Stand. Ohne GitHub-Anmeldung.</p></div></header>
      <section class='card glass cc-update-panel'>
        <div class='cc-update-heading'><img class='cc-update-symbol' src='icons/mark.svg' alt='' width='40' height='40'>
          <div><h2>CARVIS CORE</h2><p>Deine Anwendung</p></div></div>
        <div class='cc-version-row'><span>Installiert</span><strong data-cur${BUILD ? ` title="interne Build-Nummer ${BUILD}"` : ''}>${esc(VERSION)}</strong></div>
        <div class='cc-version-row'><span>Neueste Version</span><strong data-latest>${esc(label)}</strong></div>
        ${S.error ? `<p class='cc-update-error' role='alert'>${esc(S.error)}</p>` : ''}
        ${S.busy === 'install' ? `<p class='cc-update-progress' role='status'>Update wird vorbereitet … ${S.progress}%</p>` : ''}
        <div class='cc-update-actions'>
          ${available ? `<button class='btn btn-primary' data-act='update-apply' ${S.busy ? 'disabled' : ''}>${S.busy === 'install' ? 'Aktualisiere …' : 'Jetzt aktualisieren'}</button>` : ''}
          ${!available && S.checked && !S.error && latest?.state === 'current' ? `<p class='cc-current'>CARVIS CORE ist aktuell.</p>` : ''}
          <button class='btn cc-check' data-act='update-check' ${S.busy ? 'disabled' : ''}>${S.busy === 'check' ? 'Prüfe …' : 'Erneut prüfen'}</button>
        </div>
        ${prev ? `<div class='cc-previous'><span>Die vorherige Version ist ${esc(prev.version)}.</span>
          <button class='btn cc-previous-button' data-act='update-previous' ${S.busy ? 'disabled' : ''}>Vorherige Version installieren</button></div>` : ''}
        ${S.file && S.url ? `<p class='cc-update-manual'>Download geprüft. <a href='${S.url}' download='${esc(S.file.name)}'>Installer speichern</a></p>` : ''}
      </section>
      <details class='card glass upd-adv' ${S.advOpen ? 'open' : ''} data-adv><summary>Erweitert</summary>
        <label class="switch"><input type="checkbox" data-set-update="updatePrivate" ${s.updatePrivate ? 'checked' : ''}><span></span> Entwicklerkanal anzeigen (nur für Entwickler)</label>
        ${s.updatePrivate ? `        <section class="card" data-private-update>
          <header class="card-head"><h2>Privater Entwicklerkanal</h2></header>
          ${!agentClient.connected ? `<p class="notice notice-warn">Dafür wird der Agent gebraucht (in der Windows-App automatisch verbunden).</p>` : `
          <p class="muted small">Anmeldung bei GitHub über einen Gerätecode. Das Zugriffstoken bleibt im Agenten (unter Windows mit dem Benutzerkonto verschlüsselt) und wird nie angezeigt. Installiert wird nur nach deinem Klick, nur eine mit SHA-256 geprüfte Datei.</p>
          ${P.err ? `<div class="notice notice-warn" data-priv-error>${esc(P.err)}</div>` : ''}
          ${!P.st?.loggedIn ? (P.login ? `<div class="notice" data-priv-code>Öffne <b>${esc(P.login.verificationUri)}</b> und gib den Code <b style="font-size:1.3rem;letter-spacing:.1em">${esc(P.login.userCode)}</b> ein. Diese Seite wartet auf deine Bestätigung …</div>
            <button class="btn" data-act="priv-cancel">Abbrechen</button>` : `<div class="inline-fields"><label class="field">Client-ID der GitHub App<input id="priv-client" type="text" value="${esc(P.clientDraft ?? P.st?.clientId ?? '')}" placeholder="Iv1.… oder Iv23…"></label></div>
            <button class="btn btn-primary" data-act="priv-login" ${P.busy ? 'disabled' : ''}>Mit GitHub anmelden</button>`)
          : `<p class="small"><span class="led led-ok"></span> Angemeldet${P.st.tokenProtected ? ' (Token verschlüsselt)' : ' (Token lokal, nicht verschlüsselt)'} · Version ${esc(currentVersion())}</p>
            <button class="btn btn-primary" data-act="priv-check" ${P.busy ? 'disabled' : ''}>${P.busy === 'check' ? 'Suche …' : 'Nach privaten Updates suchen'}</button>
            <button class="btn" data-act="priv-logout" ${P.busy ? 'disabled' : ''}>Abmelden</button>
            ${P.checked && !P.rel ? '<p class="small" data-priv-none>Kein neueres Update vorhanden.</p>' : ''}
            ${P.rel ? `<div class="notice" data-priv-rel><b>${esc(P.rel.name)}</b> (${esc(P.rel.tag)}, ${mb(P.rel.installer.size || 0)} MB) ist neuer als deine Version.${P.rel.notes ? `<pre class="small" style="white-space:pre-wrap">${esc(P.rel.notes)}</pre>` : ''}
              ${!P.rel.sums ? '<p class="small"><b>Keine Prüfsumme im Release – Download gesperrt.</b></p>' : !P.dl || P.dl.state === 'fehler' || P.dl.state === 'leer' ? `<button class="btn btn-primary" data-act="priv-download">Jetzt herunterladen</button>` : ''}
              ${P.dl?.state === 'lädt' ? `<div role="progressbar" style="height:8px;border-radius:6px;background:rgba(255,255,255,.1);overflow:hidden"><div style="width:${P.dl.total ? Math.round(100 * P.dl.received / P.dl.total) : 5}%;height:100%;background:var(--cyan)"></div></div><p class="small">Lade … ${mb(P.dl.received || 0)} MB</p>` : ''}
              ${P.dl?.state === 'fehler' ? `<p class="small" data-priv-dlerr>${esc(P.dl.error)}</p>` : ''}
              ${P.dl?.state === 'fertig' ? `<p class="small" data-priv-verified><b>Prüfsumme bestätigt</b> (SHA-256 ${esc((P.dl.sha256 || '').slice(0, 16))}…).</p>
                ${P.confirm ? `<p class="small">CARVIS CORE schließt sich, installiert still und startet neu. Deine Daten werden vorher gesichert und bleiben erhalten.</p><button class="btn btn-primary" data-act="priv-install">Ja, jetzt installieren</button> <button class="btn" data-act="priv-noinstall">Abbrechen</button>` : `<button class="btn btn-primary" data-act="priv-askinstall">Installieren …</button>`}` : ''}
            </div>` : ''}`}`}
        </section>` : ''}
        ${(s.updateAudit || []).length ? `<div class="upd-adv-block" data-audit><h3 class="small">Update-Protokoll</h3><ul class="status-list small">${[...s.updateAudit].reverse().slice(0, 12).map((e) => `<li><span class="k">${new Date(e.t).toLocaleString('de-DE')}</span><span class="v">${esc(e.ev)}${e.detail ? ' · ' + esc(e.detail) : ''}</span></li>`).join('')}</ul></div>` : ''}
      </details>
      <p class='cc-update-footnote'>Die Installation bewahrt deine Einstellungen. Bei Problemen bleiben Sicherung und technische Wiederherstellung erhalten.</p>
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
            if (r.state === 'abgelaufen' || r.state === 'abgelehnt') { P.login = null; P.err = r.state === 'abgelehnt' ? 'Anmeldung abgelehnt.' : 'Der Code ist abgelaufen. Bitte neu anmelden.'; break; }
            if (r.interval && P.login) P.login.interval = r.interval;
          }
        }
        if (act === 'priv-cancel') P.login = null;
        if (act === 'priv-logout') { await agentClient.updLogout(); P.st = await agentClient.updStatus(); P.rel = null; P.dl = null; P.checked = false; audit('Private Abmeldung'); }
        if (act === 'priv-check') {
          P.busy = 'check'; P.rel = null; P.dl = null; P.confirm = false; rr();
          const r = await agentClient.updCheck(); const cur = currentVersion();
          P.rel = (r.releases || []).filter((x) => cmpVer(x.tag, cur) > 0).sort((a, b) => cmpVer(b.tag, a.tag))[0] || null; P.checked = true;
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
        if (act === 'priv-install' && P.rel) { audit('Installation gestartet (auf Klick)', P.rel.tag); P.confirm = false; await agentClient.updInstall(P.rel.installer.name); toast('CARVIS CORE wird aktualisiert und startet neu.', 'info'); }
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
        S.previous = newest && cmpVer(VERSION, newest.version) >= 0 ? releases.find((r) => cmpVer(r.version, VERSION) < 0) || null : null;
        audit('Update-Prüfung', newest?.version || 'Kein veröffentlichtes Update');
        actions.setSettings({ lastUpdateCheck: Date.now() });
      } catch (e) { S.checked = true; S.error = e instanceof UpdateError ? e.message : 'Die Updateprüfung ist momentan nicht möglich.'; audit('Updateprüfung fehlgeschlagen', S.error); }
      S.busy = ''; ctx.rerender(); return;
    }
    if (action === 'update-apply' || action === 'update-previous') {
      if (S.busy) return;
      const target = action === 'update-apply' ? S.releases[0] : S.previous;
      if (!target) return;
      if (action === 'update-previous') {
        const ok = await confirmDialog(`Die vorherige Version ${target.version} installieren? Deine Einstellungen werden gesichert.`, { ok: 'Installieren' });
        if (!ok) return;
      }
      S.busy = 'install'; S.error = ''; S.progress = 0; ctx.rerender();
      try {
        if (agentClient.connected) await installRelease(target, ctx);
        else if (action === 'update-apply') {
          // In der Webansicht ohne Desktop-Agent nur verifizierter manueller Download.
          const info = S.info;
          if (!info?.installer || !info.sums) throw new UpdateError('Kein überprüfbares Installationspaket vorhanden.');
          S.file = await downloadVerified(info, { onProgress: (n,t) => { S.progress = t ? Math.round(100*n/t) : 0; ctx.rerender(); } });
          if (S.url) URL.revokeObjectURL(S.url);
          S.url = URL.createObjectURL(S.file.blob);
          audit('Installer zum Speichern geprüft', S.file.name);
        } else throw new UpdateError('Die vorherige Version kann nur in der Windows-App installiert werden.');
      } catch (e) { S.error = e instanceof UpdateError ? e.message : (e?.message || 'Update fehlgeschlagen.'); audit('Installation fehlgeschlagen', S.error); }
      S.busy = ''; ctx.rerender(); return;
    }
  },
};
