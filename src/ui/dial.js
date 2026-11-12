// 24-hour dial: outer ring = primary activities, inner ring = secondary (overlapping) events.

import { clipAll, sessionActive, eventInterval, clip } from '../core/time.js';
import { catColor } from './dom.js';

const C = 120, R_OUT = 96, R_IN = 78, W_OUT = 18, W_IN = 7;

function pt(r, frac) {
  const a = frac * 2 * Math.PI - Math.PI / 2;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}

function arc(r, f0, f1) {
  const span = Math.min(f1 - f0, 0.9999);
  const [x0, y0] = pt(r, f0), [x1, y1] = pt(r, f0 + span);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${span > 0.5 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export function renderDial(svg, sessions, events, range, now) {
  const len = range[1] - range[0];
  const f = (t) => (t - range[0]) / len;
  let out = `<circle class="track" cx="${C}" cy="${C}" r="${R_OUT}" stroke-width="${W_OUT}"/>`
    + `<circle class="track" cx="${C}" cy="${C}" r="${R_IN}" stroke-width="${W_IN}" opacity=".6"/>`;
  for (const s of sessions) {
    for (const [a, b] of clipAll(sessionActive(s, now), range)) {
      out += `<path d="${arc(R_OUT, f(a), f(b))}" fill="none" stroke="${catColor(s.category)}" stroke-width="${W_OUT}"/>`;
    }
  }
  for (const e of events) {
    const iv = eventInterval(e, now), c = iv && clip(iv, range);
    if (c) out += `<path d="${arc(R_IN, f(c[0]), f(c[1]))}" fill="none" stroke="var(--secondary)" stroke-width="${W_IN}" opacity="${e.attention === 'background' ? 0.4 : 0.95}"/>`;
  }
  for (let h = 0; h < 24; h++) {
    const [x0, y0] = pt(R_OUT + W_OUT / 2 + 2, h / 24), [x1, y1] = pt(R_OUT + W_OUT / 2 + (h % 6 ? 4 : 6), h / 24);
    out += `<line class="tick" x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}"/>`;
  }
  for (const h of [0, 6, 12, 18]) {
    const [x, y] = pt(R_OUT + W_OUT / 2 + 12, h / 24);
    out += `<text class="hour" x="${x.toFixed(1)}" y="${y.toFixed(1)}">${String(h).padStart(2, '0')}</text>`;
  }
  if (now >= range[0] && now < range[1]) {
    const [x0, y0] = pt(R_IN - 8, f(now)), [x1, y1] = pt(R_OUT + W_OUT / 2 + 1, f(now));
    out += `<line class="now" x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}"/>`;
  }
  svg.setAttribute('viewBox', '-14 -14 268 268');
  svg.innerHTML = out;
}

/**
 * Plan dial: the day as a 24-hour clock. Planned items sit on the outer band — items that
 * overlap share the band as concentric rings — and measured time is the thin inner ring.
 * items: output of planner.layout() with a `color`; actual: [{ iv:[start,end], color }].
 */
export function renderPlanDial(svg, items, actual, range, now) {
  const len = range[1] - range[0];
  const f = (t) => Math.max(0, Math.min(1, (t - range[0]) / len));
  const OUT = 106, IN = 68, band = OUT - IN, REAL = 56;
  let out = `<circle class="track" cx="${C}" cy="${C}" r="${(OUT + IN) / 2}" stroke-width="${band}"/>`
    + `<circle class="track" cx="${C}" cy="${C}" r="${REAL}" stroke-width="7" opacity=".6"/>`;
  for (const i of items) {
    const w = band / i.cols, r = OUT - w * (i.col + 0.5);
    const a = f(i.start), b = Math.max(f(i.end), a + 0.004);
    out += `<path class="pd-item${i.done ? ' done' : ''}${i.parallel ? ' par' : ''}" data-kind="${i.kind}" data-id="${i.id}" data-slot="${i.slot || 0}" data-col="${i.col}" data-cols="${i.cols}"
      d="${arc(r, a, b)}" fill="none" stroke="${i.color}" stroke-width="${(w - 1.5).toFixed(1)}"><title>${i.label}</title></path>`;
  }
  for (const a of actual) out += `<path class="pd-real" d="${arc(REAL, f(a.iv[0]), Math.max(f(a.iv[1]), f(a.iv[0]) + 0.003))}" fill="none" stroke="${a.color}" stroke-width="7"/>`;
  for (let h = 0; h < 24; h++) {
    const [x0, y0] = pt(OUT + 2, h / 24), [x1, y1] = pt(OUT + (h % 3 ? 4 : 7), h / 24);
    out += `<line class="tick" x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}"/>`;
  }
  for (let h = 0; h < 24; h += 3) {
    const [x, y] = pt(OUT + 16, h / 24);
    out += `<text class="hour" x="${x.toFixed(1)}" y="${y.toFixed(1)}">${String(h).padStart(2, '0')}</text>`;
  }
  if (now >= range[0] && now < range[1]) {
    const [x0, y0] = pt(REAL - 8, f(now)), [x1, y1] = pt(OUT + 3, f(now));
    out += `<line class="now" x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}"/>`;
  }
  svg.setAttribute('viewBox', '-18 -18 276 276');
  svg.innerHTML = out;
}
