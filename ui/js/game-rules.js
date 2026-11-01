// Adventure rules: pure logic, no DOM and no store. Numbers match TimeBlock's game.
// XP comes only from finalised days and claim-once rewards, so unticking and re-ticking a block can never farm it.
// Totals are derived from the reward rows rather than incremented, so two devices finalising the same day cannot double count.
import { addDays, weekday, mondayOf } from './time.js';

export const MAX_HP = 100;
export const XP_PER_LEVEL = 250;
export const RESPAWN_HP = 45;
export const BOSS_XP = 90;
export const STYLES = ['ASCII', '8-bit', 'Vector', 'Block', 'Blob'];
const LOOKBACK_DAYS = 31;

export const AREAS = [
  { name:'Greenvale Trail', boss:'Inbox Slime', kind:'slime', dark:false, art:'greenvale' },
  { name:'Amberwood', boss:'Meeting Mimic', kind:'mimic', dark:false, art:'amberwood' },
  { name:'Moonlit Ruins', boss:'Deadline Drake', kind:'drake', dark:true, art:'moonlit' },
  { name:'Clockwork Pass', boss:'Scope Creep', kind:'clock', dark:false, art:'clockwork' },
  { name:'Frostbyte Ridge', boss:'Context Hydra', kind:'hydra', dark:false, art:'frostbyte' },
  { name:'Skykeep', boss:'Procrastinatus', kind:'mage', dark:false, art:'skykeep' },
];

export const QUOTES = [
  'Quest log: Protect the next block. The kingdom can wait 30 minutes.',
  'Save point: A planned hour is easier to defend than a vague intention.',
  'NPC wisdom: The boss is rarely the task. It is deciding when the task happens.',
  'Loading tip: Put the main quest on the map before side quests spawn.',
  'Party advice: Three priorities. One calendar. Zero heroic multitasking required.',
  'Dungeon rule: Empty tiles are tactical. Leave buffer between battles.',
  'Combo guide: Estimate, place, execute, review. Repeat until legendary.',
  'Boss tip: If the day goes sideways, redraw the map. Do not fight yesterday’s route.',
  'Crafting note: A realistic plan gives better stats than an ambitious fantasy build.',
  'Fast travel: Planning tomorrow tonight is basically unlocking the next checkpoint early.',
];
const ordinal = date => Math.round(Date.parse(date + 'T00:00:00Z') / 86400000) + 719163; // Python's date.toordinal()
export const quoteFor = date => QUOTES[ordinal(date) % QUOTES.length];

export const GOALS = [
  { code:'first_clear', title:'First clear', desc:'Complete any calendar block', xp:15 },
  { code:'planned_day', title:'Battle plan', desc:'Schedule at least 3 blocks', xp:10 },
  { code:'deep_work', title:'Deep work', desc:'Complete 2 hours of timeboxed work', xp:25 },
  { code:'top3_clear', title:'Top 3 cleared', desc:'Complete P1, P2 and P3', xp:45 },
  { code:'perfect_clear', title:'Perfect clear', desc:'Complete every scheduled block', xp:55 },
  { code:'tomorrow_mapped', title:'Next checkpoint mapped', desc:'Pre-plan the next adventure day with at least 3 blocks and 90 minutes', xp:15 },
  { code:'week_scouted', title:'Week scouted', desc:'Have at least 4 of the next 5 adventure days meaningfully timeboxed', xp:35 },
];
const PLANNING_CODES = new Set(['tomorrow_mapped', 'week_scouted']);

const TIERS = [
  [1, 4, 'Timebox Scout', 'I'], [5, 9, 'Calendar Crafter', 'II'], [10, 14, 'Focus Tactician', 'III'],
  [15, 19, 'Schedule Strategist', 'IV'], [20, 29, 'Master Timekeeper', 'V'], [30, 9999, 'Chronomancer', 'VI'],
];
export const levelFromXp = xp => Math.max(1, Math.floor((xp || 0) / XP_PER_LEVEL) + 1);
export function rankForLevel(level){
  const tier = Math.max(0, TIERS.findIndex(([lo, hi]) => level >= lo && level <= hi)), [, hi, name, roman] = TIERS[tier];
  return { name, roman, tier, next:hi < 9999 ? hi + 1 : null };
}

export const isAdventureDay = (date, mode) => mode === 'Every day' || weekday(date) < 5;
export function nextAdventureDay(date, mode){
  for (let i = 1; i <= 8; i++) if (isAdventureDay(addDays(date, i), mode)) return addDays(date, i);
  return addDays(date, 1);
}

const isTop = t => [1, 2, 3].includes(t.priority_hint);
const isDone = t => t.state === 'completed';

// tasks: the day's calendar rows (scheduled or completed).
export function dayStats(tasks){
  const total = tasks.length, done = tasks.filter(isDone).length, top = tasks.filter(isTop);
  return { total, done, plannedMinutes:tasks.reduce((n, t) => n + t.duration_minutes, 0),
    doneMinutes:tasks.filter(isDone).reduce((n, t) => n + t.duration_minutes, 0),
    plannedTop3:top.length, top3Done:top.filter(isDone).length, completionPct:total ? Math.round(done / total * 100) : 0 };
}

