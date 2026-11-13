// Combos on Home: a chain of steps across projects, life and habits, with a game-like counter.

import { $, $$, esc, icon, toast, haptic } from './dom.js';
import * as store from '../core/store.js';
import * as K from '../core/combos.js';
import { routineTimes } from '../core/planner.js';
import { isoDate, fromIso, fmtTime } from '../core/time.js';
import { ValidationError } from '../core/tracker.js';
import { openSheet, closeSheet, run } from './sheets.js';
import { openTask, startTask, stopTask, runningOf, toggleTask } from './plan.js';

const today = () => isoDate(Date.now());
const norm = (s) => String(s || '').trim().toLocaleLowerCase('tr-TR');
const act = (p) => Promise.resolve(p).catch((e) => toast(e instanceof ValidationError ? e.message : 'Kaydedilemedi. Lütfen tekrar dene.'));

function dayWord(iso) {
  if (!iso) return '';
  const d = Math.round((fromIso(iso) - fromIso(today())) / 86_400_000);
  if (d === 0) return 'bugün';
  if (d === 1) return 'yarın';
  if (d === -1) return 'dün';
  return new Date(fromIso(iso) + 43_200_000).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

const fmtWin = (m) => (m % 60 ? (m >= 60 ? `${Math.floor(m / 60)} sa ${m % 60} dk` : `${m} dk`) : `${m / 60} saat`);
const WINDOWS = [[null, 'Süresiz'], [30, '30 dk'], [60, '1 saat'], [90, '1,5 saat'], [120, '2 saat'], [180, '3 saat'], [360, '6 saat'], [720, '12 saat'], [1440, '1 gün']];
const FOLD = 'tg.comboFold';
const folded = () => { try { return localStorage.getItem(FOLD) === '1'; } catch { return false; } };

const stepName = (x) => x.missing ? 'silinmiş adım' : x.title;
const stepTag = (x) => x.habit ? '↻' : '';

/** Which part of her life or work a step belongs to. */
function areaOf(step) {
  if (step.kind === 'habit') { const r = store.getRoutine(step.ref); return r ? `Hayatım · ${r.category || 'Kişisel'}` : ''; }
  const t = store.getTask(step.ref), p = t && store.getProject(t.projectId);
  if (!p) return '';
  return p.life ? `Hayatım · ${t.category || 'Kişisel'}` : (p.area ? `${p.name} · ${p.area}` : p.name);
}

/** Small square cards laid out like a snake: 3 a row, every other row runs back. */
export function snakeHtml(cards, cols = 3) {
  const pos = (i) => { const r = Math.floor(i / cols), c = i % cols; return { r, c: r % 2 ? cols - 1 - c : c }; };
  let out = '';
  cards.forEach((html, i) => {
    const a = pos(i);
    out += `<div class="sn-cell" style="grid-row:${a.r * 2 + 1};grid-column:${a.c * 2 + 1}">${html}</div>`;
    if (i === cards.length - 1) return;
    const b = pos(i + 1);
    if (a.r === b.r) out += `<span class="sn-arrow" style="grid-row:${a.r * 2 + 1};grid-column:${Math.min(a.c, b.c) * 2 + 2}" aria-hidden="true">${b.c > a.c ? '→' : '←'}</span>`;
    else out += `<span class="sn-arrow down" style="grid-row:${a.r * 2 + 2};grid-column:${a.c * 2 + 1}" aria-hidden="true">↓</span>`;
  });
  return `<div class="snake" style="grid-template-columns:repeat(${cols - 1},minmax(0,1fr) 16px) minmax(0,1fr)">${out}</div>`;
}

function comboHtml(c) {
  const pr = store.comboProgress(c), cur = pr.info[pr.next];
  const cards = pr.info.map((x, i) => `<button type="button" class="sq${x.doneAt ? ' done' : ''}${i === pr.next ? ' now' : ''}${i === pr.next && pr.status === 'broken' ? ' broke' : ''}" data-cstep="${c.id}|${i}">
    <span class="sq-top">${x.doneAt ? '✓' : (x.habit ? '↻' : i + 1)}</span><b>${esc(stepName(x))}</b><small>${esc(areaOf(x.step))}</small></button>`);
  let line = '', btn = '';
  if (pr.status === 'done') {
    line = `Tamamlandı · ${pr.count} adım art arda`;
    if (c.repeat) btn = `<button type="button" class="chip" data-crestart="${c.id}">↻ Yeni tur</button>`;
  } else if (pr.status === 'broken') {
    line = c.windowMin ? `Süre doldu: ${fmtWin(c.windowMin)} içinde bitmeliydi` : `Kırıldı: “${esc(stepName(cur))}” ${dayWord(cur.due)} yapılacaktı`;
    btn = `<button type="button" class="chip" data-crestart="${c.id}">Baştan başla</button>`;
  } else if (cur) {
    const when = c.windowMin ? (pr.endsAt ? ` · ⏳ ${fmtTime(pr.endsAt)}’e kadar` : ` · ilk adımla ${fmtWin(c.windowMin)} başlar`)
      : (cur.due ? ` · ${dayWord(cur.due)}` : (cur.queued ? ' · alışkanlık sırada bekliyor' : ' · gün seçilmedi'));
    line = `Sırada: <b>${esc(stepName(cur))}</b>${when}`;
    btn = cur.habit ? `<button type="button" class="chip" data-cdo="${c.id}">✓ Bugün yaptım</button>`
      : (cur.missing ? '' : `<button type="button" class="chip" data-cdo="${c.id}">${runningOf(cur.step.ref) ? '■ Bitir' : '▶ Başlat'}</button><button type="button" class="chip" data-cdone="${c.id}">✓ Bitti</button>`);
  }
  return `<div class="combo ${pr.status}" data-combo="${c.id}">
    <div class="cb-head"><button type="button" class="cb-title" data-cedit="${c.id}">${esc(c.title)}${c.repeat ? ' <small>↻</small>' : ''}${c.windowMin ? ` <small>⏳ ${fmtWin(c.windowMin)}</small>` : ''}</button>
      <span class="cb-x${pr.count ? ' hot' : ''}" aria-label="Combo ${pr.count}">×${pr.count}</span></div>
    ${snakeHtml(cards)}
    <div class="cb-foot"><span>${line}</span>${btn}</div></div>`;
}

export function renderCombos() {
  const el = $('#comboCard');
  if (!el) return;
  const list = store.state.combos, n = suggestions().length, fold = folded();
  const shown = [...list].sort((a, b) => rank(a) - rank(b));
  const mini = (c) => { const pr = store.comboProgress(c); return `<button type="button" class="cb-mini ${pr.status}" data-cedit="${c.id}"><span>${esc(c.title)}</span><b>×${pr.count}</b></button>`; };
  el.innerHTML = `<div class="block-head"><button type="button" class="fold-h" id="comboFold" aria-expanded="${!fold}"><h2>Combo</h2><span class="fold-i">${fold ? '▸' : '▾'}</span></button><span class="grow"></span>
    ${n && !fold ? `<button class="chip quiet" id="comboIdeas">✨ ${n} öneri</button>` : ''}<button class="btn ghost sm" id="comboNew">＋ Combo kur</button></div>
    ${fold ? (shown.length ? `<div class="cb-minis">${shown.map(mini).join('')}</div>` : '')
      : shown.length ? shown.map(comboHtml).join('') : '<p class="empty-note">Alışkanlık kazanmak için birbirini çeken işleri sıraya diz (akşam duş + saç → sabah makyaj → çekim…). Art arda yaptıkça sayaç artar; süre verirsen o süre içinde bitirmen gerekir.</p>'}`;
  $('#comboFold', el).onclick = () => { try { localStorage.setItem(FOLD, fold ? '0' : '1'); } catch { /* private mode */ } renderCombos(); };
  bind(el);
}

function rank(c) {
  const s = store.comboProgress(c).status;
  return s === 'running' ? 0 : s === 'broken' ? 1 : 2;
}

function bind(el) {
  $('#comboNew', el).onclick = () => openBuilder();
  const ideas = $('#comboIdeas', el);
  if (ideas) ideas.onclick = openSuggestions;
  $$('[data-cedit]', el).forEach((b) => { b.onclick = () => openBuilder(store.getCombo(b.dataset.cedit)); });
  $$('[data-crestart]', el).forEach((b) => { b.onclick = () => { const again = store.comboProgress(store.getCombo(b.dataset.crestart)).status === 'done'; run(() => store.restartCombo(b.dataset.crestart), again ? 'Yeni tur başladı ×0' : 'Combo baştan başladı ×0'); }; });
  $$('[data-cstep]', el).forEach((b) => {
    b.onclick = () => {
      const [cid, i] = b.dataset.cstep.split('|'), s = store.getCombo(cid)?.steps[Number(i)];
      if (s?.kind === 'task' && store.getTask(s.ref)) openTask(s.ref);
      else if (s?.kind === 'habit') toast('Alışkanlıklar Plan › Gün’de, zincirinde');
    };
  });
  $$('[data-cdone]', el).forEach((b) => {
    b.onclick = () => {
      const c = store.getCombo(b.dataset.cdone), s = c.steps[store.comboProgress(c).next];
      if (s?.kind !== 'task') return;
      stopTask(s.ref, true).then(() => toggleTask(s.ref, b)).then(() => { const after = store.comboProgress(store.getCombo(c.id)); toast(after.status === 'done' ? `Combo tamam! ×${after.count}` : `Combo ×${after.count}`); });
    };
  });
  $$('[data-cdo]', el).forEach((b) => {
    b.onclick = () => {
      const c = store.getCombo(b.dataset.cdo), pr = store.comboProgress(c), s = c.steps[pr.next];
      if (!s) return;
      if (s.kind === 'task') { if (runningOf(s.ref)) stopTask(s.ref); else startTask(s.ref); return; }
      const r = store.getRoutine(s.ref);
      haptic(15);
      act(Promise.all(routineTimes(r).map((_, slot) => store.setRoutineDone(r.id, today(), true, slot))).then(() => {
        const after = store.comboProgress(store.getCombo(c.id));
        toast(after.status === 'done' ? `Combo tamam! ×${after.count}` : `Combo ×${after.count}`);
      }));
    };
  });
}

// ── builder ────────────────────────────────────────────────────────────────
// A draft step is {kind:'task'|'habit', ref} or {kind:'new', title, projectId}.

function pickerHtml() {
  const { routines, projects, tasks } = store.state;
  const life = projects.filter((p) => p.life), rest = projects.filter((p) => !p.life && !p.archived);
  const group = (label, items) => items.length ? `<optgroup label="${esc(label)}">${items.join('')}</optgroup>` : '';
  const habitLabel = (r) => r.status === 'queued' ? ' (sırada)' : r.status === 'active' ? ' (şu an)' : '';
  const open = (p) => tasks.filter((t) => t.projectId === p.id && !t.done).sort((a, b) => a.order - b.order).map((t) => `<option value="task|${t.id}">${t.parentId ? '· ' : ''}${esc(t.title)}</option>`);
  return `<option value="">Adım seç…</option>
    ${group('Alışkanlıklar', routines.map((r) => `<option value="habit|${r.id}">↻ ${esc(r.title)}${habitLabel(r)}</option>`))}
    ${[...life, ...rest].map((p) => group(p.life ? 'Hayatım' : `${p.name}${p.area ? ` · ${p.area}` : ''}`, open(p))).join('')}`;
}

function projectOptions(sel) {
  const ps = [...store.state.projects.filter((p) => p.life), ...store.state.projects.filter((p) => !p.life && !p.archived)];
  return `${store.lifeProject() ? '' : `<option value="__life"${sel === '__life' ? ' selected' : ''}>Hayatım</option>`}${ps.map((p) => `<option value="${p.id}"${p.id === sel ? ' selected' : ''}>${esc(p.life ? 'Hayatım' : p.name)}</option>`).join('')}`;
}

function draftName(s) {
  if (s.kind === 'new') return s.title;
  if (s.kind === 'habit') return store.getRoutine(s.ref)?.title || '?';
  return store.getTask(s.ref)?.title || '?';
}
function draftWhere(s) {
  if (s.kind === 'habit') return 'alışkanlık';
  const p = store.getProject(s.kind === 'new' ? s.projectId : store.getTask(s.ref)?.projectId);
  return s.kind === 'new' ? 'yeni adım' : (p?.life ? 'Hayatım' : p?.name || '');
}

export function openBuilder(combo = null, preset = null) {
  const draft = preset ? { ...preset, steps: [...preset.steps] } : combo ? { title: combo.title, repeat: combo.repeat, windowMin: combo.windowMin ?? null, steps: [...combo.steps] } : { title: '', repeat: false, windowMin: null, steps: [] };
  const lifeId = store.lifeProject()?.id || '__life';
  openSheet(combo ? 'Combo' : 'Combo kur', `<form id="cf" class="combo-form">
    <input class="ts-title" name="title" maxlength="80" placeholder="Combo adı (örn. Hazırlık)" value="${esc(draft.title)}" autocomplete="off" aria-label="Combo adı">
    <label class="check"><input type="checkbox" name="repeat"${draft.repeat ? ' checked' : ''}>Tekrarlanan combo (bitince yeni tur açılır)</label>
    <div class="field"><span>Ne kadar sürede bitmeli?</span><div class="chips" id="cbWin">${WINDOWS.map(([v, l]) => `<button type="button" class="chip${(draft.windowMin ?? null) === v ? ' chosen' : ''}" data-w="${v ?? ''}">${l}</button>`).join('')}</div>
      <small class="hint" style="text-align:left">Süre ilk adımı bitirdiğinde başlar; süre dolmadan hepsini art arda bitirmelisin.</small></div>
    <ol class="cb-draft" id="cbDraft"></ol>
    <div class="field"><span>Var olan bir adım ekle</span><select id="cbPick">${pickerHtml()}</select></div>
    <div class="field"><span>ya da yeni adım yaz</span><div class="cb-new"><input id="cbNewTitle" maxlength="160" placeholder="Örn. Kombin çekimi" autocomplete="off" enterkeyhint="done">
      <select id="cbNewProj" aria-label="Hangi projeye">${projectOptions(lifeId)}</select><button type="button" class="btn sm" id="cbNewAdd">Ekle</button></div></div>
    <p class="hint" style="text-align:left">Alışkanlıklar, Hayatım’daki işler ve bunların açtığı proje adımları (çekim, edit…) olabilir. Bir adım planlandığı gün yapılmazsa combo kırılır.</p>
    <p class="form-error" role="alert"></p>
    <button class="btn full">${combo ? 'Kaydet' : 'Combo kur'}</button>
    ${combo ? '<div class="more-acts"><button type="button" class="btn danger sm" id="cbDel">Combo’yu sil</button></div>' : ''}</form>`);
  const b = $('#sheetBody'), f = $('#cf', b);
  const draw = () => {
    $('#cbDraft', b).innerHTML = draft.steps.map((s, i) => `<li><span class="cb-n">${i + 1}</span><div class="grow"><b>${esc(draftName(s))}</b><small>${esc(draftWhere(s))}</small></div>
      <button type="button" class="mini-btn" data-up="${i}" aria-label="Yukarı"${i ? '' : ' disabled'}>↑</button><button type="button" class="mini-btn" data-rm="${i}" aria-label="Çıkar">✕</button></li>`).join('')
      || '<li class="empty-note">Henüz adım yok. En az iki adım ekle.</li>';
    $$('[data-up]', b).forEach((x) => { x.onclick = () => { const i = Number(x.dataset.up); [draft.steps[i - 1], draft.steps[i]] = [draft.steps[i], draft.steps[i - 1]]; draw(); }; });
    $$('[data-rm]', b).forEach((x) => { x.onclick = () => { draft.steps.splice(Number(x.dataset.rm), 1); draw(); }; });
  };
  draw();
  $$('#cbWin [data-w]', b).forEach((x) => { x.onclick = () => { draft.windowMin = x.dataset.w ? Number(x.dataset.w) : null; $$('#cbWin .chip', b).forEach((c) => c.classList.toggle('chosen', c === x)); }; });
  $('#cbPick', b).onchange = (e) => {
    const [kind, ref] = e.target.value.split('|');
    if (kind && !draft.steps.some((s) => s.kind === kind && s.ref === ref)) draft.steps.push({ kind, ref });
    e.target.value = ''; draw();
  };
  const addNew = () => {
    const t = $('#cbNewTitle', b).value.trim();
    if (!t) return;
    draft.steps.push({ kind: 'new', title: t, projectId: $('#cbNewProj', b).value });
    $('#cbNewTitle', b).value = ''; draw(); $('#cbNewTitle', b).focus();
  };
  $('#cbNewAdd', b).onclick = addNew;
  $('#cbNewTitle', b).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addNew(); } });
  if (combo) $('#cbDel', b).onclick = () => { if (confirm(`“${combo.title}” silinsin mi? Adımlar projelerinde kalır.`)) run(() => store.removeCombo(combo.id), 'Silindi'); };
  f.onsubmit = (e) => {
    e.preventDefault();
    const input = { title: f.title.value, repeat: f.repeat.checked, windowMin: draft.windowMin };
    run(async () => {
      if (draft.steps.length < 2) throw new ValidationError('Bir combo en az iki adımdan oluşur.');
      const steps = [];
      for (const s of draft.steps) {
        if (s.kind !== 'new') { steps.push(s); continue; }
        const pid = s.projectId === '__life' || !store.getProject(s.projectId) ? (await store.ensureLife()).id : s.projectId;
        steps.push({ kind: 'task', ref: (await store.addTask({ projectId: pid, title: s.title })).id });
      }
      return combo ? store.updateCombo(combo.id, { ...input, steps }) : store.addCombo({ ...input, steps });
    }, combo ? 'Kaydedildi' : 'Combo kuruldu ×0');
  };
}

