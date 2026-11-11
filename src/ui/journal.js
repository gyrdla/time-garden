// Daily journal page. This is still the v1 page model (HTML objects on a sheet) with its
// bugs fixed and storage moved to IndexedDB. The object canvas with handles, undo/redo
// and layers replaces it in the Journal phase.

import { $, $$, esc, toast, haptic, fmtFullDate, fmtMonth } from './dom.js';
import * as store from '../core/store.js';
import { dayRange, summarize, fmtDur, fromIso, isoDate } from '../core/time.js';
import { view } from './nav.js';

const WASHI = {
  pink: 'repeating-linear-gradient(45deg,#efc5d8 0 5px,#f8e2eb 5px 10px)',
  lilac: 'repeating-linear-gradient(90deg,#cbbbe7 0 5px,#e5daf3 5px 10px)',
  gold: 'repeating-linear-gradient(45deg,#e8d2a6 0 5px,#f6e9c9 5px 10px)',
  mint: 'repeating-linear-gradient(90deg,#b9d6c7 0 5px,#e0eee6 5px 10px)',
};
const SVG_NS = 'http://www.w3.org/2000/svg';

let selected = null, drawMode = false, drawing = null, drawSvg = null, saveTimer = 0, loadedDate = null;
const bound = new WeakSet();

// ── persistence ─────────────────────────────────────────────────────────────
function sanitize(html) {
  const t = document.createElement('template');
  t.innerHTML = html || '';
  t.content.querySelectorAll('script,iframe,object,embed,link,style').forEach((n) => n.remove());
  t.content.querySelectorAll('*').forEach((n) => {
    for (const a of [...n.attributes]) if (/^on/i.test(a.name) || (a.name === 'src' && !/^data:image\//i.test(a.value))) n.removeAttribute(a.name);
  });
  return t.innerHTML;
}

function snapshot() {
  const clone = $('#canvasItems').cloneNode(true);
  clone.querySelectorAll('.selected').forEach((n) => n.classList.remove('selected'));
  clone.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
  const draw = drawSvg.cloneNode(true);
  draw.querySelectorAll('.selected').forEach((n) => n.classList.remove('selected'));
  return { note: $('#journalNote').value, items: clone.innerHTML.trim(), draw: draw.innerHTML.trim() };
}

function savePage() {
  clearTimeout(saveTimer);
  if (!loadedDate) return Promise.resolve();
  $('#saveState').textContent = '…';
  return store.savePage(loadedDate, snapshot())
    .then(() => { $('#saveState').textContent = 'Kaydedildi'; })
    .catch(() => { $('#saveState').textContent = 'Kaydedilemedi'; toast('Sayfa kaydedilemedi. Depolama dolu olabilir.'); });
}
const saveSoon = () => { clearTimeout(saveTimer); $('#saveState').textContent = '…'; saveTimer = setTimeout(savePage, 500); };

export function renderJournal() {
  if (loadedDate && loadedDate !== view.date) savePage();
  const date = view.date, ts = fromIso(date), page = store.getPage(date) || {};
  loadedDate = date;
  $('#journalDate').textContent = fmtFullDate(ts);
  const sum = summarize(store.state.sessions, store.state.events, dayRange(ts), Date.now());
  $('#journalTime').textContent = sum.uniqueMs ? `${fmtDur(sum.uniqueMs)} kayıtlı zaman` : 'Bu gün için zaman kaydı yok';
  $('#paperDate').textContent = new Date(ts).getDate();
  $('#paperMonth').textContent = fmtMonth(ts);
  $('#journalNote').value = page.note || '';
  $('#canvasItems').innerHTML = sanitize(page.items);
  drawSvg.innerHTML = sanitize(page.draw);
  drawSvg.querySelectorAll('path').forEach(bindStroke);
  $$('#canvasItems .placed').forEach(enableDrag);
  select(null);
  $('#saveState').textContent = '';
}

function changeDay(n) {
  savePage();
  const d = new Date(fromIso(view.date)); d.setDate(d.getDate() + n);
  view.date = isoDate(d.getTime());
  renderJournal();
}

// ── objects ─────────────────────────────────────────────────────────────────
function select(el) {
  if (selected && selected !== el) { selected.classList.remove('selected'); if (selected.isContentEditable) selected.contentEditable = 'false'; }
  selected = el;
  if (el) el.classList.add('selected');
  $('#objectToolbar').hidden = !el;
}

function addPlaced(markup) {
  $('#canvasItems').insertAdjacentHTML('beforeend', markup);
  const el = $('#canvasItems').lastElementChild;
  enableDrag(el); select(el); savePage();
  return el;
}

function enableDrag(el) {
  if (bound.has(el)) return;
  bound.add(el);
  let sx, sy, ox, oy, moved = false;
  el.addEventListener('pointerdown', (e) => {
    if (drawMode || el.isContentEditable) return;
    e.stopPropagation(); select(el);
    const p = el.parentElement.getBoundingClientRect();
    sx = e.clientX; sy = e.clientY; ox = el.offsetLeft; oy = el.offsetTop; moved = false;
    el.setPointerCapture(e.pointerId);
    void p;
  });
  el.addEventListener('pointermove', (e) => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    const p = el.parentElement;
    moved = true;
    el.style.left = Math.max(-10, Math.min(p.clientWidth - 20, ox + e.clientX - sx)) + 'px';
    el.style.top = Math.max(-10, Math.min(p.clientHeight - 20, oy + e.clientY - sy)) + 'px';
  });
  const end = (e) => { if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId); if (moved) savePage(); };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', () => editSelected());
  el.addEventListener('blur', () => { if (el.isContentEditable) { el.contentEditable = 'false'; savePage(); } });
}

