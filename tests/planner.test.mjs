// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { clampDuration, occurrenceDates, slotChanges, pushPlan, nextFreeSlot, metrics, category, timeMix, hourBins, observations, pulse, journal, suggestLinks, inferSessionType, fmtClock } from '../ui/js/planner.js';
import { melbourneISO, weekday } from '../ui/js/time.js';

const block = (id, minute, duration = 30, extra = {}) => ({ id, start_minute:minute, duration_minutes:duration, state:'scheduled', priority_hint:0, title:'', ...extra });
const rule = o => ({ active:true, frequency:'daily', starts_on:'2026-11-02', ends_on:'2026-11-08', weekdays:null, ...o });

test('daily rule yields every date in range', () => assert.equal(occurrenceDates(rule({})).length, 7));
test('weekly weekdays are Python weekdays with Monday as 0', () => {
  assert.equal(weekday('2026-11-02'), 0);
  assert.deepEqual(occurrenceDates(rule({ frequency:'weekly', weekdays:[0, 4] })), ['2026-11-02', '2026-11-06']);
});
test('exceptions and existing rows are never regenerated', () => {
  assert.deepEqual(occurrenceDates(rule({ ends_on:'2026-11-04' }), new Set(['2026-11-02']), new Set(['2026-11-03'])), ['2026-11-04']);
});
test('inactive rule generates nothing', () => assert.deepEqual(occurrenceDates(rule({ active:false })), []));

test('claiming a free slot displaces nobody', () => assert.deepEqual(slotChanges([block('a', 0)], 'b', 1), []));
test('Important and none never displace', () => assert.deepEqual(slotChanges([block('a', 0, 30, { priority_hint:4 })], 'b', 4), []));
test('same-day swap gives the holder the old slot', () => assert.deepEqual(slotChanges([block('a', 0, 30, { priority_hint:1 }), block('b', 30, 30, { priority_hint:2 })], 'b', 1, 2), [['a', 2]]));
test('newcomer sends the holder to the first free slot', () => assert.deepEqual(slotChanges([block('a', 0, 30, { priority_hint:1 }), block('c', 60, 30, { priority_hint:2 })], 'b', 1), [['a', 3]]));
test('full day drops the holder to no priority', () => {
  const day = [1, 2, 3].map(p => block('p' + p, p * 30, 30, { priority_hint:p }));
  assert.deepEqual(slotChanges(day, 'new', 2), [['p2', 0]]);
});

test('push cascades through blocks it hits', () => {
  assert.deepEqual(pushPlan([block('a', 600, 60), block('b', 660, 30), block('c', 900)], 600, 60), [{ id:'a', minute:660 }, { id:'b', minute:720 }]);
});
test('touching blocks are not pushed', () => assert.deepEqual(pushPlan([block('a', 570, 30), block('b', 660)], 600, 60), []));
test('a pushed block stays inside its day', () => assert.equal(pushPlan([block('a', 1380, 60)], 1380, 60)[0].minute, 1380));

test('next free slot skips blocks and rounds up to a slot', () => {
  const day = [block('a', 480, 60)];
  assert.deepEqual(nextFreeSlot(() => day, 30, { date:'2026-11-02', now:'2026-11-02', nowMin:475 }), { date:'2026-11-02', minute:540 });
});
test('next free slot rolls to the next day when full', () => {
  const full = d => d === '2026-11-02' ? [block('a', 420, 780)] : [];
  assert.deepEqual(nextFreeSlot(full, 60, { date:'2026-11-02', now:'2026-11-02', nowMin:0 }), { date:'2026-11-03', minute:420 });
});
test('past dates start from today, and the moved task ignores itself', () => {
  assert.deepEqual(nextFreeSlot(() => [block('a', 420)], 30, { date:'2026-10-01', excludeId:'a', now:'2026-11-02', nowMin:0 }), { date:'2026-11-02', minute:420 });
});

