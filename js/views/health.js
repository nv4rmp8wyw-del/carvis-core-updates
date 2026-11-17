// Systemzustand (Feedback Center, 4.0): Status, erkannte/behobene/offene Probleme, Prüfungen, Reparaturhistorie,
// Empfehlungen, Not-Stopp, freiwilliges Feedback mit geschütztem Diagnosebericht.
import { esc, fmtTime } from '../util.js';
import { icon, toast, confirmDialog } from '../ui.js';
import { health, STATUS, STATUS_LED, REPAIRS, diagnosticReport } from '../health.js';
import { REPO } from '../version.js';

const S = { kind: 'Fehler', text: '', withDiag: true, consent: false, preview: '', open: new Set() };
const ago = (t) => { if (!t) return 'noch nie'; const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'gerade eben' : s < 3600 ? `vor ${Math.round(s / 60)} min` : fmtTime(t); };

function issueCard(it) {
  const r = REPAIRS[it.code];
  const canRepair = r && !['repairing', 'fixed'].includes(it.status) && !health.stopped;
  const open = S.open.has(it.key);
  return `<article class="heal-issue" data-issue="${esc(it.key)}" data-status="${it.status}">
    <header><span class="led led-${STATUS_LED[it.status]}"></span><b>${esc(it.area)}</b><span class="chip chip-${STATUS_LED[it.status]}">${esc(STATUS[it.status])}</span>${it.count > 1 ? `<span class="muted small">${it.count}× · zuletzt ${esc(ago(it.last))}</span>` : `<span class="muted small">${esc(ago(it.last))}</span>`}</header>
    <p>${esc(it.cause || it.code)}</p>
    ${it.affects?.length ? `<p class="small muted">Betroffen: ${esc(it.affects.join(', '))}</p>` : ''}
    ${['fixed'].includes(it.status) ? '' : `<p class="small"><b>Empfehlung:</b> ${esc(it.advice || 'Erneut prüfen.')}</p>`}
    ${r && !['fixed'].includes(it.status) ? `<p class="small muted">Reparatur: ${esc(r.label)} · ${r.risk === 'safe' ? 'sicher, läuft automatisch' : 'nur mit deiner Freigabe'} · höchstens ${r.maxAttempts} Versuche${r.reversible ? ' · umkehrbar' : ''} · Versuche bisher: ${it.attempts}</p>` : ''}
    <div class="row-actions">
      ${canRepair ? `<button class="btn btn-sm ${it.status === 'consent' ? 'btn-primary' : ''}" data-act="heal-repair" data-key="${esc(it.key)}">${it.status === 'consent' ? 'Freigeben und reparieren' : 'Jetzt reparieren'}</button>` : ''}
      ${it.status !== 'repairing' ? `<button class="btn btn-sm btn-ghost" data-act="heal-recheck" data-key="${esc(it.key)}">Erneut prüfen</button>` : '<span class="muted small">Reparatur läuft …</span>'}
      ${it.undo ? `<button class="btn btn-sm btn-ghost" data-act="heal-undo" data-key="${esc(it.key)}">${esc(it.undo.label)}</button>` : ''}
      <button class="btn btn-sm btn-ghost" data-act="heal-hist" data-key="${esc(it.key)}" aria-expanded="${open}">Verlauf</button>
      ${['fixed', 'manual', 'detected'].includes(it.status) ? `<button class="btn btn-sm btn-ghost" data-act="heal-dismiss" data-key="${esc(it.key)}">Ausblenden</button>` : ''}
    </div>
    ${open ? `<ol class="heal-hist small">${it.hist.slice().reverse().map((h) => `<li class="${h.ok === true ? 'ok' : h.ok === false ? 'bad' : ''}"><time>${esc(fmtTime(h.t))}</time> ${esc(h.text)}</li>`).join('')}</ol>` : ''}
  </article>`;
}