function scaleSelected(f) {
  const el = selected;
  if (!el) return;
  if (el.tagName.toLowerCase() === 'path') {
    el.setAttribute('stroke-width', Math.max(1, Number(el.getAttribute('stroke-width') || 2.5) * f).toFixed(2));
  } else if (el.matches('.sticker,.text,.decor-dots')) {
    const size = parseFloat(getComputedStyle(el).fontSize);
    el.style.fontSize = Math.max(10, Math.min(160, size * f)).toFixed(1) + 'px';
    if (el.matches('.text')) el.style.maxWidth = 'none';
  } else {
    const w = el.offsetWidth;
    el.style.width = Math.max(24, w * f) + 'px';
    if (el.tagName === 'IMG') el.style.height = 'auto'; else if (!el.matches('.washi-object,.decor-line')) el.style.height = Math.max(15, el.offsetHeight * f) + 'px';
  }
  savePage();
}

function editSelected() {
  if (selected?.classList.contains('text')) {
    selected.contentEditable = 'true';
    selected.focus();
    const r = document.createRange(); r.selectNodeContents(selected);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  } else if (selected) toast('Bu nesnede düzenlenecek metin yok.');
}

function addPhoto(file) {
  if (!file || !file.type.startsWith('image/')) return toast('Lütfen bir görsel seç.');
  const url = URL.createObjectURL(file), im = new Image();
  im.onload = () => {
    // Downscale so a page stays small; originals are not kept yet.
    const k = Math.min(1, 1200 / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    addPlaced(`<img class="placed photo" src="${c.toDataURL('image/jpeg', 0.85)}" alt="" style="left:44%;top:6%">`);
  };
  im.onerror = () => { URL.revokeObjectURL(url); toast('Görsel okunamadı.'); };
  im.src = url;
}

// ── freehand drawing ────────────────────────────────────────────────────────
function bindStroke(path) {
  if (bound.has(path)) return;
  bound.add(path);
  let sx = 0, sy = 0, moved = false;
  path.addEventListener('pointerdown', (e) => { if (drawMode) return; e.stopPropagation(); select(path); sx = e.clientX; sy = e.clientY; moved = false; path.setPointerCapture(e.pointerId); });
  path.addEventListener('pointermove', (e) => {
    if (drawMode || !path.hasPointerCapture(e.pointerId)) return;
    const [tx0, ty0] = (path.dataset.shift || '0,0').split(',').map(Number);
    const tx = tx0 + e.clientX - sx, ty = ty0 + e.clientY - sy;
    path.dataset.shift = `${tx},${ty}`; path.style.transform = `translate(${tx}px,${ty}px)`;
    sx = e.clientX; sy = e.clientY; moved = true;
  });
  path.addEventListener('pointerup', (e) => { if (path.hasPointerCapture(e.pointerId)) path.releasePointerCapture(e.pointerId); if (moved) savePage(); });
}

function setupDrawing() {
  drawSvg = document.createElementNS(SVG_NS, 'svg');
  drawSvg.id = 'drawOverlay';
  drawSvg.setAttribute('viewBox', '0 0 320 360');
  drawSvg.setAttribute('preserveAspectRatio', 'none');
  $('#paperContent').appendChild(drawSvg);
  const pos = (e) => { const r = drawSvg.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * 320, ((e.clientY - r.top) / r.height) * 360]; };
  drawSvg.addEventListener('pointerdown', (e) => {
    if (!drawMode) return;
    const [x, y] = pos(e);
    drawing = document.createElementNS(SVG_NS, 'path');
    drawing.setAttribute('d', `M ${x.toFixed(1)} ${y.toFixed(1)}`);
    for (const [k, v] of Object.entries({ fill: 'none', stroke: '#a778a7', 'stroke-width': '2.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) drawing.setAttribute(k, v);
    drawSvg.appendChild(drawing);
    drawSvg.setPointerCapture(e.pointerId);
  });
  drawSvg.addEventListener('pointermove', (e) => { if (!drawing) return; const [x, y] = pos(e); drawing.setAttribute('d', drawing.getAttribute('d') + ` L ${x.toFixed(1)} ${y.toFixed(1)}`); });
  for (const ev of ['pointerup', 'pointercancel']) drawSvg.addEventListener(ev, () => { if (drawing) { bindStroke(drawing); drawing = null; savePage(); } });
  $('#drawToggle').onclick = () => {
    drawMode = !drawMode;
    drawSvg.classList.toggle('drawing', drawMode);
    $('#drawToggle').classList.toggle('on', drawMode);
    select(null);
    toast(drawMode ? 'El yazısı açık: sayfaya parmağınla çiz' : 'El yazısı kapalı');
  };
}

// ── tear-off gesture ────────────────────────────────────────────────────────
function setupTear() {
  const handle = $('#tearHandle'), paper = $('#paper');
  const THRESHOLD = 110;
  let startY = null, dy = 0, dragged = false, armed = false;
  const pose = (y) => {
    const k = Math.min(1, -y / 320);
    paper.style.transform = `perspective(900px) translateY(${y}px) rotateX(${(k * 34).toFixed(1)}deg) rotate(${(k * -2.5).toFixed(2)}deg)`;
    paper.style.boxShadow = `0 ${12 + k * 46}px ${18 + k * 50}px rgba(110,80,110,${(0.14 + k * 0.2).toFixed(2)})`;
  };
  const reset = () => { paper.style.transition = 'transform .32s cubic-bezier(.2,.7,.2,1), box-shadow .32s'; paper.style.transform = ''; paper.style.boxShadow = ''; setTimeout(() => { paper.style.transition = ''; }, 340); };
  const tear = () => {
    savePage();
    haptic(30);
    paper.style.transition = 'transform .42s cubic-bezier(.5,0,.9,.4), opacity .42s';
    paper.style.transform = 'perspective(900px) translateY(-120vh) rotateX(50deg) rotate(-9deg)';
    paper.style.opacity = '0';
    setTimeout(() => {
      changeDay(1);
      paper.style.transition = 'none'; paper.style.transform = 'translateY(14px) scale(.985)'; paper.style.opacity = '0'; paper.style.boxShadow = '';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        paper.style.transition = 'transform .3s cubic-bezier(.2,.7,.2,1), opacity .3s'; paper.style.transform = ''; paper.style.opacity = '';
        setTimeout(() => { paper.style.transition = ''; }, 320);
      }));
      toast('Yaprak koptu · yeni günün sayfası');
    }, 430);
  };
  handle.addEventListener('pointerdown', (e) => { startY = e.clientY; dy = 0; dragged = false; armed = false; paper.style.transition = 'none'; handle.setPointerCapture(e.pointerId); });
  handle.addEventListener('pointermove', (e) => {
    if (startY == null) return;
    dy = Math.min(0, e.clientY - startY);
    if (dy < -6) dragged = true;
    pose(dy);
    const now = dy < -THRESHOLD;
    if (now !== armed) { armed = now; handle.classList.toggle('armed', armed); if (armed) haptic(8); }
  });
  const up = (e) => {
    if (startY == null) return;
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
    startY = null; handle.classList.remove('armed');
    if (e.type === 'pointerup' && dy < -THRESHOLD) tear(); else reset();
  };
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', up);
  // Keyboard / plain tap fallback: a tap without drag does not tear by accident; Enter does.
  handle.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tear(); } });
  handle.addEventListener('click', () => { if (!dragged) toast('Koparmak için tutup yukarı sürükle'); });
}

