// Screen router and the shared "selected day".

import { $, $$ } from './dom.js';
import { isoDate } from '../core/time.js';

export const view = { screen: 'home', date: isoDate(Date.now()) };
const renderers = {};

export function register(name, render) { renderers[name] = render; }

export function go(name) {
  view.screen = name;
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === name + 'Screen'));
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.screen === name));
  renderers[name]?.();
  window.scrollTo(0, 0);
}

export function refresh() { renderers[view.screen]?.(); }

export function openDay(iso) { view.date = iso; go('journal'); }

export function bindNav() {
  $$('[data-screen]').forEach((b) => b.addEventListener('click', () => go(b.dataset.screen)));
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  $('#tileJournal').addEventListener('click', () => openDay(isoDate(Date.now())));
}
