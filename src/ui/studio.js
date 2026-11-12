// Home studio: idea post-its, inspiration videos and tutorials. Cards can be dragged onto
// a project or an idea, or moved there from the card's sheet.

import { $, $$, esc, icon, toast, haptic, catColor } from './dom.js';
import * as store from '../core/store.js';
import { parseVideo, hostOf, POSTIT, linkedTo, linksOf } from '../core/cards.js';
import { ValidationError } from '../core/tracker.js';
import { openSheet, closeSheet, run } from './sheets.js';

let tab = 'idea';
let lastKey = '';
let open = true;
try { open = localStorage.getItem('tg-studio-open') !== '0'; } catch { /* private mode */ }
const LABEL = { idea: 'Fikirler', inspire: 'İlham', tuto: 'Tuto' };
const act = (p) => Promise.resolve(p).catch((e) => toast(e instanceof ValidationError ? e.message : 'Kaydedilemedi. Lütfen tekrar dene.'));
const projName = (id) => store.getProject(id)?.name || '';
const ideaText = (c) => (c.title || c.text || '').split('\n')[0];
const cardName = (c) => (c.kind === 'idea' ? ideaText(c) : (c.title || hostOf(c.url)));
const KIND_IC = { idea: '💡', inspire: '✦', tuto: '🎓' };

/** Live projects grouped under their area headings, in the order the areas first appear. */
function projectsByArea() {
  const groups = new Map();
  for (const p of store.state.projects.filter((x) => !x.archived).sort((a, b) => (b.life ? 1 : 0) - (a.life ? 1 : 0))) {
    const a = p.area || 'Genel';
    if (!groups.has(a)) groups.set(a, []);
    groups.get(a).push(p);
  }
  return [...groups];
}

/** An embedded video, or a plain link card when the link is not a known video. */
export function embedHtml(url, { compact = false } = {}) {
  const v = parseVideo(url);
  if (!v) return url ? `<a class="link-face" href="${esc(url)}" target="_blank" rel="noopener">${icon('next')}<span>${esc(hostOf(url))}</span></a>` : '';
  return `<div class="embed ${v.provider}${compact ? ' compact' : ''}" style="--ratio:${v.ratio}">
    <iframe src="${esc(v.embed)}" loading="lazy" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" title="Video"></iframe></div>`;
}

function linkChips(c) {
  const bits = (c.projectIds || []).filter(projName).map((pid) => `<span class="chip"><span class="dot" style="--c:${catColor(store.getProject(pid)?.category)}"></span>${esc(projName(pid))}</span>`);
  const linked = linkedTo(store.state.cards, { cardId: c.id });
  const count = (k) => linked.filter((x) => x.kind === k).length;
  const parts = [['idea', 'fikir'], ['inspire', 'ilham'], ['tuto', 'tuto']].filter(([k]) => count(k)).map(([k, l]) => `${count(k)} ${l}`);
  if (parts.length) bits.push(`<span class="chip quiet">🔗 ${parts.join(' · ')}</span>`);
  return bits.length ? `<div class="card-links">${bits.join('')}</div>` : '';
}

function cardHtml(c) {
  const grip = `<span class="grip card-grip" data-drag-card="${c.id}" aria-label="Sürükle">⠿</span>`;
  if (c.kind === 'idea') {
    return `<div class="postit p-${c.color}" data-card="${c.id}">${grip}<button class="postit-body" data-open="${c.id}">
      ${c.title ? `<b>${esc(c.title)}</b>` : ''}<p>${esc(c.text)}</p></button>${linkChips(c)}</div>`;
  }
  return `<div class="vcard ${c.kind}" data-card="${c.id}">${embedHtml(c.url, { compact: true })}
    <div class="vcard-foot">${grip}<button class="vcard-text" data-open="${c.id}">
      ${c.kind === 'tuto' ? `<b>${esc(c.title)}</b>` : (c.title ? `<b>${esc(c.title)}</b>` : `<b class="host">${esc(hostOf(c.url))}</b>`)}
      ${c.text ? `<small>${esc(c.text)}</small>` : ''}</button></div>${linkChips(c)}</div>`;
}

