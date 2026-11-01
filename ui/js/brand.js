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
export function react(pose, ms = 700){ $('dog').innerHTML = dog(pose); clearTimeout(reactT); reactT = setTimeout(() => { reactT = 0; $('dog').innerHTML = dog(restPose); }, ms); }
// The planner is a workspace that is never blank, so the header dog carries Sleepy while it is empty or offline.
export function setRestPose(pose){ if (pose === restPose) return; restPose = pose; if (!reactT) $('dog').innerHTML = dog(pose); }

/* ===== Chip sounds: Game Boy-style pulse (4 duties, 16-step volume) and LFSR noise ===== */
let ac = null; let muted = false;
export const setMuted = v => { muted = v; };
function audio(){ if (!ac){ try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){} } if (ac && ac.state === 'suspended') ac.resume(); return ac; }
let lastBack = 0; // a cancel button and the sheet closing are one gesture
const DUTY = { 12:0.125, 25:0.25, 50:0.5, 75:0.75 }, waves = {};
function pulseWave(c, duty){ if (waves[duty]) return waves[duty]; const n = 32, re = new Float32Array(n), im = new Float32Array(n); for (let i = 1; i < n; i++) im[i] = 2 / (i * Math.PI) * Math.sin(i * Math.PI * duty); return (waves[duty] = c.createPeriodicWave(re, im)); }
function blip(freq, dur, opt = {}){ if (muted) return; const c = audio(); if (!c) return; const t = c.currentTime + (opt.at || 0);
  const o = c.createOscillator(), g = c.createGain(); o.setPeriodicWave(pulseWave(c, DUTY[opt.duty || 50])); o.frequency.setValueAtTime(freq, t);
  const vol = opt.vol == null ? 10 : opt.vol, steps = Math.max(1, Math.round(dur * 64));
  for (let i = 0; i <= steps; i++){ const v = Math.max(0, vol - (opt.fade === false ? 0 : Math.round(i * vol / steps))); g.gain.setValueAtTime(v / 15 * 0.12, t + i / 64); }
  g.gain.setValueAtTime(0, t + dur); o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.02); }
function tap(at, vol){ if (muted) return; const c = audio(); if (!c) return; const n = Math.floor(c.sampleRate * 0.008), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0); let l = 0x7FFF;
  for (let i = 0; i < n; i++){ const bit = (l ^ (l >> 1)) & 1; l = (l >> 1) | (bit << 14); d[i] = ((l & 1) ? -1 : 1) * vol / 15 * 0.12; }
  const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(c.currentTime + at); }
let lastTick = 0;
export const SFX = {
  tick:    () => { const now = Date.now(); if (now - lastTick < 60) return; lastTick = now; blip(2093, 0.03, { duty:12, vol:7 }); },
  confirm: () => { blip(988, 0.05, { duty:25, vol:8 }); blip(1319, 0.07, { duty:25, vol:8, at:0.05 }); },
  back:    () => { const now = Date.now(); if (now - lastBack < 150) return; lastBack = now; blip(988, 0.05, { duty:25, vol:8 }); blip(659, 0.07, { duty:25, vol:8, at:0.05 }); },
  error:   () => { blip(147, 0.09, { duty:50, vol:11 }); blip(110, 0.12, { duty:50, vol:11, at:0.1 }); },
  success: () => [523, 659, 784, 1047].forEach((f, i) => blip(f, 0.09, { duty:50, vol:9, at:i * 0.06 })),
  yip:     () => { blip(1319, 0.05, { duty:25, vol:9 }); blip(1568, 0.06, { duty:25, vol:9, at:0.07 }); },
  chomp:   () => blip(220, 0.04, { duty:50, vol:10 }),
  pop:     () => { blip(2637, 0.02, { duty:12, vol:6 }); tap(0.01, 4); },
  woof:    () => { blip(392, 0.06, { duty:50, vol:10 }); blip(262, 0.08, { duty:50, vol:10, at:0.06 }); },
  swish:   () => { if (muted) return; const c = audio(); if (!c) return; const n = Math.floor(c.sampleRate * 0.14), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), t = c.currentTime; s.buffer = b; f.type = 'bandpass'; f.Q.value = 1.4; f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(3200, t + 0.13);
    g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14); s.connect(f); f.connect(g); g.connect(c.destination); s.start(t); },
  startup: () => { [0, .11, .22, .33].forEach((t, i) => tap(t, 5 + i)); blip(784, 0.09, { duty:50, vol:12, at:.42, fade:false }); blip(1047, 0.55, { duty:50, vol:13, at:.51 }); }
};
// Every press answers: one capture listener, so no button can be missed
document.addEventListener('click', e => { const b = e.target.closest('button, [role="button"], label.btn, a.btn, .col'); if (!b || b.closest('#boot') || b.matches('.tab,.subtab,.keybtn')) return; // those answer with a swish or a buzz
  if (b.classList.contains('primary')) SFX.confirm(); else if (b.dataset.sfx) SFX[b.dataset.sfx](); else if (b.closest('dialog') && /^(cancel|close)$/i.test(b.textContent.trim())) SFX.back(); else SFX.tick(); }, true);
