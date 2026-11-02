// ROWMI starter kit as a module: Rommel, chip sounds, reactions, toast, boot, bubbles. Grids are the brand; do not redraw.
const $ = id => document.getElementById(id);

const R = ['..##..##..','##########','###t##t###','##########','#.#e##e#.#','..t####t..','..#tttt#..','...t##t...','....##....','..........'];
const edit = rows => { const p = R.slice(); Object.keys(rows).forEach(k => { p[k] = rows[k]; }); return p; };
const POSES = { idle:R,
  alert: edit({0:'#.##..##.#',4:'..#e##e#..'}),
  happy: edit({0:'#.##..##.#',4:'..######..',9:'....pp....'}),
  grin:  edit({0:'#.##..##.#',4:'..#e##e#..',9:'....pp....'}),
  sad:   edit({5:'#.t####t.#'}),
  sleepy:edit({4:'#.######.#',5:'#.t####t.#'}),
  blink: edit({4:'#.######.#'}),
  wink:  edit({4:'#.#e####.#',9:'....pp....'}) };
const DOG = { '#':'#16181D', t:'#D9893B', e:'#F4F5F7', p:'#E07A6B' };
// outline = true draws the 1 px Paper ring every dark ground needs (viewBox needs 1 unit of room: -1 -1 12 12)
export function dog(pose, ox = 0, oy = 0, outline = false){ const rows = POSES[pose]; let s = ''; const on = (x, y) => y >= 0 && y < 10 && x >= 0 && x < 10 && rows[y][x] !== '.';
  if (outline) for (let y0 = -1; y0 <= 10; y0++) for (let x0 = -1; x0 <= 10; x0++) if (!on(x0, y0) && (on(x0-1,y0) || on(x0+1,y0) || on(x0,y0-1) || on(x0,y0+1))) s += `<rect x="${x0+ox}" y="${y0+oy}" width="1" height="1" fill="#ECEEF1"/>`;
  rows.forEach((r, y) => { for (let x = 0; x < 10; x++){ const c = r[x]; if (c !== '.') s += `<rect x="${x+ox}" y="${y+oy}" width="1" height="1" fill="${DOG[c]}"/>`; } }); return s; }
export function isDark(){ const t = document.documentElement.dataset.theme; return t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches); }
const WORD = ['####...###..#...#.#...#.###','#...#.#...#.#...#.##.##..#.','#...#.#...#.#.#.#.#.#.#..#.','####..#...#.#.#.#.#...#..#.','#...#..###...#.#..#...#.###'];
export function word(fill, ox, oy){ let s = ''; WORD.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === '#') s += `<rect x="${x+ox}" y="${y+oy}" width="1" height="1" fill="${fill}"/>`; }); return s; }
// Any <svg data-pose="..."> on a Paper or dark ground; call after inserting new ones.
export function paintDogs(root = document){ const dk = isDark();
  root.querySelectorAll('svg[data-pose]').forEach(s => { s.setAttribute('viewBox', dk ? '-1 -1 12 12' : '0 0 10 10'); s.innerHTML = dog(s.dataset.pose, 0, 0, dk); });
  // 3x either way: the outline ring adds a unit each side, so the box grows with it
  if (root === document){ const l = $('aboutLock'); l.setAttribute('width', dk ? 123 : 117); l.setAttribute('height', dk ? 36 : 30); l.setAttribute('viewBox', dk ? '-1 -1 41 12' : '0 0 39 10'); l.innerHTML = dog('idle', 0, 0, dk) + word(dk ? '#F4F5F7' : '#16181D', 12, 4); } }

