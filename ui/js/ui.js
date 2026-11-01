// Small shared UI helpers. Views render with template strings; esc() everything that came from data.
import { paintDogs, SFX } from './brand.js';

const MAP = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => MAP[c]);

export const launchbar = () => '<div class="launchbar" aria-label="Loading">' + Array.from({ length:10 }, (_, i) => `<i style="--i:${i}"></i>`).join('') + '</div>';
// Typing keeps its keys; every other control takes the console keys.
export const isTextEntry = t => !!t && (t.isContentEditable || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !/^(checkbox|radio|color|range|button)$/.test(t.type)));
// One Rommel per screen: a state hands its pose to the header dog through data-rest. action is optional button HTML.
export function stateBlock(pose, title, text, action = ''){
  return `<div class="state" data-rest="${pose}"><b>${esc(title)}</b><span>${esc(text)}</span>${action}</div>`;
}
export const loadingBlock = text => `<div class="state">${launchbar()}<span>${esc(text)}</span></div>`;
// Set innerHTML and paint any Rommel inside.
export function fill(el, markup){ el.innerHTML = markup; if (markup.includes('data-pose')) paintDogs(el); }

// Modal sheet. build(body, close) fills it; resolves with close(value). Temporary tasks only: workspaces stay in the shell.
export function sheet(title, build, { wide = false } = {}){
  return new Promise(resolve => {
    const d = document.createElement('dialog'); if (wide) d.className = 'wide';
    d.innerHTML = `<h2>${esc(title)}</h2><div class="sheet-body"></div>`;
    document.body.appendChild(d);
    let result; const close = v => { result = v; d.close(); };
    d.addEventListener('close', () => { d.remove(); if (result === undefined) SFX.back(); resolve(result); }); // a sheet that returned a value was confirmed, not backed out of
    build(d.querySelector('.sheet-body'), close);
    d.showModal();
    if (!isTextEntry(document.activeElement)){ const h = d.querySelector('h2'); h.tabIndex = -1; h.focus(); } // a focused select would change value on the first arrow key
  });
}
export const confirmSheet = (title, text, label, danger = true, cancelLabel = 'Keep it') => sheet(title, (b, close) => {
  b.innerHTML = `<p>${esc(text)}</p><div class="sheet-actions"><button class="btn" type="button" data-no data-sfx="back">${esc(cancelLabel)}</button><button class="btn ${danger ? 'danger' : 'primary'}" type="button" data-yes>${danger ? '' : '<span class="glyph">A</span>'}${esc(label)}</button></div>`;
  b.querySelector('[data-no]').onclick = () => close(false);
  b.querySelector('[data-yes]').onclick = () => close(true);
});

// Shown in Settings so no control is secret.
export const SHORTCUTS = [['L or R', 'Previous or next tab'], ['1 2 3', 'Today, Brief, Command'], ['Arrows', 'Move'], ['A or Enter', 'Open'], ['B or Esc', 'Back']];

let dropMenu = null;
export const closeMenu = () => dropMenu?.();
// Dropdown at an anchor. items: [{ label, run, danger }]
export function menu(anchor, items){
  closeMenu();
  const m = document.createElement('div'); m.className = 'menu'; m.setAttribute('role', 'menu');
  items.forEach(it => { const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.textContent = it.label; if (it.danger) b.className = 'danger-text'; b.onclick = () => { closeMenu(); it.run(); }; m.appendChild(b); });
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.top = Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8) + 'px';
  m.style.left = Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8)) + 'px';
  m.querySelector('button')?.focus();
  const off = e => { if (e.type === 'keydown' ? e.key === 'Escape' : !m.contains(e.target)){ if (e.type === 'keydown'){ e.stopPropagation(); SFX.back(); } closeMenu(); } };
  dropMenu = () => { dropMenu = null; m.remove(); document.removeEventListener('pointerdown', off, true); document.removeEventListener('keydown', off, true); anchor.focus(); };
  document.addEventListener('pointerdown', off, true); document.addEventListener('keydown', off, true);
}