export default {
  id: 'health',
  title: 'Systemzustand',
  render() {
    const all = health.issues;
    const fixed = all.filter((i) => i.status === 'fixed');
    const open = all.filter((i) => i.status !== 'fixed');
    const ov = health.overall();
    const checks = health.checks;
    const affected = [...new Set(open.flatMap((i) => i.affects || []))];
    return `<div class="page heal">
      <section class="card glass heal-hero" data-heal-overall="${ov}">
        <div class="heal-state"><span class="led led-${STATUS_LED[ov]} led-lg"></span><div><p class="eyebrow">Systemzustand</p><h1>${esc(STATUS[ov])}</h1>
          <p class="muted small">${open.length ? `${open.length} offene${open.length === 1 ? 's Problem' : ' Probleme'}${affected.length ? ` · betroffen: ${esc(affected.slice(0, 4).join(', '))}` : ''}` : 'Keine offenen Probleme.'} · letzte Prüfung ${esc(ago(health.lastRun))}</p></div></div>
        <div class="row-actions">
          <button class="btn btn-primary" data-act="heal-run" ${health.running ? 'disabled' : ''}>${health.running ? 'Prüfung läuft …' : 'Jetzt prüfen'}</button>
          <label class="switch"><input type="checkbox" data-heal-auto ${health.auto ? 'checked' : ''}><span></span> Sichere Reparaturen automatisch</label>
          <button class="btn ${health.stopped ? 'btn-primary' : 'btn-danger'}" data-act="heal-stop">${health.stopped ? 'Selbstreparatur fortsetzen' : 'Not-Stopp'}</button>
        </div>
        ${health.stopped ? '<div class="notice notice-warn">Not-Stopp aktiv: Es werden keine Reparaturen ausgeführt. Prüfungen laufen weiter und zeigen nur an.</div>' : ''}
        ${health.queue.length ? `<p class="small muted">Wartet auf Internet: ${esc(health.queue.join(', '))}</p>` : ''}
      </section>

      <section class="card glass"><header class="card-head"><h2>${icon('bolt')} Offene Probleme</h2></header>
        ${open.length ? `<div class="heal-list">${open.map(issueCard).join('')}</div>` : '<p class="empty">Alles bereit. Erkannte Probleme erscheinen hier mit Ursache, Reparatur und Verlauf.</p>'}
      </section>

      <section class="card glass"><header class="card-head"><h2>${icon('reset')} Automatisch behoben</h2></header>
        ${fixed.length ? `<div class="heal-list">${fixed.slice(0, 12).map(issueCard).join('')}</div>` : '<p class="empty">Noch nichts. Behoben heißt: Die betroffene Funktion wurde danach erneut geprüft und funktioniert.</p>'}
      </section>

      <section class="card glass"><header class="card-head"><h2>${icon('system')} Letzte Prüfungen</h2></header>
        <div class="tbl-wrap"><table class="tbl" data-heal-checks><thead><tr><th>Bereich</th><th>Zuletzt</th><th>Ergebnis</th><th>Intervall</th></tr></thead><tbody>
          ${checks.map((c) => `<tr><td>${esc(c.label)}</td><td>${esc(c.lastResult ? ago(c.lastResult.t) : (c.when() ? 'ausstehend' : 'nicht nötig'))}</td><td>${c.lastResult ? `<span class="led led-${c.lastResult.ok ? 'ok' : 'warn'}"></span> ${esc(c.lastResult.text)}` : '–'}</td><td class="small muted">${Math.round(c.interval / 1000)} s</td></tr>`).join('')}
          <tr><td>Oberfläche, Navigation, Mikrofon, Internet</td><td colspan="3" class="small muted">ereignisgesteuert (Fehler, Laden einer Ansicht, Mikrofonzugriff, online/offline)</td></tr>
        </tbody></table></div>
      </section>

      <section class="card glass"><header class="card-head"><h2>${icon('doc')} Reparaturhistorie</h2></header>
        ${health.log.length ? `<ol class="heal-log small" data-heal-log>${health.log.slice(0, 40).map((l) => `<li class="${l.ok === true ? 'ok' : l.ok === false ? 'bad' : ''}"><time>${esc(fmtTime(l.t))}</time> ${esc(l.text)}</li>`).join('')}</ol>` : '<p class="empty">Noch keine Einträge.</p>'}
      </section>

      <section class="card glass" data-feedback><header class="card-head"><h2>${icon('chat')} Feedback und Diagnose</h2></header>
        <p class="muted small">Freiwillig. Der Diagnosebericht enthält keine Chats, Notizen, Projekte, Namen, Tokens oder Zugangsdaten. Es wird nichts automatisch übertragen.</p>
        <div class="inline-fields">
          <label class="field">Art<select data-fb-kind>${['Fehler', 'Verbesserung'].map((k) => `<option ${S.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
        </div>
        <label class="field">Beschreibung<textarea data-fb-text rows="3" placeholder="Was ist passiert bzw. was wünschst du dir?">${esc(S.text)}</textarea></label>
        <label class="switch"><input type="checkbox" data-fb-diag ${S.withDiag ? 'checked' : ''}><span></span> Diagnosebericht anhängen</label>
        <div class="row-actions" style="margin-top:10px">
          <button class="btn" data-act="fb-preview">Bericht ansehen</button>
          <button class="btn" data-act="fb-download">Diagnosebericht herunterladen</button>
          <button class="btn" data-act="fb-copy">Kopieren</button>
        </div>
        <label class="switch" style="margin-top:10px"><input type="checkbox" data-fb-consent ${S.consent ? 'checked' : ''}><span></span> Ich stimme zu, dass dieser Text an GitHub übertragen wird (privates Projekt-Repository, als Issue).</label>
        <div class="row-actions"><button class="btn btn-primary" data-act="fb-issue" ${S.consent ? '' : 'disabled'}>Als GitHub-Issue vorbereiten</button></div>
        ${S.preview ? `<pre class="heal-pre small" data-fb-preview>${esc(S.preview)}</pre>` : ''}
      </section>
    </div>`;
  },
  onMount(root) {
    root.querySelector('[data-fb-text]')?.addEventListener('input', (e) => { S.text = e.target.value; });
  },
  onChange(el, ctx) {
    if (el.matches('[data-heal-auto]')) { health.setAuto(el.checked); toast(el.checked ? 'Sichere Reparaturen laufen automatisch' : 'Reparaturen nur noch auf Knopfdruck', 'info'); }
    if (el.matches('[data-fb-kind]')) S.kind = el.value;
    if (el.matches('[data-fb-diag]')) S.withDiag = el.checked;
    if (el.matches('[data-fb-consent]')) { S.consent = el.checked; ctx.rerender(); }
  },
  async onAct(act, el, ctx) {
    const key = el?.dataset.key;
    const text = () => {
      const head = `${S.kind}: ${health.redact(S.text || '(ohne Beschreibung)')}`;
      return S.withDiag ? `${head}\n\nDiagnosebericht:\n${JSON.stringify(diagnosticReport({ description: S.text, kind: S.kind }), null, 2)}` : head;
    };
    if (act === 'heal-run') { const p = health.runChecks({ force: true }); ctx.rerender(); await p; }
    if (act === 'heal-stop') health.setStopped(!health.stopped);
    if (act === 'heal-recheck') await health.recheck(key);
    if (act === 'heal-dismiss') health.dismiss(key);
    if (act === 'heal-hist') { if (S.open.has(key)) S.open.delete(key); else S.open.add(key); }
    if (act === 'heal-undo') { const r = await health.undo(key); toast(r.ok ? 'Rückgängig gemacht' : `Nicht möglich: ${r.text}`, r.ok ? 'ok' : 'warn'); }
    if (act === 'heal-repair') {
      const it = health.issues.find((i) => i.key === key);
      const r = it && REPAIRS[it.code];
      if (r && r.risk !== 'safe' && !(await confirmDialog(`${r.label}.${r.reversible ? ' Lässt sich rückgängig machen.' : ''} Danach wird die Funktion erneut geprüft.`, { title: 'Reparatur freigeben?', ok: 'Freigeben', danger: false }))) return;
      const res = await health.repair(key, { approved: true });
      toast(res.ok ? 'Behoben und erneut geprüft' : `Nicht behoben: ${res.text}`, res.ok ? 'ok' : 'warn');
    }
    if (act === 'fb-preview') S.preview = S.preview ? '' : text();
    if (act === 'fb-download') {
      const blob = new Blob([JSON.stringify({ ...diagnosticReport({ description: S.text, kind: S.kind }) }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `carvis-diagnose-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('Diagnosebericht gespeichert (lokal)', 'ok');
    }
    if (act === 'fb-copy') { try { await navigator.clipboard.writeText(text()); toast('In die Zwischenablage kopiert', 'ok'); } catch { S.preview = text(); toast('Kopieren nicht erlaubt – Bericht unten anzeigen', 'warn'); } }
    if (act === 'fb-issue') {
      if (!S.consent) return toast('Bitte zuerst zustimmen.', 'warn');
      const body = text().slice(0, 6000);
      const url = `https://github.com/${REPO}/issues/new?labels=${encodeURIComponent(S.kind === 'Fehler' ? 'bug' : 'enhancement')}&title=${encodeURIComponent(`[${S.kind}] ${(S.text || 'Rückmeldung aus CARVIS CORE').slice(0, 70)}`)}&body=${encodeURIComponent(body)}`;
      window.open(url, '_blank', 'noopener');
      toast('GitHub geöffnet – das Issue wird erst gespeichert, wenn du es dort absendest.', 'info');
      S.consent = false;
    }
    ctx.rerender();
  },
};
