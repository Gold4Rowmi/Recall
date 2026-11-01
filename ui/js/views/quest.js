// Adventure workspace and the compact Today rail card. Scoring runs on idle time, never on a click,
// and only after a successful sync so a device cannot score a day from stale data.
import * as store from '../store.js';
import * as sync from '../sync.js';
import { toast, react, SFX } from '../brand.js';
import { esc, fill, stateBlock, loadingBlock } from '../ui.js';
import { today, fmtDate, addDays } from '../time.js';
import * as rules from '../game-rules.js';
import { createScene, fitCanvas } from '../game-scene.js';

const idle = fn => (window.requestIdleCallback || (f => setTimeout(f, 200)))(fn);
const tasksByDay = () => { const m = new Map(); store.all('tasks').forEach(t => { if (t.local_date && (t.state === 'scheduled' || t.state === 'completed')){ const l = m.get(t.local_date); if (l) l.push(t); else m.set(t.local_date, [t]); } }); return m; };
const mode = () => store.pref('game_days_mode', 'Weekdays') === 'Every day' ? 'Every day' : 'Weekdays';
const style = () => { const s = store.pref('idle_game_style', '8-bit'); return rules.STYLES.includes(s) ? s : '8-bit'; };
const progressRow = () => store.all('game_progress')[0];
const gameState = () => ({ scores:store.all('daily_scores'), achievements:store.all('user_achievements'), bosses:store.all('boss_rewards'),
  hpBase:Number(store.pref('game_hp_base', progressRow()?.hp ?? rules.MAX_HP)), hpFrom:store.pref('game_hp_from', '9999-12-31') });

let phase = 'loading'; // loading | ready | error
let running = false, doneFor = null;
const scenes = new Set(), rails = new Set();

function bank(){
  if (running || doneFor === today()) return; running = true;
  try {
    const d = today(), lists = tasksByDay(), tasksOn = x => lists.get(x) || [];
    // First run: carry the HP from TimeBlock forward, and start the adventure if there is no date yet.
    if (store.pref('game_hp_from') === undefined){ store.setPref('game_hp_base', String(progressRow()?.hp ?? rules.MAX_HP)); store.setPref('game_hp_from', d); }
    if (!store.pref('game_adventure_started')) store.setPref('game_adventure_started', d);
    const before = gameState(), oldXp = rules.totalXp(before.scores, before.achievements, before.bosses);
    const out = rules.finalize(before, { today:d, started:store.pref('game_adventure_started'), mode:mode(), tasksOn });
    out.scores.forEach(r => store.put('daily_scores', r));
    out.achievements.forEach(r => store.put('user_achievements', r));
    out.bosses.forEach(r => store.put('boss_rewards', r));
    const p = progressRow(), changed = !p || Object.keys(out.progress).some(k => p[k] !== out.progress[k]);
    if (changed) store.put('game_progress', { ...(p || {}), ...out.progress });
    doneFor = d; phase = 'ready';
    celebrate(out, oldXp);
  } catch (e){ console.error(e); phase = 'error'; }
  finally { running = false; repaint(); }
}

// One short moment, whatever happened overnight. Nothing here ever opens a modal.
function celebrate(out, oldXp){
  out.events.slice(-3).forEach(e => scenes.forEach(s => s.play(e)));
  if (!out.scores.length) return;
  const gained = out.progress.xp - oldXp, oldLv = rules.levelFromXp(oldXp), lv = out.progress.level, boss = out.bosses.at(-1);
  if (boss) { toast(`${boss.boss_name} defeated. +${gained} XP banked.`, 'success'); return; }
  if (lv > oldLv){ const rank = rules.rankForLevel(lv), oldRank = rules.rankForLevel(oldLv); toast(rank.tier > oldRank.tier ? `New rank: ${rank.name}.` : `Level ${lv}. +${gained} XP banked.`, 'success'); return; }
  const a = out.achievements.at(-1), goal = a && rules.GOALS.find(g => g.code === a.achievement_key);
  if (gained) toast(goal && out.scores.length === 1 ? `${goal.title}. +${gained} XP banked.` : `${out.scores.length === 1 ? 'Yesterday' : out.scores.length + ' days'} scored. +${gained} XP banked.`, 'success');
}

