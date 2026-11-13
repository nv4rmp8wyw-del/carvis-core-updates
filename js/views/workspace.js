// GPT-Modus: Chat, Projekte, Aufgaben, Vorschauen, Dokumente, Gedächtnis.
import { esc, fmtDate, relTime, download } from '../util.js';
import { icon, modal, confirmDialog, toast } from '../ui.js';
import { renderBlocks } from '../blocks.js';
import { actions, projectProgress, store } from '../store.js';

const SUGGESTIONS = ['Was kannst du?', 'Wie gehe ich bei einer eigenen Webseite vor?', 'Zeige meine Aufgaben', 'Visualisiere meine Projekte', 'Analysiere die Risiken von meinem Server-Projekt'];
export const chips = (list = SUGGESTIONS) => list.map((s) => `<button class="chip" data-act="suggest" data-text="${esc(s)}">${esc(s)}</button>`).join('');

// ---------------- Projekte ----------------
export const projects = {
  id: 'projects',
  title: 'Projekte',
  icon: 'project',
  render(s) {
    return `<div class="page">
      <header class="page-head"><div><p class="eyebrow">Lokal gespeichert</p><h1>Projekte</h1></div></header>
      <form class="inline-form glass" data-form="add-project">
        <input name="name" placeholder="Neues Projekt …" required maxlength="80" aria-label="Projektname">
        <input name="description" placeholder="Kurzbeschreibung (optional)" maxlength="200" aria-label="Beschreibung">
        <button class="btn btn-primary" type="submit">${icon('plus')} Anlegen</button>
      </form>
      <div class="cards">${s.projects.map((p) => {
        const list = s.tasks.filter((t) => t.projectId === p.id);
        const pr = projectProgress(p, s.tasks);
        return `<article class="proj glass">
          <div class="proj-head"><h3>${esc(p.name)}</h3>
            <select data-change="project-status" data-id="${p.id}" aria-label="Status">${['aktiv', 'pausiert', 'abgeschlossen'].map((x) => `<option ${x === p.status ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
          <p class="muted">${esc(p.description) || '<i>Keine Beschreibung</i>'}</p>
          <div class="progress big"><span style="--w:${pr}%"></span></div>
          <div class="proj-meta"><span>${pr} %</span><span>${list.filter((t) => t.done).length}/${list.length} Aufgaben</span><span>aktualisiert ${relTime(p.updated)}</span></div>
          <ul class="mini-list">${list.slice(0, 4).map((t) => `<li><button class="check ${t.done ? 'on' : ''}" data-act="toggle-task" data-id="${t.id}" aria-label="Status umschalten"></button><span class="${t.done ? 'done' : ''}">${esc(t.title)}</span></li>`).join('')}</ul>
          <div class="row-actions">
            <button class="btn btn-ghost btn-sm" data-act="project-add-task" data-id="${p.id}">${icon('plus')} Aufgabe</button>
            <button class="btn btn-ghost btn-sm" data-act="project-edit" data-id="${p.id}">Bearbeiten</button>
            <button class="btn btn-ghost btn-sm danger-text" data-act="project-delete" data-id="${p.id}">${icon('trash')}</button>
          </div>
        </article>`;
      }).join('') || '<p class="empty">Noch keine Projekte.</p>'}</div>
    </div>`;
  },
  async onAct(act, el, ctx) {
    const id = el.dataset.id;
    const p = store.get().projects.find((x) => x.id === id);
    if (act === 'project-delete' && p) {
      if (await confirmDialog(`Projekt „${p.name}“ löschen? Zugehörige Aufgaben bleiben ohne Projekt erhalten.`, { ok: 'Löschen' })) {
        actions.deleteProject(id);
        toast('Projekt gelöscht');
      }
    }
    if (act === 'project-edit' && p) {
      const res = await modal({
        title: 'Projekt bearbeiten',
        body: `<label class="field">Name<input id="pe-name" value="${esc(p.name)}" maxlength="80" autofocus></label>
               <label class="field">Beschreibung<textarea id="pe-desc" rows="3" maxlength="200">${esc(p.description)}</textarea></label>`,
        actions: [{ label: 'Abbrechen', value: null }, { label: 'Speichern', cls: 'btn-primary', getValue: (w) => ({ name: w.querySelector('#pe-name').value.trim(), description: w.querySelector('#pe-desc').value.trim() }) }],
      });
      if (res?.name) actions.updateProject(id, res);
    }
    if (act === 'project-add-task' && p) ctx.quickTask(p.id);
  },
  onSubmit(form) {
    const f = new FormData(form);
    if (!f.get('name').trim()) return;
    actions.addProject({ name: f.get('name'), description: f.get('description').trim() });
    toast('Projekt angelegt', 'ok');
  },
  onChange(el) {
    if (el.dataset.change === 'project-status') actions.updateProject(el.dataset.id, { status: el.value });
  },
};

// ---------------- Aufgaben ----------------
let taskFilter = 'offen';
export const tasks = {
  id: 'tasks',
  title: 'Aufgaben',
  icon: 'task',
  render(s) {
    const prio = { hoch: 0, mittel: 1, niedrig: 2 };
    const list = s.tasks
      .filter((t) => (taskFilter === 'alle' ? true : taskFilter === 'offen' ? !t.done : t.done))
      .sort((a, b) => a.done - b.done || prio[a.priority] - prio[b.priority] || b.created - a.created);
    const proj = (id) => s.projects.find((p) => p.id === id)?.name;
    return `<div class="page">
      <header class="page-head"><div><p class="eyebrow">${s.tasks.filter((t) => !t.done).length} offen · ${s.tasks.filter((t) => t.done).length} erledigt</p><h1>Aufgaben</h1></div>
        <div class="seg" role="group" aria-label="Filter">${['offen', 'erledigt', 'alle'].map((f) => `<button class="${f === taskFilter ? 'on' : ''}" data-act="task-filter" data-f="${f}">${f}</button>`).join('')}</div></header>
      <form class="inline-form glass" data-form="add-task">
        <input name="title" placeholder="Neue Aufgabe …" required maxlength="140" aria-label="Aufgabe">
        <select name="projectId" aria-label="Projekt"><option value="">Kein Projekt</option>${s.projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
        <select name="priority" aria-label="Priorität"><option value="hoch">hoch</option><option value="mittel" selected>mittel</option><option value="niedrig">niedrig</option></select>
        <input name="due" type="date" aria-label="Fällig am">
        <button class="btn btn-primary" type="submit">${icon('plus')} Hinzufügen</button>
      </form>
      <ul class="task-list">${list.map((t) => {
        const overdue = t.due && !t.done && new Date(t.due) < new Date(new Date().toDateString());
        return `<li class="task glass ${t.done ? 'is-done' : ''}">
          <button class="check ${t.done ? 'on' : ''}" data-act="toggle-task" data-id="${t.id}" aria-label="${t.done ? 'Wieder öffnen' : 'Erledigt'}"></button>
          <div class="task-main"><span class="task-title">${esc(t.title)}</span>
            <span class="task-meta">${proj(t.projectId) ? `${icon('project')} ${esc(proj(t.projectId))}` : ''}${t.due ? `<span class="${overdue ? 'overdue' : ''}">fällig ${fmtDate(t.due)}</span>` : ''}</span></div>
          <span class="tag tag-${t.priority === 'hoch' ? 'danger' : t.priority === 'mittel' ? 'warn' : 'idle'}">${t.priority}</span>
          <button class="icon-btn sm ghost" data-act="task-delete" data-id="${t.id}" aria-label="Löschen">${icon('trash')}</button>
        </li>`;
      }).join('') || `<li class="empty">Keine ${taskFilter === 'alle' ? '' : taskFilter + 'en '}Aufgaben.</li>`}</ul>
    </div>`;
  },
  async onAct(act, el, ctx) {
    if (act === 'task-filter') { taskFilter = el.dataset.f; ctx.rerender(); }
    if (act === 'task-delete') {
      const t = store.get().tasks.find((x) => x.id === el.dataset.id);
      if (t && (await confirmDialog(`Aufgabe „${t.title}“ löschen?`, { ok: 'Löschen' }))) actions.deleteTask(t.id);
    }
  },
  onSubmit(form) {
    const f = new FormData(form);
    if (!f.get('title').trim()) return;
    actions.addTask({ title: f.get('title'), projectId: f.get('projectId') || null, priority: f.get('priority'), due: f.get('due') });
    toast('Aufgabe hinzugefügt', 'ok');
  },
};

// ---------------- Vorschauen ----------------
export const previews = {
  id: 'previews',
  title: 'Vorschauen',
  icon: 'preview',
  render(s) {
    const kinds = (b) => [...new Set(b.map((x) => ({ steps: 'Schritte', risks: 'Risiken', table: 'Tabelle', chart: 'Diagramm', donut: 'Diagramm' }[x.type])).filter(Boolean))];
    return `<div class="page">
      <header class="page-head"><div><p class="eyebrow">Automatisch aus dem Chat gespeichert</p><h1>Vorschauen</h1>
        <p class="muted">Pläne, Risikoanalysen, Tabellen und Visualisierungen. Frag CARVIS z. B. „Wie gehe ich bei einer App vor?“.</p></div></header>
      <div class="cards">${s.previews.map((p) => `<article class="prev glass" data-act="preview-open" data-id="${p.id}" tabindex="0" role="button">
          <div class="prev-thumb">${renderBlocks(p.blocks.filter((b) => b.type !== 'notice').slice(0, 1))}</div>
          <h3>${esc(p.title)}</h3>
          <div class="proj-meta"><span class="src ${p.source === 'local' ? 'src-local' : p.source === 'llm' ? 'src-llm' : 'src-demo'}">${p.source === 'local' ? 'lokale Daten' : p.source === 'llm' ? 'LLM' : 'simuliert'}</span>${kinds(p.blocks).map((k) => `<span>${k}</span>`).join('')}<span>${relTime(p.created)}</span></div>
        </article>`).join('') || '<p class="empty">Noch keine Vorschauen.</p>'}</div>
    </div>`;
  },
  async onAct(act, el) {
    const p = store.get().previews.find((x) => x.id === el.dataset.id);
    if (act !== 'preview-open' || !p) return;
    const r = await modal({
      title: p.title,
      wide: true,
      body: renderBlocks(p.blocks),
      actions: [{ label: 'Löschen', value: 'del', cls: 'btn-ghost danger-text' }, { label: 'Als Dokument speichern', value: 'doc', cls: 'btn-primary' }],
    });
    if (r === 'del' && (await confirmDialog('Vorschau löschen?', { ok: 'Löschen' }))) actions.deletePreview(p.id);
    if (r === 'doc') {
      actions.addDocument({ title: p.title, content: blocksToText(p.blocks) });
      toast('Als Dokument gespeichert', 'ok');
    }
  },
};

export function blocksToText(blocks = []) {
  return blocks.map((b) => {
    if (b.type === 'steps') return `## ${b.title || 'Schritte'}\n${b.items.map((x, i) => `${i + 1}. ${x}`).join('\n')}`;
    if (b.type === 'risks') return `## ${b.title || 'Risiken'}\n${b.rows.map(([r, l, m]) => `- ${r} (${l}) → ${m}`).join('\n')}`;
    if (b.type === 'table') return `## ${b.title || 'Tabelle'}\n| ${b.columns.join(' | ')} |\n| ${b.columns.map(() => '---').join(' | ')} |\n${b.rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}`;
    if (b.type === 'chart') return `## ${b.title}\n${b.items.map((i) => `- ${i.label}: ${i.value}${b.unit || ''}`).join('\n')}`;
    if (b.type === 'donut') return `## ${b.title}\n${b.segments.map((i) => `- ${i.label}: ${i.value}`).join('\n')}`;
    if (b.type === 'notice') return `> ${b.text}`;
    return '';
  }).filter(Boolean).join('\n\n');
}

