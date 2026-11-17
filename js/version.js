// Versionen (D-046): Es gibt GENAU EINE Quelle – die technische Build-Version VERSION.
// - VERSION (Build) steuert Updates, Installer, GitHub-Releases, Veröffentlichungssperre. Sie steigt immer weiter
//   (4.0.0 → 4.1.0 → 4.2.0 …), damit installierte Versionen sicher aktualisiert werden und nie unbemerkt downgraden.
// - Die PRODUKTVERSION ist nur die Anzeige für Menschen und wird daraus abgeleitet:
//   Build 4.x.y = CARVIS CORE v1.x.y  (4.0.0 = v1.0.0 STABLE, 4.1.0 = v1.1.0 TEST, 5.0.0 = v2.0.0 …).
//   Builds vor 4.0.0 (3.x) behalten ihre damalige Bezeichnung.
export const VERSION = '4.2.0';
export const PRODUCT = 'CARVIS CORE';
export const REPO = 'nv4rmp8wyw-del/carvis-core-c';
// Nur geprüfte Installationsdateien öffentlich; dieser Quellcode bleibt privat.
export const UPDATE_REPO = 'nv4rmp8wyw-del/carvis-core-updates';
// Testbuild-Nummer: 0 = Entwicklungsstand. Wird nur in der CI (tools/stamp-build.py) für Testbuilds gesetzt und nie committet.
export const BUILD = 0;

/** Produktversion aus einer Build-Version: '4.1.0' → 'v1.1.0'; vor 4.0.0 unverändert ('3.8.1'). */
export function productVersion(build = VERSION) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(build || ''));
  if (!m || +m[1] < 4) return String(build || '').replace(/^v/, '');
  return `v${+m[1] - 3}.${m[2]}.${m[3]}`;
}
/** Anzeige mit Build: 'v1.1.0 · Build 4.1.0' (vor 4.0.0 nur die Nummer). */
export function versionLabel(build = VERSION) {
  const p = productVersion(build);
  const b = String(build || '').replace(/^v/, '');
  return p === b ? b : `${p} · Build ${b}`;
}
export const PRODUCT_VERSION = productVersion();

// ---- Sichtbare Versionsangabe (D-051): EINE Funktion für alle Anzeigen in der Oberfläche ----
// Höchste öffentlich freigegebene Build-Version. Muss genau dem Eintrag in .github/release-freigabe.txt entsprechen
// (geprüft von tools/test-version.py). Wird nur zusammen mit der Freigabe durch den Inhaber geändert.
export const RELEASED = '4.2.0';
const core = (v) => (/^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || '')) || []).slice(1, 4).map(Number);
const cmpCore = (a, b) => { const x = core(a), y = core(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
/** Ist diese Build-Version öffentlich freigegeben? Testbuilds (-test.N) und alles über RELEASED sind TEST. */
export function isReleased(build = VERSION) { return !/-test\.\d+/.test(String(build)) && cmpCore(build, RELEASED) <= 0; }
/** Kurze Produktversion ohne technische Nummer: 4.0.0 → v1.0, 4.1.0 → v1.1, 4.1.2 → v1.1.2; vor 4.0.0 unverändert. */
export function shortVersion(build = VERSION) {
  const [ma, mi, pa] = core(build);
  if (ma === undefined || ma < 4) return String(build || '').replace(/^v/, '').replace(/-test\.\d+$/, '');
  return `v${ma - 3}.${mi}${pa ? `.${pa}` : ''}`;
}
/**
 * DIE sichtbare Versionsangabe: „CARVIS CORE v1.0“, „CARVIS CORE v1.1 TEST“.
 * TEST, solange die Version nicht freigegeben ist, und immer in einem Testbuild (BUILD > 0).
 * Technische Nummern (4.x.y, Testnummer) gehören nur in Diagnosen, Logs und Release-Metadaten (versionLabel).
 */
export function displayVersion(build = VERSION, { product = true, test } = {}) {
  const isTest = test ?? (!isReleased(build) || (build === VERSION && BUILD > 0));
  return `${product ? 'CARVIS CORE ' : ''}${shortVersion(build)}${isTest ? ' TEST' : ''}`;
}
export const DISPLAY_VERSION = displayVersion();