// ── suggestions ────────────────────────────────────────────────────────────

/** Turn a list of names into draft steps: a habit or open task with that name, else a new step. */
function stepsFromNames(names) {
  const { routines, tasks } = store.state, lifeId = store.lifeProject()?.id || '__life';
  return names.map((n) => {
    const r = routines.find((x) => norm(x.title) === norm(n));
    if (r) return { kind: 'habit', ref: r.id };
    const t = tasks.find((x) => !x.done && norm(x.title) === norm(n));
    return t ? { kind: 'task', ref: t.id } : { kind: 'new', title: n, projectId: lifeId };
  });
}

function suggestions() {
  const { sessions, combos } = store.state, out = [];
  const taken = new Set(combos.map((c) => norm(c.title)));
  for (const s of K.sequencesFromRecords(sessions).slice(0, 3)) {
    out.push({ why: `kayıtlarından · ${s.days} gün art arda yaptın`, title: s.names.join(' → '), steps: stepsFromNames(s.names), repeat: true });
  }
  return out.filter((s) => !taken.has(norm(s.title)));
}

export function openSuggestions() {
  const list = suggestions(), tpl = K.COMBO_TEMPLATES;
  const item = (s, i, kind) => `<button data-sug="${kind}|${i}"><div><b>${esc(s.title)}</b><small>${esc(s.why || 'hazır şablon')}${s.steps ? ` · ${s.steps.length} adım` : ''}</small></div></button>`;
  openSheet('Combo önerileri', `<div class="menu">${list.map((s, i) => item(s, i, 's')).join('')}</div>
    ${list.length ? '' : '<p class="hint">Aynı işleri birkaç gün art arda ölçtükçe ya da farklı projelerdeki adımları bağladıkça burada öneriler belirir.</p>'}
    <h3 class="section-h">Hazır şablonlar</h3><div class="menu">${tpl.map((s, i) => item({ title: s.title, why: s.steps.join(' → ') }, i, 't')).join('')}</div>`);
  $$('[data-sug]', $('#sheetBody')).forEach((b) => {
    b.onclick = () => {
      const [k, i] = b.dataset.sug.split('|');
      const s = k === 's' ? list[Number(i)] : { title: tpl[i].title, repeat: tpl[i].repeat, steps: stepsFromNames(tpl[i].steps) };
      openBuilder(null, { title: k === 's' ? '' : s.title, repeat: !!s.repeat, steps: s.steps });
    };
  });
}