// ---------------- Dokumente ----------------
let currentDoc = null;
export const documents = {
  id: 'documents',
  title: 'Dokumente',
  icon: 'doc',
  open(id) { currentDoc = id; },
  render(s) {
    const d = s.documents.find((x) => x.id === currentDoc) || null;
    return `<div class="page docs-page">
      <header class="page-head"><div><p class="eyebrow">Lokale Notizen & gespeicherte Antworten</p><h1>Dokumente</h1></div>
        <button class="btn btn-primary" data-act="doc-new">${icon('plus')} Neues Dokument</button></header>
      <div class="docs ${d ? 'has-doc' : ''}">
        <ul class="doc-list glass">${s.documents.map((x) => `<li><button class="${x.id === currentDoc ? 'on' : ''}" data-act="doc-open" data-id="${x.id}"><b>${esc(x.title)}</b><small>${relTime(x.updated)}</small></button></li>`).join('') || '<li class="empty">Noch keine Dokumente.</li>'}</ul>
        ${d ? `<form class="doc-editor glass" data-form="doc-save" data-id="${d.id}">
            <div class="doc-bar"><button type="button" class="btn btn-ghost btn-sm back" data-act="doc-close">‹ Liste</button>
              <input name="title" value="${esc(d.title)}" aria-label="Titel" maxlength="120">
              <button type="button" class="btn btn-ghost btn-sm" data-act="doc-export" data-id="${d.id}">.md</button>
              <button type="button" class="btn btn-ghost btn-sm danger-text" data-act="doc-delete" data-id="${d.id}">${icon('trash')}</button>
              <button type="submit" class="btn btn-primary btn-sm">Speichern</button></div>
            <textarea name="content" placeholder="Schreibe hier … (Markdown wird unterstützt)" aria-label="Inhalt">${esc(d.content)}</textarea>
            <small class="muted">Zuletzt gespeichert ${relTime(d.updated)} · Strg/Cmd + S speichert</small>
          </form>` : `<div class="doc-empty glass"><p class="muted">Wähle ein Dokument oder lege ein neues an.<br>Tipp: Jede Antwort von CARVIS lässt sich im Chat über ${icon('save')} als Dokument speichern.</p></div>`}
      </div>
    </div>`;
  },
  async onAct(act, el, ctx) {
    const id = el.dataset.id;
    if (act === 'doc-new') { currentDoc = actions.addDocument({ title: 'Neues Dokument' }).id; ctx.rerender(); }
    if (act === 'doc-open') { currentDoc = id; ctx.rerender(); }
    if (act === 'doc-close') { currentDoc = null; ctx.rerender(); }
    if (act === 'doc-export') {
      const d = store.get().documents.find((x) => x.id === id);
      if (d) download(`${d.title.replace(/[^\wäöüÄÖÜß -]/g, '').trim() || 'dokument'}.md`, `# ${d.title}\n\n${d.content}`, 'text/markdown');
    }
    if (act === 'doc-delete') {
      const d = store.get().documents.find((x) => x.id === id);
      if (d && (await confirmDialog(`Dokument „${d.title}“ endgültig löschen?`, { ok: 'Löschen' }))) { actions.deleteDocument(id); currentDoc = null; }
    }
  },
  onSubmit(form) {
    const f = new FormData(form);
    actions.updateDocument(form.dataset.id, { title: f.get('title').trim() || 'Unbenannt', content: f.get('content') });
    toast('Gespeichert', 'ok', 1600);
  },
};

