import { esc, uid } from '../util.js';
import { icon, confirmDialog } from '../ui.js';
import { store } from '../store.js';
import { donut } from '../blocks.js';

// Alle Rechnungen laufen lokal im Browser. Keine Bankanbindung, keine Zahlungen, keine Anlageempfehlung.
const CATS = ['Wohnen', 'Lebensmittel', 'Mobilität', 'Versicherung', 'Abos', 'Freizeit', 'Sparen', 'Sonstiges'];
const NEEDS = ['Wohnen', 'Lebensmittel', 'Mobilität', 'Versicherung'];
const WANTS = ['Abos', 'Freizeit', 'Sonstiges'];
const COLORS = ['#22e4ff', '#2f6bff', '#7a5cff', '#2ff3b1', '#ffc24b', '#ff4d6d', '#7df3ff', '#9b8cff'];

export const num = (v) => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
export const eur = (n) => (Number.isFinite(n) ? n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }) : '–');
const monthly = (i) => (i.interval === 'jahr' ? i.amount / 12 : i.amount);

/** Budget-Kennzahlen (rein, testbar). */
export function budget(items) {
  const inc = items.filter((i) => i.type === 'in').reduce((a, i) => a + monthly(i), 0);
  const out = items.filter((i) => i.type === 'out');
  const byCat = Object.fromEntries(CATS.map((c) => [c, out.filter((i) => i.cat === c).reduce((a, i) => a + monthly(i), 0)]));
  const spend = Object.values(byCat).reduce((a, b) => a + b, 0);
  const sum = (arr) => arr.reduce((a, c) => a + byCat[c], 0);
  return { inc, spend, rest: inc - spend, rate: inc > 0 ? (inc - spend) / inc : null, byCat, needs: sum(NEEDS), wants: sum(WANTS), saving: byCat.Sparen };
}

/** Sparplan: Endwert bei monatlicher Sparrate und jährlicher Rendite (Annahme). */
export function futureValue(monthlySave, years, annualRate) {
  const n = Math.round(years * 12);
  if (!(n > 0)) return 0;
  const r = Math.pow(1 + annualRate, 1 / 12) - 1;
  return Math.abs(r) < 1e-12 ? monthlySave * n : monthlySave * ((Math.pow(1 + r, n) - 1) / r);
}

/** Positionsgröße aus Risiko je Trade. Es wird nichts bestellt. */
export function positionSize(capital, riskPct, entry, stop) {
  const riskAmt = capital * (riskPct / 100);
  const per = Math.abs(entry - stop);
  if (!(capital > 0) || !(riskPct > 0) || !(per > 0)) return null;
  const units = riskAmt / per;
  return { riskAmt, units, value: units * entry, exceeds: units * entry > capital };
}

let scen = null;
let risk = null;

