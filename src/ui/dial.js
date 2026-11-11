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
