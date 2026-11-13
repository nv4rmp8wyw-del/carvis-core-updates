// Update Center: prüft GitHub Releases (kostenlos), lädt das Installationspaket herunter und prüft die SHA-256-Prüfsumme.
// Es wird nichts automatisch installiert und nichts ohne passende Prüfsumme angeboten. Das Paket startet der Nutzer selbst.
import { VERSION, UPDATE_REPO, BUILD } from './version.js';

// Versionen: 3.8.0 (Release) oder 3.8.0-test.42 (Testbuild, fortlaufende Nummer). Ein Release ist immer neuer als jeder Testbuild derselben Linie.
export const parseVer = (v) => { const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-test\.(\d+))?(?![\w.-])/.exec(String(v || '').trim()); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? Infinity : +m[4]] : null; };
export const isTestVer = (v) => /-test\.\d+/.test(String(v || ''));
export const currentVersion = () => (BUILD ? `${VERSION}-test.${BUILD}` : VERSION);
export function cmpVer(a, b) {
  const x = parseVer(a), y = parseVer(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

export class UpdateError extends Error {}

/** @returns {{state:'current'|'available'|'none', current, latest?, notes?, published?, installer?, sums?, page?}} */
export async function checkUpdate({ current = currentVersion(), fetchFn = fetch.bind(globalThis), repo = UPDATE_REPO, includeTests = false } = {}) {
  let res;
  try {
    res = await fetchFn(`https://api.github.com/repos/${repo}/releases${includeTests ? '?per_page=20' : '/latest'}`, { headers: { Accept: 'application/vnd.github+json' } });
  } catch {
    throw new UpdateError('Keine Verbindung zu GitHub. Prüfe deine Internetverbindung und versuche es erneut.');
  }
  // Der öffentliche Download-Kanal hat noch kein Release oder ist nicht verfügbar.
  if (res.status === 404) return { state: 'none', current, notFound: true };
  if (res.status === 403 || res.status === 429) throw new UpdateError('GitHub begrenzt gerade die Anfragen. Bitte in einigen Minuten erneut prüfen.');
  if (!res.ok) throw new UpdateError(`GitHub antwortet mit Fehler ${res.status}.`);
  let r = await res.json();
  if (includeTests) { // Liste: neueste Version inklusive veröffentlichter Testversionen (Entwürfe sind nie sichtbar)
    const list = (Array.isArray(r) ? r : []).filter((x) => !x.draft && parseVer(x.tag_name));
    if (!list.length) return { state: 'none', current };
    r = list.reduce((m, x) => (cmpVer(x.tag_name, m.tag_name) > 0 ? x : m));
  }
  const latest = String(r.tag_name || '').replace(/^v/, '');
  if (!parseVer(latest)) throw new UpdateError('Die veröffentlichte Version hat keine gültige Versionsnummer.');
  const assets = (r.assets || []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size }));
  const installer = assets.find((a) => /^CARVIS-CORE_[0-9A-Za-z.\-]+_x64-setup\.exe$/i.test(a.name)) || null;
  const sums = assets.find((a) => /^sha256sums?(\.txt)?$/i.test(a.name)) || null;
  return {
    state: cmpVer(current, latest) < 0 ? 'available' : 'current',
    current, latest, isTest: isTestVer(latest) || !!r.prerelease, notes: r.body || '', published: r.published_at || '', page: r.html_url, installer, sums, assets,
  };
}

/** Öffentliche, reguläre Releases, nach Version absteigend. Kein Test- oder Vorabkanal. */
export async function listStableReleases({ fetchFn = fetch.bind(globalThis), repo = UPDATE_REPO } = {}) {
  let response;
  try {
    response = await fetchFn(`https://api.github.com/repos/${repo}/releases?per_page=20`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
  } catch {
    throw new UpdateError('Update-Server derzeit nicht erreichbar.');
  }
  if (response.status === 404) return [];
  if (!response.ok) throw new UpdateError(`Update-Server antwortet mit ${response.status}.`);
  let data;
  try { data = await response.json(); } catch { throw new UpdateError('Ungültige Antwort vom Update-Server.'); }
  if (!Array.isArray(data)) throw new UpdateError('Unerwartetes Release-Format.');
  return data.filter((r) => !r.draft && !r.prerelease && /^v?\d+\.\d+\.\d+$/.test(String(r.tag_name || '')))
    .map((r) => {
      const assets = Array.isArray(r.assets) ? r.assets : [];
      const installer = assets.find((a) => /^CARVIS-CORE_\d+\.\d+\.\d+_x64-setup\.exe$/i.test(String(a.name || '')));
      const sums = assets.find((a) => a.name === 'SHA256SUMS.txt');
      return installer && sums ? { version: String(r.tag_name).replace(/^v/, ''), tag: String(r.tag_name), installer, sums } : null;
    }).filter(Boolean).sort((a, b) => cmpVer(b.version, a.version));
}

export function parseSums(text) {
  const map = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([a-f0-9]{64})\s+\*?(.+?)\s*$/i.exec(line.trim());
    if (m) map[m[2]] = m[1].toLowerCase();
  }
  return map;
}

export const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Lädt das Paket mit Fortschritt und vergleicht die SHA-256-Prüfsumme. Wirft UpdateError bei jedem Problem. */
export async function downloadVerified(info, { onProgress = () => {}, fetchFn = fetch.bind(globalThis) } = {}) {
  if (!info.installer) throw new UpdateError('Das Release enthält keine Installationsdatei (.exe).');
  if (!info.sums) throw new UpdateError('Das Release enthält keine Prüfsummen-Datei (SHA256SUMS.txt). Ohne Prüfsumme lade ich nichts herunter.');
  let sumsText;
  try { sumsText = await (await fetchFn(info.sums.url)).text(); } catch { throw new UpdateError('Die Prüfsummen konnten nicht geladen werden.'); }
  const expected = parseSums(sumsText)[info.installer.name];
  if (!expected) throw new UpdateError(`In SHA256SUMS.txt fehlt ein Eintrag für ${info.installer.name}.`);
  let res;
  try { res = await fetchFn(info.installer.url); } catch { throw new UpdateError('Download fehlgeschlagen (Netzwerk). Du kannst die Datei auch von der Release-Seite laden.'); }
  if (!res.ok) throw new UpdateError(`Download fehlgeschlagen (Fehler ${res.status}).`);
  const total = Number(res.headers.get('content-length')) || info.installer.size || 0;
  const chunks = [];
  let got = 0;
  if (res.body?.getReader) {
    const rd = res.body.getReader();
    for (;;) { const { done, value } = await rd.read(); if (done) break; chunks.push(value); got += value.length; onProgress(got, total); }
  } else { const b = new Uint8Array(await res.arrayBuffer()); chunks.push(b); got = b.length; onProgress(got, got); }
  const blob = new Blob(chunks, { type: 'application/octet-stream' });
  const actual = toHex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  if (actual !== expected) throw new UpdateError('Prüfsumme stimmt NICHT überein. Die Datei wurde verworfen und darf nicht installiert werden.');
  return { blob, name: info.installer.name, sha256: actual, size: got };
}
