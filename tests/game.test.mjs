import test from 'node:test';
import assert from 'node:assert/strict';
import { finalize, scoreDay, dayStats, hpDelta, replayHp, levelFromXp, rankForLevel, campaign, weekBoss, bossHp, totalXp, streak, quoteFor, QUOTES, planningReadiness, achievementsFor, MAX_HP, RESPAWN_HP } from '../ui/js/game-rules.js';

const block = (done, minutes = 60, priority = 0) => ({ state:done ? 'completed' : 'scheduled', duration_minutes:minutes, priority_hint:priority });
const day = plan => d => plan[d] || [];
const empty = { scores:[], achievements:[], bosses:[], hpBase:100, hpFrom:'2026-01-01' };
const opts = (plan, today, started = '2026-10-05') => ({ today, started, mode:'Weekdays', tasksOn:day(plan) });
const apply = (state, out) => ({ ...state, scores:[...state.scores, ...out.scores], achievements:[...state.achievements, ...out.achievements], bosses:[...state.bosses, ...out.bosses] });

test('score and XP bands match TimeBlock', () => {
  assert.deepEqual([scoreDay(dayStats([block(1), block(1)])).score, scoreDay(dayStats([block(1), block(1)])).xp], [100, 75]);
  const half = scoreDay(dayStats([block(1), block(0)])); assert.deepEqual([half.score, half.xp], [40, 25]);
  const none = scoreDay(dayStats([block(0)])); assert.deepEqual([none.score, none.xp], [0, 0]);
  const top = scoreDay(dayStats([block(1, 60, 1), block(1, 60, 2), block(0, 60, 3), block(1)])); assert.deepEqual([top.score, top.xp], [73, 40]);
});

test('level, rank and quote', () => {
  assert.equal(levelFromXp(0), 1); assert.equal(levelFromXp(249), 1); assert.equal(levelFromXp(250), 2); assert.equal(levelFromXp(375), 2);
  assert.equal(rankForLevel(4).name, 'Timebox Scout'); assert.equal(rankForLevel(5).next, 10); assert.equal(rankForLevel(30).next, null);
  assert.equal(quoteFor('2026-11-01'), QUOTES[739921 % QUOTES.length]);
});

test('anti-farming: XP depends only on the final state of a day, never on how often it was toggled', () => {
  const plan = { '2026-10-05':[block(1), block(1), block(0)] };
  const once = finalize(empty, opts(plan, '2026-10-06'));
  for (let i = 0; i < 50; i++){ plan['2026-10-05'][2].state = 'completed'; plan['2026-10-05'][2].state = 'scheduled'; }
  const toggled = finalize(empty, opts(plan, '2026-10-06'));
  assert.equal(toggled.progress.xp, once.progress.xp);
  assert.equal(finalize(empty, opts(plan, '2026-10-05')).scores.length, 0, 'today never scores');
});

test('finalising is idempotent and rows are deterministic across devices', () => {
  const plan = { '2026-10-05':[block(1, 120), block(1), block(1)], '2026-10-06':[block(1)] };
  const a = finalize(empty, opts(plan, '2026-10-07')), b = finalize(empty, opts(plan, '2026-10-07'));
  assert.deepEqual(a, b);
  const synced = apply(empty, a), again = finalize(synced, opts(plan, '2026-10-07'));
  assert.deepEqual([again.scores, again.achievements, again.bosses], [[], [], []]);
  assert.equal(again.progress.xp, a.progress.xp);
  // Both devices writing the same primary keys cannot add XP: the total is derived from rows.
  assert.equal(totalXp(synced.scores, synced.achievements, synced.bosses), a.progress.xp);
});

test('a score row already in the cloud stops the day being re-awarded', () => {
  const state = { ...empty, scores:[{ score_date:'2026-10-05', score:100, xp_awarded:75, hp_delta:0 }] };
  const out = finalize(state, opts({ '2026-10-05':[block(1)] }, '2026-10-06'));
  assert.equal(out.scores.length, 0); assert.equal(out.progress.xp, 75);
});

test('rest days with no work leave no record, weekend work still scores', () => {
  const out = finalize(empty, opts({ '2026-10-10':[block(1)] }, '2026-10-12', '2026-10-10'));
  assert.deepEqual(out.scores.map(s => s.score_date), ['2026-10-10']); // Sat worked, Sun skipped
  assert.equal(out.scores[0].hp_delta, 0);
});