export function renderStudio(force = false) {
  const el = $('#studio');
  if (!el) return;
  const list = store.cardsOf(tab);
  // Iframes reload when re-rendered, so only redraw when something visible changed.
  const key = JSON.stringify([open, tab, store.state.cards.map((c) => [c.id, c.updatedAt]), store.state.projects.map((p) => [p.id, p.name])]);
  if (!force && key === lastKey) return;
  lastKey = key;
  const empty = {
    idea: 'Aklına gelen her fikri bir post-it olarak buraya bırak; sonra bir projeye aktarırsın.',
    inspire: 'Etkilendiğin videoların bağlantılarını ekle (YouTube, Instagram, TikTok, Vimeo); kartın üstünde oynar.',
    tuto: 'Öğrenmek istediğin teknikleri kaydet: “Glitch efekti” yaz, nasıl yapıldığını gösteren videonun bağlantısını ekle.',
  }[tab];
  const n = store.state.cards.length;
  el.innerHTML = `<div class="block-head"><button class="fold-head" id="studioToggle" aria-expanded="${open}"><h2>Stüdyo</h2><span class="chip quiet">${n ? `${n} kart` : 'boş'}</span><span class="fold-ic">${open ? '▾' : '▸'}</span></button>
    ${open ? `<button class="btn ghost sm" id="studioAdd">＋ ${tab === 'idea' ? 'Fikir' : tab === 'inspire' ? 'İlham' : 'Tuto'}</button>` : ''}</div>
    ${open ? `<div class="segmented" id="studioTabs">${Object.entries(LABEL).map(([k, l]) => `<button data-st="${k}" class="${k === tab ? 'selected' : ''}">${l}${store.cardsOf(k).length ? ` · ${store.cardsOf(k).length}` : ''}</button>`).join('')}</div>
    ${list.length ? `<div class="card-row ${tab}">${list.map(cardHtml).join('')}</div><p class="hint left">Kartı ⠿ tutamağından tutup bir projeye ya da başka bir karta sürükle; bir kart birden fazla yere bağlanabilir.</p>`
      : `<p class="empty-note">${empty}</p>`}` : ''}`;
  $('#studioToggle', el).onclick = () => { open = !open; try { localStorage.setItem('tg-studio-open', open ? '1' : '0'); } catch { /* private mode */ } renderStudio(true); };
  if (!open) return;
  $$('#studioTabs [data-st]', el).forEach((b) => { b.onclick = () => { tab = b.dataset.st; renderStudio(true); }; });
  $('#studioAdd', el).onclick = () => openCardSheet(null, tab);
  $$('[data-open]', el).forEach((b) => { b.onclick = () => openCardSheet(b.dataset.open); });
  bindCardDrag(el);
}

// ── drag onto a project or an idea ─────────────────────────────────────────
function dropBar(card) {
  const linked = new Set(linksOf(store.state.cards, card.id));
  const others = store.state.cards.filter((c) => c.id !== card.id);
  const group = (k, title) => {
    const list = others.filter((c) => c.kind === k);
    return list.length ? `<small>${title}</small><div>${list.map((c) => `<span class="drop-t card k-${c.kind}${c.kind === 'idea' ? ` p-${c.color}` : ''}${linked.has(c.id) ? ' on' : ''}" data-drop-card="${c.id}">${KIND_IC[c.kind]} ${esc(cardName(c).slice(0, 22))}${linked.has(c.id) ? ' ✓' : ''}</span>`).join('')}</div>` : '';
  };
  const bar = document.createElement('div');
  bar.className = 'drop-bar';
  const target = (p) => `<span class="drop-t${(card.projectIds || []).includes(p.id) ? ' on' : ''}" data-drop-project="${p.id}"><span class="dot" style="--c:${catColor(p.category)}"></span>${esc(p.name)}${(card.projectIds || []).includes(p.id) ? ' ✓' : ''}</span>`;
  bar.innerHTML = `${projectsByArea().map(([area, list]) => `<small>${esc(area)}</small><div>${list.map(target).join('')}</div>`).join('')}
    <div class="drop-new"><span class="drop-t new" data-drop-new="1">＋ Yeni proje ya da alan</span></div>
    ${group('idea', 'Fikirler')}${group('inspire', 'İlham')}${group('tuto', 'Tuto')}`;
  document.body.appendChild(bar);
  return bar;
}

function bindCardDrag(root) {
  $$('[data-drag-card]', root).forEach((grip) => {
    grip.addEventListener('pointerdown', (e) => {
      const card = store.getCard(grip.dataset.dragCard);
      if (!card) return;
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const bar = dropBar(card), ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      ghost.innerHTML = `<b>${esc(card.kind === 'idea' ? ideaText(card) : (card.title || hostOf(card.url)))}</b><small>Bir yere bırak</small>`;
      document.body.appendChild(ghost);
      let hot = null;
      const move = (ev) => {
        ghost.style.transform = `translate(${ev.clientX}px,${ev.clientY}px)`;
        ghost.style.visibility = 'hidden';
        const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-drop-project],[data-drop-card],[data-drop-new]');
        ghost.style.visibility = '';
        if (hot !== under) { hot?.classList.remove('drop-hot'); hot = under; hot?.classList.add('drop-hot'); }
      };
      const end = (ev) => {
        grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', end); grip.removeEventListener('pointercancel', end);
        if (grip.hasPointerCapture(ev.pointerId)) grip.releasePointerCapture(ev.pointerId);
        ghost.remove(); bar.remove();
        if (ev.type !== 'pointerup' || !hot) return;
        haptic(12);
        if (hot.dataset.dropNew) { openNewProject(card.id); return; }
        if (hot.dataset.dropProject) {
          const pid = hot.dataset.dropProject;
          act(store.setCardProject(card.id, pid, true).then((did) => toast(did ? `${projName(pid)} projesine eklendi` : `Zaten ${projName(pid)} projesinde`)));
        } else {
          const other = store.getCard(hot.dataset.dropCard);
          act(store.linkCards(card.id, other.id).then((did) => toast(did ? `“${cardName(other).slice(0, 30)}” ile bağlandı` : 'Bu iki kart zaten bağlı')));
        }
      };
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
      move(e);
    });
  });
}

