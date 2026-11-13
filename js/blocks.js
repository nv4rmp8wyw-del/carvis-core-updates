// Darstellung strukturierter Antwort-Blöcke: Tabellen, Schritte, Risiken, Diagramme, Hinweise.
import { esc } from './util.js';

export function renderBlocks(blocks = []) {
  return blocks.map(renderBlock).join('');
}

const LEVEL = { hoch: 'danger', mittel: 'warn', niedrig: 'ok' };

function renderBlock(b) {
  switch (b.type) {
    case 'table':
      return `<div class="blk">${b.title ? `<div class="blk-title">${esc(b.title)}</div>` : ''}
        <div class="tbl-wrap"><table class="tbl"><thead><tr>${b.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${b.columns.length}" class="muted">Keine Einträge</td></tr>`}</tbody></table></div></div>`;
    case 'steps':
      return `<div class="blk">${b.title ? `<div class="blk-title">${esc(b.title)}</div>` : ''}
        <ol class="steps">${b.items.map((s) => `<li><span>${esc(s)}</span></li>`).join('')}</ol></div>`;
    case 'risks':
      return `<div class="blk"><div class="blk-title">${esc(b.title || 'Risiken')}</div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Risiko</th><th>Stufe</th><th>Maßnahme</th></tr></thead><tbody>
        ${b.rows.map(([r, l, m]) => `<tr><td>${esc(r)}</td><td><span class="lvl lvl-${LEVEL[l] || 'warn'}">${esc(l)}</span></td><td>${esc(m)}</td></tr>`).join('')}
        </tbody></table></div></div>`;
    case 'chart':
      return `<div class="blk"><div class="blk-title">${esc(b.title || 'Diagramm')}</div>${barChart(b.items, b.unit, b.max)}</div>`;
    case 'donut':
      return `<div class="blk"><div class="blk-title">${esc(b.title || '')}</div>${donut(b.segments, b.center)}</div>`;
    case 'sources':
      return `<div class="blk"><div class="blk-title">Quellen</div><ol class="sources">${b.items.map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a></li>`).join('')}</ol></div>`;
    case 'coord':
      return coordBlock(b);
    case 'notice':
      return `<div class="notice notice-${esc(b.tone || 'info')}">${esc(b.text)}</div>`;
    case 'actions':
      return `<div class="blk-actions">${b.items
        .map((a) => `<button class="btn btn-sm ${a.danger ? 'btn-danger' : 'btn-ghost'}" data-act="${esc(a.act)}" data-payload="${esc(JSON.stringify(a.payload ?? null))}">${esc(a.label)}</button>`)
        .join('')}</div>`;
    default:
      return '';
  }
}

// Koordinationsbericht: welche Modelle, wie bewertet, wie zusammengeführt
function coordBlock(b) {
  const multi = b.rows.length > 1;
  const summary = multi
    ? `${b.rows.filter((r) => r.ok).length}/${b.rows.length} Modelle · Übereinstimmung ${b.agreement ?? '–'} % · ${b.method}`
    : `${b.rows[0].label} · ${b.rows[0].ok ? `${(b.rows[0].ms / 1000).toFixed(1)} s · Bewertung ${b.rows[0].score}` : 'Fehler'}`;
  const warn = [];
  if (b.lowAgreement) warn.push('Die Modelle stimmen inhaltlich wenig überein – Ergebnis kritisch prüfen.');
  if (b.disputedNumbers?.length) warn.push(`Nicht alle Modelle nennen dieselben Zahlen: ${b.disputedNumbers.join(', ')}`);
  return `<details class="coord"><summary><span class="coord-ico"></span>Koordinationsbericht <small>${esc(summary)}</small></summary>
    <div class="coord-body">
      <p class="muted small">Aufgabe: <b>${esc(b.task.type)}</b>${b.task.complex ? ' · komplex' : ''} · Auswahl: ${esc(b.why)}</p>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>Modell</th><th>Anbieter</th><th>Kosten</th><th>Zeit</th><th>Bewertung</th><th title="Abdeckung der Frage / Struktur / Übereinstimmung mit anderen">Abd. / Strukt. / Überein.</th><th>Hinweise</th></tr></thead><tbody>
      ${b.rows.map((r) => `<tr class="${r.best ? 'best' : ''}"><td>${esc(r.letter)}</td><td>${esc(r.label)}${r.best && multi ? ' <span class="tag tag-ok">beste</span>' : ''}</td><td>${esc(r.provider)}</td><td>${esc(r.cost)}</td>
        <td>${r.ok ? `${(r.ms / 1000).toFixed(1)} s` : '–'}</td><td>${r.ok ? `<b>${r.score}</b>/100` : '<span class="lvl lvl-danger">Fehler</span>'}</td>
        <td>${r.ok ? `${r.parts.coverage} / ${r.parts.structure} / ${r.parts.agreement ?? '–'}` : '–'}</td><td>${esc(r.ok ? r.flags.join(', ') || '–' : r.error)}</td></tr>`).join('')}
      </tbody></table></div>
      ${warn.map((w) => `<div class="notice notice-warn">${esc(w)}</div>`).join('')}
      ${b.contradictions?.length ? `<div class="blk-title" style="margin-top:12px">Erkannte Widersprüche</div><ul>${b.contradictions.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
      ${b.uncertainties?.length ? `<div class="blk-title" style="margin-top:12px">Unsicherheiten</div><ul>${b.uncertainties.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
      ${b.sources?.length ? `<div class="blk-title" style="margin-top:12px">Quellen</div><ol class="sources">${b.sources.map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a></li>`).join('')}</ol>` : ''}
      <p class="muted small">Bewertung = heuristische Messwerte (Abdeckung der Frage, Länge, Struktur, Sicherheit, Übereinstimmung zwischen Modellen) – keine absolute Wahrheit.</p>
    </div></details>`;
}

export function barChart(items = [], unit = '', max) {
  const m = max ?? Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return '<p class="muted">Keine Daten vorhanden.</p>';
  return `<div class="bars">${items
    .map(
      (i) => `<div class="bar-row"><span class="bar-label" title="${esc(i.label)}">${esc(i.label)}</span>
      <span class="bar-track"><span class="bar-fill" style="--w:${Math.max(2, (i.value / m) * 100)}%"></span></span>
      <span class="bar-val">${esc(i.value)}${esc(unit)}</span></div>`,
    )
    .join('')}</div>`;
}

export function donut(segments = [], center = '') {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const r = 42;
  const C = 2 * Math.PI * r;
  let off = 0;
  const arcs = segments
    .map((s) => {
      const len = (s.value / total) * C;
      const el = `<circle r="${r}" cx="60" cy="60" fill="none" stroke="${s.color}" stroke-width="12" stroke-linecap="butt"
        stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"/>`;
      off += len;
      return el;
    })
    .join('');
  return `<div class="donut"><svg viewBox="0 0 120 120" role="img" aria-label="${esc(segments.map((s) => `${s.label}: ${s.value}`).join(', '))}">
    <circle r="${r}" cx="60" cy="60" fill="none" stroke="rgba(120,180,255,.08)" stroke-width="12"/>${arcs}
    <text x="60" y="58" text-anchor="middle" class="donut-num">${esc(center)}</text>
    <text x="60" y="74" text-anchor="middle" class="donut-sub">gesamt</text></svg>
    <ul class="legend">${segments.map((s) => `<li><i style="background:${s.color}"></i>${esc(s.label)} <b>${s.value}</b></li>`).join('')}</ul></div>`;
}