let restPose = 'idle', reactT = 0;
const EMOTE = '<g class="hemote"><rect x="11" y="0" width="1" height="3" fill="#D9893B"/><rect x="11" y="4" width="1" height="1" fill="#D9893B"/></g>';
export const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'off';
export function react(pose, ms = 700, emote = ''){ $('dog').innerHTML = dog(pose) + emote; clearTimeout(reactT); reactT = setTimeout(() => { reactT = 0; $('dog').innerHTML = dog(restPose); }, ms); }
// The planner is a workspace that is never blank, so the header dog carries Sleepy while it is empty or offline.
// Only good news bounces: a hop in whole dog pixels. Errors shake.
const hop = () => { if (!calm()) $('dog').animate([0, -4, -8, -4, 0].map(y => ({ transform:`translateY(${y}px)` })), { duration:240, easing:'steps(4,end)' }); };
export function bonk(el){ if (!calm()) el.animate([0, -8, 8, -5, 3, 0].map(x => ({ transform:`translateX(${x}px)` })), { duration:300, easing:'steps(5,end)' }); }
export function celebrate(big){ react('happy', 700); hop(); const r = $('dog').getBoundingClientRect(); sparks(r.left + r.width / 2, r.top + r.height / 2); big ? SFX.yip() : SFX.success(); }
export function setRestPose(pose){ if (pose === restPose) return; restPose = pose; if (!reactT) $('dog').innerHTML = dog(pose); }

/* ===== Sounds: the package's rendered WAVs through one master gain ===== */
const NAMES = ['tick','click','confirm','back','error','chime','on','off','sting','swish','chomp','bubble-pop','startup','woof','yip','sniff','tag','whine','grr','awoo', ...Array.from({ length:11 }, (_, i) => 'detent-' + String(i).padStart(2, '0'))];
const buffers = {};
let ac = null, master = null, muted = false, volume = 6, dogSounds = true, queued = null, lastTick = 0, lastBack = 0, lastDog = 0;
export const setMuted = v => { muted = v; };
export const setVolume = n => { volume = n; if (master) master.gain.value = n / 10; };
export const setDogSounds = v => { dogSounds = v; };
// The context waits for the first press where a page can't play yet: making one at load only earns a console warning.
const mayAudio = () => ac || window.__TAURI__ || navigator.userActivation?.hasBeenActive !== false;
function audio(){ if (!ac){ try { ac = new (window.AudioContext || window.webkitAudioContext)(); master = ac.createGain(); master.gain.value = volume / 10; master.connect(ac.destination); } catch(e){} } if (ac?.state === 'suspended') ac.resume(); return ac; }
// Decoded on an offline context, which needs no gesture, so the first press already has its sound.
export function loadSounds(){ const off = new OfflineAudioContext(1, 1, 44100);
  return Promise.all(NAMES.map(async n => { try { buffers[n] = await off.decodeAudioData(await (await fetch(`vendor/sounds/${n}.wav`)).arrayBuffer()); } catch(e){ console.warn('sound not loaded', n, e); } })); }
// Not ready means silent, never late. A suspended context with no gesture would save every sound up for the first press.
function play(n, at = 0){ queued = null; if (muted || !buffers[n] || !mayAudio()) return; const c = audio(); if (!c || (c.state !== 'running' && !navigator.userActivation?.isActive)) return;
  const s = c.createBufferSource(); s.buffer = buffers[n]; s.connect(master); s.start(c.currentTime + at); }
