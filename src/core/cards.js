// Studio cards: ideas (post-its), inspiration videos and tutorials. Pure helpers.
//
// Card { id, kind:'idea'|'inspire'|'tuto', title, text, url, color, projectId|null, ideaId|null,
//        createdAt, updatedAt }
// A card can be linked to a project, and inspiration / tutorial cards also to an idea.

import { uid, ValidationError } from './tracker.js';

export const KINDS = ['idea', 'inspire', 'tuto'];
export const POSTIT = ['yellow', 'pink', 'lilac', 'mint', 'sky'];

const clean = (v, n) => String(v ?? '').trim().slice(0, n);

/** Recognise a video link and return how to embed it; null for anything else. */
export function parseVideo(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.replace(/^(www|m|mobile)\./, '');
  const seg = u.pathname.split('/').filter(Boolean);
  const ok = (id) => /^[\w-]{4,64}$/.test(id || '');
  if (host === 'youtu.be' && ok(seg[0])) return yt(seg[0], false);
  if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
    if (seg[0] === 'watch' && ok(u.searchParams.get('v'))) return yt(u.searchParams.get('v'), false);
    if (['shorts', 'embed', 'live', 'v'].includes(seg[0]) && ok(seg[1])) return yt(seg[1], seg[0] === 'shorts');
  }
  if (host === 'vimeo.com' && /^\d+$/.test(seg[0] || '')) return { provider: 'vimeo', id: seg[0], embed: `https://player.vimeo.com/video/${seg[0]}`, ratio: 16 / 9 };
  if (host === 'tiktok.com') {
    const i = seg.indexOf('video');
    if (i >= 0 && /^\d+$/.test(seg[i + 1] || '')) return { provider: 'tiktok', id: seg[i + 1], embed: `https://www.tiktok.com/embed/v2/${seg[i + 1]}`, ratio: 9 / 16 };
  }
  if (host === 'instagram.com' && ['p', 'reel', 'reels', 'tv'].includes(seg[0]) && ok(seg[1])) {
    const type = seg[0] === 'p' ? 'p' : 'reel';
    return { provider: 'instagram', id: seg[1], embed: `https://www.instagram.com/${type}/${seg[1]}/embed`, ratio: type === 'p' ? 4 / 5 : 9 / 16 };
  }
  return null;
}

function yt(id, short) {
  return { provider: 'youtube', id, embed: `https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0`, ratio: short ? 9 / 16 : 16 / 9, thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function cleanUrl(url, required) {
  const s = clean(url, 600);
  if (!s) { if (required) throw new ValidationError('Bir bağlantı yapıştır.'); return ''; }
  let u;
  try { u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`); } catch { throw new ValidationError('Bağlantı geçersiz.'); }
  if (!/^https?:$/.test(u.protocol)) throw new ValidationError('Bağlantı geçersiz.');
  return u.href;
}

export function newCard({ kind, title = '', text = '', url = '', color = 'yellow', projectId = null, ideaId = null }, now = Date.now()) {
  if (!KINDS.includes(kind)) throw new ValidationError('Kart türü geçersiz.');
  const c = { id: uid(), kind, title: clean(title, 120), text: clean(text, 2000), url: cleanUrl(url, kind === 'inspire'),
    color: POSTIT.includes(color) ? color : 'yellow', projectId: projectId || null, ideaId: kind === 'idea' ? null : (ideaId || null), createdAt: now, updatedAt: now };
  if (kind === 'idea' && !c.text && !c.title) throw new ValidationError('Fikrini yaz.');
  if (kind === 'tuto' && !c.title) throw new ValidationError('Neyin tutorial’ı olduğunu yaz (örn. Glitch efekti).');
  return c;
}

export function editCard(card, patch, now = Date.now()) {
  const merged = { ...card, ...patch, kind: card.kind };
  const next = newCard(merged, now);
  return { ...next, id: card.id, createdAt: card.createdAt };
}

/** Cards attached to a project or to an idea. */
export const linkedTo = (cards, { projectId, ideaId }) =>
  cards.filter((c) => (projectId && c.projectId === projectId) || (ideaId && c.ideaId === ideaId));