export function planningReadiness(date, mode, tasksOn){
  const tomorrow = nextAdventureDay(date, mode), next = tasksOn(tomorrow), minutes = l => l.reduce((n, t) => n + t.duration_minutes, 0);
  const future = [];
  for (let d = tomorrow; future.length < 5; d = addDays(d, 1)) if (isAdventureDay(d, mode)) future.push(tasksOn(d));
  return { tomorrowReady:next.length >= 3 && minutes(next) >= 90,
    readyDays:future.filter(l => l.length >= 2 && minutes(l) >= 60).length,
    mappedDays:future.filter(l => l.length >= 3 && minutes(l) >= 90 && l.some(isTop)).length };
}

export function scoreDay(s){
  const topBonus = s.plannedTop3 ? Math.round(s.top3Done / s.plannedTop3 * 20) : 0;
  let score = s.total ? Math.min(100, Math.round(s.completionPct * .8) + topBonus) : 0;
  if (s.total && s.done === s.total) score = 100;
  if (score === 100) return { score, xp:75, summary:'Perfect clear. The calendar has been comprehensively defeated.' };
  if (score >= 80) return { score, xp:55, summary:'Excellent day. You planned it, protected it, and mostly shipped it.' };
  if (score >= 60) return { score, xp:40, summary:'Strong day. Useful work survived contact with reality.' };
  if (score >= 35) return { score, xp:25, summary:'Solid day. The plan did its job.' };
  if (score > 0) return { score, xp:10, summary:'You moved the day forward.' };
  if (s.total) return { score, xp:0, summary:'No blocks were finished this day.' };
  return { score:0, xp:0, summary:'Nothing was scheduled this day.' };
}

export function achievementsFor(s, r){
  const hit = { first_clear:s.done >= 1, planned_day:s.total >= 3, deep_work:s.doneMinutes >= 120,
    top3_clear:s.plannedTop3 === 3 && s.top3Done === 3, perfect_clear:s.total >= 1 && s.done === s.total,
    tomorrow_mapped:r.tomorrowReady, week_scouted:r.readyDays >= 4 };
  return GOALS.filter(g => hit[g.code]);
}

export function hpDelta(s, r){
  if (s.total === 0) return { delta:-18, label:'No blocks scheduled' };
  const damage = Math.min(26, (s.total - s.done) * 4 + (s.plannedTop3 - s.top3Done) * 3);
  let heal = 0;
  if (s.completionPct >= 80) heal += 5;
  if (s.done === s.total) heal += 6;
  if (r.tomorrowReady) heal += 3;
  if (r.readyDays >= 4) heal += 3;
  const delta = Math.max(-30, Math.min(12, heal - damage));
  return { delta, label:delta > 0 ? 'Recovered through a strong plan' : delta < 0 ? 'Some blocks stayed open' : 'Held your ground' };
}

// Knock-outs are a setback, not a punishment: HP respawns and XP is never touched.
export function replayHp(base, scores){
  let hp = base;
  [...scores].sort((a, b) => a.score_date < b.score_date ? -1 : 1).forEach(s => {
    hp = Math.max(0, Math.min(MAX_HP, hp + (s.hp_delta || 0)));
    if (hp <= 0) hp = RESPAWN_HP;
  });
  return hp;
}

export const totalXp = (scores, achievements, bosses) => [scores, achievements, bosses].flat().reduce((n, r) => n + (r.xp_awarded || 0), 0);

export function streak(scores, through){
  const by = new Map(scores.map(s => [s.score_date, s.score]));
  let d = by.has(through) ? through : addDays(through, -1), n = 0;
  while ((by.get(d) ?? -1) >= 60){ n++; d = addDays(d, -1); }
  return n;
}
export function longestStreak(scores){
  const days = scores.filter(s => s.score >= 60).map(s => s.score_date).sort(); let best = 0, run = 0, prev = null;
  days.forEach(d => { run = prev && addDays(prev, 1) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; });
  return best;
}

export function campaign(bosses){
  const defeats = bosses.length, areaIndex = defeats % AREAS.length;
  return { defeats, stage:defeats + 1, chapter:Math.floor(defeats / AREAS.length) + 1, areaIndex, area:AREAS[areaIndex] };
}
export const bossHp = defeats => Math.min(900, 420 + defeats * 35);

