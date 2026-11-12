// Home studio: idea post-its, inspiration videos and tutorials. Cards can be dragged onto
// a project or an idea, or moved there from the card's sheet.

import { $, $$, esc, icon, toast, haptic, catColor } from './dom.js';
import * as store from '../core/store.js';
import { parseVideo, hostOf, POSTIT, linkedTo } from '../core/cards.js';
import { ValidationError } from '../core/tracker.js';
import { openSheet, closeSheet, run } from './sheets.js';

let tab = 'idea';
let lastKey = '';
const LABEL = { idea: 'Fikirler', inspire: 'İlham', tuto: 'Tuto' };
const act = (p) => Promise.resolve(p).catch((e) => toast(e instanceof ValidationError ? e.message : 'Kaydedilemedi. Lütfen tekrar dene.'));
const projName = (id) => store.getProject(id)?.name || '';
const ideaText = (c) => (c.title || c.text || '').split('\n')[0];

/** An embedded video, or a plain link card when the link is not a known video. */
export function embedHtml(url, { compact = false } = {}) {
  const v = parseVideo(url);
  if (!v) return url ? `<a class="link-face" href="${esc(url)}" target="_blank" rel="noopener">${icon('next')}<span>${esc(hostOf(url))}</span></a>` : '';
  return `<div class="embed ${v.provider}${compact ? ' compact' : ''}" style="--ratio:${v.ratio}">
    <iframe src="${esc(v.embed)}" loading="lazy" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" title="Video"></iframe></div>`;
}

function linksOf(c) {
  const bits = [];
  if (c.projectId && projName(c.projectId)) bits.push(`<span class="chip"><span class="dot" style="--c:${catColor(store.getProject(c.projectId)?.category)}"></span>${esc(projName(c.projectId))}</span>`);
  const idea = c.ideaId && store.getCard(c.ideaId);
  if (idea) bits.push(`<span class="chip">💡 ${esc(ideaText(idea).slice(0, 24))}</span>`);
  if (c.kind === 'idea') {
    const n = linkedTo(store.state.cards, { ideaId: c.id });
    if (n.length) bits.push(`<span class="chip quiet">${n.filter((x) => x.kind === 'inspire').length} ilham · ${n.filter((x) => x.kind === 'tuto').length} tuto</span>`);
  }
  return bits.length ? `<div class="card-links">${bits.join('')}</div>` : '';
}

function cardHtml(c) {
  const grip = `<span class="grip card-grip" data-drag-card="${c.id}" aria-label="Sürükle">⠿</span>`;
  if (c.kind === 'idea') {
    return `<div class="postit p-${c.color}" data-card="${c.id}">${grip}<button class="postit-body" data-open="${c.id}">
      ${c.title ? `<b>${esc(c.title)}</b>` : ''}<p>${esc(c.text)}</p></button>${linksOf(c)}</div>`;
  }
  return `<div class="vcard ${c.kind}" data-card="${c.id}">${embedHtml(c.url, { compact: true })}
    <div class="vcard-foot">${grip}<button class="vcard-text" data-open="${c.id}">
      ${c.kind === 'tuto' ? `<b>${esc(c.title)}</b>` : (c.title ? `<b>${esc(c.title)}</b>` : `<b class="host">${esc(hostOf(c.url))}</b>`)}
      ${c.text ? `<small>${esc(c.text)}</small>` : ''}</button></div>${linksOf(c)}</div>`;
}

export function renderStudio(force = false) {
  const el = $('#studio');
  if (!el) return;
  const list = store.cardsOf(tab);
  // Iframes reload when re-rendered, so only redraw when something visible changed.
  const key = JSON.stringify([tab, list.map((c) => [c.id, c.updatedAt]), store.state.projects.map((p) => [p.id, p.name]), store.state.cards.length]);
  if (!force && key === lastKey) return;
  lastKey = key;
  const empty = {
    idea: 'Aklına gelen her fikri bir post-it olarak buraya bırak; sonra bir projeye aktarırsın.',
    inspire: 'Etkilendiğin videoların bağlantılarını ekle (YouTube, Instagram, TikTok, Vimeo); kartın üstünde oynar.',
    tuto: 'Öğrenmek istediğin teknikleri kaydet: “Glitch efekti” yaz, nasıl yapıldığını gösteren videonun bağlantısını ekle.',
  }[tab];
  el.innerHTML = `<div class="block-head"><h2>Stüdyo</h2><button class="btn ghost sm" id="studioAdd">＋ ${tab === 'idea' ? 'Fikir' : tab === 'inspire' ? 'İlham' : 'Tuto'}</button></div>
    <div class="segmented" id="studioTabs">${Object.entries(LABEL).map(([k, l]) => `<button data-st="${k}" class="${k === tab ? 'selected' : ''}">${l}${store.cardsOf(k).length ? ` · ${store.cardsOf(k).length}` : ''}</button>`).join('')}</div>
    ${list.length ? `<div class="card-row ${tab}">${list.map(cardHtml).join('')}</div><p class="hint left">Kartı ⠿ tutamağından tutup bir projeye${tab === 'idea' ? '' : ' ya da fikre'} sürükle; dokununca açılır.</p>`
      : `<p class="empty-note">${empty}</p>`}`;
  $$('#studioTabs [data-st]', el).forEach((b) => { b.onclick = () => { tab = b.dataset.st; renderStudio(true); }; });
  $('#studioAdd', el).onclick = () => openCardSheet(null, tab);
  $$('[data-open]', el).forEach((b) => { b.onclick = () => openCardSheet(b.dataset.open); });
  bindCardDrag(el);
}