// Selects, colours and dates answer when they change; text fields would tick on every blur.
document.addEventListener('change', e => { if (!e.target.matches('textarea, input:not([type]), input[type="text"], input[type="email"], input[type="password"]')) SFX.tick(); }, true);

let toastT;
// action = { label, run }: an inline undo instead of a confirm dialog for reversible work.
export function toast(msg, kind, action){ const t = $('toast'); t.textContent = msg;
  if (action){ const b = document.createElement('button'); b.type = 'button'; b.textContent = action.label; b.onclick = () => { t.classList.remove('show'); action.run(); }; t.appendChild(b); }
  t.classList.remove('show'); t.hidePopover?.(); t.showPopover?.(); void t.offsetWidth; // re-entering the top layer puts it above any open sheet
  t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), action ? 6000 : 2400);
  if (kind === 'error'){ react('sad', 900); SFX.error(); } else if (kind === 'success'){ react('happy', 700); SFX.success(); } else if (kind === 'new'){ react('alert', 700); } }

/* Boot: once per launch, skippable after 300 ms, ends on the logo */
export function boot(){
  const el = $('boot'), timers = [], t0 = Date.now(), reduce = matchMedia('(prefers-reduced-motion: reduce)').matches, dk = isDark(); let done = false;
  // Before the wipe he sits on the theme's ground, so a dark ground gets the outline and a Paper word. The shell is light.
  $('bootDog').innerHTML = dog('sleepy', 0, 0, dk); $('bootWord').innerHTML = word(dk ? '#F4F5F7' : '#16181D', 12, 4);
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));
  const skip = () => { if (Date.now() - t0 > 300) finish(); };
  const onKey = e => { e.stopImmediatePropagation(); skip(); }; // a key during boot skips it and is not a shortcut
  const finish = () => { if (done) return; done = true; timers.forEach(clearTimeout); removeEventListener('keydown', onKey, true); el.remove(); };
  el.addEventListener('click', skip); addEventListener('keydown', onKey, true);
  if (audio() && ac.state === 'running') SFX.startup();
  const onShell = () => { $('bootWord').innerHTML = word('#16181D', 12, 4); };
  if (reduce){ el.classList.add('done','named'); $('bootDog').innerHTML = dog('idle'); onShell(); at(800, finish); return; }
  el.classList.add('booting');
  at(510, () => { $('bootDog').innerHTML = dog('alert'); onShell(); $('bootEmote').classList.add('show'); el.classList.add('wiping'); });
  at(800, () => { $('bootDog').innerHTML = dog('idle'); $('bootEmote').classList.remove('show'); });
  at(900, () => el.classList.add('named'));
  at(1100, finish);
}

/* Easter egg: bubbles. He would smile and try to eat them as they floated by. */
let BUB = false; const SVGNS = 'http://www.w3.org/2000/svg';
function bubbleSvg(size){ const b = document.createElementNS(SVGNS, 'svg'); b.setAttribute('class', 'bub'); b.setAttribute('width', size); b.setAttribute('height', size); b.setAttribute('viewBox', '0 0 8 8');
  b.innerHTML = '<path fill="currentColor" d="M2 0h4v1H2zM1 1h1v1H1zM6 1h1v1H6zM0 2h1v4H0zM7 2h1v4H7zM1 6h1v1H1zM6 6h1v1H6zM2 7h4v1H2z"/><path fill="#ECEEF1" opacity=".7" d="M2 1h4v1H2zM1 2h6v4H1zM2 6h4v1H2z"/><path fill="#7AA7F2" d="M2 2h2v1H2zM2 3h1v1H2z"/>';
  return b; }
function sparks(x, y){ if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
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
  let list = [], spawnAt = 0, caught = 0, left = false; const t0 = Date.now();
  const tick = setInterval(() => {
    const now = Date.now(), el = now - t0, W = innerWidth, H = innerHeight, r = ds.getBoundingClientRect(), m = { x: r.left + r.width / 2, y: r.top + r.height * 0.75, r: r.width / 2 };
    if (el < 6500 && now >= spawnAt){
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
    if (el > 9000 && !left){
      left = true; stage.classList.remove('in'); stage.classList.add('out'); SFX.woof();
      toast(caught ? 'He got ' + caught + (caught === 1 ? ' bubble.' : ' bubbles.') + ' Good boy.' : 'He missed every one. He never minded.');
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
  $('dog').style.cursor = 'pointer';
  $('dog').addEventListener('click', () => { const now = Date.now(); eggTaps = eggTaps.filter(t => now - t < 1500); eggTaps.push(now);
    if (eggTaps.length >= 5){ eggTaps = []; bubbles(); } else react('alert', 300); });
}
