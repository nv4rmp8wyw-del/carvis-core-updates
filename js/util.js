// Kleine Hilfsfunktionen ohne Abhängigkeiten.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

const dtf = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const dtfS = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dfl = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dfs = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

export const fmtTime = (d = new Date(), sec = false) => (sec ? dtfS : dtf).format(new Date(d));
export const fmtDateLong = (d = new Date()) => dfl.format(new Date(d));
export const fmtDate = (d) => (d ? dfs.format(new Date(d)) : '–');

export function relTime(ts) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 45) return 'gerade eben';
  if (diff < 3600) return `vor ${Math.round(diff / 60)} Min.`;
  if (diff < 86400) return `vor ${Math.round(diff / 3600)} Std.`;
  if (diff < 86400 * 7) return `vor ${Math.round(diff / 86400)} Tg.`;
  return fmtDate(ts);
}

export function greetingByTime(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return 'Gute Nacht';
  if (h < 11) return 'Guten Morgen';
  if (h < 18) return 'Guten Tag';
  return 'Guten Abend';
}

// Sehr kleines, sicheres Markdown (escaped zuerst, dann wenige Formatierungen).
export function md(src) {
  const code = [];
  let s = String(src ?? '').replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, c) => {
    code.push(`<pre><code>${esc(c.replace(/\n$/, ''))}</code></pre>`);
    return `\u0000${code.length - 1}\u0000`;
  });
  s = esc(s);
  const inline = (t) =>
    t
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
  const out = [];
  let list = null;
  const close = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of s.split('\n')) {
    const line = raw.trimEnd();
    let m;
    if (/^\u0000\d+\u0000$/.test(line.trim())) {
      close();
      out.push(line.trim());
    } else if ((m = line.match(/^(#{1,3})\s+(.*)/))) {
      close();
      out.push(`<h${m[1].length + 2}>${inline(m[2])}</h${m[1].length + 2}>`);
    } else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) {
      if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
      if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if (!line.trim()) {
      close();
    } else {
      close();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  close();
  return out.join('').replace(/\u0000(\d+)\u0000/g, (_, i) => code[+i]);
}

// Text für Sprachausgabe: Markdown entfernen, kürzen.
export function plainText(src, max = 600) {
  let t = String(src ?? '')
    .replace(/```[\s\S]*?```/g, ' (Codeblock) ')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length > max) t = t.slice(0, t.lastIndexOf(' ', max)) + ' … Den Rest findest du im Chat.';
  return t;
}

export function download(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