test('metrics keep the v6 semantics', () => {
  const tasks = [block('a', 540, 60, { state:'completed', priority_hint:1 }), block('b', 600, 60, { priority_hint:2 }), block('c', 900, 120)];
  const m = metrics(tasks, 2, '2026-11-02', '2026-11-02', 700);
  assert.equal(m.planned, 240); assert.equal(m.free, 240);
  assert.equal(m.completion, 50, 'future blocks do not count against you');
  assert.equal(m.planDone, 25); assert.equal(m.focus, 50); assert.equal(m.needsPlan, true);
});
test('focus falls back to plan done without priorities', () => assert.equal(metrics([block('a', 0, 60, { state:'completed' }), block('b', 60, 60)], 0, '2026-11-01', '2026-11-02', 0).focus, 50));
test('a covered day stops asking for planning', () => assert.equal(metrics([block('a', 420, 480)], 0, '2026-11-02', '2026-11-02', 0).needsPlan, false));

test('time mix reads titles and priority', () => {
  assert.equal(category({ title:'Weekly sync' }), 'Meetings'); assert.equal(category({ title:'Inbox' }), 'Admin');
  assert.equal(category({ title:'Gym' }), 'Personal'); assert.equal(category({ title:'Anything', priority_hint:1 }), 'Focus'); assert.equal(category({ title:'Anything' }), 'Other');
  assert.equal(timeMix([block('a', 0, 60, { title:'Gym' })]).find(x => x.name === 'Personal').pct, 100);
});
test('hour chart counts completed work by start hour only', () => {
  const bins = new Map(hourBins([block('a', 540, 30, { state:'completed' }), block('b', 540, 30), block('c', 60, 30, { state:'completed' })]));
  assert.equal(bins.get(9), 30); assert.equal(bins.size, 11);
});
test('observations name the busier half of the day', () => assert.match(observations(metrics([], 0, 'x', 'y', 0), [block('a', 540, 120, { state:'completed' })])[1], /before 1pm/));

test('pulse reports late and current work', () => {
  assert.match(pulse([block('a', 540, 60), block('b', 700, 60, { title:'Write' })], 720).pace, /1 past planned end/);
  assert.match(pulse([block('b', 700, 60, { title:'Write' })], 720).pace, /Now: Write until 12:40 PM/);
  assert.equal(pulse([], 0).base, 'No calendar blocks today yet.');
});
test('clock labels', () => { assert.equal(fmtClock(0), '12:00 AM'); assert.equal(fmtClock(780), '1:00 PM'); });

test('journal summarises the week by person', () => {
  const j = journal([{ ...block('a', 540, 60, { title:'Write', state:'completed', notes:'line' }), local_date:'2026-11-02', assigned_person_id:'p' }], new Map([['p', { display_name:'Me' }]]), '2026-11-02');
  assert.match(j, /\*\*Me:\*\* 1h planned \/ 1h completed/); assert.match(j, /- line/); assert.match(j, /_No time blocks\._/);
});

test('session type is inferred from the block', () => { assert.equal(inferSessionType({ title:'Product shoot' }), 'shoot'); assert.equal(inferSessionType({ title:'Write' }), 'focus'); });
test('suggestions need real relevance, skip closed and linked rows, and pull in neighbours', () => {
  const r = (id, name, x = {}) => ({ clickup_task_id:id, name, clickup_list_id:'l1', tags:[], raw:{}, ...x });
  const rows = [r('1', 'Mouse launch banner'), r('2', 'Mouse launch poster'), r('3', 'Unrelated'), r('4', 'Mouse launch closed', { is_closed:true }), r('5', 'Mouse launch linked')];
  const ids = suggestLinks({ title:'Mouse launch' }, rows, new Set(['5']), '2026-11-02').map(x => x.clickup_task_id);
  assert.deepEqual(ids.sort(), ['1', '2']);
});

test('wall clock maps to the right Melbourne instant across DST', () => {
  assert.equal(melbourneISO('2026-11-02', 540), '2026-11-01T22:00:00.000Z'); // AEDT, UTC+11
  assert.equal(melbourneISO('2026-07-01', 540), '2026-06-30T23:00:00.000Z'); // AEST, UTC+10
});

test('resize keeps a block inside its own day and above one slot', () => {
  assert.equal(clampDuration(14 * 60, 690), 600);
  assert.equal(clampDuration(14 * 60, 60), 60);
  assert.equal(clampDuration(14 * 60, 0), 30);
});