// A block ticked off lands a provisional hit in the scene. It is only animation: no XP moves until the day is final.
let doneToday = null;
store.on(set => { if (!set.has('tasks')) return; const d = today(), l = store.all('tasks').filter(t => t.local_date === d && t.state === 'completed'), n = l.length;
  if (doneToday !== null && n > doneToday){ const t = l.at(-1); scenes.forEach(s => s.play({ kind:'attack', power:Math.max(6, Math.min(22, Math.floor(t.duration_minutes / 5))), label:'Provisional hit' })); }
  doneToday = n; });

function boss(d){ const lists = tasksByDay(), s = gameState(), scored = s.scores.some(x => x.score_date === d);
  return rules.weekBoss(d, s, scored ? 0 : rules.previewDamage(d, mode(), x => lists.get(x) || [])); }
const sceneState = b => ({ style:style(), area:b.area, kind:b.kind, defeated:b.defeated, hp:rules.replayHp(gameState().hpBase, gameState().scores) });
const pct = (n, of) => Math.round(Math.min(1, n / Math.max(1, of)) * 100);
const meter = (label, value, of, cls = '') => `<div class="q-meter ${cls}" role="meter" aria-label="${esc(label)}" aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="${of}"><i style="width:${pct(value, of)}%"></i></div>`;

function shield(tier, roman){ // pixel crest; a pip fills for each rank
  const pips = Array.from({ length:6 }, (_, i) => `<i class="${i <= tier ? 'on' : ''}"></i>`).join('');
  return `<div class="q-crest" aria-hidden="true"><div class="q-pips">${pips}</div><svg class="px" width="48" height="56" viewBox="0 0 12 14"><path fill="var(--ink)" d="M1 0h10v1h1v7h-1v2h-1v1H9v1H8v1H7v1H5v-1H4v-1H3v-1H2v-1H1V8H0V1h1z"/><path fill="var(--shell)" d="M2 1h8v1h1v6h-1v2H9v1H8v1H7v1H5v-1H4v-1H3v-1H2V8H1V2h1z"/></svg><span class="pixel">${roman}</span></div>`;
}

function repaint(){ view.dirty(); rails.forEach(r => r.render()); }