// ── Sticker Atelier (v1 composition; no background removal, emoji or GIF yet) ──
function setupStudio() {
  const canvas = $('#stickerCanvas'), ctx = canvas.getContext('2d');
  const styles = { pink: ['#d88eb6', '#efbfd6'], moon: ['#9588c5', '#c9bde9'], botanical: ['#799c83', '#b9d2bd'], pixel: ['#8175b7', '#bcb4e7'], lilac: ['#a48bc6', '#d3c2e9'] };
  let image = null, dataUrl = null;
  const draw = () => {
    if (!image) return;
    const [accent, tape] = styles[$('#stickerStyle').value] || styles.pink;
    ctx.clearRect(0, 0, 480, 480);
    ctx.save(); ctx.shadowColor = 'rgba(70,45,70,.18)'; ctx.shadowBlur = 18; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(45, 35, 390, 410, 42); ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(240, 75); ctx.rotate(-0.035); ctx.fillStyle = tape; ctx.fillRect(-112, -14, 224, 28); ctx.restore();
    const k = Math.min(330 / image.naturalWidth, 270 / image.naturalHeight), w = image.naturalWidth * k, h = image.naturalHeight * k, x = (480 - w) / 2, y = 220 - h / 2;
    ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, 18); ctx.clip(); ctx.drawImage(image, x, y, w, h); ctx.restore();
    ctx.fillStyle = accent; ctx.font = 'bold 28px sans-serif'; ctx.textAlign = 'center'; ctx.fillText($('#stickerEmoji').value || '✧', 240, 395);
    dataUrl = canvas.toDataURL('image/png');
    $('#saveSticker').disabled = false;
    $('#studioHint').textContent = 'Önizleme hazır.';
  };
  $('#openStudio').onclick = () => { $('#studioModal').hidden = false; };
  $('#closeStudio').onclick = () => { $('#studioModal').hidden = true; };
  $('#studioModal').addEventListener('click', (e) => { if (e.target.id === 'studioModal') $('#studioModal').hidden = true; });
  $('#studioPhoto').onchange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast('Lütfen bir görsel seç.');
    const url = URL.createObjectURL(f), im = new Image();
    im.onload = () => { image = im; draw(); URL.revokeObjectURL(url); };
    im.src = url;
  };
  $('#stickerStyle').onchange = draw;
  $('#stickerEmoji').oninput = draw;
  $('#makeSticker').onclick = () => { if (!image) return toast('Önce fotoğraf seçmelisin.'); draw(); };
  $('#saveSticker').onclick = () => {
    if (!dataUrl) return;
    const a = document.createElement('a'); a.href = dataUrl; a.download = `time-garden-${$('#stickerStyle').value}-sticker.png`; a.click();
    addPlaced(`<img class="placed photo-sticker" src="${dataUrl}" alt="" style="left:28%;top:22%;width:44%">`);
    $('#studioModal').hidden = true;
    toast('Çıkartma indirildi ve sayfaya eklendi');
  };
}