test('HP stays capped, recovers, and a knock-out respawns without touching XP', () => {
  assert.equal(replayHp(95, [{ score_date:'a', hp_delta:12 }]), MAX_HP);
  assert.equal(replayHp(10, [{ score_date:'a', hp_delta:-30 }]), RESPAWN_HP);
  assert.equal(replayHp(50, [{ score_date:'b', hp_delta:5 }, { score_date:'a', hp_delta:-5 }]), 50);
  const s = dayStats([]), r = { tomorrowReady:false, readyDays:0 }; assert.equal(hpDelta(s, r).delta, -18);
  const bad = dayStats(Array.from({ length:12 }, () => block(0))); assert.equal(hpDelta(bad, r).delta, -26);
  const good = dayStats([block(1)]); assert.equal(hpDelta(good, { tomorrowReady:true, readyDays:5 }).delta, 12); // capped from 17
  const state = { ...empty, hpBase:10, hpFrom:'2026-10-01' }, out = finalize(state, opts({}, '2026-10-06'));
  assert.equal(out.progress.xp, 0); assert.equal(out.progress.hp, RESPAWN_HP);
  assert.ok(out.events.some(e => e.kind === 'revive'));
});

test('days before RECALL took over do not move HP again', () => {
  const out = finalize({ ...empty, hpBase:79, hpFrom:'2026-10-20' }, opts({}, '2026-10-07'));
  assert.equal(out.scores[0].hp_delta, 0); assert.equal(out.progress.hp, 79);
});

test('a weekly boss is claimed once, advances the campaign, and scales', () => {
  const perfect = [block(1, 120), block(1), block(1)], plan = {};
  ['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09'].forEach(d => { plan[d] = perfect; });
  const out = finalize(empty, opts(plan, '2026-10-12'));
  assert.equal(out.bosses.length, 1); assert.equal(out.bosses[0].week_start, '2026-10-05'); assert.equal(out.bosses[0].boss_name, 'Inbox Slime');
  assert.equal(out.events.filter(e => e.kind === 'boss_clear').length, 1);
  const state = apply(empty, out);
  assert.equal(campaign(state.bosses).stage, 2); assert.equal(campaign(state.bosses).area.boss, 'Meeting Mimic');
  const again = weekBoss('2026-10-07', state); assert.equal(again.rewarded, true); assert.equal(again.name, 'Inbox Slime');
  assert.equal(finalize(state, opts(plan, '2026-10-13')).bosses.length, 0);
  assert.equal(bossHp(0), 420); assert.equal(bossHp(99), 900);
});

test('planning readiness and achievements', () => {
  const plan = { '2026-10-06':[block(0, 30), block(0, 30), block(0, 30, 1)] }, tasksOn = day(plan);
  const r = planningReadiness('2026-10-05', 'Weekdays', tasksOn);
  assert.deepEqual(r, { tomorrowReady:true, readyDays:1, mappedDays:1 });
  const codes = achievementsFor(dayStats([block(1, 120), block(1, 60, 1), block(1, 60, 2), block(1, 60, 3)]), r).map(g => g.code);
  assert.deepEqual(codes, ['first_clear', 'planned_day', 'deep_work', 'top3_clear', 'perfect_clear', 'tomorrow_mapped']);
  // Friday's next adventure day skips the weekend.
  assert.equal(planningReadiness('2026-10-09', 'Weekdays', day({ '2026-10-12':plan['2026-10-06'] })).tomorrowReady, true);
});

test('existing cloud history adds up to the 375 XP already banked', () => {
  const a = (achievement_key, xp_awarded) => ({ achievement_key, xp_awarded, unlocked_on:'2026-10-05' });
  const scores = [75, 40, 55].map(xp_awarded => ({ xp_awarded }));
  assert.equal(totalXp(scores, [a('x', 25), a('x', 15), a('x', 55), a('x', 10), a('x', 25), a('x', 15), a('x', 10), a('x', 25), a('x', 15), a('x', 10)], []), 375);
});

test('streak counts 60+ days through yesterday until today is scored', () => {
  const s = [{ score_date:'2026-10-05', score:70 }, { score_date:'2026-10-06', score:60 }, { score_date:'2026-10-04', score:59 }];
  assert.equal(streak(s, '2026-10-07'), 2); assert.equal(streak(s, '2026-10-06'), 2); assert.equal(streak(s, '2026-10-09'), 0);
});