// ---------------- Gedächtnis ----------------
export const memory = {
  id: 'memory',
  title: 'Gedächtnis',
  icon: 'memory',
  render(s) {
    return `<div class="page">
      <header class="page-head"><div><p class="eyebrow">${s.memory.length} Einträge · nur auf diesem Gerät</p><h1>Gedächtnis</h1>
        <p class="muted">Fakten, die C über dich kennt. Sie werden nur lokal gespeichert und – falls aktiviert – an dein eigenes lokales Sprachmodell übergeben. Speichere hier keine Passwörter.</p></div>
        <label class="switch"><input type="checkbox" data-change="use-memory" ${s.settings.useMemory ? 'checked' : ''}><span></span> Gedächtnis verwenden</label></header>
      <form class="inline-form glass" data-form="add-memory">
        <input name="text" placeholder="z. B. Ich mache eine Ausbildung zum Fachinformatiker." required maxlength="300" aria-label="Neue Erinnerung">
        <button class="btn btn-primary" type="submit">${icon('plus')} Merken</button>
      </form>
      <ul class="mem-list">${s.memory.map((m) => `<li class="glass">${icon('memory')}<span>${esc(m.text)}</span><time>${fmtDate(m.created)}</time>
          <button class="icon-btn sm ghost" data-act="memory-delete" data-id="${m.id}" aria-label="Vergessen">${icon('trash')}</button></li>`).join('') || '<li class="empty">Noch leer. Sag im Chat: „Merke dir, dass …“</li>'}</ul>
    </div>`;
  },
  async onAct(act, el) {
    if (act === 'memory-delete' && (await confirmDialog('Diese Erinnerung vergessen?', { ok: 'Vergessen' }))) actions.deleteMemory(el.dataset.id);
  },
  onSubmit(form) {
    const t = new FormData(form).get('text').trim();
    if (t) actions.addMemory(t);
  },
  onChange(el) {
    if (el.dataset.change === 'use-memory') actions.setSettings({ useMemory: el.checked });
  },
};