// preview: damage today's unfinalised work would add, shown but not banked.
export function weekBoss(date, state, preview = 0){
  const week = mondayOf(date), end = addDays(week, 6), camp = campaign(state.bosses), reward = state.bosses.find(b => b.week_start === week);
  if (reward){ // A cleared boss stays on screen until the weekly reset, so there is no unclaimable second boss.
    const area = AREAS.find(a => a.boss === reward.boss_name) || AREAS[Math.max(0, (camp.defeats - 1) % AREAS.length)], hp = bossHp(Math.max(0, camp.defeats - 1));
    return { week, name:reward.boss_name, kind:area.kind, area, campaign:camp, hp, damage:hp, committed:hp, preview:0, remaining:0, defeated:true, rewarded:true };
  }
  const area = camp.area, hp = bossHp(camp.defeats), inWeek = d => d >= week && d <= end;
  const damage = state.scores.filter(s => inWeek(s.score_date)).reduce((n, s) => n + s.score, 0)
    + state.achievements.filter(a => inWeek(a.unlocked_on) && PLANNING_CODES.has(a.achievement_key)).reduce((n, a) => n + a.xp_awarded, 0);
  const shown = Math.min(hp, damage + preview);
  return { week, name:area.boss, kind:area.kind, area, campaign:camp, hp, damage:shown, committed:Math.min(hp, damage), preview, remaining:Math.max(0, hp - shown), defeated:damage >= hp, rewarded:false };
}

export function previewDamage(date, mode, tasksOn){
  const r = planningReadiness(date, mode, tasksOn);
  return scoreDay(dayStats(tasksOn(date))).score + (r.tomorrowReady ? 15 : 0) + (r.readyDays >= 4 ? 35 : 0);
}

// Score every past day that has no row yet. state: { scores, achievements, bosses, hpBase, hpFrom }.
// opts: { today, started, mode, tasksOn(date) }. Returns only the new rows plus the progress they lead to. Same input, same rows.
// Scene events wait until a scene is on screen. holdEvents keeps the last few; releaseEvents plays them once and returns what is still held.
export const holdEvents = (held, events, keep = 3) => [...held, ...events].slice(-keep);
export function releaseEvents(held, shown){ if (!shown.length) return held; held.forEach(e => shown.forEach(s => s.play(e))); return []; }

export function finalize(state, opts){
  const { today, started, mode, tasksOn } = opts;
  const scores = [...state.scores], achievements = [...state.achievements], bosses = [...state.bosses];
  const out = { scores:[], achievements:[], bosses:[], events:[] }, scored = new Set(scores.map(s => s.score_date));
  const floor = addDays(today, -LOOKBACK_DAYS);
  for (let day = started > floor ? started : floor; day < today; day = addDays(day, 1)){
    if (scored.has(day)) continue;
    const tasks = tasksOn(day);
    if (!tasks.length && !isAdventureDay(day, mode)) continue; // rest days with no work leave no record
    const s = dayStats(tasks), r = planningReadiness(day, mode, tasksOn), v = scoreDay(s);
    // Days before RECALL took over already shaped the HP carried across, so they score without moving it again.
    const h = !isAdventureDay(day, mode) ? { delta:0, label:'Rest day' } : day < state.hpFrom ? { delta:0, label:'Earlier day' } : hpDelta(s, r);
    const row = { score_date:day, planned_minutes:s.plannedMinutes, completed_minutes:s.doneMinutes, scheduled_count:s.total, completed_count:s.done,
      top3_completed:Math.min(3, s.top3Done), score:v.score, xp_awarded:v.xp, hp_delta:h.delta, summary:v.summary };
    scores.push(row); out.scores.push(row); scored.add(day);
    achievementsFor(s, r).forEach(g => { const a = { achievement_key:g.code, unlocked_on:day, xp_awarded:g.xp }; achievements.push(a); out.achievements.push(a); });
    if (v.xp) out.events.push({ kind:'attack', power:Math.max(8, Math.min(60, Math.floor(v.xp / 2) + 8)), label:'Day clear' });
    if (h.delta < 0) out.events.push({ kind:'hurt', power:-h.delta, label:h.label }); else if (h.delta > 0) out.events.push({ kind:'heal', power:h.delta, label:h.label });
    const boss = weekBoss(day, { scores, achievements, bosses });
    if (boss.defeated && !boss.rewarded){
      const b = { week_start:boss.week, boss_name:boss.name, xp_awarded:BOSS_XP };
      bosses.push(b); out.bosses.push(b); out.events.push({ kind:'boss_clear', power:BOSS_XP, label:boss.name + ' defeated', kindOf:boss.kind, areaIndex:AREAS.indexOf(boss.area) });
    }
  }
  const before = replayHp(state.hpBase, state.scores), hp = replayHp(state.hpBase, scores);
  if (out.scores.length && hp === RESPAWN_HP && before !== RESPAWN_HP) out.events.push({ kind:'revive', power:RESPAWN_HP, label:'Campfire respawn' });
  out.progress = progressFrom({ scores, achievements, bosses, hpBase:state.hpBase }, today);
  return out;
}

export function progressFrom({ scores, achievements, bosses, hpBase }, today){
  const xp = totalXp(scores, achievements, bosses), camp = campaign(bosses), boss = weekBoss(today, { scores, achievements, bosses });
  return { xp, level:levelFromXp(xp), hp:replayHp(hpBase, scores), current_stage:camp.stage, current_boss_key:boss.name.toLowerCase().replace(/\W+/g, '_'),
    boss_hp:boss.remaining, current_streak:streak(scores, today), longest_streak:longestStreak(scores) };
}