const view = {
  el:null, scene:null, unfit:null,
  dirty(){ if (this.el && !this.el.hidden) this.render(); },
  mount(el){
    this.el = el;
    el.innerHTML = `<div class="wrap quest"><header class="pagehead"><h1 class="pixel">Quest</h1></header><div class="row q-bar"><button class="btn" type="button" data-sfx="back" id="qBack"><span class="q-cap pixel" aria-hidden="true">B</span>Back to Today</button><span class="spacer"></span>
      <label class="q-pick">Style<select id="qStyle">${rules.STYLES.map(s => `<option>${s}</option>`).join('')}</select></label>
      <label class="q-pick">Days<select id="qDays"><option>Weekdays</option><option>Every day</option></select></label></div>
      <div class="q-grid"><section class="card q-stage"><div id="qBossHead"></div><div class="q-screen" id="qScreen"><canvas id="qCanvas" width="96" height="54" role="img"></canvas></div><div id="qFoot"></div><div id="qState"></div></section>
      <div class="q-side"><section class="card" id="qRank"></section><section class="card"><h2>Today</h2><div id="qGoals"></div></section><section class="card"><h2>Recent days</h2><div id="qDaysList"></div></section></div></div></div>`;
    this.scene = createScene(el.querySelector('#qCanvas')); scenes.add(this.scene);
    el.querySelector('#qBack').onclick = () => window.dispatchEvent(new CustomEvent('recall:go', { detail:'today' }));
    el.querySelector('#qStyle').onchange = e => { store.setPref('idle_game_style', e.target.value); };
    el.querySelector('#qDays').onchange = e => { store.setPref('game_days_mode', e.target.value); };
    el.addEventListener('click', e => { if (e.target.closest('#qRetry')){ phase = 'ready'; doneFor = null; idle(bank); repaint(); } });
    this.unfit = fitCanvas(el.querySelector('#qCanvas'), el.querySelector('.q-stage'));
  },
  onShow(){ idle(bank); this.render(); this.scene.start(); },
  onHide(){ this.scene.stop(); },
  render(){
    const el = this.el, d = today(), s = gameState(), b = boss(d), hp = rules.replayHp(s.hpBase, s.scores);
    const xp = rules.totalXp(s.scores, s.achievements, s.bosses) , lv = rules.levelFromXp(xp), rank = rules.rankForLevel(lv), into = xp % rules.XP_PER_LEVEL;
    const blocked = phase !== 'ready' || !s.scores.length, screen = el.querySelector('#qScreen'), stateEl = el.querySelector('#qState');
    screen.hidden = blocked; el.querySelector('#qBossHead').hidden = blocked; el.querySelector('#qFoot').hidden = blocked;
    if (phase === 'ready' && !s.scores.length) el.dataset.rest = 'sleepy'; else delete el.dataset.rest; // the header dog carries the state; the panel stays words
    if (phase === 'error' && !this.saidError){ react('sad', 900); SFX.error(); }
    this.saidError = phase === 'error';
    if (phase === 'loading') fill(stateEl, loadingBlock('Reading your quest log.'));
    else if (phase === 'error') fill(stateEl, stateBlock('sad', 'Scoring is paused', 'Your days are safe. Check your connection, then try again.', '<button class="btn" type="button" id="qRetry">Try again</button>'));
    else if (!s.scores.length) fill(stateEl, stateBlock('sleepy', 'No days scored yet', 'Plan some blocks today. Your first score lands after midnight.', '<button class="btn primary" type="button" id="qPlan"><span class="glyph">A</span>Go to Today</button>'));
    else stateEl.innerHTML = '';
    el.querySelector('#qPlan')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('recall:go', { detail:'today' })));
    if (!blocked){
      this.scene.setState(sceneState(b));
      el.querySelector('#qCanvas').setAttribute('aria-label', `The knight faces ${b.name} in ${b.area.name}.`);
      el.querySelector('#qBossHead').innerHTML = `<div class="q-head"><b class="pixel">${esc(b.name)}</b><span class="muted small">${esc(b.area.name)}, stage ${b.campaign.stage}</span><span class="spacer"></span><span class="small">${b.defeated ? 'Clear' : b.remaining + ' HP left'}</span></div>${meter('Boss damage', b.damage, b.hp, 'boss')}`;
      el.querySelector('#qFoot').innerHTML = `<div class="q-head"><span class="small">Knight HP ${hp} of ${rules.MAX_HP}</span><span class="spacer"></span><span class="small muted">${b.campaign.defeats} ${b.campaign.defeats === 1 ? 'boss' : 'bosses'} cleared</span></div>${meter('Knight health', hp, rules.MAX_HP, hp > 45 ? 'good' : hp > 20 ? 'warn' : 'low')}`;
    }
    const st = rules.streak(s.scores, d);
    el.querySelector('#qRank').innerHTML = `<div class="row q-rank">${shield(rank.tier, rank.roman)}<div class="clip"><b>${esc(rank.name)}</b><div class="small muted">Level ${lv}, ${xp} XP</div><div class="small muted">${rank.next ? 'Next rank at level ' + rank.next : 'Top rank reached'}</div></div></div>${meter('Experience this level', into, rules.XP_PER_LEVEL)}<div class="small muted q-under"><span>${into} of ${rules.XP_PER_LEVEL} XP</span><span>Streak ${st} ${st === 1 ? 'day' : 'days'}</span></div>`;
    const lists = tasksByDay(), tasksOn = x => lists.get(x) || [], stats = rules.dayStats(tasksOn(d)), ready = new Set(rules.achievementsFor(stats, rules.planningReadiness(d, mode(), tasksOn)).map(g => g.code));
    el.querySelector('#qGoals').innerHTML = `<p class="small muted q-note">${stats.total ? `${stats.done} of ${stats.total} blocks done. Scores bank at midnight.` : 'No blocks scheduled yet.'}</p><p class="small muted q-note">${esc(rules.quoteFor(d))}</p><ul class="q-goals">${rules.GOALS.map(g => `<li class="${ready.has(g.code) ? 'on' : ''}" title="${esc(g.desc)}"><i aria-hidden="true"></i><span class="clip">${esc(g.title)}</span><span class="small muted">+${g.xp}</span></li>`).join('')}</ul>`;
    const recent = [...s.scores].sort((a, b) => a.score_date < b.score_date ? 1 : -1).slice(0, 7);
    el.querySelector('#qDaysList').innerHTML = recent.length ? `<ul class="q-days">${recent.map(r => `<li title="${esc(r.summary || '')}"><span class="small">${esc(fmtDate(r.score_date))}</span><span class="spacer"></span><b>${r.score}</b><span class="small muted">+${r.xp_awarded} XP</span></li>`).join('')}</ul>` : '<p class="small muted">Scored days appear here.</p>';
    el.querySelector('#qStyle').value = style(); el.querySelector('#qDays').value = mode();
  },
};

