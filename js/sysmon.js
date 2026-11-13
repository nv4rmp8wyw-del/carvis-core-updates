// Geräte- und Netzwerkmonitor. Nur echte Messwerte aus Browser-Schnittstellen.
// Was ein Browser nicht liefert (CPU-Last, Prozesse, WLAN-Signal), wird als „nicht verfügbar“ angezeigt – nie geschätzt.

const state = {
  latency: null, // { med, min, max, loss, n, at }
  storage: null, // { used, quota }
  battery: null, // { level, charging }
  measuring: false,
};

export const sysmon = {
  get: () => state,

  info() {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
    return {
      cores: navigator.hardwareConcurrency || null,
      memGB: navigator.deviceMemory || null, // nur Chromium, auf 8 GB gedeckelt
      online: navigator.onLine,
      type: c?.effectiveType || null,
      downlink: c?.downlink ?? null,
      rtt: c?.rtt ?? null,
      saveData: !!c?.saveData,
    };
  },

  /** Misst die Antwortzeit zum eigenen Host (5 Anfragen, ohne Cache). */
  async measureLatency(n = 5) {
    if (state.measuring) return state.latency;
    state.measuring = true;
    const t = [];
    let fail = 0;
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      try {
        const r = await fetch(`manifest.webmanifest?ping=${Date.now()}${i}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        await r.arrayBuffer();
        t.push(performance.now() - t0);
      } catch {
        fail++;
      }
    }
    state.measuring = false;
    t.sort((a, b) => a - b);
    state.latency = {
      med: t.length ? Math.round(t[Math.floor(t.length / 2)]) : null,
      min: t.length ? Math.round(t[0]) : null,
      max: t.length ? Math.round(t[t.length - 1]) : null,
      loss: Math.round((fail / n) * 100),
      n,
      at: Date.now(),
    };
    return state.latency;
  },

  async readStorage() {
    try {
      const e = await navigator.storage?.estimate?.();
      if (e?.quota) state.storage = { used: e.usage || 0, quota: e.quota };
    } catch { /* nicht verfügbar */ }
    return state.storage;
  },

  async readBattery() {
    try {
      const b = await navigator.getBattery?.();
      if (b) state.battery = { level: Math.round(b.level * 100), charging: b.charging };
    } catch { /* nicht verfügbar (z. B. Safari) */ }
    return state.battery;
  },
};

export const fmtBytes = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(0)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

/** Ringanzeige. pct 0–100 oder null (dann leerer Ring mit „–“). */
export function ring(pct, value, label, tone = 'cyan') {
  const r = 34;
  const C = 2 * Math.PI * r;
  const p = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  return `<div class="gauge g-${tone}"><svg viewBox="0 0 84 84" role="img" aria-label="${label}: ${value}">
    <circle class="g-bg" cx="42" cy="42" r="${r}"/>
    <circle class="g-fg" cx="42" cy="42" r="${r}" stroke-dasharray="${(p / 100) * C} ${C}" transform="rotate(-90 42 42)"/>
    <text x="42" y="46" text-anchor="middle">${value}</text></svg><span>${label}</span></div>`;
}
