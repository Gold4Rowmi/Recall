// Shell and router. Views mount once and stay mounted; switching flips `hidden` synchronously, then renders only if dirty.
import { initBrand, boot, toast, react, setRestPose, setMuted, setVolume, setDogSounds, loadSounds, bonk, undoLast, SFX } from './brand.js';
import * as store from './store.js';
import * as sync from './sync.js';
import { menu, closeMenu, loadingBlock, fieldErr, isTextEntry, slide, ITEMS } from './ui.js';
import { initCursor, keep, keyed } from './cursor.js';
import { startPad } from './gamepad.js';
import today from './views/today.js';
import brief from './views/brief.js';
import command from './views/command.js';
import quest from './views/quest.js';
import { openFollowUps, exportWeek, openSettings, applyMotion } from './views/utilities.js';
import { seedDemo } from './demo.js';
import * as calendar from './calendar.js';

const $ = id => document.getElementById(id);
const VIEWS = { today, brief, command, quest };
const ORDER = ['today', 'brief', 'command'];
const mounted = {}, dirty = new Set(Object.keys(VIEWS));
let current = null, frame = 0, xTarget = null;

// Offline wins, then a planner with nothing on it says so through data-rest.
function rest(){
  const v = mounted[current];
  const pose = sync.getStatus().state === 'offline' ? 'sleepy' : v?.dataset.rest;
  const panelDog = !!v && [...v.querySelectorAll('.state svg')].some(s => s.getClientRects().length); // one Rommel per screen
  setRestPose(panelDog ? 'idle' : pose || 'idle');
}
const clearX = () => { xTarget = null; $('itemX').hidden = true; };
const gone = el => !el?.isConnected || !el.getClientRects().length;
function paint(){ frame = 0; if (dirty.has(current)){ dirty.delete(current); VIEWS[current].render(); } rest(); if (xTarget && gone(xTarget)) clearX(); keep(); }
const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };

export function go(name){
  if (name === current) return;
  closeMenu(); clearX();
  const from = current;
  if (current){ mounted[current].hidden = true; VIEWS[current].onHide?.(); }
  current = name;
  if (!mounted[name]){
    const el = document.createElement('section'); el.className = 'view'; el.id = 'v-' + name;
    $('views').appendChild(el); mounted[name] = el; VIEWS[name].mount(el);
  }
  mounted[name].hidden = false;
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.view === name));
  $('tabs').style.setProperty('--i', ORDER.indexOf(name));
  VIEWS[name].onShow?.();
  paint();
  if (from){ SFX.swish(); if (name === 'quest') SFX.woof(); slide(mounted[name], ORDER.indexOf(name) > ORDER.indexOf(from) ? 24 : -24); }
  setTimeout(() => localStorage.setItem('recall.view', name)); // never on the click path
}
export const invalidate = (...names) => { (names.length ? names : Object.keys(VIEWS)).forEach(n => dirty.add(n)); schedule(); };

store.on(() => invalidate());
window.addEventListener('recall:go', e => go(e.detail));
window.addEventListener('recall:calendar', () => invalidate('today'));
window.addEventListener('recall:fill', () => { go('today'); today.fillDay(); });

let lastState = 'idle', syncFrom = 0, outage = false;
function syncPill(s){
  if (s.state !== lastState){ // whine for a failure, awoo for a long job that finished while you were away
    if (s.state === 'error'){ if (!outage) SFX.whine(); outage = true; } else if (s.state === 'syncing') syncFrom = Date.now(); else if (s.state === 'synced'){ outage = false; if (document.hidden && Date.now() - syncFrom > 10000) SFX.awoo(); } // once per outage: the retries back off for minutes
    lastState = s.state; }
  const el = $('sync'), n = store.pendingCount();
  $('syncIcon').setAttribute('href', `vendor/icons-sprite.svg#i-${s.state === 'offline' ? 'offline' : s.state === 'error' ? 'warning' : 'sync'}`);
  el.classList.toggle('busy', s.state === 'syncing'); el.classList.toggle('bad', s.state === 'error'); el.classList.toggle('off', s.state === 'offline');
  $('syncText').textContent = s.state === 'syncing' ? 'Syncing' : s.state === 'offline' ? (n ? `Offline, ${n} waiting` : 'Offline')
    : s.state === 'error' ? 'Sync failed' : 'Synced';
  el.title = s.message || 'Sync now';
  document.body.classList.toggle('is-offline', s.state === 'offline');
  rest();
}

