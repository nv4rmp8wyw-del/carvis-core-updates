// Service Worker: App-Shell offline verfügbar machen. Version erhöhen, wenn Dateien sich ändern.
const CACHE = 'ccc-3.8.1-r12-9f17730';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/cc.css',
  'js/app.js', 'js/util.js', 'js/store.js', 'js/core.js', 'js/voice.js', 'js/engine.js', 'js/ui.js', 'js/blocks.js',
  'js/sysmon.js', 'js/views/dashboard.js', 'js/views/workspace.js', 'js/views/gpt.js', 'js/views/settings.js', 'js/views/ultimate.js', 'js/views/models.js', 'js/views/agents.js', 'js/views/computer.js', 'js/views/finance.js', 'js/agents.js', 'js/theme.js', 'js/greeting.js', 'js/version.js', 'js/update.js', 'js/views/update.js', 'js/views/perf.js', 'js/preview.js', 'js/views/design.js', 'js/views/business.js', 'js/views/ucc.js', 'js/agent-client.js',
  'js/ai/providers.js', 'js/ai/orchestrator.js', 'js/ai/quality.js', 'js/ai/privacy.js', 'js/ai/research.js', 'js/ai/webllm.js', 'js/ai/webllm-worker.js',
  'icons/icon.svg',
  'icons/mark.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const fonts = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!sameOrigin && !fonts) return; // z. B. lokales LLM: nie cachen
  // Eigene Dateien: sofort aus dem Cache, im Hintergrund aktualisieren (schneller Start, danach aktuell).
  // Schriften: dasselbe. Nicht-GET und fremde Hosts (z. B. lokale KI) werden oben ausgenommen.
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req, sameOrigin ? { cache: 'no-cache' } : undefined)
        .then((res) => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; })
        .catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      const res = await net;
      return res || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
    }),
  );
});
