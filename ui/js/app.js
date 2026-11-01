// Shell and router. Views mount once and stay mounted; switching flips `hidden` synchronously, then renders only if dirty.
import { initBrand, boot, toast, react, setRestPose, setMuted, SFX } from './brand.js';
import * as store from './store.js';
import * as sync from './sync.js';
import { menu, closeMenu, launchbar, isTextEntry } from './ui.js';
import { onSnapshot } from './insights.js';
import today from './views/today.js';
import brief from './views/brief.js';
import command from './views/command.js';
import quest from './views/quest.js';
import { openFollowUps, exportWeek, openSettings } from './views/utilities.js';
import { seedDemo } from './demo.js';

const $ = id => document.getElementById(id);
const VIEWS = { today, brief, command, quest };
const ORDER = ['today', 'brief', 'command'];
const mounted = {}, dirty = new Set(Object.keys(VIEWS));
let current = null, frame = 0;

// The header dog is the only Rommel: offline wins, then whatever state the visible view declares with data-rest.
function rest(){
  const v = mounted[current];
  const pose = sync.getStatus().state === 'offline' ? 'sleepy' : v?.dataset.rest || (v && [...v.querySelectorAll('[data-rest]')].find(e => e.offsetParent)?.dataset.rest);
  setRestPose(pose || 'idle');
}
function paint(){ frame = 0; if (dirty.has(current)){ dirty.delete(current); VIEWS[current].render(); } rest(); }
const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };

export function go(name){
  if (name === current) return;
  closeMenu();
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
  if (from){ // the page comes in from the side you moved toward
    SFX.swish();
    const dx = ORDER.indexOf(name) > ORDER.indexOf(from) ? 24 : -24;
    if (!matchMedia('(prefers-reduced-motion:reduce)').matches) mounted[name].animate([{ transform:`translateX(${dx}px)`, opacity:0 }, { transform:'none', opacity:1 }], { duration:260, easing:'cubic-bezier(.2,.8,.2,1)' });
  }
  setTimeout(() => localStorage.setItem('recall.view', name)); // never on the click path
}
export const invalidate = (...names) => { (names.length ? names : Object.keys(VIEWS)).forEach(n => dirty.add(n)); schedule(); };

store.on(() => invalidate());
window.addEventListener('recall:go', e => go(e.detail));

