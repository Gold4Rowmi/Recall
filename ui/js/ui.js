// Small shared UI helpers. Views render with template strings; esc() everything that came from data.
import { paintDogs, SFX, bonk, calm } from './brand.js';

const MAP = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => MAP[c]);

export const icon = (name, size = 16) => `<svg class="px" width="${size}" height="${size}" aria-hidden="true"><use href="vendor/icons-sprite.svg#i-${name}"/></svg>`;
export const launchbar = () => '<div class="launchbar" aria-label="Loading">' + Array.from({ length:10 }, (_, i) => `<i style="--i:${i}"></i>`).join('') + '</div>';
// Typing keeps its keys; every other control takes the console keys.
export const isTextEntry = t => !!t && (t.isContentEditable || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !/^(checkbox|radio|color|range|button)$/.test(t.type)));
// What the arrows and the selection brackets can land on.
export const ITEMS = 'button:not(:disabled), a[href], [role="button"], input:not([type="hidden"]), select, textarea';
export function slide(el, dx){ // a page comes in from the side you moved toward
  if (!calm()) el.animate([{ transform:`translateX(${dx}px)`, opacity:0 }, { transform:'none', opacity:1 }], { duration:260, easing:'cubic-bezier(.2,.8,.2,1)' });
}
export const backBtn = (label = 'Close', attrs = 'data-close') => `<button class="btn ghost" type="button" data-sfx="back" ${attrs}><span class="glyph">B</span>${esc(label)}</button>`;
// Rommel carries a state; the header dog stays Idle, so there's one per screen. action is optional button HTML.
export function stateBlock(pose, title, text, action = ''){
  return `<div class="state"><svg class="px" width="60" height="60" viewBox="0 0 10 10" data-pose="${pose}" aria-hidden="true"></svg><b>${esc(title)}</b><span>${esc(text)}</span>${action}</div>`;
}
// Shows after 400 ms; past 10 s it adds a percent and a Cancel, both timed in CSS.
export const loadingBlock = text => `<div class="state loading">${launchbar()}<span>${esc(text)}</span><span class="late"><span hidden><span data-pct>0</span>% done</span>${backBtn('Cancel', 'data-cancel-load')}</span></div>`;
document.addEventListener('click', e => { const s = e.target.closest('[data-cancel-load]')?.closest('.state'); if (s){ s.classList.remove('loading'); s.innerHTML = '<b>Stopped waiting</b><span>Your work is safe. It shows up here once it arrives.</span>'; } });
export const toggle = (label, on, attrs = '') => `<button class="toggle" type="button" role="switch" aria-checked="${!!on}" ${attrs}><span class="track"><span class="knob"></span></span>${esc(label)}</button>`;
export const isOn = el => el.getAttribute('aria-checked') === 'true';
document.addEventListener('click', e => { const t = e.target.closest('.toggle'); if (t) t.setAttribute('aria-checked', !isOn(t)); }, true); // first, so a handler reads the new value
// Says what's wrong under the field itself, until the field is edited.
let errs = 0;
export function fieldErr(input, msg){
  const f = input.closest('.field'), h = document.createElement('span');
  f.querySelector('[id^="err-"]')?.remove(); f.classList.add('err');
  h.className = 'help'; h.id = 'err-' + ++errs; h.textContent = msg; f.appendChild(h);
  bonk(input); input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', h.id);
  const set = input.matches('fieldset'); (set ? input.querySelector('button') : input).focus(); // a group of switches fires no input event
  input.addEventListener(set ? 'click' : 'input', () => { f.classList.remove('err'); input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); h.remove(); }, { once:true });
}
// Numbers sit on tape strips, so a change can roll like a counter.
const STRIP = Array.from({ length:10 }, (_, i) => `<span>${i}</span>`).join('');
export const rollDigits = v => [...String(v)].map(c => /\d/.test(c) ? `<span class="dg" aria-hidden="true"><span class="strip" style="transform:translateY(-${c}em)">${STRIP}</span></span>` : `<span aria-hidden="true">${esc(c)}</span>`).join('');
export function fillRolling(el, markup){ const was = [...el.querySelectorAll('[data-roll]')].map(m => m.dataset.roll); fill(el, markup); if (calm()) return;
  let ticks = 0; // one detent per digit that rolled, kept to a few
  el.querySelectorAll('[data-roll]').forEach((m, i) => { if (was[i] === undefined || was[i] === m.dataset.roll) return; const to = m.dataset.roll.replace(/\D/g, ''), from = was[i].replace(/\D/g, '').padStart(to.length, '0').slice(-to.length);
    m.querySelectorAll('.strip').forEach((s, j) => { if (from[j] !== to[j]){ s.animate([{ transform:`translateY(-${from[j]}em)` }, { transform:`translateY(-${to[j]}em)` }], { duration:220, easing:'cubic-bezier(.2,.8,.2,1)' }); if (ticks < 3 && !document.hidden) setTimeout(SFX.detent, ticks++ * 70, 4); } }); }); }
// Set innerHTML and paint any Rommel inside.
export function fill(el, markup){ el.innerHTML = markup; if (markup.includes('data-pose')) paintDogs(el); }

// Modal sheet. build(body, close) fills it; resolves with close(value). Temporary tasks only: workspaces stay in the shell.
export function sheet(title, build, { wide = false, work = false } = {}){
  return new Promise(resolve => {
    const d = document.createElement('dialog'); d.className = wide ? 'wide' : work ? 'work' : '';
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
  if (danger) SFX.grr();
  b.innerHTML = `<p>${esc(text)}</p><div class="sheet-actions">${backBtn(cancelLabel, 'data-no')}<button class="btn ${danger ? 'danger' : 'primary'}" type="button" data-yes><span class="glyph">${danger ? 'X' : 'A'}</span>${esc(label)}</button></div>`;
  b.querySelector('[data-no]').onclick = () => close(false);
  b.querySelector('[data-yes]').onclick = () => close(true);
});

// Shown in Settings so no control is secret.
export const SHORTCUTS = [['L or R', 'Previous or next tab'], ['Ctrl + Tab', 'Next tab, desktop app only'], ['1 2 3', 'Today, Brief, Command'], ['Arrows', 'Move the selection'], ['A or Enter', 'Open'], ['B or Esc', 'Back'],
  ['X, Del or Space', 'Delete or more options for the selected item'], ['Ctrl + Z', 'Undo, while its message is showing'], ['Y or Ctrl + ,', 'Settings'], ['Controller', 'A B X Y, D-pad or stick, shoulders for tabs, Start for New block']];

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