// ── sheets ─────────────────────────────────────────────────────────────────
function openCardSheet(id, kind = 'idea') {
  const c = id ? store.getCard(id) : null;
  const k = c ? c.kind : kind;
  const projects = store.state.projects.filter((p) => !p.archived);
  const others = store.state.cards.filter((o) => o.id !== c?.id);
  const linked = new Set(c ? linksOf(store.state.cards, c.id) : []);
  const head = { idea: c ? 'Fikir' : 'Yeni fikir', inspire: c ? 'İlham' : 'Yeni ilham', tuto: c ? 'Tuto' : 'Yeni tuto' }[k];
  openSheet(head, `<form id="f">
    ${c && k !== 'idea' ? embedHtml(c.url) : ''}
    ${k === 'tuto' ? `<label class="field">Ne öğreniyorsun?<input name="title" required maxlength="120" value="${esc(c?.title || '')}" placeholder="Örn. Glitch efekti" autocomplete="off"></label>` : ''}
    ${k === 'idea' ? `<label class="field">Başlık (isteğe bağlı)<input name="title" maxlength="120" value="${esc(c?.title || '')}" autocomplete="off"></label>
      <label class="field">Fikir<textarea name="text" rows="4" placeholder="Aklındaki fikri yaz…">${esc(c?.text || '')}</textarea></label>
      <div class="chips" id="colors">${POSTIT.map((p) => `<button type="button" class="swatch p-${p}${(c?.color || 'yellow') === p ? ' chosen' : ''}" data-color="${p}" aria-label="${p}"></button>`).join('')}</div>` : ''}
    ${k !== 'idea' ? `<label class="field">Video bağlantısı${k === 'tuto' ? ' (isteğe bağlı)' : ''}<input name="url" ${k === 'inspire' ? 'required' : ''} inputmode="url" value="${esc(c?.url || '')}" placeholder="YouTube, Instagram, TikTok, Vimeo…" autocomplete="off"></label>
      ${k === 'inspire' ? `<label class="field">Başlık (isteğe bağlı)<input name="title" maxlength="120" value="${esc(c?.title || '')}" autocomplete="off"></label>` : ''}
      <label class="field">${k === 'tuto' ? 'Nasıl yapılır? (adımlar, dakika, notlar)' : 'Neden etkiledi?'}<textarea name="text" rows="3">${esc(c?.text || '')}</textarea></label>` : ''}
    <div class="field"><span>Projeler (birden fazla seçebilirsin)</span><div id="projPick">${projectsByArea().map(([area, list]) => `<small class="area-mini">${esc(area)}</small><div class="chips">${list.map((p) => `<button type="button" class="chip${(c?.projectIds || []).includes(p.id) ? ' chosen' : ''}" data-pid="${p.id}"><span class="dot" style="--c:${catColor(p.category)}"></span>${esc(p.name)}</button>`).join('')}</div>`).join('')}
      <div class="chips"><button type="button" class="chip add" id="newProj">＋ Yeni proje ya da alan</button></div></div></div>
    ${others.length ? `<div class="field"><span>Bağlı kartlar</span><div class="chips" id="linkPick">${others.map((o) => `<button type="button" class="chip k-${o.kind}${linked.has(o.id) ? ' chosen' : ''}" data-cid="${o.id}">${KIND_IC[o.kind]} ${esc(cardName(o).slice(0, 26))}</button>`).join('')}</div></div>` : ''}
    <p class="form-error" role="alert"></p>
    <div class="sheet-actions"><button class="btn full">Kaydet</button>
      ${c && k === 'idea' ? '<button type="button" class="btn ghost full" id="toTask">Seçili projelerde göreve çevir</button>' : ''}
      ${c && k !== 'idea' && c.url ? `<a class="btn ghost full" href="${esc(c.url)}" target="_blank" rel="noopener">Bağlantıyı aç</a>` : ''}
      ${c ? '<button type="button" class="btn danger full" id="del">Kartı sil</button>' : ''}</div></form>`);
  const b = $('#sheetBody'), f = $('#f', b);
  let color = c?.color || 'yellow';
  $$('#colors [data-color]', b).forEach((x) => { x.onclick = () => { color = x.dataset.color; $$('#colors [data-color]', b).forEach((y) => y.classList.toggle('chosen', y === x)); }; });
  const pids = new Set(c?.projectIds || []), want = new Set(linked);
  $('#newProj', b).onclick = () => openNewProject(c?.id || null, () => openCardSheet(c?.id || null, k));
  $$('#projPick [data-pid]', b).forEach((x) => { x.onclick = () => { const id = x.dataset.pid; if (pids.has(id)) pids.delete(id); else pids.add(id); x.classList.toggle('chosen', pids.has(id)); }; });
  $$('#linkPick [data-cid]', b).forEach((x) => { x.onclick = () => { const id = x.dataset.cid; if (want.has(id)) want.delete(id); else want.add(id); x.classList.toggle('chosen', want.has(id)); }; });
  const input = () => ({ kind: k, title: f.title?.value || '', text: f.text?.value || '', url: f.url?.value || '', color, projectIds: [...pids] });
  const saveLinks = async (id) => {
    for (const o of want) if (!linked.has(o)) await store.linkCards(id, o);
    for (const o of linked) if (!want.has(o)) await store.unlinkCards(id, o);
  };
  f.onsubmit = (e) => {
    e.preventDefault();
    run(async () => { const saved = c ? await store.updateCard(c.id, { ...input(), links: c.links }) : await store.addCard(input()); await saveLinks(saved.id); }, 'Kaydedildi');
  };
  const tt = $('#toTask', b);
  if (tt) tt.onclick = () => {
    if (!pids.size) { $('.form-error', b).textContent = 'Önce en az bir proje seç.'; return; }
    run(async () => { await store.updateCard(c.id, { ...input(), links: c.links }); await saveLinks(c.id); for (const pid of pids) await store.ideaToTask(c.id, pid); },
      `${[...pids].map(projName).join(', ')} projesine görev olarak eklendi`);
  };
  const del = $('#del', b);
  if (del) del.onclick = () => { if (confirm('Bu kart silinsin mi?')) run(() => store.removeCard(c.id), 'Silindi'); };
}