function wire(){
  $('tabs').addEventListener('pointerdown', e => { const b = e.target.closest('.tab'); if (b) go(b.dataset.view); }); // on press, not release: a tab change should feel instant
  $('tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) go(b.dataset.view); });
  $('aboutBtn').onclick = () => $('about').showModal();
  $('sync').onclick = async () => { const ok = await sync.syncNow(); toast(ok ? 'Everything is synced.' : 'Couldn’t sync. Your changes are safe here, try again when you’re online.', ok ? 'success' : null); if (!ok) react('sad', 900); }; // the failure already whined
  $('newBlock').onclick = () => { go('today'); today.newBlock(); };
  $('moreBtn').onclick = e => menu(e.currentTarget, [
    { label:'Quest', run:() => go('quest') }, { label:'Wrap up day', run:() => { go('today'); today.wrapUp(); } }, { label:'Follow-ups', run:openFollowUps }, { label:'Export week', run:exportWeek }, ...(getComputedStyle($('settingsBtn')).display === 'none' ? [{ label:'Settings', run:openSettings }] : []), // the action bar is gone at phone width
  ]);
  $('settingsBtn').onclick = openSettings;
  // The bar names what X does to the selected item, and pressing it leaves the selection where it is.
  addEventListener('focusin', e => { const f = e.target; if (f.closest('#actionBar')) return;
    xTarget = f.closest('dialog') ? null : f.matches('[data-x]') ? f : f.closest('.blk,.qrow')?.querySelector('[data-x]');
    $('itemX').hidden = !xTarget; if (xTarget) $('itemXLabel').textContent = xTarget.dataset.act === 'more' ? 'More' : 'Delete'; });
  $('itemX').onpointerdown = e => e.preventDefault();
  $('itemX').onclick = () => { if (!gone(xTarget)) xTarget.click(); clearX(); };
  const shift = n => { const i = ORDER.indexOf(current), to = i < 0 ? 0 : i + n; if (ORDER[to]) go(ORDER[to]); else { SFX.error(); bonk($('tabs')); } }; // the ends stop, they don't wrap
  $('tabL').onclick = () => shift(-1);
  $('tabR').onclick = () => shift(1);
  // Console feel: L R switch tabs, arrows move, A opens, B or Esc goes back, X acts on the item, Y is Settings. 1 2 3 jump.
  const topSheet = () => [...document.querySelectorAll('dialog[open]')].pop(); // a confirm opens above the sheet that asked for it
  const scope = () => topSheet() || document.querySelector('.menu') || mounted[current];
  const back = () => { const d = topSheet();
    if (d) d.close();
    else if (document.querySelector('.menu')){ SFX.back(); closeMenu(); }
    else if (current === 'quest') go('today');
    else { SFX.tick(); document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true })); } }; // Today closes its drawer on this
  const walk = (d, leave) => { const items = [...scope().querySelectorAll(ITEMS)].filter(b => b.getClientRects().length); if (!items.length) return;
    const at = items.indexOf(document.activeElement), next = at < 0 ? items[0] : items[at + d] || (leave && items[at - d]);
    if (next){ next.focus(); SFX.tick(); } else { SFX.error(); bonk(items[at]); } }; // the ends stop
  let typed = '', backT = 0;
  addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !isTextEntry(e.target)){ if (undoLast()){ e.preventDefault(); SFX.back(); } return; }
    const sheetOpen = !!document.querySelector('dialog[open]');
    if (e.ctrlKey && current && !sheetOpen && (e.key === 'Tab' || e.key === ',')){ e.preventDefault(); keyed(); if (e.key === ','){ SFX.click(); openSettings(); } else shift(e.shiftKey ? -1 : 1); return; } // browsers keep Ctrl+Tab for themselves
    if (e.target.type === 'range' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')){ // the slider keeps left and right; a controller's key is synthetic, so step it here
      if (!e.isTrusted){ e.key === 'ArrowLeft' ? e.target.stepDown() : e.target.stepUp(); e.target.dispatchEvent(new Event('input', { bubbles:true })); e.target.dispatchEvent(new Event('change', { bubbles:true })); }
      return; }
    // Up and down walk past a one-line field, so walking through a time or a number never changes it. Esc leaves one on a page; in a sheet it closes the sheet.
    const walksOut = e.target.tagName === 'INPUT' && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || (e.key === 'Escape' && !sheetOpen));
    if ((isTextEntry(e.target) && !walksOut) || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    const key = e.key.toLowerCase(), wasTyping = typed === 'bubb', menuOpen = !!document.querySelector('.menu');
    clearTimeout(backT); // b waits a beat: if another key follows, it was the word bubbles
    typed = (typed + key).slice(-4);
    if (e.repeat && (key.length === 1 || key === 'enter' || key === 'delete')) return;
    if (!current){ if (key === 'a' && !$('login').hidden) $('loginForm').requestSubmit(); return; } // signed out: nothing to move through yet
    if (key === 'escape' && isTextEntry(e.target)) return walk(1, true);
    if (key === 'b'){ backT = setTimeout(back, e.isTrusted ? 250 : 0); return; } // a controller's B can't be the start of a word
    if (key === 'a' || key === 'enter'){
      const f = document.activeElement;
      if (f?.tagName === 'SELECT'){ e.preventDefault(); try { f.showPicker?.(); } catch {} return; } // a controller press doesn't count as a user gesture
      const hit = f?.matches('button, a, [role="button"]') ? f : [...scope().querySelectorAll('.btn.primary')].find(b => b.getClientRects().length) || (!sheetOpen && current === 'today' ? $('newBlock') : null); // New block is Today's main action
      if (hit){ e.preventDefault(); hit.click(); }
    } else if (key === 'x' || key === 'delete' || key === ' '){ // a focused control with no item action keeps its native Space
      const f = document.activeElement, x = f?.matches('[data-x]') ? f : f?.closest('.blk,.qrow')?.querySelector('[data-x]');
      if (x){ e.preventDefault(); x.click(); }
    } else if (key === 'arrowdown' || key === 'arrowup' || ((key === 'arrowleft' || key === 'arrowright') && (sheetOpen || menuOpen || current === 'brief' || current === 'quest'))){ // on Today and Command, left and right belong to the view
      e.preventDefault(); walk(key === 'arrowdown' || key === 'arrowright' ? 1 : -1);
    } else if (sheetOpen) return;
    else if (['1','2','3'].includes(key)){ const to = ORDER[+key - 1]; if (to === current) SFX.tick(); else { keyed(); go(to); } }
    else if ((key === 'l' && !wasTyping) || key === '['){ keyed(); shift(-1); }
    else if (key === 'r' || key === ']'){ keyed(); shift(1); }
    else if (key === 'y'){ SFX.click(); openSettings(); }
    else if (key === 'escape' && current === 'quest') go('today');
  });
  const KEYS = { a:'a', b:'b', x:'x', y:'y', l:'l', r:'r', up:'ArrowUp', down:'ArrowDown', left:'ArrowLeft', right:'ArrowRight' };
  startPad(act => {
    if (act === 'start'){ if (!$('actionBar').hidden && !document.querySelector('dialog[open]')) $('newBlock').click(); return; }
    const f = document.activeElement; // the same handlers as the keyboard; a text field would swallow the key, so it goes past it
    if (act === 'b' && isTextEntry(f) && !document.querySelector('dialog[open]')) return f.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true, cancelable:true }));
    (!f || isTextEntry(f) ? document.body : f).dispatchEvent(new KeyboardEvent('keydown', { key:KEYS[act], bubbles:true, cancelable:true }));
  });
  $('loginForm').addEventListener('submit', async e => {
    const submit = e.target.querySelector('button[type="submit"]');
    e.preventDefault(); $('loginErr').hidden = true; submit.disabled = true;
    try { await sync.signIn($('email').value.trim(), $('password').value); $('password').value = ''; enter(); }
    catch (err){ console.error(err); if (err.status === 400) fieldErr($('password'), 'Couldn’t sign in. Check your email and password and try again.'); else { $('loginErrText').textContent = 'Couldn’t reach RECALL. Check your connection and try again.'; $('loginErr').hidden = false; } react('sad', 900); SFX.error(); }
    submit.disabled = false;
  });
}

