// GPT-Modus: KI-Modelle – Übersicht, Verbindung, Koordination, Kosten, Protokoll.
import { esc, fmtTime, relTime } from '../util.js';
import { icon, toast, confirmDialog, modal } from '../ui.js';
import { actions, store } from '../store.js';
import { CATALOG, COST_LABEL, makeExpert, discoverOllama, discoverProxy, callExpert } from '../ai/providers.js';

import { BROWSER_MODELS, webgpuStatus, onProgress, progress, load as loadBrowserModel, removeModel } from '../ai/webllm.js';

export function browserExpert(m) {
  const ex = makeExpert({ provider: 'webllm', vendorKey: 'webllm', model: m.id, label: `${m.name} · im Browser`, cost: 'free', local: true });
  ex.strengths = { ...m.strengths };
  return ex;
}

// ---- KI im Browser ----
function browserCard(st) {
  const installed = new Set(st.browserModels || []);
  setTimeout(refreshGpu, 0);
  return `<section class="card glass" style="margin-bottom:16px">
    <header class="card-head"><h2>${icon('phone')} KI im Browser (dieses Gerät)</h2><span class="tag tag-ok">0 € · ohne Konto</span></header>
    <p class="muted small">Das Modell läuft komplett auf diesem Gerät (WebGPU) – kein Konto, kein Schlüssel, deine Eingaben verlassen das Gerät nicht. Einmaliger Download von huggingface.co, danach auch offline. Gilt nur für diesen Browser auf diesem Gerät.</p>
    <p class="small" id="webgpu-status"><span class="led led-idle"></span> Prüfe WebGPU …</p>
    <ul class="cat-list">${BROWSER_MODELS.map((m) => {
      const has = installed.has(m.id);
      return `<li><span class="led led-${has ? 'ok' : 'idle'}"></span><div><b>${esc(m.name)}</b>${m.recommended ? ' <span class="tag tag-ok">empfohlen</span>' : ''}<small>${esc(m.note)} · Grafikspeicher ca. ${(m.vramMB / 1000).toFixed(1).replace('.', ',')} GB</small></div>
        <span class="muted small">${has ? 'auf diesem Gerät' : 'nicht geladen'}</span>
        ${has ? `<button class="btn btn-ghost btn-sm danger-text" data-act="webllm-remove" data-id="${m.id}">Entfernen</button>` : `<button class="btn btn-primary btn-sm webllm-dl" data-act="webllm-download" data-id="${m.id}">Herunterladen</button>`}</li>`;
    }).join('')}</ul>
    <div class="dl-progress" ${progress.active ? '' : 'hidden'}><div class="progress big"><span style="--w:${progress.value}%"></span></div><small class="muted">${esc(progress.text)}</small></div>
  </section>`;
}

let gpuInfo = null;
async function refreshGpu() {
  const el = document.getElementById('webgpu-status');
  if (!el) return;
  gpuInfo ||= await webgpuStatus();
  el.innerHTML = gpuInfo.ok
    ? '<span class="led led-ok"></span> WebGPU verfügbar – dieses Gerät kann KI im Browser ausführen.'
    : `<span class="led led-danger"></span> ${esc(gpuInfo.reason)}`;
  if (!gpuInfo.ok) document.querySelectorAll('.webllm-dl').forEach((b) => (b.disabled = true));
}

onProgress((p) => {
  const box = document.querySelector('.dl-progress');
  if (!box) return;
  box.hidden = !p.active;
  box.querySelector('.progress span').style.setProperty('--w', `${p.value}%`);
  box.querySelector('small').textContent = `${p.value} % – ${p.text}`;
});

const costTag = (c) => `<span class="tag ${c === 'free' ? 'tag-ok' : c === 'paid' ? 'tag-danger' : 'tag-warn'}">${COST_LABEL[c]}</span>`;

