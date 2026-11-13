import { esc, download } from '../util.js';
import { icon, confirmDialog, toast } from '../ui.js';
import { actions, store } from '../store.js';
import { voice } from '../voice.js';

import { VERSION } from '../version.js';

export default {
  id: 'settings',
  title: 'Einstellungen',
  icon: 'settings',
  render(s, ctx) {
    const st = s.settings;
    const gF = st.voiceGender || 'alle';
    const voices = voice.voices().filter((v) => (st.voiceAllLangs || v.lang?.startsWith((st.lang || 'de').slice(0, 2))) && (gF === 'alle' || voice.guessGender(v.name) === gF));
    return `<div class="page settings">
      <header class="page-head"><div><p class="eyebrow">CARVIS CORE</p><h1>Einstellungen</h1></div></header>

      <section class="card glass">
        <header class="card-head"><h2>Profil</h2></header>
        <label class="field">Wie soll C dich nennen?<input data-set="userName" value="${esc(st.userName)}" maxlength="30" placeholder="Dein Name"></label>
      </section>

      <section class="card glass">
        <header class="card-head"><h2>KI-Modelle</h2></header>
        <p class="muted small">Verbindungen zu Ollama, lokalen Servern und Cloud-Anbietern (über deinen Proxy), Zusammenarbeit mehrerer KIs, Kosten und Protokoll findest du unter <b>KI-Modelle</b>.</p>
        <button class="btn btn-primary" data-go="#/gpt/models">${icon('plug')} KI-Modelle öffnen</button>
      </section>

      <section class="card glass">
        <header class="card-head"><h2>Stimme</h2><span class="tag ${voice.ttsSupported ? 'tag-ok' : 'tag-danger'}">${voice.ttsSupported ? 'Sprachausgabe verfügbar' : 'nicht unterstützt'}</span></header>
        <label class="switch"><input type="checkbox" data-set="voiceOutput" ${st.voiceOutput ? 'checked' : ''}><span></span> Antworten im CARVIS-Modus vorlesen</label>
        <label class="field">Anrede<select data-set="addressForm"><option value="sie" ${st.addressForm !== 'du' ? 'selected' : ''}>Sie (förmlich)</option><option value="du" ${st.addressForm === 'du' ? 'selected' : ''}>du</option></select></label>
        <label class="switch"><input type="checkbox" data-set="greetOnOpen" ${st.greetOnOpen ? 'checked' : ''}><span></span> Beim Öffnen laut begrüßen</label>
        <label class="switch"><input type="checkbox" data-set="conversationMode" ${st.conversationMode ? 'checked' : ''}><span></span> Gesprächsmodus: nach jeder gesprochenen Antwort wieder zuhören <span class="muted small">(beenden mit „Stopp“)</span></label>
        <label class="field">Sprache<select data-set="lang"><option value="de-DE" ${st.lang === 'de-DE' ? 'selected' : ''}>Deutsch</option><option value="en-US" ${st.lang === 'en-US' ? 'selected' : ''}>English (Spracheingabe/-ausgabe)</option></select></label>
        <p class="muted small">Browser erlauben Sprachausgabe oft erst nach einem Klick/Tippen. Ist das so, zeigt CARVIS einen Hinweis zum Antippen. Sprechen unterbrechen: „■ Stopp“, Klick auf den Kern oder Mikrofon drücken.</p>
        <div class="two">
          <label class="field">Geschlecht (geschätzt)<select data-set="voiceGender">${['alle', 'weiblich', 'männlich'].map((g) => `<option ${gF === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
          <label class="switch" style="align-self:end"><input type="checkbox" data-set="voiceAllLangs" ${st.voiceAllLangs ? 'checked' : ''}><span></span> Alle Sprachen anzeigen</label>
        </div>
        <label class="field">Stimme<select data-set="voiceName"><option value="">Automatisch</option>${voices.map((v) => `<option ${v.name === st.voiceName ? 'selected' : ''} value="${esc(v.name)}">${esc(v.name)} · ${esc(v.lang)} · ${voice.guessGender(v.name)}${v.localService ? '' : ' (online)'}</option>`).join('') }</select></label>
        <p class="muted small">${voices.length} Stimmen gefunden. Der Browser meldet das Geschlecht nicht, die Angabe ist eine Schätzung nach dem Namen. CC nutzt die Systemstimmen deines Geräts. Am natürlichsten klingen unter Windows die Edge-Stimmen mit „Natural“ im Namen und auf dem iPhone die Stimmen mit „Erweitert/Premium“ (in den iOS-Einstellungen unter Bedienungshilfen → Gesprochene Inhalte ladbar). Menschlich ist keine davon, CC zerlegt nur Sätze mit kurzen Pausen und leichter Betonung.</p>
        <div class="two">
          <label class="field">Tempo <output>${st.rate.toFixed(1)}</output><input type="range" min="0.6" max="1.6" step="0.1" data-set="rate" value="${st.rate}"></label>
          <label class="field">Tonhöhe <output>${st.pitch.toFixed(1)}</output><input type="range" min="0.5" max="1.5" step="0.1" data-set="pitch" value="${st.pitch}"></label>
          <label class="field">Lautstärke <output>${Math.round((st.volume ?? 1) * 100)} %</output><input type="range" min="0" max="1" step="0.05" data-set="volume" value="${st.volume ?? 1}"></label>
        </div>
        <button class="btn btn-ghost" data-act="tts-test">${icon('speak')} Stimme testen</button>
      </section>

      <section class="card glass">
        <header class="card-head"><h2>Spracheingabe</h2><span class="tag ${voice.sttSupported ? 'tag-ok' : 'tag-danger'}">${voice.sttSupported ? 'verfügbar' : 'nicht unterstützt'}</span></header>
        <label class="switch"><input type="checkbox" data-set="autoSendVoice" ${st.autoSendVoice ? 'checked' : ''}><span></span> Erkannten Text automatisch senden</label>
        <label class="switch ${voice.wakeSupported ? '' : 'disabled'}"><input type="checkbox" data-set="wakeWord" ${st.wakeWord && voice.wakeSupported ? 'checked' : ''} ${voice.wakeSupported ? '' : 'disabled'}><span></span> Wake-Word „Hey C“ <span class="tag tag-warn">experimentell</span></label>
        <p class="muted small">${voice.wakeSupported
          ? 'Das Wake-Word funktioniert nur, solange CC geöffnet und sichtbar ist (Chrome/Edge am PC). Es ist kein dauerhaftes Hintergrund-Wake-Word. Hinweis: Chrome und Edge senden Audio zur Erkennung an Google- bzw. Microsoft-Server.'
          : 'Auf diesem Gerät/Browser ist ein Wake-Word nicht zuverlässig möglich (z. B. iPhone/Safari). Nutze die Mikrofontaste.'}</p>
      </section>

      <section class="card glass">
        <header class="card-head"><h2>Darstellung</h2></header>
        <label class="switch"><input type="checkbox" data-set="reduceMotion" ${st.reduceMotion ? 'checked' : ''}><span></span> Animationen reduzieren (spart Akku)</label>
      </section>

      <section class="card glass">
        <header class="card-head"><h2>Daten</h2><span class="muted small">${store.sizeKB()} KB lokal</span></header>
        <p class="muted small">Alle Daten liegen ausschließlich im Speicher dieses Browsers (localStorage). Es gibt keinen Server und kein Konto. Passwörter werden nie gespeichert.</p>
        <div class="row-actions">
          <button class="btn btn-ghost" data-act="data-export">Backup exportieren</button>
          <label class="btn btn-ghost">Backup importieren<input type="file" accept="application/json" data-change="data-import" hidden></label>
          <button class="btn btn-ghost danger-text" data-act="data-reset">Alles zurücksetzen</button>
        </div>
      </section>

      <section class="card glass">
        <header class="card-head"><h2>Windows-App</h2><span class="tag ${window.__TAURI__ ? 'tag-ok' : ''}">${window.__TAURI__ ? 'Desktop-App' : 'Browser'}</span></header>
        ${window.__TAURI__?.autostart ? `<p class="muted small">Autostart startet CARVIS CORE beim Anmelden.</p><button class="btn" data-act="autostart-on">Autostart einschalten</button> <button class="btn" data-act="autostart-off">Autostart ausschalten</button>` : '<p class="muted small">Autostart und Tray-Symbol gibt es nur in der installierten Windows-App (nicht im Browser).</p>'}
      </section>

      <section class="card glass">
        <header class="card-head"><h2>Update Center</h2></header>
        <p class="muted small">Updates suchen, Änderungsprotokoll lesen, geprüftes Paket herunterladen.</p>
        <button class="btn btn-primary" data-go="#/gpt/update">Update Center öffnen</button>
      </section>

      <section class="card glass">
        <header class="card-head"><h2>Über CARVIS CORE</h2></header>
        <p class="muted small">CARVIS CORE · Budget 0,00 € · reine Web-App (HTML/CSS/JS), installierbar als PWA. Simulierte Funktionen sind immer als „simuliert“ gekennzeichnet.</p>
      </section>
    </div>`;
  },
  onChange(el, ctx) {
    if (el.dataset.set) {
      const key = el.dataset.set;
      let val = el.type === 'checkbox' ? el.checked : el.type === 'range' ? parseFloat(el.value) : el.value;
      if (key === 'userName') val = val.trim();
      actions.setSettings({ [key]: val });
      if (key === 'wakeWord' || key === 'reduceMotion') ctx.applySettings();
      if (key === 'voiceGender' || key === 'voiceAllLangs' || key === 'lang') ctx.rerender();
      if (el.type === 'range') el.previousElementSibling.textContent = val.toFixed(1);
      return;
    }
    if (el.dataset.change === 'data-import') importBackup(el);
  },
  async onAct(act, el, ctx) {
    const s = store.get().settings;
    if (act === 'autostart-on' || act === 'autostart-off') {
      try { await window.__TAURI__.autostart[act === 'autostart-on' ? 'enable' : 'disable'](); toast(act === 'autostart-on' ? 'Autostart eingeschaltet.' : 'Autostart ausgeschaltet.', 'info'); }
      catch (e) { toast('Autostart nicht möglich: ' + (e?.message || e), 'danger'); }
    }
    if (act === 'tts-test') ctx.speak('Hallo. Ich bin CARVIS. Wie kann ich dir heute helfen? Ich spreche mit den Einstellungen, die du gerade gewählt hast.');
    if (act === 'data-export') download(`ccc-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store.get(), null, 2), 'application/json');
    if (act === 'data-reset' && (await confirmDialog('Wirklich ALLE lokalen Daten (Chat, Projekte, Aufgaben, Dokumente, Gedächtnis, Einstellungen) löschen? Das kann nicht rückgängig gemacht werden.', { ok: 'Alles löschen' }))) {
      store.reset();
      ctx.applySettings();
      toast('Zurückgesetzt');
    }
  },
};

async function importBackup(input) {
  const file = input.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== 'object' || !Array.isArray(data.tasks) || !Array.isArray(data.projects)) throw new Error('Format');
    if (await confirmDialog('Backup importieren? Die aktuellen lokalen Daten werden ersetzt.', { ok: 'Importieren' })) {
      store.replace(data);
      toast('Backup importiert', 'ok');
    }
  } catch {
    toast('Ungültige Backup-Datei', 'danger');
  }
  input.value = '';
}