const SHELL = ['tabL', 'tabs', 'tabR', 'sync', 'actionBar', 'moreBtn'];
function enter(){
  $('login').hidden = $('loading').hidden = true; $('views').hidden = false;
  SHELL.forEach(id => { $(id).hidden = false; });
  const saved = localStorage.getItem('recall.view');
  go(ORDER.includes(saved) ? saved : 'today');
}

async function checkUpdate(){
  const t = window.__TAURI__;
  if (!t){ if (location.protocol === 'https:') navigator.serviceWorker?.register('sw.js').catch(e => console.warn('offline cache failed', e)); return; }
  $('version').textContent = await t.app.getVersion();
  try { const u = await t.updater.check();
    if (u){ await u.downloadAndInstall(); toast('Update ready. It applies next time you open RECALL.', 'new', { label:'Restart now', run:() => t.process.relaunch() }); }
  } catch (e){ console.warn('update check failed', e); } // never interrupt work for this
}

(async function main(){
  setMuted(localStorage.getItem('recall.muted') === '1'); setVolume(+(localStorage.getItem('recall.volume') ?? 6)); // before boot: the store isn't open yet
  initBrand(); boot(loadSounds()); wire(); initCursor();
  $('loading').innerHTML = loadingBlock('Opening RECALL.');
  setInterval(() => document.querySelectorAll('[data-pct]').forEach(e => { const p = sync.pullPct(); e.textContent = p; e.parentElement.hidden = !p; }), 1000); // a wait on the analytics worker has no percent to give
  const demo = new URLSearchParams(location.search).has('demo');
  await store.open(demo);
  if (demo) seedDemo();
  const mute = () => { const m = store.pref('sound_muted', '0') === '1', v = store.pref('sound_volume', '6'); setMuted(m); setVolume(+v); setDogSounds(store.pref('dog_sounds', '1') !== '0'); localStorage.setItem('recall.muted', m ? '1' : '0'); localStorage.setItem('recall.volume', v); };
  mute(); store.on(mute); applyMotion(); calendar.init(demo);
  sync.onStatus(syncPill);
  store.on(() => syncPill(sync.getStatus()));
  const known = !!store.ctx.workspaceId;
  if (known || demo) enter();      // cached data paints before the network is touched
  const signedIn = await sync.start();
  if (signedIn && !known && !demo) enter();
  if (!signedIn && !demo){ $('views').hidden = $('loading').hidden = true; SHELL.forEach(id => { $(id).hidden = true; }); $('login').hidden = false; }
  setTimeout(checkUpdate, 3000);
})().catch(e => { console.error(e); toast('RECALL couldn’t start. Close it and open it again.', 'error'); });