export function bindJournal() {
  setupDrawing(); setupTear(); setupStudio();
  $('#prevDay').onclick = () => changeDay(-1);
  $('#nextDay').onclick = () => changeDay(1);
  $('#journalNote').addEventListener('input', saveSoon);
  $('#photoInput').onchange = (e) => { addPhoto(e.target.files[0]); e.target.value = ''; };
  $('#addText').onclick = () => { addPlaced('<div class="placed text" style="left:12%;top:42%">Yeni not</div>'); editSelected(); };
  $('#stickerToggle').onclick = () => { $('#stickerTray').hidden = !$('#stickerTray').hidden; $('#decorTray').hidden = true; };
  $('#decorToggle').onclick = () => { $('#decorTray').hidden = !$('#decorTray').hidden; $('#stickerTray').hidden = true; };
  $$('[data-sticker]').forEach((b) => { b.onclick = () => addPlaced(`<div class="placed sticker" style="left:60%;top:55%">${esc(b.dataset.sticker)}</div>`); });
  $$('[data-washi]').forEach((b) => { b.onclick = () => addPlaced(`<div class="placed washi-object" style="left:8%;top:2%;width:84%;height:16px;background:${WASHI[b.dataset.washi]}"></div>`); });
  $$('[data-decor]').forEach((b) => {
    b.onclick = () => addPlaced({
      line: '<div class="placed decor-line" style="left:12%;top:40%;width:72%"></div>',
      dots: '<div class="placed decor-dots" style="left:20%;top:50%">• · • · • · •</div>',
      star: '<div class="placed sticker" style="left:45%;top:45%">✧</div>',
      tape: `<div class="placed washi-object" style="left:10%;top:15%;width:80%;height:18px;background:${WASHI.pink}"></div>`,
    }[b.dataset.decor]);
  });
  $('#objectDelete').onclick = () => { if (selected) { selected.remove(); select(null); savePage(); } };
  $('#objectBigger').onclick = () => scaleSelected(1.15);
  $('#objectSmaller').onclick = () => scaleSelected(0.87);
  $('#objectRotate').onclick = () => {
    if (!selected || selected.tagName.toLowerCase() === 'path') return;
    const r = (Number(selected.dataset.rotation || 0) + 15) % 360;
    selected.dataset.rotation = r; selected.style.transform = `rotate(${r}deg)`; savePage();
  };
  $('#objectEdit').onclick = editSelected;
  $('#objectFront').onclick = () => { if (selected) { selected.parentElement.appendChild(selected); savePage(); } };
  $('#objectBack').onclick = () => { if (selected) { selected.parentElement.insertBefore(selected, selected.parentElement.firstChild); savePage(); } };
  $('#paper').addEventListener('pointerdown', (e) => { if (!e.target.closest('.placed, #drawOverlay path')) select(null); });
  // Never lose a pending note when the app is backgrounded or closed.
  document.addEventListener('visibilitychange', () => { if (document.hidden && loadedDate) savePage(); });
  window.addEventListener('pagehide', () => { if (loadedDate) savePage(); });
}
