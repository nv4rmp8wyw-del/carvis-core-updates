// Einstellungen. D-053: alle Texte aus dem Sprachsystem; App-Sprache wählbar (wirkt sofort, ohne Neustart, auch auf
// KI-Antworten und Sprache). Spracheingabe/-ausgabe zeigen ehrlich, was auf diesem Gerät für die Sprache verfügbar ist.
import { esc, download } from '../util.js';
import { icon, confirmDialog, toast } from '../ui.js';
import { actions, store } from '../store.js';
import { voice } from '../voice.js';
import { VERSION, displayVersion } from '../version.js';
import { modelMenu, modelLabel } from './talk.js';
import { applyTheme } from '../theme.js';
import { t, lang, setLang, langInfo, LANGS } from '../i18n.js';

const GENDER = { alle: 'set.genderAll', weiblich: 'set.genderF', männlich: 'set.genderM' };

export default {
  id: 'settings',
  get title() { return t('set.title'); },
  icon: 'settings',
  render(s) {
    const st = s.settings;
    const gF = st.voiceGender || 'alle';
    const L = langInfo();
    const prefix = (st.lang || L.speech).slice(0, 2);
    const langVoices = voice.voices().filter((v) => v.lang?.startsWith(prefix));
    const voices = voice.voices().filter((v) => (st.voiceAllLangs || v.lang?.startsWith(prefix)) && (gF === 'alle' || voice.guessGender(v.name) === gF));
    const light = document.documentElement.dataset.theme === 'light';
    const ok = s.experts.filter((e) => e.enabled && e.status === 'ok').length;
    const adv = (body) => `<details class="adv"><summary>${t('common.advanced')}</summary><div class="adv-body">${body}</div></details>`;
    const sw = (key, label, extra = '') => `<label class="switch"><input type="checkbox" data-set="${key}" ${st[key] ? 'checked' : ''}><span></span> ${label}${extra}</label>`;
    const sttTag = voice.sttEngine === 'agent' ? t('set.sttLocalTag') : voice.sttSupported ? t('set.browser') : t('set.sttNoneTag');
    const caps = t('set.caps', {
      lang: L.name,
      stt: voice.sttSupported ? `${t('set.capYes')} (${t('set.capUnchecked')})` : t('set.capNo'),
      tts: voice.ttsSupported && langVoices.length ? t('set.capVoices', { n: langVoices.length }) : t('set.capNo'),
    });
    return `<div class="page settings settings5">
      <header class="page-head"><div><h1>${t('set.title')}</h1></div></header>

      <section class="card" data-sec="darstellung">
        <header class="card-head"><h2>${icon('sun')} ${t('set.look')}</h2></header>
        <div class="seg" role="radiogroup" aria-label="${esc(t('set.look'))}">
          <button class="seg-btn${light ? ' on' : ''}" role="radio" aria-checked="${light}" data-act="set-mode" data-mode="light">${icon('sun')} ${t('set.light')}</button>
          <button class="seg-btn${light ? '' : ' on'}" role="radio" aria-checked="${!light}" data-act="set-mode" data-mode="dark">${icon('moon')} ${t('set.dark')}</button>
        </div>
        <label class="field">${t('set.nameQ')}<input data-set="userName" value="${esc(st.userName)}" maxlength="30" placeholder="${esc(t('set.namePh'))}"></label>
        ${adv(`${sw('reduceMotion', t('set.reduceMotion'))}
          <button class="btn btn-ghost btn-sm" data-go="#/gpt/design">${t('set.colors')}</button>`)}
      </section>

      <section class="card" data-sec="ki">
        <header class="card-head"><h2>${icon('core')} ${t('set.ai')}</h2><span class="tag ${ok ? 'tag-ok' : 'tag-warn'}">${ok ? t('set.aiReady', { n: ok }) : t('set.aiNot')}</span></header>
        <div class="row-actions"><button class="btn" data-act="set-model">${esc(t('dash.model', { m: '' }).trim())} <b data-set-model>${esc(modelLabel(s))}</b></button></div>
        <p class="muted small">${t('set.autoHint')}</p>
        ${adv(`<button class="btn btn-ghost btn-sm" data-go="#/gpt/models">${icon('plug')} ${t('set.manage')}</button>`)}
      </section>

      <section class="card" data-sec="sprache">
        <header class="card-head"><h2>${icon('mic')} ${t('set.speech')}</h2><span class="tag ${voice.ttsSupported ? 'tag-ok' : 'tag-danger'}">${esc(sttTag)}</span></header>
        <label class="field">${t('set.uiLang')}<select data-ui-lang aria-describedby="lang-hint">${LANGS.map((l) => `<option value="${l.code}" ${l.code === lang() ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>
        <p class="muted small" id="lang-hint">${t('lang.hint')}</p>
        <p class="small" data-speech-caps>${esc(caps)}</p>
        ${langVoices.length ? '' : `<p class="notice notice-warn small" data-voice-none>${esc(t('set.voiceNone'))}</p>`}
        ${sw('voiceOutput', t('set.readAloud'))}
        ${sw('conversationMode', t('set.conv'), ` <span class="muted small">${t('set.convHint')}</span>`)}
        <label class="field">${t('set.voice')}<select data-set="voiceName"><option value="">${t('set.auto')}</option>${voices.map((v) => `<option ${v.name === st.voiceName ? 'selected' : ''} value="${esc(v.name)}">${esc(v.name)} · ${esc(v.lang)}${v.localService ? '' : ' (online)'}</option>`).join('')}</select></label>
        <button class="btn btn-ghost btn-sm" data-act="tts-test">${icon('speak')} ${t('set.testVoice')}</button>
        ${adv(`<div class="two">
            <label class="field">${t('set.address')}<select data-set="addressForm"><option value="sie" ${st.addressForm !== 'du' ? 'selected' : ''}>${t('set.formal')}</option><option value="du" ${st.addressForm === 'du' ? 'selected' : ''}>${t('set.informal')}</option></select></label>
          </div>
          ${sw('greetOnOpen', t('set.greet'))}
          ${sw('autoSendVoice', t('set.autoSend'))}
          <label class="switch ${voice.wakeSupported ? '' : 'disabled'}"><input type="checkbox" data-set="wakeWord" ${st.wakeWord && voice.wakeSupported ? 'checked' : ''} ${voice.wakeSupported ? '' : 'disabled'}><span></span> ${t('set.wake')} <span class="tag tag-warn">${t('set.experimental')}</span></label>
          <div class="two">
            <label class="field">${t('set.gender')}<select data-set="voiceGender">${Object.entries(GENDER).map(([g, k]) => `<option value="${g}" ${gF === g ? 'selected' : ''}>${t(k)}</option>`).join('')}</select></label>
            <label class="switch" style="align-self:end"><input type="checkbox" data-set="voiceAllLangs" ${st.voiceAllLangs ? 'checked' : ''}><span></span> ${t('set.allLangs')}</label>
          </div>
          <div class="two">
            <label class="field">${t('set.rate')} <output>${st.rate.toFixed(1)}</output><input type="range" min="0.6" max="1.6" step="0.1" data-set="rate" value="${st.rate}"></label>
            <label class="field">${t('set.pitch')} <output>${st.pitch.toFixed(1)}</output><input type="range" min="0.5" max="1.5" step="0.1" data-set="pitch" value="${st.pitch}"></label>
            <label class="field">${t('set.volume')} <output>${Math.round((st.volume ?? 1) * 100)} %</output><input type="range" min="0" max="1" step="0.05" data-set="volume" value="${st.volume ?? 1}"></label>
          </div>
          <p class="muted small" data-stt-info>${voice.sttEngine === 'agent' ? t('set.sttAgent') : voice.sttEngine === 'web' ? t('set.sttWeb') : esc(voice.sttReason || '')} ${t('set.voicesFound', { n: langVoices.length })}</p>`)}
      </section>

      <section class="card" data-sec="datenschutz">
        <header class="card-head"><h2>${icon('lock')} ${t('set.privacy')}</h2><span class="muted small">${t('set.kbLocal', { n: store.sizeKB() })}</span></header>
        <p class="muted small">${t('set.privacyText')}</p>
        <label class="switch"><input type="checkbox" data-set="searchHistory" ${st.searchHistory !== false ? 'checked' : ''}><span></span> ${t('set.searchHistory')}</label>
        <div class="row-actions"><button class="btn btn-ghost btn-sm" data-act="data-export">${t('set.export')}</button></div>
        ${adv(`<div class="row-actions">
            <label class="btn btn-ghost btn-sm">${t('set.import')}<input type="file" accept="application/json" data-change="data-import" hidden></label>
            ${window.__TAURI__?.autostart ? `<button class="btn btn-ghost btn-sm" data-act="autostart-on">${t('set.autostartOn')}</button><button class="btn btn-ghost btn-sm" data-act="autostart-off">${t('set.autostartOff')}</button>` : ''}
            <button class="btn btn-ghost btn-sm danger-text" data-act="data-reset">${t('set.reset')}</button>
          </div>
          ${window.__TAURI__?.autostart ? '' : `<p class="muted small">${t('set.autostartOnly')}</p>`}`)}
      </section>

      <section class="card" data-sec="updates">
        <header class="card-head"><h2>${icon('update')} ${t('set.updates')}</h2></header>
        <p class="muted small" data-version>${t('set.installed', { v: esc(displayVersion()), kind: window.__TAURI__ ? t('set.winApp') : t('set.browser') })}</p>
        <div class="row-actions"><button class="btn btn-sm" data-go="#/gpt/update">${t('set.checkUpdates')}</button><button class="btn btn-ghost btn-sm" data-go="#/gpt/health">${t('set.health')}</button></div>
      </section>
    </div>`;
  },
  onChange(el, ctx) {
    if (el.matches('[data-ui-lang]')) {
      const code = el.value;
      if (code !== lang()) { actions.setSettings({ uiLang: code, lang: langInfo(code).speech, voiceName: '' }); setLang(code); }
      return;
    }
    if (el.dataset.set) {
      const key = el.dataset.set;
      let val = el.type === 'checkbox' ? el.checked : el.type === 'range' ? parseFloat(el.value) : el.value;
      if (key === 'userName') val = val.trim();
      if (key === 'searchHistory' && !val) { try { localStorage.removeItem('ccc.search.history'); } catch { /* privat */ } }
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
      try { await window.__TAURI__.autostart[act === 'autostart-on' ? 'enable' : 'disable'](); toast(t(act === 'autostart-on' ? 'set.autostartOnDone' : 'set.autostartOffDone'), 'info'); }
      catch (e) { toast(t('set.autostartFail', { e: e?.message || e }), 'danger'); }
    }
    if (act === 'set-mode') {
      actions.setSettings({ theme: { ...(s.theme || {}), mode: el.dataset.mode } });
      applyTheme(store.get().settings.theme);
      document.dispatchEvent(new Event('cc-theme'));
      ctx.rerender();
      return;
    }
    if (act === 'set-model') { modelMenu(el, () => { const b = document.querySelector('[data-set-model]'); if (b) b.textContent = modelLabel(store.get()); }); return; }
    if (act === 'tts-test') ctx.speak(t('set.testVoiceText'));
    if (act === 'data-export') download(`ccc-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store.get(), null, 2), 'application/json');
    if (act === 'data-reset' && (await confirmDialog(t('set.resetAsk'), { ok: t('set.resetOk') }))) {
      store.reset();
      ctx.applySettings();
      toast(t('set.resetDone'));
    }
  },
};

async function importBackup(input) {
  const file = input.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== 'object' || !Array.isArray(data.tasks) || !Array.isArray(data.projects)) throw new Error('Format');
    if (await confirmDialog(t('set.importAsk'), { ok: t('set.importOk') })) {
      store.replace(data);
      toast(t('set.imported'), 'ok');
    }
  } catch {
    toast(t('set.importBad'), 'danger');
  }
  input.value = '';
}
