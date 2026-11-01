// Selection: four blue brackets on what A will act on. Keyboard and controller only; a mouse press puts them away.
import { ITEMS } from './ui.js';

const MOVES = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const box = () => [...document.querySelectorAll('dialog[open]')].pop() || document.querySelector('.menu') || document.querySelector('.view:not([hidden])');
const items = b => [...b.querySelectorAll(ITEMS)].filter(x => x.getClientRects().length);
let keyedOn = false;
const spot = new WeakMap(); // where the selection was in each sheet, menu or view
export const keyed = () => { keyedOn = true; };
// A render can take the focused item away. The keyboard carries on from the same place, not from the top of the page.
export function keep(){
  if (!keyedOn) return; const a = document.activeElement; if (a && a !== document.body && a.getClientRects().length) return;
  const b = box(); if (!b) return; const l = items(b); l[Math.min(spot.get(b) ?? 0, l.length - 1)]?.focus();
}

export function initCursor(){
  const c = document.createElement('div'); c.className = 'cursor'; c.popover = 'manual'; c.setAttribute('aria-hidden', 'true');
  c.innerHTML = '<div class="in"><i></i><i></i><i></i><i></i></div>';
  document.body.appendChild(c);
  let target = null, layer = null, landT = 0, settleT = 0, frame = 0;
  // Clipped by a scroller counts as not intersecting, so brackets never float over the header.
  const seen = new IntersectionObserver(([e]) => { if (e.target === target) c.classList.toggle('gone', !e.isIntersecting); });
  const place = instant => {
    const r = target.getBoundingClientRect();
    c.classList.toggle('instant', instant);
    c.style.width = r.width + 'px'; c.style.height = r.height + 'px';
    c.style.transform = `translate(${r.left}px,${r.top}px)`;
  };
  const to = el => {
    const from = target, top = el.closest('dialog'), glide = from && top === layer;
    if (from) seen.unobserve(from);
    target = el; seen.observe(el);
    const b = el.closest('dialog,.menu,.view'); if (b) spot.set(b, items(b).indexOf(el));
    if (!glide){ if (from) c.hidePopover(); c.showPopover(); layer = top; } // re-entering the top layer puts it above an open sheet
    place(!glide);
    if (glide){ c.classList.remove('squash'); clearTimeout(landT); landT = setTimeout(() => c.classList.add('squash'), 240); }
    clearTimeout(settleT); settleT = setTimeout(follow, 280); // the page may still be sliding in under it
  };
  const off = () => { if (!target) return; seen.unobserve(target); target = null; clearTimeout(landT); c.hidePopover(); };
  const follow = () => { if (target && !frame) frame = requestAnimationFrame(() => { frame = 0; if (target) place(true); }); };

  c.addEventListener('animationend', () => c.classList.remove('squash'));
  addEventListener('keydown', e => { if (MOVES.has(e.key)) keyedOn = true; setTimeout(keep); }, true);
  addEventListener('pointerdown', () => { keyedOn = false; off(); }, true);
  document.addEventListener('focusin', e => { if (keyedOn) e.target.matches(ITEMS) ? to(e.target) : off(); });
  document.addEventListener('focusout', e => { if (!e.relatedTarget) requestAnimationFrame(() => { if (document.activeElement === document.body || !target?.isConnected) off(); }); });
  addEventListener('scroll', follow, { capture:true, passive:true });
  addEventListener('resize', follow);
}