// Seasoning: one per action, and never twice within 2 s.
const bark = (n, at) => { const now = Date.now(); if (!dogSounds || now - lastDog < 2000) return; lastDog = now; play(n, at); };
export const SFX = {
  tick:    () => { const now = Date.now(); if (now - lastTick < 60) return; lastTick = now; play('tick'); },
  click:   () => play('click'),
  confirm: () => play('confirm'),
  back:    () => { const now = Date.now(); if (now - lastBack < 150) return; lastBack = now; play('back'); }, // a cancel button and the sheet closing are one gesture
  error:   () => play('error'),
  success: () => play('chime'),
  on:      () => play('on'),
  off:     () => play('off'),
  swish:   () => play('swish'),
  chomp:   () => play('chomp'),
  pop:     () => play('bubble-pop'),
  detent:  n => play('detent-' + String(n).padStart(2, '0')),
  startup: () => play('startup'),
  news:    () => { play('sting'); bark('tag', .2); },
  woof:    () => bark('woof'), yip: () => bark('yip'), sniff: () => bark('sniff'), whine: () => bark('whine'), grr: () => bark('grr'), awoo: () => bark('awoo')
};
// Every press answers: one pair of capture listeners, so no button can be missed.
const PRESS = 'button, [role="button"], label.btn, a.btn, .col', OWN_SOUND = '.tab,.subtab,.keybtn,.dogbtn,.q-rail'; // those answer with a swish, a buzz or a woof
document.addEventListener('pointerdown', e => { const b = e.target.closest(PRESS); if (b && !b.disabled && !b.closest('#boot') && !b.matches(`${OWN_SOUND},.primary,.toggle,[data-sfx]`)) SFX.click(); }, true);
document.addEventListener('click', e => { const b = e.target.closest(PRESS); if (!b || b.closest('#boot') || b.matches(OWN_SOUND)) return;
  if (b.matches('.toggle')) return void (b.getAttribute('aria-checked') === 'true' ? SFX.off() : setTimeout(SFX.on)); // after the handlers, or turning Sound on is silent; off plays before it mutes
  const n = b.classList.contains('primary') ? 'confirm' : b.dataset.sfx || (b.closest('dialog') && /^(cancel|close)$/i.test(b.textContent.trim()) ? 'back' : e.detail ? null : 'click'); // a key press has no pointerdown
  if (n){ queued = n; setTimeout(() => { if (queued){ const q = queued; queued = null; SFX[q](); } }); } }, true); // waits for the handlers: a richer sound from one of them replaces it
// Selects, colours and dates answer when they change; text fields would tick on every blur, and a slider has its detents.
document.addEventListener('change', e => { if (!e.target.matches('textarea, input:not([type]), input[type="text"], input[type="email"], input[type="password"], input[type="range"]')) SFX.tick(); }, true);

let toastT, undoable = null;
// Emptied once it's out of sight, so nothing in it can be tabbed to.
const hide = () => { const t = $('toast'); t.classList.remove('show'); clearTimeout(toastT); toastT = setTimeout(() => { t.textContent = ''; }, 300); };
// Pointing at the message or tabbing into it holds it open; leaving gives a few more seconds.
function wireToast(t){ if (t._wired) return; t._wired = true;
  const hold = () => clearTimeout(toastT), rest = () => { if (t.classList.contains('show')) toastT = setTimeout(hide, 3000); };
  t.addEventListener('pointerenter', hold); t.addEventListener('focusin', hold); t.addEventListener('pointerleave', rest); t.addEventListener('focusout', rest); }
// Ctrl+Z: the Undo on the message that is showing, for anyone who deleted with a key and can't reach its button in time.
export function undoLast(){ if (!undoable || !$('toast').classList.contains('show')) return false; const a = undoable; undoable = null; hide(); a.run(); return true; }
// action = { label, run }: an inline undo instead of a confirm dialog for reversible work.
export function toast(msg, kind, action){ const t = $('toast'); t.textContent = msg; wireToast(t); undoable = action?.label === 'Undo' ? action : null;
  if (action){ const b = document.createElement('button'); b.type = 'button'; b.textContent = action.label; b.onclick = () => { undoable = null; hide(); b.remove(); action.run(); }; t.appendChild(b); }
  t.classList.remove('show'); t.hidePopover?.(); t.showPopover?.(); void t.offsetWidth; // re-entering the top layer puts it above any open sheet
  t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(hide, action ? 10000 : 2400);
  if (kind === 'error'){ react('sad', 900); SFX.error(); } else if (kind === 'success') celebrate(); else if (kind === 'big') celebrate(true); else if (kind === 'new'){ react('alert', 700, EMOTE); SFX.news(); } }

