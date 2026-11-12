// Studio cards: ideas (post-its), inspiration videos and tutorials. Pure helpers.
//
// Card { id, kind:'idea'|'inspire'|'tuto', title, text, url, color, projectIds:[], links:[cardId],
//        createdAt, updatedAt }
// Links are many-to-many: one idea can use several tutorials, one tutorial can serve several
// ideas, and any card can belong to several projects. A link is stored on one of the two cards
// and read from both sides.

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

const ids = (v) => [...new Set((Array.isArray(v) ? v : []).filter((x) => typeof x === 'string' && x))];

export function newCard({ kind, title = '', text = '', url = '', color = 'yellow', projectIds = [], links = [], projectId = null, ideaId = null }, now = Date.now()) {
  if (!KINDS.includes(kind)) throw new ValidationError('Kart türü geçersiz.');
  const c = { id: uid(), kind, title: clean(title, 120), text: clean(text, 2000), url: cleanUrl(url, kind === 'inspire'),
    color: POSTIT.includes(color) ? color : 'yellow',
    projectIds: ids([...(projectIds || []), projectId]), links: ids([...(links || []), ideaId]), createdAt: now, updatedAt: now };
  if (kind === 'idea' && !c.text && !c.title) throw new ValidationError('Fikrini yaz.');
  if (kind === 'tuto' && !c.title) throw new ValidationError('Neyin tutorial’ı olduğunu yaz (örn. Glitch efekti).');
  return c;
}

/** Bring a stored card up to the current shape (older cards had one projectId / ideaId). */
export function upgradeCard(c) {
  if (Array.isArray(c.projectIds) && Array.isArray(c.links)) return c;
  const { projectId, ideaId, ...rest } = c;
  return { ...rest, projectIds: ids([...(c.projectIds || []), projectId]), links: ids([...(c.links || []), ideaId]) };
}

export function editCard(card, patch, now = Date.now()) {
  const base = upgradeCard(card);
  const next = newCard({ ...base, ...patch, kind: base.kind, projectId: null, ideaId: null }, now);
  return { ...next, id: card.id, createdAt: card.createdAt };
}

/** Ids of every card linked with `id`, from either side. */
export function linksOf(cards, id) {
  const me = cards.find((c) => c.id === id);
  const out = new Set((me?.links || []).filter((x) => x !== id && cards.some((c) => c.id === x)));
  for (const c of cards) if (c.id !== id && (c.links || []).includes(id)) out.add(c.id);
  return [...out];
}

export const areLinked = (cards, a, b) => linksOf(cards, a).includes(b);

/** Cards in a project, or cards linked with a card. */
export const linkedTo = (cards, { projectId, cardId }) => {
  if (projectId) return cards.filter((c) => (c.projectIds || []).includes(projectId));
  const set = new Set(linksOf(cards, cardId));
  return cards.filter((c) => set.has(c.id));
};