// ── drag onto a project or an idea ─────────────────────────────────────────
function dropBar(card) {
  const projects = store.state.projects.filter((p) => !p.archived);
  const ideas = card.kind === 'idea' ? [] : store.cardsOf('idea');
  const bar = document.createElement('div');
  bar.className = 'drop-bar';
  bar.innerHTML = `<small>Bırakacağın yer</small><div>${projects.map((p) => `<span class="drop-t" data-drop-project="${p.id}"><span class="dot" style="--c:${catColor(p.category)}"></span>${esc(p.name)}</span>`).join('')}
    ${ideas.map((i) => `<span class="drop-t idea p-${i.color}" data-drop-idea="${i.id}">💡 ${esc(ideaText(i).slice(0, 22))}</span>`).join('')}
    ${projects.length || ideas.length ? '' : '<span class="drop-t empty">Önce Plan’da bir proje ekle</span>'}</div>`;
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
        const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-drop-project],[data-drop-idea]');
        ghost.style.visibility = '';
        if (hot !== under) { hot?.classList.remove('drop-hot'); hot = under; hot?.classList.add('drop-hot'); }
      };
      const end = (ev) => {
        grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', end); grip.removeEventListener('pointercancel', end);
        if (grip.hasPointerCapture(ev.pointerId)) grip.releasePointerCapture(ev.pointerId);
        ghost.remove(); bar.remove();
        if (ev.type !== 'pointerup' || !hot) return;
        haptic(12);
        if (hot.dataset.dropProject) act(moveToProject(card.id, hot.dataset.dropProject));
        else act(store.updateCard(card.id, { ideaId: hot.dataset.dropIdea }).then(() => toast('Fikre bağlandı')));
      };
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
      move(e);
    });
  });
}

function moveToProject(id, projectId) {
  return store.updateCard(id, { projectId }).then(() => toast(`${projName(projectId)} projesine aktarıldı`));
}

// ── sheets ─────────────────────────────────────────────────────────────────
function openCardSheet(id, kind = 'idea') {
  const c = id ? store.getCard(id) : null;
  const k = c ? c.kind : kind;
  const projects = store.state.projects.filter((p) => !p.archived);
  const ideas = store.cardsOf('idea');
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
    <label class="field">Proje<select name="project"><option value="">— proje yok —</option>${projects.map((p) => `<option value="${p.id}"${p.id === c?.projectId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    ${k !== 'idea' && ideas.length ? `<label class="field">Fikir<select name="idea"><option value="">— fikir yok —</option>${ideas.map((i) => `<option value="${i.id}"${i.id === c?.ideaId ? ' selected' : ''}>${esc(ideaText(i).slice(0, 40))}</option>`).join('')}</select></label>` : ''}
    <p class="form-error" role="alert"></p>
    <div class="sheet-actions"><button class="btn full">Kaydet</button>
      ${c && k === 'idea' ? '<button type="button" class="btn ghost full" id="toTask">Seçili projede göreve çevir</button>' : ''}
      ${c && k !== 'idea' && c.url ? `<a class="btn ghost full" href="${esc(c.url)}" target="_blank" rel="noopener">Bağlantıyı aç</a>` : ''}
      ${c ? '<button type="button" class="btn danger full" id="del">Kartı sil</button>' : ''}</div></form>`);
  const b = $('#sheetBody'), f = $('#f', b);
  let color = c?.color || 'yellow';
  $$('#colors [data-color]', b).forEach((x) => { x.onclick = () => { color = x.dataset.color; $$('#colors [data-color]', b).forEach((y) => y.classList.toggle('chosen', y === x)); }; });
  const input = () => ({ kind: k, title: f.title?.value || '', text: f.text?.value || '', url: f.url?.value || '', color, projectId: f.project.value || null, ideaId: f.idea?.value || null });
  f.onsubmit = (e) => { e.preventDefault(); run(() => (c ? store.updateCard(c.id, input()) : store.addCard(input())), 'Kaydedildi'); };
  const tt = $('#toTask', b);
  if (tt) tt.onclick = () => {
    if (!f.project.value) { $('.form-error', b).textContent = 'Önce bir proje seç.'; return; }
    run(() => store.updateCard(c.id, input()).then(() => store.ideaToTask(c.id, f.project.value)), `${projName(f.project.value)} projesine görev olarak eklendi`);
  };
  const del = $('#del', b);
  if (del) del.onclick = () => { if (confirm('Bu kart silinsin mi?')) run(() => store.removeCard(c.id), 'Silindi'); };
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