export default {
  id: 'finance',
  title: 'Finanzen',
  icon: 'doc',
  render(s) {
    const F = s.finance || { items: [], shopping: [] };
    const b = budget(F.items);
    const subs = F.items.filter((i) => i.type === 'out' && i.cat === 'Abos');
    const flex = WANTS.map((c) => [c, b.byCat[c]]).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]);
    const seg = CATS.map((c, i) => ({ label: c, value: Math.round(b.byCat[c] * 100) / 100, color: COLORS[i] })).filter((x) => x.value > 0);
    return `<div class="page"><header class="page-head"><div><p class="eyebrow">kostenlos · lokal</p><h1>Finanzen &amp; Einkauf</h1>
      <p class="muted">Rechenhilfen nach deinen Eingaben. Keine Bankanbindung, keine Zahlungen, <b>keine Anlageberatung</b> und keine Gewinnversprechen. Die Daten bleiben in diesem Browser.</p></div></header>
      <div class="grid">
        <section class="card glass span-2"><header class="card-head"><h2>${icon('doc')} Budget pro Monat</h2></header>
          <form class="inline-form" data-form="fin-item">
            <select name="type" aria-label="Art"><option value="out">Ausgabe</option><option value="in">Einnahme</option></select>
            <input name="name" placeholder="Bezeichnung" required maxlength="60" aria-label="Bezeichnung">
            <input name="amount" inputmode="decimal" placeholder="Betrag €" required aria-label="Betrag">
            <select name="cat" aria-label="Kategorie">${CATS.map((c) => `<option>${c}</option>`).join('')}</select>
            <select name="interval" aria-label="Rhythmus"><option value="monat">monatlich</option><option value="jahr">jährlich</option></select>
            <button class="btn btn-primary" type="submit">${icon('plus')} Hinzufügen</button></form>
          ${F.items.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Bezeichnung</th><th>Kategorie</th><th>Betrag</th><th>pro Monat</th><th></th></tr></thead><tbody>
            ${F.items.map((i) => `<tr><td>${i.type === 'in' ? '＋' : '−'} ${esc(i.name)}</td><td>${i.type === 'in' ? 'Einnahme' : esc(i.cat)}</td><td>${eur(i.amount)} ${i.interval === 'jahr' ? '/ Jahr' : ''}</td><td>${eur(monthly(i))}</td><td><button class="icon-btn sm ghost" data-act="fin-del" data-id="${i.id}" aria-label="Löschen">${icon('trash')}</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Noch keine Einträge. Füge Einnahmen und Ausgaben hinzu.</p>'}
        </section>
        <section class="card glass"><header class="card-head"><h2>${icon('dashboard')} Übersicht</h2></header>
          <ul class="status-list"><li><span class="k">Einnahmen</span><span class="v">${eur(b.inc)}</span></li><li><span class="k">Ausgaben</span><span class="v">${eur(b.spend)}</span></li>
            <li><span class="led led-${b.rest >= 0 ? 'ok' : 'danger'}"></span><span class="k">Übrig</span><span class="v">${eur(b.rest)}${b.rate != null ? ` <small>${Math.round(b.rate * 100)} % der Einnahmen</small>` : ''}</span></li></ul>
          ${seg.length ? donut(seg, eur(b.spend).replace(/\s?€/, '')) : ''}</section>
        ${b.inc > 0 ? `<section class="card glass"><header class="card-head"><h2>${icon('preview')} 50/30/20-Faustregel</h2></header>
          <ul class="status-list"><li><span class="k">Notwendig (Ziel 50 %)</span><span class="v">${Math.round((b.needs / b.inc) * 100)} %</span></li><li><span class="k">Wünsche (Ziel 30 %)</span><span class="v">${Math.round((b.wants / b.inc) * 100)} %</span></li><li><span class="k">Sparen (Ziel 20 %)</span><span class="v">${Math.round(((b.saving + Math.max(0, b.rest)) / b.inc) * 100)} %</span></li></ul>
          <p class="muted small">Nur eine grobe Orientierung, kein Rat. Kategorien: Notwendig = Wohnen, Lebensmittel, Mobilität, Versicherung. Wünsche = Abos, Freizeit, Sonstiges.</p></section>` : ''}
        ${flex.length || subs.length ? `<section class="card glass"><header class="card-head"><h2>${icon('bolt')} Sparpotenzial</h2></header>
          <ul class="status-list">${flex.map(([c, v]) => `<li><span class="k">${esc(c)}: ${eur(v)} / Monat</span><span class="v">−10 % = ${eur(v * 0.1)} / Monat, ${eur(v * 1.2)} / Jahr</span></li>`).join('')}</ul>
          ${subs.length ? `<p class="muted small">Abos: ${subs.map((i) => `${esc(i.name)} ${eur(monthly(i) * 12)}/Jahr`).join(', ')}. Prüfe, ob du sie noch nutzt.</p>` : ''}
          <p class="muted small">Rechenbeispiel „was wäre wenn du 10 % kürzt“. Was du kürzen willst, entscheidest du.</p></section>` : ''}

        <section class="card glass span-2"><header class="card-head"><h2>${icon('bolt')} Sparplan-Szenarien</h2></header>
          <form class="inline-form" data-form="fin-scen"><input name="save" inputmode="decimal" placeholder="Sparrate €/Monat" required aria-label="Sparrate"><input name="years" inputmode="numeric" placeholder="Jahre" required aria-label="Jahre"><button class="btn btn-primary" type="submit">Berechnen</button></form>
          ${scen ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Annahme Rendite p. a.</th><th>Endwert nach ${scen.years} Jahren</th><th>davon eingezahlt</th></tr></thead><tbody>
            ${[0, 0.03, 0.06].map((r) => `<tr><td>${Math.round(r * 100)} %</td><td>${eur(futureValue(scen.save, scen.years, r))}</td><td>${eur(scen.save * scen.years * 12)}</td></tr>`).join('')}</tbody></table></div>
            <p class="muted small">Das sind Rechenannahmen, <b>keine Prognose</b>. Echte Renditen schwanken, können negativ sein, und es gibt keine Garantie. Kosten, Steuern und Inflation sind nicht eingerechnet.</p>` : ''}
        </section>

        <section class="card glass span-2"><header class="card-head"><h2>${icon('lock')} Trading-Risikorechner</h2><span class="tag tag-warn">KEINE ORDERS</span></header>
          <form class="inline-form" data-form="fin-risk"><input name="capital" inputmode="decimal" placeholder="Kapital €" required aria-label="Kapital"><input name="risk" inputmode="decimal" placeholder="Risiko je Trade %" required aria-label="Risiko in Prozent"><input name="entry" inputmode="decimal" placeholder="Einstieg" required aria-label="Einstiegskurs"><input name="stop" inputmode="decimal" placeholder="Stop-Loss" required aria-label="Stop-Loss"><button class="btn btn-primary" type="submit">Berechnen</button></form>
          ${risk ? (risk.res ? `<ul class="status-list"><li><span class="k">Maximaler Verlust bei Stop</span><span class="v">${eur(risk.res.riskAmt)}</span></li><li><span class="k">Positionsgröße</span><span class="v">${risk.res.units.toLocaleString('de-DE', { maximumFractionDigits: 4 })} Stück <small>Wert ${eur(risk.res.value)}</small></span></li>
            ${[3, 5, 10].map((n) => { const left = risk.capital * Math.pow(1 - risk.pct / 100, n); const need = 1 / (1 - (1 - left / risk.capital)) - 1; return `<li><span class="k">Nach ${n} Verlusten in Folge</span><span class="v">${eur(left)} <small>zurück auf Start: +${Math.round(need * 100)} % nötig</small></span></li>`; }).join('')}</ul>
            ${risk.res.exceeds ? '<div class="notice notice-warn">Die Position wäre größer als dein Kapital. Das ginge nur mit Hebel, der das Verlustrisiko deutlich erhöht.</div>' : ''}
            <p class="muted small">Hohe Gewinnchancen mit kleinem Budget gibt es nicht ohne hohes Verlustrisiko. Ein Totalverlust ist möglich. CC platziert keine Orders und gibt keine Kauf- oder Verkaufsempfehlung.</p>` : '<div class="notice notice-warn">Bitte gültige Zahlen eingeben (Einstieg und Stop müssen verschieden sein).</div>') : ''}
        </section>

        <section class="card glass span-2"><header class="card-head"><h2>${icon('task')} Einkaufsliste &amp; Preisvergleich</h2></header>
          <form class="inline-form" data-form="shop-item"><input name="name" placeholder="Produkt" required maxlength="60" aria-label="Produkt"><input name="shop" placeholder="Shop" required maxlength="40" aria-label="Shop"><input name="price" inputmode="decimal" placeholder="Preis €" required aria-label="Preis"><input name="target" inputmode="decimal" placeholder="Zielpreis € (optional)" aria-label="Zielpreis"><button class="btn btn-primary" type="submit">${icon('plus')} Hinzufügen</button></form>
          ${(F.shopping || []).length ? `<ul class="task-list">${F.shopping.map((p) => {
            const best = p.prices.length ? p.prices.reduce((a, c) => (c.price < a.price ? c : a)) : null;
            const hit = best && p.target != null && best.price <= p.target;
            return `<li class="task glass"><div class="task-main"><span class="task-title">${esc(p.name)} ${hit ? '<span class="tag tag-ok">ZIELPREIS ERREICHT</span>' : ''}</span>
              <span class="task-meta">${p.prices.map((x) => `<span class="${best && x === best ? 'ok' : ''}">${esc(x.shop)}: ${eur(x.price)}${best && x === best && p.prices.length > 1 ? ' ✓ günstigster' : ''}</span>`).join(' · ')}${p.target != null ? ` · Ziel ${eur(p.target)}` : ''}</span></div>
              <button class="icon-btn sm ghost" data-act="shop-del" data-id="${p.id}" aria-label="Löschen">${icon('trash')}</button></li>`;
          }).join('')}</ul>` : '<p class="empty">Noch keine Produkte.</p>'}
          <p class="muted small"><b>Nicht verfügbar:</b> automatischer Preisabruf und echte Preisalarme. Dafür gibt es ohne Backend keine kostenlose, zulässige Datenquelle. Die Preise trägst du selbst ein, CC vergleicht und zeigt den günstigsten. Gekauft wird nie automatisch.</p>
        </section>
      </div></div>`;
  },
  onSubmit(form) {
    const f = new FormData(form);
    const k = form.dataset.form;
    if (k === 'fin-item') {
      const amount = num(f.get('amount'));
      if (!(amount > 0)) return;
      store.update((s) => { s.finance.items.push({ id: uid(), type: f.get('type'), name: String(f.get('name')).trim(), amount, cat: f.get('cat'), interval: f.get('interval') }); }, { text: `Budget-Eintrag: ${f.get('name')}`, icon: 'doc' });
    }
    if (k === 'fin-scen') {
      const save = num(f.get('save')), years = num(f.get('years'));
      scen = save > 0 && years > 0 && years <= 60 ? { save, years } : null;
    }
    if (k === 'fin-risk') {
      const capital = num(f.get('capital')), pct = num(f.get('risk'));
      const res = positionSize(capital, pct, num(f.get('entry')), num(f.get('stop')));
      risk = { capital, pct, res: pct > 0 && pct <= 100 ? res : null };
    }
    if (k === 'shop-item') {
      const price = num(f.get('price')), t = num(f.get('target')), name = String(f.get('name')).trim(), shop = String(f.get('shop')).trim();
      if (!(price > 0)) return;
      store.update((s) => {
        let p = s.finance.shopping.find((x) => x.name.toLowerCase() === name.toLowerCase());
        if (!p) { p = { id: uid(), name, target: null, prices: [] }; s.finance.shopping.unshift(p); }
        const ex = p.prices.find((x) => x.shop.toLowerCase() === shop.toLowerCase());
        if (ex) ex.price = price; else p.prices.push({ shop, price });
        if (t > 0) p.target = t;
      }, { text: `Einkaufsliste: ${name}`, icon: 'task' });
    }
  },
  async onAct(act, el, ctx) {
    if (act === 'fin-del') store.update((s) => { s.finance.items = s.finance.items.filter((i) => i.id !== el.dataset.id); });
    if (act === 'shop-del' && (await confirmDialog('Produkt aus der Liste entfernen?', { ok: 'Entfernen' }))) store.update((s) => { s.finance.shopping = s.finance.shopping.filter((p) => p.id !== el.dataset.id); });
    ctx.rerender();
  },
};