store.on(set => { if (['daily_scores','user_achievements','boss_rewards','app_preferences','tasks'].some(t => set.has(t))){ const when = window.requestIdleCallback || setTimeout; when(() => rails.forEach(r => r.render())); } });

export default view;

// Today's performance rail: a progress line always, the battle scene only when it is switched on (show_idle_game, as before).
export function mountRail(el){
  el.innerHTML = `<button class="q-rail" type="button" aria-label="Open the adventure"><span class="q-rail-top"><span class="pixel" data-lv></span><span class="small muted clip" data-rank></span></span><span data-bar></span><span class="q-railscreen" hidden><canvas width="96" height="54" aria-hidden="true"></canvas></span></button><button class="q-toggle small" type="button" data-toggle></button>`;
  const open = el.querySelector('.q-rail'), canvas = el.querySelector('canvas'), wrap = el.querySelector('.q-railscreen'), toggle = el.querySelector('[data-toggle]');
  const scene = createScene(canvas); let unfit = null, vis = false;
  open.onclick = () => window.dispatchEvent(new CustomEvent('recall:go', { detail:'quest' }));
  toggle.onclick = () => store.setPref('show_idle_game', store.pref('show_idle_game', '0') !== '0' ? '0' : '1');
  const io = new IntersectionObserver(([e]) => { vis = e.isIntersecting; vis && !wrap.hidden && !document.hidden ? scene.start() : scene.stop(); });
  io.observe(canvas);
  document.addEventListener('visibilitychange', () => { vis && !wrap.hidden && !document.hidden ? scene.start() : scene.stop(); });
  const rail = { render(){
    const s = gameState(), xp = rules.totalXp(s.scores, s.achievements, s.bosses), lv = rules.levelFromXp(xp), on = store.pref('show_idle_game', '0') !== '0';
    el.querySelector('[data-lv]').textContent = 'Lv ' + lv; el.querySelector('[data-rank]').textContent = rules.rankForLevel(lv).name;
    el.querySelector('[data-bar]').innerHTML = meter('Experience this level', xp % rules.XP_PER_LEVEL, rules.XP_PER_LEVEL);
    toggle.textContent = on ? 'Hide scene' : 'Show scene';
    if (on !== !wrap.hidden){ wrap.hidden = !on; if (on){ unfit = fitCanvas(canvas, wrap); scenes.add(scene); } else { unfit?.(); scenes.delete(scene); scene.stop(); } }
    if (on){ scene.setState(sceneState(boss(today()))); if (vis && !document.hidden) scene.start(); }
  } };
  rails.add(rail); rail.render();
  return () => { rails.delete(rail); scenes.delete(scene); scene.stop(); unfit?.(); io.disconnect(); };
}

sync.onStatus(s => {
  if (s.state === 'synced'){ phase = 'ready'; idle(bank); }
  else if (s.state === 'error' && phase === 'loading'){ phase = 'error'; }
  else if (s.state === 'offline' && phase === 'loading') phase = 'ready'; // cached progress is fine to show offline; scoring just waits
  repaint();
});