/* Boot: once per launch, skippable after 300 ms, ends on the logo */
export function boot(sounds){
  const el = $('boot'), timers = [], t0 = Date.now(), reduce = calm(), dk = isDark(); let done = false;
  // Before the wipe he sits on the theme's ground, so a dark ground gets the outline and a Paper word. The shell is light.
  $('bootDog').innerHTML = dog('sleepy', 0, 0, dk); $('bootWord').innerHTML = $('bootWordGhost').innerHTML = word(dk ? '#F4F5F7' : '#16181D', 12, 4);
  el.querySelector('.bootbox').style.width = Math.min(10, Math.floor(innerWidth * .92 / 64)) * 64 + 'px'; // one dot is a whole number of pixels
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));
  const skip = () => { if (Date.now() - t0 > 300) finish(); };
  const onKey = e => { e.stopImmediatePropagation(); skip(); }; // a key during boot skips it and is not a shortcut
  const finish = () => { if (done) return; done = true; timers.forEach(clearTimeout); removeEventListener('keydown', onKey, true); el.remove(); };
  el.addEventListener('click', skip); addEventListener('keydown', onKey, true);
  if (mayAudio() && audio() && ac.state === 'running') sounds.then(() => { if (Date.now() - t0 < 200) SFX.startup(); }); // past that it would miss the picture; browsers only allow it after a press
  const onShell = () => { $('bootWord').innerHTML = word('#16181D', 12, 4); };
  if (reduce){ el.classList.add('done','named'); $('bootDog').innerHTML = dog('idle'); onShell(); at(800, finish); return; }
  el.classList.add('booting');
  at(510, () => { $('bootDog').innerHTML = dog('alert', 0, 0, dk); $('bootEmote').classList.add('show'); el.classList.add('wiping'); });
  at(595, () => { $('bootDog').innerHTML = dog('alert'); onShell(); }); // halfway: the rising shell has reached them
  at(800, () => { $('bootDog').innerHTML = dog('idle'); $('bootEmote').classList.remove('show'); });
  at(900, () => el.classList.add('named'));
  at(1100, finish);
}

/* Easter egg: bubbles. He would smile and try to eat them as they floated by. */
let BUB = false; const SVGNS = 'http://www.w3.org/2000/svg';
function bubbleSvg(size){ const b = document.createElementNS(SVGNS, 'svg'); b.setAttribute('class', 'bub'); b.setAttribute('width', size); b.setAttribute('height', size); b.setAttribute('viewBox', '0 0 8 8');
  b.innerHTML = '<path fill="currentColor" d="M2 0h4v1H2zM1 1h1v1H1zM6 1h1v1H6zM0 2h1v4H0zM7 2h1v4H7zM1 6h1v1H1zM6 6h1v1H6zM2 7h4v1H2z"/><path fill="#ECEEF1" opacity=".7" d="M2 1h4v1H2zM1 2h6v4H1zM2 6h4v1H2z"/><path fill="#7AA7F2" d="M2 2h2v1H2zM2 3h1v1H2z"/>';
  return b; }
function sparks(x, y){ if (calm()) return;
  [[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]].forEach(d => { const s = document.createElement('span'), dist = Math.random() < .5 ? 32 : 64;
    s.className = 'spark'; s.style.left = x + 'px'; s.style.top = y + 'px'; s.style.setProperty('--dx', d[0] * dist + 'px'); s.style.setProperty('--dy', d[1] * dist + 'px');
    document.body.appendChild(s); setTimeout(() => s.remove(), 480); }); }
