// Öffentliche Downloads (v1.2, D-056): Portable EXE ist der Standard-Download, Installer die Alternative.
// Quelle ist ausschließlich das öffentliche Update-Repo (GitHub Releases). „latest“ = neueste reguläre, nicht
// vorab veröffentlichte Version (STABLE). Private TEST-Dateien erscheinen hier nie.
import { UPDATE_REPO, VERSION, RELEASED } from './version.js';
import { listStableReleases } from './update.js';

const BASE = `https://github.com/${UPDATE_REPO}/releases`;
export const PORTABLE_NAME = 'CARVIS-CORE.exe';
/** Ein Klick = Portable EXE der aktuellen öffentlichen STABLE */
export const portableUrl = () => `${BASE}/latest/download/${PORTABLE_NAME}`;
/** Installer der auf der Website ausgelieferten Version (Website und Release kommen aus derselben Pipeline) */
export const installerUrl = (v = RELEASED || VERSION) => `${BASE}/download/v${v}/CARVIS-CORE_${v}_x64-setup.exe`;
export const releaseNotesUrl = (v = RELEASED || VERSION) => `${BASE}/tag/v${v}`;
export const allReleasesUrl = () => BASE;

/** Öffentliche Versionen mit Portable/Installer/Prüfsummen (für das Versionsarchiv) */
export async function publicVersions(opts) {
  const list = await listStableReleases(opts);
  return list.map((r) => ({
    version: r.version, tag: r.tag,
    installer: `${BASE}/download/${r.tag}/${r.installer.name}`,
    portable: `${BASE}/download/${r.tag}/${PORTABLE_NAME}`,
    sums: `${BASE}/download/${r.tag}/SHA256SUMS.txt`,
    page: `${BASE}/tag/${r.tag}`,
  }));
}