/** Make a project in an existing or a new area, then put the card in it. */
function openNewProject(cardId, after = null) {
  const areas = [...new Set(store.state.projects.filter((p) => !p.life).map((p) => p.area).filter(Boolean))];
  openSheet('Yeni proje', `<form id="np">
    <label class="field">Proje adı<input name="name" required maxlength="160" autocomplete="off"></label>
    <div class="field"><span>Hangi alanda?</span><div class="chips" id="npAreas">${areas.map((a, i) => `<button type="button" class="chip${i === 0 ? ' chosen' : ''}" data-area="${esc(a)}">${esc(a)}</button>`).join('')}</div>
      <input name="area" maxlength="60" placeholder="${areas.length ? 'ya da yeni bir alan yaz' : 'Alan adı, örn. Sosyal medya'}" autocomplete="off" value=""></div>
    <p class="form-error" role="alert"></p>
    <div class="sheet-actions"><button class="btn full">${cardId ? 'Projeyi oluştur ve kartı koy' : 'Projeyi oluştur'}</button></div></form>`);
  const b = $('#sheetBody'), f = $('#np', b);
  let area = areas[0] || '';
  $$('#npAreas [data-area]', b).forEach((x) => { x.onclick = () => { area = x.dataset.area; f.area.value = ''; $$('#npAreas [data-area]', b).forEach((y) => y.classList.toggle('chosen', y === x)); }; });
  f.area.oninput = () => { if (f.area.value.trim()) $$('#npAreas [data-area]', b).forEach((y) => y.classList.remove('chosen')); };
  f.name.focus();
  f.onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const p = await store.addProject({ name: f.name.value, area: f.area.value.trim() || area });
      if (cardId) await store.setCardProject(cardId, p.id, true);
      if (after) setTimeout(after, 0);
    }, cardId ? 'Proje oluşturuldu, kart içinde' : 'Proje oluşturuldu');
  };
}

/** Cards attached to a project, for its detail page. */
export function projectCardsHtml(projectId) {
  const list = linkedTo(store.state.cards, { projectId });
  if (!list.length) return '';
  return `<section class="block"><div class="block-head"><h2>Fikirler ve ilham</h2></div><div class="card-row mixed">${list.map(cardHtml).join('')}</div></section>`;
}

export function bindProjectCards(root) {
  $$('[data-open]', root).forEach((b) => { b.onclick = () => openCardSheet(b.dataset.open); });
  bindCardDrag(root);
}

export { closeSheet };