export function bubbles(){
  if (BUB) return; BUB = true;
  const dk = isDark(), layer = document.createElement('div'), stage = document.createElement('div'), ds = document.createElementNS(SVGNS, 'svg');
  layer.className = 'bubbles'; layer.setAttribute('aria-hidden', 'true'); stage.className = 'bubdog'; stage.setAttribute('aria-hidden', 'true');
  ds.setAttribute('class', 'px'); ds.setAttribute('viewBox', dk ? '-1 -1 12 12' : '0 0 10 10'); ds.setAttribute('width', dk ? 96 : 80); ds.setAttribute('height', dk ? 96 : 80);
  const face = p => { ds.innerHTML = dog(p, 0, 0, dk); };
  face('grin'); stage.appendChild(ds); document.body.appendChild(layer); document.body.appendChild(stage);
  void stage.offsetWidth; stage.classList.add('in'); SFX.yip(); toast('Bubbles. He loved these.');
  let list = [], spawnAt = 0, caught = 0, left = false; const t0 = Date.now(), quiet = calm(); // with motion off he visits, and no bubbles rise
  const tick = setInterval(() => {
    const now = Date.now(), el = now - t0, W = innerWidth, H = innerHeight, r = ds.getBoundingClientRect(), m = { x: r.left + r.width / 2, y: r.top + r.height * 0.75, r: r.width / 2 };
    if (!quiet && el < 6500 && now >= spawnAt){
      spawnAt = now + 260 + Math.random() * 340;
      const size = [16, 24, 32][Math.floor(Math.random() * 3)], px = size / 8;
      const b = { el: bubbleSvg(size), size, px, x: Math.round((W * 0.3 + Math.random() * W * 0.66) / px) * px, y: Math.round(H / px) * px + size, drift: Math.random() < .5 ? -1 : 1, n: 0 };
      b.el.style.left = b.x + 'px'; b.el.style.top = b.y + 'px'; layer.appendChild(b.el); list.push(b);
    }
    list.forEach(b => {
      b.n++; b.y -= b.px;
      if (b.n % 6 === 0) b.x += b.drift * b.px;
      if (b.n % 36 === 0) b.drift = -b.drift;
      b.el.style.left = b.x + 'px'; b.el.style.top = b.y + 'px';
      const cx = b.x + b.size / 2, cy = b.y + b.size / 2;
      if (!left && !b.dead && Math.abs(cx - m.x) < m.r + b.size / 2 && Math.abs(cy - m.y) < m.r * 0.6){
        b.dead = true; caught++; SFX.chomp(); SFX.pop();
        stage.classList.remove('chomp'); void stage.offsetWidth; stage.classList.add('chomp'); face('happy'); setTimeout(() => face('grin'), 160);
        sparks(cx, cy);
      }
      if (b.dead || b.y < -b.size){ b.el.remove(); b.gone = true; }
    });
    list = list.filter(b => !b.gone);
    if (el > (quiet ? 3000 : 9000) && !left){
      left = true; stage.classList.remove('in'); stage.classList.add('out'); SFX.woof();
      if (!quiet) toast(caught ? 'He got ' + caught + (caught === 1 ? ' bubble.' : ' bubbles.') + ' Good boy.' : 'He missed every one. He never minded.');
      setTimeout(() => stage.remove(), 300);
    }
    if (left && !list.length){ clearInterval(tick); layer.remove(); BUB = false; }
  }, 50);
}
let eggTyped = '', eggTaps = [];
document.addEventListener('keydown', e => { const tg = e.target; if (tg && (/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) || tg.isContentEditable)) return;
  if (e.key.length !== 1) return; eggTyped = (eggTyped + e.key.toLowerCase()).slice(-7); if (eggTyped === 'bubbles'){ eggTyped = ''; bubbles(); } });

export function initBrand(){
  $('dog').innerHTML = dog('idle'); paintDogs();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => paintDogs());
  new MutationObserver(() => paintDogs()).observe(document.documentElement, { attributes:true, attributeFilter:['data-theme'] });
  $('toast').showPopover?.(); // stays open off-screen so the slide always has a start
  $('about').addEventListener('close', () => SFX.back());
  setInterval(() => { if (restPose === 'idle' && !reactT && !document.hidden && !calm()) react('blink', 120); }, 4000);
  $('dogBtn').addEventListener('click', () => { const now = Date.now(); eggTaps = eggTaps.filter(t => now - t < 1500); eggTaps.push(now);
    if (eggTaps.length >= 5){ eggTaps = []; bubbles(); } else { react('alert', 300); hop(); SFX.woof(); } });
}