export function aiOverview(st) {
  const ex = st.experts;
  const usable = ex.filter((e) => e.enabled && e.local === true && e.cost === 'free');
  return {
    connected: usable.filter((e) => e.status === 'ok').length,
    available: usable.length,
    failing: ex.filter((e) => e.status === 'error').length,
    notConnected: CATALOG.filter((c) => !ex.some((e) => e.vendorKey === c.key || (c.key === 'ollama' && e.provider === 'ollama'))).length,
  };
}

export function catalogStatus(c, st) {
  const mine = st.experts.filter((e) => e.vendorKey === c.key || (c.key === 'ollama' && e.provider === 'ollama'));
  if (!mine.length) return { led: 'idle', text: c.how === 'proxy' ? 'vorbereitet · nicht verbunden' : 'nicht verbunden' };
  if (mine.some((e) => e.status === 'ok')) return { led: 'ok', text: `verbunden · ${mine.length} Modell${mine.length === 1 ? '' : 'e'}` };
  if (mine.every((e) => e.status === 'error')) return { led: 'danger', text: 'Fehler' };
  return { led: 'warn', text: `eingerichtet · ungetestet` };
}

export default {
  id: 'models',
  title: 'KI-Modelle',
  icon: 'plug',
  render(st) {
    const s = st.settings;
    const o = aiOverview(st);
    return `<div class="page">
      <header class="page-head"><div><p class="eyebrow">Zentrale Koordination · CARVIS CORE 3.8</p><h1>KI-Modelle</h1>
        <p class="muted">CARVIS befragt die hier verbundenen Modelle, vergleicht ihre Antworten nachvollziehbar und führt sie zusammen. Es werden nur Modelle genutzt, die wirklich verbunden sind – nichts wird vorgetäuscht.</p></div></header>

      <div class="ai-summary">
        <div class="ai-stat glass"><b>${o.connected}</b><span>verbunden & getestet</span></div>
        <div class="ai-stat glass"><b>${o.available}</b><span>aktiv nutzbar</span></div>
        <div class="ai-stat glass"><b>${o.failing}</b><span>mit Fehler</span></div>
        <div class="ai-stat glass"><b>${o.notConnected}</b><span>Anbieter nicht verbunden</span></div>
      </div>

      <section class="card glass" style="margin-bottom:16px">
        <header class="card-head"><h2>${icon('core')} Zusammenarbeit</h2></header>
        <div class="seg" role="group" aria-label="Zusammenarbeit">${[['auto', 'Automatisch'], ['always', 'Immer'], ['never', 'Nie']].map(([v, l]) => `<button class="${s.collab === v ? 'on' : ''}" data-act="collab" data-v="${v}">${l}</button>`).join('')}</div>
        <p class="muted small">Automatisch: einfache Fragen → ein passendes Modell; komplexe Aufgaben (z. B. „Entwickle …“, „Vergleiche …“, lange Anfragen) → mehrere Modelle parallel.</p>
        <div class="two">
          <label class="field">Höchstens Modelle pro Anfrage <output>${s.maxExperts}</output><input type="range" min="2" max="5" step="1" data-set="maxExperts" value="${s.maxExperts}"></label>
          <div>
            <label class="switch"><input type="checkbox" data-set="synthesize" ${s.synthesize ? 'checked' : ''}><span></span> Ergebnisse von CARVIS zusammenführen lassen</label>
            <label class="switch"><input type="checkbox" data-set="localSequential" ${s.localSequential !== false ? 'checked' : ''}><span></span> Lokale Modelle nacheinander abfragen (empfohlen bis 32 GB RAM)</label>
            <p class="muted small">Nur kostenlose lokale Modelle werden automatisch genutzt. Keine kostenpflichtigen KI-Aufrufe.</p>
          </div>
        </div>
      </section>

      ${browserCard(st)}

      <section class="card glass" style="margin-bottom:16px">
        <header class="card-head"><h2>${icon('bolt')} Lokal & kostenlos</h2><span class="tag tag-ok">0 €</span></header>
        <div class="inline-fields">
          <label class="field">Ollama-Adresse<input data-set="ollamaUrl" value="${esc(s.ollamaUrl)}" spellcheck="false" inputmode="url"></label>
          <button class="btn btn-primary" data-act="discover-ollama">Modelle erkennen</button>
        </div>
        <details class="help"><summary>Ollama einrichten (Windows / macOS)</summary>
          <ol><li>Ollama von ollama.com installieren (kostenlos).</li>
            <li>Mehrere Modelle laden, z. B. <code>ollama pull llama3.2</code>, <code>ollama pull mistral</code>, <code>ollama pull deepseek-r1:7b</code>, <code>ollama pull qwen2.5-coder:7b</code>.</li>
            <li>Zugriff aus dem Browser erlauben: Umgebungsvariable <code>OLLAMA_ORIGINS</code> auf diese Adresse setzen (z. B. <code>${esc(location.origin)}</code>), Ollama neu starten.</li>
            <li>„Modelle erkennen“ klicken – jedes Modell wird zu einem Experten für CARVIS.</li></ol>
        </details>
        <div class="inline-fields" style="margin-top:12px">
          <button class="btn btn-ghost" data-act="add-openai">+ Lokalen Server (LM Studio) hinzufügen</button>
        </div>
      </section>

      <section class="card glass" style="margin-bottom:16px">
        <header class="card-head"><h2>${icon('globe')} Cloud-Anbieter über eigenen Proxy</h2><span class="tag tag-warn">optional</span></header>
        <p class="muted small">API-Schlüssel gehören nie ins Frontend. Cloud-KIs laufen über deinen eigenen Proxy (Vorlage im Ordner <code>proxy/</code>, kostenloser Cloudflare-Plan). Vor dem ersten Senden an einen externen Anbieter fragt CARVIS um Erlaubnis.</p>
        <div class="inline-fields">
          <label class="field">Proxy-Adresse<input data-set="proxyUrl" value="${esc(s.proxyUrl)}" placeholder="https://ccc-proxy.<konto>.workers.dev" spellcheck="false" inputmode="url"></label>
          <button class="btn btn-ghost" data-act="discover-proxy" ${s.proxyUrl ? '' : 'disabled'}>Proxy prüfen</button>
        </div>
        <ul class="cat-list" style="margin-top:14px">${CATALOG.map((c) => {
          const cs = catalogStatus(c, st);
          return `<li><span class="led led-${cs.led}"></span><div><b>${esc(c.name)}</b><small>${esc(c.vendor)} · ${esc(c.costNote)}</small></div><span class="muted small">${cs.text}</span>${costTag(c.cost)}</li>`;
        }).join('')}</ul>
      </section>

      <section class="card glass" style="margin-bottom:16px">
        <header class="card-head"><h2>${icon('plug')} Eingerichtete Modelle</h2><span class="muted small">${st.experts.length}</span></header>
        <ul class="expert-list">${st.experts.map((e) => {
          const avg = e.stats?.ok ? Math.round(e.stats.scoreSum / e.stats.ok) : null;
          const ms = e.stats?.ok ? (e.stats.msSum / e.stats.ok / 1000).toFixed(1) : null;
          return `<li class="expert glass"><span class="led led-${e.status === 'ok' ? 'ok' : e.status === 'error' ? 'danger' : 'warn'}"></span>
            <div><b>${esc(e.label)}</b> ${costTag(e.cost)}
              <div class="meta"><span>${e.local ? 'lokal' : `extern · ${esc(e.vendorKey)}`}</span><span>${e.status === 'ok' ? 'verbunden' : e.status === 'error' ? `Fehler: ${esc(e.lastError)}` : 'ungetestet'}</span>
              ${e.stats?.calls ? `<span>${e.stats.calls} Anfragen</span><span>Ø Bewertung ${avg ?? '–'}</span><span>Ø ${ms ?? '–'} s</span><span>${e.stats.wins} × beste Antwort</span>` : ''}</div></div>
            <div class="acts">
              <label class="switch" title="aktiv"><input type="checkbox" data-change="expert-enable" data-id="${esc(e.id)}" ${e.enabled ? 'checked' : ''}><span></span></label>
              <button class="btn btn-ghost btn-sm" data-act="expert-test" data-id="${esc(e.id)}">Testen</button>
              <button class="icon-btn sm ghost" data-act="expert-remove" data-id="${esc(e.id)}" aria-label="Entfernen">${icon('trash')}</button>
            </div></li>`;
        }).join('') || '<li class="empty">Noch kein Modell eingerichtet. Ohne Modell antwortet C mit lokalen Befehlen, Wikipedia-Recherche und der als „simuliert“ gekennzeichneten Vorlagen-Antworten.</li>'}</ul>
      </section>

      <section class="card glass" style="margin-bottom:16px">
        <header class="card-head"><h2>${icon('memory')} Datenschutz</h2></header>
        <label class="switch"><input type="checkbox" data-set="allowResearch" ${s.allowResearch ? 'checked' : ''}><span></span> Wikipedia-Recherche erlauben (Suchbegriff geht an wikipedia.org)</label>
        <label class="switch"><input type="checkbox" data-set="shareMemoryExternal" ${s.shareMemoryExternal ? 'checked' : ''}><span></span> Gedächtnis & Namen auch an externe Anbieter senden</label>
        <p class="muted small">Lokale Modelle erhalten Gedächtnis und Verlauf. Externe Anbieter erhalten standardmäßig nur die Unterhaltung, erkannte Schlüssel werden entfernt, bei sensiblen Daten fragt CARVIS vorher. Erteilte Freigaben: ${Object.keys(st.consents).filter((k) => st.consents[k]).map((k) => `<b>${esc(k)}</b>`).join(', ') || 'keine'} ${Object.keys(st.consents).length ? '<button class="link-btn" data-act="consents-reset">widerrufen</button>' : ''}</p>
      </section>

      <section class="card glass">
        <header class="card-head"><h2>${icon('doc')} Protokoll externer & KI-Anfragen</h2>${st.aiLog.length ? '<button class="link-btn" data-act="log-clear">leeren</button>' : ''}</header>
        <div class="tbl-wrap log"><table class="tbl"><thead><tr><th>Zeit</th><th>Ziel</th><th>Modell</th><th>Zeichen</th><th>Dauer</th><th>Status</th></tr></thead><tbody>
          ${st.aiLog.slice(0, 25).map((l) => `<tr><td title="${relTime(l.ts)}">${fmtTime(l.ts, true)}</td><td>${esc(l.target)}</td><td>${esc(l.model)}${l.note ? ` <small class="muted">${esc(l.note)}</small>` : ''}</td><td>${l.chars}</td><td>${l.ms ? `${(l.ms / 1000).toFixed(1)} s` : '–'}</td><td><span class="lvl lvl-${l.status === 'ok' ? 'ok' : 'danger'}">${l.status}</span></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Noch keine Anfragen.</td></tr>'}
        </tbody></table></div>
      </section>
    </div>`;
  },

  async onAct(act, el, ctx) {
    const s = store.get().settings;
    if (act === 'collab') { actions.setSettings({ collab: el.dataset.v }); return; }
    if (act === 'webllm-download') {
      const m = BROWSER_MODELS.find((x) => x.id === el.dataset.id);
      if (!m) return;
      const ok = await confirmDialog(`„${m.name}“ jetzt herunterladen? Es werden ca. ${(m.vramMB / 1000).toFixed(1).replace('.', ',')} GB von huggingface.co geladen und im Browser gespeichert. Am besten im WLAN. Das kann einige Minuten dauern.`, { ok: 'Herunterladen', title: 'KI im Browser', danger: false });
      if (!ok) return;
      document.querySelectorAll('.webllm-dl').forEach((b) => (b.disabled = true));
      try {
        await loadBrowserModel(m.id);
        store.update((s) => { s.browserModels = [...new Set([...(s.browserModels || []), m.id])]; });
        actions.upsertExpert(browserExpert(m));
        actions.updateExpert(`webllm:webllm:${m.id}`, { status: 'ok', enabled: true });
        toast(`${m.name} läuft jetzt auf diesem Gerät`, 'ok', 5000);
      } catch (e) {
        toast(`Download/Start fehlgeschlagen: ${e.message}`, 'danger', 8000);
      }
      ctx.rerender();
      ctx.renderStatus();
    }
    if (act === 'webllm-remove') {
      const m = BROWSER_MODELS.find((x) => x.id === el.dataset.id);
      if (!m || !(await confirmDialog(`„${m.name}“ von diesem Gerät löschen? Der Speicher wird freigegeben; ein erneuter Download ist jederzeit möglich.`, { ok: 'Löschen' }))) return;
      try { await removeModel(m.id); } catch { /* Cache evtl. schon leer */ }
      store.update((s) => { s.browserModels = (s.browserModels || []).filter((x) => x !== m.id); s.experts = s.experts.filter((e) => e.model !== m.id || e.provider !== 'webllm'); });
      toast(`${m.name} entfernt`);
      ctx.renderStatus();
    }
    if (act === 'discover-ollama') {
      el.disabled = true; el.textContent = 'Suche …';
      try {
        const names = await discoverOllama(s.ollamaUrl);
        if (!names.length) toast('Ollama erreichbar, aber keine Modelle installiert (ollama pull …).', 'info', 5000);
        names.forEach((n) => actions.upsertExpert(makeExpert({ provider: 'ollama', vendorKey: 'ollama', model: n, label: `${n} · Ollama`, cost: 'free', local: true })));
        if (names.length) toast(`${names.length} lokale Modelle gefunden`, 'ok');
      } catch (e) {
        toast(`Ollama nicht erreichbar (${e.message}). Läuft Ollama und ist OLLAMA_ORIGINS gesetzt?`, 'danger', 6000);
      }
      ctx.rerender();
    }
    if (act === 'add-openai') {
      const r = await modal({
        title: 'Lokalen OpenAI-kompatiblen Server hinzufügen',
        body: `<p>Zum Beispiel LM Studio („Local Server“) oder llama.cpp – ohne API-Schlüssel.</p>
          <label class="field">Endpunkt<input id="oa-ep" value="http://localhost:1234/v1/chat/completions" spellcheck="false"></label>
          <label class="field">Modellname<input id="oa-model" placeholder="z. B. qwen2.5-7b-instruct" spellcheck="false" autofocus></label>`,
        actions: [{ label: 'Abbrechen', value: null }, { label: 'Hinzufügen', cls: 'btn-primary', getValue: (w) => ({ ep: w.querySelector('#oa-ep').value.trim(), model: w.querySelector('#oa-model').value.trim() }) }],
      });
      if (r?.ep && r.model) {
        if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|192\.168\.|10\.|.*\.local)/.test(r.ep)) {
          toast('Nur lokale Server ohne Schlüssel – Cloud-Anbieter bitte über den Proxy anbinden.', 'danger', 5000);
          return;
        }
        actions.upsertExpert(makeExpert({ provider: 'openai', vendorKey: 'openai-compat', model: r.model, endpoint: r.ep, label: `${r.model} · lokal`, cost: 'free', local: true }));
      }
    }
    if (act === 'discover-proxy') {
      try {
        const list = await discoverProxy(s.proxyUrl);
        let n = 0;
        for (const p of list) for (const m of p.models || []) {
          actions.upsertExpert(makeExpert({ provider: 'proxy', vendorKey: p.key, model: m, label: `${m} · ${p.key}`, cost: p.paid ? 'paid' : (CATALOG.find((c) => c.key === p.key)?.cost || 'free-tier'), local: false }));
          n++;
        }
        const failed = list.filter((p) => p.error);
        toast(n ? `${n} Modelle über den Proxy eingerichtet (kostenpflichtige bleiben deaktiviert)` : 'Proxy erreichbar, aber keine Anbieter eingerichtet', n ? 'ok' : 'info', 5000);
        failed.forEach((p) => toast(`${p.key}: ${p.error} – Schlüssel prüfen`, 'danger', 8000));
      } catch (e) {
        toast(`Proxy nicht erreichbar (${e.message})`, 'danger', 5000);
      }
    }
    if (act === 'expert-test') {
      const ex = store.get().experts.find((x) => x.id === el.dataset.id);
      if (!ex) return;
      if (!ex.local && !store.get().consents[ex.vendorKey]) {
        if (!(await confirmDialog(`Für den Test wird „Antworte nur mit OK“ an ${ex.vendorKey} gesendet. Erlauben?`, { ok: 'Senden', danger: false }))) return;
        actions.setConsent(ex.vendorKey, true);
      }
      el.disabled = true; el.textContent = 'Teste …';
      try {
        const r = await callExpert(ex, [{ role: 'user', content: 'Antworte nur mit dem Wort OK.' }], s, { timeout: 60000 });
        actions.updateExpert(ex.id, { status: 'ok', lastError: '' });
        actions.logAI({ target: ex.local ? `lokal · ${ex.provider}` : `extern · ${ex.vendorKey}`, model: ex.model, chars: 27, ms: r.ms, status: 'ok', note: 'Verbindungstest' });
        toast(`${ex.label}: „${r.content.slice(0, 30)}“ (${(r.ms / 1000).toFixed(1)} s)`, 'ok');
      } catch (e) {
        actions.updateExpert(ex.id, { status: 'error', lastError: e.message });
        actions.logAI({ target: ex.local ? `lokal · ${ex.provider}` : `extern · ${ex.vendorKey}`, model: ex.model, chars: 27, ms: 0, status: 'error', note: e.message });
        toast(`${ex.label}: ${e.message}`, 'danger', 5000);
      }
      ctx.renderStatus();
    }
    if (act === 'expert-remove') {
      const ex = store.get().experts.find((x) => x.id === el.dataset.id);
      if (ex && (await confirmDialog(`„${ex.label}“ aus CC entfernen? (Das Modell selbst bleibt installiert.)`, { ok: 'Entfernen' }))) actions.removeExpert(ex.id);
    }
    if (act === 'log-clear' && (await confirmDialog('Protokoll leeren?', { ok: 'Leeren' }))) actions.clearAILog();
    if (act === 'consents-reset' && (await confirmDialog('Alle Freigaben für externe Anbieter widerrufen? CARVIS fragt dann erneut.', { ok: 'Widerrufen' }))) {
      store.update((x) => (x.consents = {}));
    }
  },

  async onChange(el, ctx) {
    if (el.dataset.change === 'expert-enable') {
      const ex = store.get().experts.find((x) => x.id === el.dataset.id);
      if (el.checked && ex?.cost === 'paid') {
        const ok = await confirmDialog(`${ex.label} ist KOSTENPFLICHTIG. Jede Anfrage kann beim Anbieter Kosten verursachen. Wirklich aktivieren?`, { ok: 'Ja, aktivieren', title: 'Mögliche Kosten' });
        if (!ok) { el.checked = false; return; }
      }
      actions.updateExpert(el.dataset.id, { enabled: el.checked });
      ctx.renderStatus();
      return;
    }
    const key = el.dataset.set;
    if (!key) return;
    let val = el.type === 'checkbox' ? el.checked : el.type === 'range' ? parseInt(el.value, 10) : el.value.trim();
    if (key === 'allowPaid' && val) {
      const ok = await confirmDialog('Kostenpflichtige Modelle zulassen? Bei Anbietern mit hinterlegten Zahlungsdaten können dann echte Kosten entstehen. Das Budget beträgt 0,00 € – empfohlen: ausgeschaltet lassen.', { ok: 'Trotzdem zulassen', title: 'Mögliche Kosten' });
      if (!ok) { el.checked = false; return; }
    }
    if ((key === 'ollamaUrl' || key === 'proxyUrl') && val && !/^https?:\/\//.test(val)) { toast('Adresse muss mit http:// oder https:// beginnen', 'danger'); return; }
    actions.setSettings({ [key]: val });
    if (el.type === 'range') el.previousElementSibling.textContent = val;
    ctx.renderStatus();
  },
};