function syncPill(s){
  const el = $('sync'), n = store.pendingCount();
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
  $('sync').onclick = async () => { const ok = await sync.syncNow(); toast(ok ? 'Everything is synced.' : 'Couldn’t sync. Your changes are safe here, try again when you’re online.', ok ? 'success' : 'error'); };
  $('newBlock').onclick = () => { go('today'); today.newBlock(); };
  $('moreBtn').onclick = e => menu(e.currentTarget, [
    { label:'Quest', run:() => go('quest') }, { label:'Follow-ups', run:openFollowUps }, { label:'Export week', run:exportWeek }, { label:'Settings', run:openSettings },
  ]);
  const shift = n => { const i = ORDER.indexOf(current), to = i < 0 ? 0 : i + n; if (ORDER[to]) go(ORDER[to]); else SFX.error(); }; // the ends stop, they don't wrap
  $('tabL').onclick = () => shift(-1);
  $('tabR').onclick = () => shift(1);
  // Console feel: L R switch tabs, arrows move, A opens, B or Esc goes back. 1 2 3 jump.
  const topSheet = () => [...document.querySelectorAll('dialog[open]')].pop(); // a confirm opens above the sheet that asked for it
  const scope = () => topSheet() || document.querySelector('.menu') || mounted[current];
  const back = () => { const d = topSheet();
    if (d) d.close();
    else if (document.querySelector('.menu')){ SFX.back(); closeMenu(); }
    else if (current === 'quest'){ SFX.back(); go('today'); }
    else { SFX.tick(); document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true })); } }; // Today closes its drawer on this
  let typed = '', backT = 0;
  addEventListener('keydown', e => {
    if (isTextEntry(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase(), wasTyping = typed === 'bubb', sheetOpen = !!document.querySelector('dialog[open]');
    clearTimeout(backT); // b waits a beat: if another key follows, it was the word bubbles
    typed = (typed + key).slice(-4);
    if (e.repeat && key.length === 1) return;
    if (!current){ if (key === 'a' && !$('login').hidden) $('loginForm').requestSubmit(); return; } // signed out: nothing to move through yet
    if (key === 'b'){ backT = setTimeout(back, 250); return; }
    if (key === 'a'){
      const f = document.activeElement;
      if (f?.tagName === 'SELECT'){ e.preventDefault(); f.showPicker?.(); return; }
      const hit = f?.matches('button, a, [role="button"], input[type="checkbox"]') ? f : [...scope().querySelectorAll('.btn.primary')].find(b => b.getClientRects().length) || (!sheetOpen && current === 'today' ? $('newBlock') : null); // New block is Today's main action
      if (hit){ e.preventDefault(); hit.click(); }
    } else if (key === 'arrowdown' || key === 'arrowup'){
      const items = [...scope().querySelectorAll('button:not(:disabled), a[href], [role="button"], input:not([type="hidden"]), select, textarea')].filter(b => b.getClientRects().length);
      if (!items.length) return;
      const at = items.indexOf(document.activeElement), next = at < 0 ? 0 : Math.min(items.length - 1, Math.max(0, at + (key === 'arrowdown' ? 1 : -1)));
      e.preventDefault(); items[next].focus(); SFX.tick();
    } else if (sheetOpen) return;
    else if (['1','2','3'].includes(key)){ SFX.tick(); go(ORDER[+key - 1]); }
    else if ((key === 'l' && !wasTyping) || key === '[') shift(-1);
    else if (key === 'r' || key === ']') shift(1);
    else if (key === 'arrowleft' || key === 'arrowright') SFX.tick(); // Today steps the date, Command moves its sub-tab
    else if (key === 'escape' && current === 'quest'){ SFX.back(); go('today'); }
  });
  addEventListener('click', () => requestAnimationFrame(rest)); // sub-tabs and sheets can reveal a different state
  onSnapshot(() => requestAnimationFrame(rest));
  $('loginForm').addEventListener('submit', async e => {
    const submit = e.target.querySelector('button[type="submit"]');
    e.preventDefault(); $('loginErr').textContent = ''; submit.disabled = true;
    try { await sync.signIn($('email').value.trim(), $('password').value); $('password').value = ''; enter(); }
    catch (err){ console.error(err); $('loginErr').textContent = err.status === 400 ? 'Couldn’t sign in. Check your email and password and try again.' : 'Couldn’t reach RECALL. Check your connection and try again.'; react('sad', 900); SFX.error(); }
    submit.disabled = false;
  });
}

const SHELL = ['tabL', 'tabs', 'tabR', 'sync', 'newBlock', 'moreBtn'];
function enter(){
  $('login').hidden = $('loading').hidden = true; $('views').hidden = false;
  SHELL.forEach(id => { $(id).hidden = false; });
  const saved = localStorage.getItem('recall.view');
  go(ORDER.includes(saved) ? saved : 'today');
}

async function checkUpdate(){
  const t = window.__TAURI__; if (!t) return;
  $('version').textContent = await t.app.getVersion();
  try { const u = await t.updater.check();
    if (u){ await u.downloadAndInstall(); toast('Update ready. It applies next time you open RECALL.', 'new', { label:'Restart now', run:() => t.process.relaunch() }); }
  } catch (e){ console.warn('update check failed', e); } // never interrupt work for this
}

(async function main(){
  setMuted(localStorage.getItem('recall.muted') === '1'); // before boot: the store isn't open yet
  initBrand(); boot(); wire();
  $('loading').innerHTML = launchbar();
  const demo = new URLSearchParams(location.search).has('demo');
  await store.open(demo);
  if (demo) seedDemo();
  const mute = () => { const m = store.pref('sound_muted', '0') === '1'; setMuted(m); localStorage.setItem('recall.muted', m ? '1' : '0'); };
  mute(); store.on(mute);
  sync.onStatus(syncPill);
  store.on(() => syncPill(sync.getStatus()));
  const known = !!store.ctx.workspaceId;
  if (known || demo) enter();      // cached data paints before the network is touched
  const signedIn = await sync.start();
  if (signedIn && !known && !demo) enter();
  if (!signedIn && !demo){ $('views').hidden = $('loading').hidden = true; SHELL.forEach(id => { $(id).hidden = true; }); $('login').hidden = false; }
  setTimeout(checkUpdate, 3000);
})().catch(e => { console.error(e); toast('RECALL couldn’t start. Close it and open it again.', 'error'); });
