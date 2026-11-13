// Business Center (privater Prototyp): unterstützt wirtschaftliche Arbeit – keine Zahlungen, Käufe, Verträge oder
// Kundenkontakte, keine Versprechen über Einnahmen. Zwei Arten von Werkzeugen:
//   • Rechner: rechnen lokal und sofort (ohne KI), Ergebnis ist nachvollziehbar.
//   • Ausarbeitungen: füllen eine strukturierte Anfrage, die im GPT-Arbeitsbereich von den verbundenen Modellen
//     beantwortet wird. Ohne verbundenes Modell kennzeichnet CARVIS die Antwort wie überall als simuliert.
import { esc, uid, download, fmtDate } from '../util.js';
import { icon, toast, confirmDialog } from '../ui.js';
import { store, actions } from '../store.js';

const eur = (v) => (Number.isFinite(v) ? v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }) : '–');
const num = (v) => { const n = parseFloat(String(v ?? '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN; };

// ------------------------------------------------------------------ Rechner (echt, lokal)
const CALCS = {
  breakeven: {
    title: 'Break-even', icon: 'bolt',
    fields: [['fix', 'Fixkosten pro Monat (€)', '2000'], ['price', 'Verkaufspreis je Einheit (€)', '49'], ['var', 'Variable Kosten je Einheit (€)', '12']],
    run: (f) => {
      const cm = f.price - f.var;
      if (!(cm > 0)) return { error: 'Der Preis muss über den variablen Kosten liegen.' };
      const units = Math.ceil(f.fix / cm);
      return { rows: [['Deckungsbeitrag je Einheit', eur(cm)], ['Deckungsbeitragsquote', `${((cm / f.price) * 100).toFixed(1)} %`], ['Break-even-Menge pro Monat', `${units.toLocaleString('de-DE')} Einheiten`], ['Break-even-Umsatz pro Monat', eur(units * f.price)]] };
    },
  },
  price: {
    title: 'Preiskalkulation', icon: 'doc',
    fields: [['cost', 'Kosten je Einheit (€)', '20'], ['margin', 'Gewünschte Marge (%)', '35'], ['vat', 'Umsatzsteuer (%)', '19']],
    run: (f) => {
      if (!(f.margin < 100)) return { error: 'Die Marge muss unter 100 % liegen.' };
      const net = f.cost / (1 - f.margin / 100);
      return { rows: [['Nettopreis', eur(net)], ['Gewinn je Einheit', eur(net - f.cost)], ['Bruttopreis', eur(net * (1 + f.vat / 100))], ['Aufschlag auf Kosten', `${(((net - f.cost) / f.cost) * 100).toFixed(1)} %`]] };
    },
  },
  forecast: {
    title: 'Umsatzprognose (12 Monate)', icon: 'update',
    fields: [['start', 'Umsatz im ersten Monat (€)', '1500'], ['growth', 'Wachstum pro Monat (%)', '8'], ['costs', 'Kosten pro Monat (€)', '1200']],
    run: (f) => {
      let rev = f.start, sum = 0, profit = 0, first = null;
      const months = [];
      for (let m = 1; m <= 12; m++) { sum += rev; profit += rev - f.costs; if (first == null && rev >= f.costs) first = m; months.push([`Monat ${m}`, eur(rev)]); rev *= 1 + f.growth / 100; }
      return { rows: [['Umsatz 12 Monate', eur(sum)], ['Ergebnis 12 Monate', eur(profit)], ['Umsatz deckt Kosten ab', first ? `Monat ${first}` : 'nicht innerhalb von 12 Monaten'], ...months], note: 'Modellrechnung mit konstanter Wachstumsrate – keine Vorhersage.' };
    },
  },
  budget: {
    title: 'Budget (Monat)', icon: 'dashboard',
    fields: [['income', 'Einnahmen (€)', '4000'], ['fixed', 'Fixe Ausgaben (€)', '2300'], ['variable', 'Variable Ausgaben (€)', '900'], ['reserve', 'Rücklage (% der Einnahmen)', '10']],
    run: (f) => {
      const res = f.income * f.reserve / 100;
      const free = f.income - f.fixed - f.variable - res;
      return { rows: [['Rücklage', eur(res)], ['Frei verfügbar', eur(free)], ['Ausgabenquote', `${(((f.fixed + f.variable) / f.income) * 100).toFixed(1)} %`]], note: free < 0 ? 'Die geplanten Ausgaben übersteigen die Einnahmen.' : '' };
    },
  },
};

// ------------------------------------------------------------------ Ausarbeitungen (über GPT)
const MODULES = [
  { id: 'plan', title: 'Planung', icon: 'project', tools: [
    { id: 'model', title: 'Geschäftsmodell analysieren', fields: [['idea', 'Geschäftsidee'], ['audience', 'Zielgruppe']], prompt: (f) => `Analysiere das Geschäftsmodell „${f.idea}“ für die Zielgruppe „${f.audience}“ mit dem Business Model Canvas (alle 9 Felder), nenne die drei größten Risiken und drei Annahmen, die zuerst geprüft werden sollten.` },
    { id: 'bplan', title: 'Businessplan-Gliederung', fields: [['idea', 'Vorhaben'], ['horizon', 'Zeithorizont (z. B. 12 Monate)']], prompt: (f) => `Erstelle eine Gliederung für einen Businessplan zu „${f.idea}“ (${f.horizon}) mit kurzen Leitfragen je Kapitel. Markiere, welche Zahlen ich selbst recherchieren muss.` },
    { id: 'market', title: 'Markt- und Wettbewerbsanalyse vorbereiten', fields: [['market', 'Markt/Branche'], ['region', 'Region']], prompt: (f) => `Bereite eine Markt- und Wettbewerbsanalyse für „${f.market}“ in „${f.region}“ vor: Kriterien, Datenquellen, Vergleichstabelle für Wettbewerber. Erfinde keine Marktzahlen; kennzeichne alles, was recherchiert werden muss.` },
  ] },
  { id: 'marketing', title: 'Marketing', icon: 'globe', tools: [
    { id: 'mplan', title: 'Marketingplan', fields: [['product', 'Produkt'], ['budget', 'Budget pro Monat']], prompt: (f) => `Entwirf einen 90-Tage-Marketingplan für „${f.product}“ mit einem Budget von ${f.budget}: Kanäle, Maßnahmen je Monat, Kennzahlen.` },
    { id: 'copy', title: 'Produkttext', fields: [['product', 'Produkt'], ['tone', 'Tonalität']], prompt: (f) => `Schreibe drei Varianten eines Produkttexts für „${f.product}“ (Tonalität: ${f.tone}), jeweils mit Überschrift, 2 Sätzen und Handlungsaufforderung. Keine unbelegten Superlative.` },
    { id: 'content', title: 'Contentplan', fields: [['topic', 'Thema'], ['channel', 'Kanal']], prompt: (f) => `Erstelle einen Contentplan für 4 Wochen zum Thema „${f.topic}“ auf ${f.channel} als Tabelle (Datum, Format, Idee, Ziel).` },
  ] },
  { id: 'sales', title: 'Vertrieb', icon: 'task', tools: [
    { id: 'offer', title: 'Angebotsentwurf', fields: [['customer', 'Kunde (Platzhalter)'], ['service', 'Leistung']], prompt: (f) => `Formuliere einen Angebotsentwurf an „${f.customer}“ für „${f.service}“ mit Leistungsbeschreibung, Positionen ohne erfundene Preise (Platzhalter), Konditionen-Platzhaltern. Kennzeichne ihn als Entwurf.` },
    { id: 'process', title: 'Verkaufsprozess', fields: [['product', 'Produkt'], ['cycle', 'Typischer Verkaufszyklus']], prompt: (f) => `Plane einen Verkaufsprozess für „${f.product}“ (Zyklus: ${f.cycle}) mit Phasen, Übergangskriterien und Kennzahlen für die Conversion je Phase.` },
  ] },
  { id: 'auto', title: 'Automatisierung', icon: 'agent', tools: [
    { id: 'workflow', title: 'Wiederkehrenden Ablauf beschreiben', fields: [['task', 'Ablauf'], ['frequency', 'Häufigkeit']], prompt: (f) => `Zerlege den Ablauf „${f.task}“ (${f.frequency}) in Schritte, markiere, welche automatisierbar sind und welche eine menschliche Freigabe brauchen.` },
    { id: 'report', title: 'Berichtsvorlage', fields: [['topic', 'Berichtsthema'], ['audience', 'Empfänger']], prompt: (f) => `Erstelle eine Vorlage für einen regelmäßigen Bericht „${f.topic}“ an ${f.audience}: Abschnitte, Kennzahlen, Platzhalter.` },
  ] },
  { id: 'web', title: 'Website & Shop', icon: 'window', tools: [
    { id: 'site', title: 'Website-Struktur', fields: [['business', 'Unternehmen/Produkt'], ['goal', 'Ziel der Website']], prompt: (f) => `Plane die Struktur einer Website für „${f.business}“ (Ziel: ${f.goal}): Seiten, Inhalte je Seite, Handlungsaufforderungen, rechtlich nötige Seiten (Impressum, Datenschutz) als Hinweis.` },
    { id: 'landing', title: 'Verkaufsseite (Entwurf)', fields: [['product', 'Produkt'], ['audience', 'Zielgruppe']], prompt: (f) => `Entwirf den Text einer Verkaufsseite für „${f.product}“ für „${f.audience}“: Abschnitte von Problem bis Handlungsaufforderung. Keine erfundenen Kundenstimmen.` },
  ] },
];
// Bewusst NICHT verfügbar (gesonderte Freigabe des Inhabers nötig)
const LOCKED = ['Echter Checkout / Zahlungsdienstleister', 'Bestellverwaltung mit echten Kunden', 'Lizenz- und Aktivierungssystem', 'Automatische Kunden-E-Mails', 'Rechnungen versenden', 'Käufe, Investitionen, Verträge'];

let state = { tab: 'overview', calc: null, calcResult: null, tool: null };
const biz = () => { const st = store.get(); if (!st.business || !Array.isArray(st.business.items)) st.business = { items: [] }; return st.business; };

function calcForm(id) {
  const c = CALCS[id];
  return `<form class="card biz-form" data-form="biz-calc" data-calc="${id}"><header class="card-head"><h2>${icon(c.icon)} ${esc(c.title)}</h2><span class="tag tag-ok">lokal · ohne KI</span></header>
    <div class="two">${c.fields.map(([k, l, d]) => `<label class="field">${esc(l)}<input name="${k}" inputmode="decimal" value="${esc(d)}" required></label>`).join('')}</div>
    <div class="row-actions"><button class="btn btn-primary" type="submit">Berechnen</button></div>
    ${state.calc === id && state.calcResult ? (state.calcResult.error ? `<div class="notice notice-danger">${esc(state.calcResult.error)}</div>` : `<ul class="status-list biz-result">${state.calcResult.rows.map(([k, v]) => `<li><span class="led led-idle"></span><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></li>`).join('')}</ul>${state.calcResult.note ? `<p class="muted small">${esc(state.calcResult.note)}</p>` : ''}<div class="row-actions"><button class="btn btn-sm" type="button" data-act="biz-save-calc" data-calc="${id}">${icon('save')} Speichern</button></div>`) : ''}
  </form>`;
}

function toolForm(mod, tool) {
  return `<form class="card biz-form" data-form="biz-tool" data-mod="${mod.id}" data-tool="${tool.id}"><header class="card-head"><h2>${icon(mod.icon)} ${esc(tool.title)}</h2><span class="tag">mit KI</span></header>
    ${tool.fields.map(([k, l]) => `<label class="field">${esc(l)}<input name="${k}" maxlength="200" required></label>`).join('')}
    <div class="row-actions"><button class="btn btn-primary" type="submit">${icon('chat')} Mit CARVIS ausarbeiten</button><button class="btn btn-ghost" type="button" data-act="biz-close">Abbrechen</button></div>
    <p class="muted small">Öffnet den GPT-Arbeitsbereich. Antworten kommen nur von verbundenen Modellen; ohne Modell wird die Antwort als simuliert gekennzeichnet.</p>
  </form>`;
}

export default {
  id: 'business',
  title: 'Business',
  icon: 'project',
  render(s) {
    const items = biz().items;
    const tabs = [['overview', 'Übersicht'], ...MODULES.map((m) => [m.id, m.title]), ['finance', 'Finanzen'], ['saved', `Gespeichert (${items.length})`]];
    const mod = MODULES.find((m) => m.id === state.tab);
    let body = '';
    if (state.tab === 'overview') {
      body = `<div class="quick">${MODULES.map((m) => `<button class="qa" data-act="biz-tab" data-id="${m.id}">${icon(m.icon)}<b>${esc(m.title)}</b><small>${m.tools.length} Werkzeuge mit KI</small></button>`).join('')}
        <button class="qa" data-act="biz-tab" data-id="finance">${icon('bolt')}<b>Finanzen</b><small>${Object.keys(CALCS).length} Rechner, lokal</small></button></div>
        <section class="card"><header class="card-head"><h2>${icon('lock')} Bewusst nicht verfügbar</h2><span class="tag tag-warn">Freigabe nötig</span></header>
          <ul class="checks">${LOCKED.map((l) => `<li class="sim">${esc(l)}</li>`).join('')}</ul>
          <p class="muted small">Diese Funktionen brauchen eine gesonderte Freigabe des Inhabers und geprüfte Integrationen. CARVIS führt keine Zahlungen, Käufe oder Vertragsabschlüsse aus und verspricht keine Einnahmen.</p></section>`;
    } else if (state.tab === 'finance') {
      body = `<div class="grid biz-calcs">${Object.keys(CALCS).map(calcForm).join('')}</div>`;
    } else if (state.tab === 'saved') {
      body = items.length ? `<div class="row-actions" style="margin-bottom:12px"><button class="btn btn-sm" data-act="biz-export">${icon('share')} Alles als Markdown exportieren</button></div>
        <ul class="mem-list">${[...items].reverse().map((it) => `<li class="glass"><span>${icon(it.kind === 'calc' ? 'bolt' : 'chat')}</span><span><b>${esc(it.title)}</b><br><small class="muted">${esc(it.summary)}</small></span><time>${fmtDate(it.ts)}</time><button class="icon-btn sm ghost" data-act="biz-del" data-id="${it.id}" aria-label="Löschen">${icon('trash')}</button></li>`).join('')}</ul>`
        : '<p class="empty">Noch nichts gespeichert. Rechnerergebnisse und Ausarbeitungs-Anfragen erscheinen hier.</p>';
    } else if (mod) {
      const tool = mod.tools.find((t) => t.id === state.tool);
      body = tool ? toolForm(mod, tool) : `<div class="quick">${mod.tools.map((t) => `<button class="qa" data-act="biz-tool" data-id="${t.id}">${icon(mod.icon)}<b>${esc(t.title)}</b><small>${t.fields.map((f) => f[1]).join(' · ')}</small></button>`).join('')}</div>`;
    }
    return `<div class="page biz"><header class="page-head"><div><p class="eyebrow">Privater Prototyp</p><h1>Business Center</h1>
      <p class="muted">Planen, rechnen, formulieren – keine Zahlungen, keine Verträge, keine Erfolgsversprechen.</p></div></header>
      <div class="seg biz-tabs" role="tablist">${tabs.map(([id, l]) => `<button role="tab" class="${state.tab === id ? 'on' : ''}" aria-selected="${state.tab === id}" data-act="biz-tab" data-id="${id}">${esc(l)}</button>`).join('')}</div>
      <div class="biz-body">${body}</div></div>`;
  },
  onAct(act, el, ctx) {
    if (act === 'biz-tab') { state = { tab: el.dataset.id, calc: null, calcResult: null, tool: null }; }
    if (act === 'biz-tool') state.tool = el.dataset.id;
    if (act === 'biz-close') state.tool = null;
    if (act === 'biz-save-calc' && state.calcResult && !state.calcResult.error) {
      const c = CALCS[el.dataset.calc];
      store.update((s) => { biz(); s.business.items.push({ id: uid(), kind: 'calc', title: c.title, summary: state.calcResult.rows.slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(' · '), rows: state.calcResult.rows, ts: Date.now() }); });
      toast('Ergebnis gespeichert', 'ok', 1400);
    }
    if (act === 'biz-del') confirmDialog('Eintrag löschen?', { ok: 'Löschen' }).then((y) => y && store.update((s) => { s.business.items = s.business.items.filter((x) => x.id !== el.dataset.id); }));
    if (act === 'biz-export') {
      const md = biz().items.map((it) => `## ${it.title} (${fmtDate(it.ts)})\n\n${it.rows ? it.rows.map(([k, v]) => `- ${k}: ${v}`).join('\n') : it.prompt || it.summary}`).join('\n\n');
      download(`carvis-business-${new Date().toISOString().slice(0, 10)}.md`, `# CARVIS CORE – Business Center\n\n${md}\n`, 'text/markdown');
    }
    ctx.rerender();
  },
  onSubmit(form, ctx) {
    const fd = Object.fromEntries(new FormData(form));
    if (form.dataset.form === 'biz-calc') {
      const c = CALCS[form.dataset.calc];
      const f = Object.fromEntries(Object.entries(fd).map(([k, v]) => [k, num(v)]));
      state.calc = form.dataset.calc;
      state.calcResult = Object.values(f).some((v) => !Number.isFinite(v)) ? { error: 'Bitte alle Felder mit Zahlen füllen.' } : c.run(f);
      return;
    }
    if (form.dataset.form === 'biz-tool') {
      const mod = MODULES.find((m) => m.id === form.dataset.mod);
      const tool = mod.tools.find((t) => t.id === form.dataset.tool);
      const prompt = tool.prompt(fd);
      store.update((s) => { biz(); s.business.items.push({ id: uid(), kind: 'tool', title: `${mod.title}: ${tool.title}`, summary: Object.values(fd).join(' · '), prompt, ts: Date.now() }); });
      state.tool = null;
      location.hash = '#/gpt/chat';
      setTimeout(() => ctx.send(prompt), 300);
    }
  },
};
