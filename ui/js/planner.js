// Planner rules. The first half is pure (tested in tests/planner.test.mjs); the second writes through the store.
// Moves keep the row's id, so work sessions and links survive calendar <-> queue round trips.
import * as store from './store.js';
import { newTask } from './tasks.js';
import { addDays, fmtDuration, melbourneISO, mondayOf, nowMinute, today, weekday, fmtDate } from './time.js';

export const SLOT = 30, DAY_START = 7 * 60, DAY_END = 20 * 60, CAPACITY = 8 * 60;
const dur = t => Math.max(0, +t.duration_minutes || 0);
export const isDone = t => t.state === 'completed' || (t.state === 'bank' && !!t.completed_at);
export const isTop3 = t => [1, 2, 3].includes(t.priority_hint);
export const fmtClock = m => `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, '0')} ${m >= 720 && m < 1440 ? 'PM' : 'AM'}`;
export const priorityLabel = p => ({ 1:'P1', 2:'P2', 3:'P3', 4:'Important' }[p] || '');

/* ===== Pure rules ===== */

// Dates a rule produces, minus exceptions and dates already materialised.
export function occurrenceDates(rule, exceptions = new Set(), existing = new Set()){
  if (!rule.active || !rule.ends_on) return [];
  const days = new Set(rule.weekdays || []), out = [];
  for (let d = rule.starts_on; d <= rule.ends_on; d = addDays(d, 1)){
    const occurs = rule.frequency === 'daily' || (rule.frequency === 'weekly' && days.has(weekday(d)));
    if (occurs && !exceptions.has(d) && !existing.has(d)) out.push(d);
  }
  return out;
}

// P1-P3 are unique within a day. Returns [[holderId, newPriority]] for whoever must give up the slot:
// a same-day swap hands the holder the mover's old slot, otherwise it takes the first free slot or drops to none.
export function slotChanges(dayTasks, taskId, wanted, oldPriority = 0){
  if (![1, 2, 3].includes(wanted)) return [];
  const holder = dayTasks.find(t => t.priority_hint === wanted && t.id !== taskId);
  if (!holder) return [];
  if ([1, 2, 3].includes(oldPriority)) return [[holder.id, oldPriority]];
  const occupied = new Set(dayTasks.filter(t => t.id !== taskId && t.id !== holder.id).map(t => t.priority_hint));
  return [[holder.id, [1, 2, 3].find(p => p !== wanted && !occupied.has(p)) || 0]];
}

// Anything hit by the moved block goes straight after it; each displaced block can displace the next.
export function pushPlan(others, minute, duration){
  const sorted = [...others].sort((a, b) => a.start_minute - b.start_minute || String(a.id).localeCompare(b.id));
  let end = minute + duration; const pushed = [];
  for (const t of sorted){
    if (t.start_minute + dur(t) <= minute || t.start_minute >= end) continue;
    const to = Math.min(end, 1440 - dur(t)); // a block never leaves its day
    pushed.push({ id:t.id, minute:to }); end = to + dur(t);
  }
  return pushed;
}

const free = (dayTasks, minute, duration, excludeId) => dayTasks.every(t => t.id === excludeId || t.start_minute >= minute + duration || t.start_minute + dur(t) <= minute);

// First free slot inside working hours in the next 31 days. tasksOn(date) supplies a day's blocks.
export function nextFreeSlot(tasksOn, duration, { date, minute = null, excludeId = null, now = today(), nowMin = nowMinute() }){
  const start = date < now ? now : date;
  for (let i = 0; i < 31; i++){
    const d = addDays(start, i); let first = DAY_START;
    if (i === 0){ if (minute != null) first = Math.max(first, minute); else if (d === now) first = Math.max(first, nowMin); }
    first = Math.ceil(first / SLOT) * SLOT;
    const day = tasksOn(d);
    for (let m = first; m <= DAY_END - duration; m += SLOT) if (free(day, m, duration, excludeId)) return { date:d, minute:m };
  }
  return null;
}

// Performance semantics are unchanged from TimeBlock v6; see the labels' tooltips in today.js.
export function metrics(tasks, queueCount, date, now, nowMin){
  const planned = tasks.reduce((n, t) => n + dur(t), 0), completed = tasks.filter(isDone).reduce((n, t) => n + dur(t), 0);
  const freeTime = Math.max(0, CAPACITY - planned);
  const elapsed = date === now ? tasks.filter(t => t.start_minute + dur(t) <= nowMin) : date < now ? tasks : [];
  const completion = elapsed.length ? Math.round(100 * elapsed.filter(isDone).length / elapsed.length) : (tasks.length && tasks.every(isDone) ? 100 : 0);
  const planDone = planned ? Math.round(100 * completed / planned) : 0;
  const top = tasks.filter(isTop3), topMin = top.reduce((n, t) => n + dur(t), 0), topDone = top.filter(isDone).reduce((n, t) => n + dur(t), 0);
  return { planned, completed, free:freeTime, capacity:CAPACITY, completion, planDone, focus:topMin ? Math.round(100 * topDone / topMin) : planDone,
    coverage:Math.min(100, Math.round(100 * planned / CAPACITY)), needsPlan:(queueCount > 0 && freeTime >= 30) || (planned < 300 && date === now), queueCount, count:tasks.length };
}

export function category(t){
  const text = `${t.title || ''} ${t.notes || ''}`.toLowerCase(), has = words => words.some(w => text.includes(w));
  if (has(['meeting', 'review', 'standup', 'call', '1:1', '1-1', 'sync'])) return 'Meetings';
  if (has(['email', 'admin', 'inbox', 'expense', 'timesheet', 'paperwork'])) return 'Admin';
  if (has(['gym', 'lunch', 'break', 'walk', 'doctor', 'school', 'personal'])) return 'Personal';
  if (isTop3(t) || has(['deep work', 'focus', 'strategy', 'write', 'build', 'design', 'research'])) return 'Focus';
  return 'Other';
}
export function timeMix(tasks){
  const mins = { Focus:0, Meetings:0, Admin:0, Personal:0, Other:0 };
  tasks.forEach(t => { mins[category(t)] += dur(t); });
  const total = tasks.reduce((n, t) => n + dur(t), 0);
  return Object.entries(mins).map(([name, m]) => ({ name, pct:total ? Math.round(100 * m / total) : 0 }));
}
// Completed minutes by start hour, 8am to 6pm. Execution pattern only: never call this energy.
export function hourBins(tasks){
  const bins = new Map(Array.from({ length:11 }, (_, i) => [i + 8, 0]));
  tasks.filter(isDone).forEach(t => { const h = Math.floor(t.start_minute / 60); if (bins.has(h)) bins.set(h, bins.get(h) + dur(t)); });
  return [...bins];
}
export function observations(m, history){
  const first = m.needsPlan ? `You still have ${fmtDuration(m.free)} of capacity and ${m.queueCount} unscheduled task${m.queueCount === 1 ? '' : 's'}.`
    : m.planDone >= 80 && m.planned ? 'Execution is tracking closely to the plan today.' : 'Keep the calendar realistic. Buffer is useful capacity, not a planning failure.';
  const done = history.filter(isDone), am = done.filter(t => t.start_minute < 780).reduce((n, t) => n + dur(t), 0), pm = done.filter(t => t.start_minute >= 780).reduce((n, t) => n + dur(t), 0);
  return [first, am > pm * 1.2 && am >= 60 ? 'Most completed work in the last week started before 1pm.' : pm > am * 1.2 && pm >= 60 ? 'Most completed work in the last week started after 1pm.' : 'Your completed work is spread fairly evenly across the day.'];
}

export function pulse(tasks, nowMin){
  const open = tasks.filter(t => !isDone(t)), top = tasks.filter(isTop3), sum = l => l.reduce((n, t) => n + dur(t), 0);
  const first = tasks.length ? Math.min(...tasks.map(t => t.start_minute)) : DAY_START, last = tasks.length ? Math.max(...tasks.map(t => t.start_minute + dur(t))) : DAY_END;
  const late = open.filter(t => t.start_minute + dur(t) <= nowMin), current = open.find(t => t.start_minute <= nowMin && nowMin < t.start_minute + dur(t)), next = open.find(t => t.start_minute > nowMin);
  const base = tasks.length ? `${tasks.length - open.length} of ${tasks.length} blocks done. ${fmtDuration(sum(tasks) - sum(open))} of ${fmtDuration(sum(tasks))} complete. Top 3 at ${top.filter(isDone).length} of ${top.length || 3}. Plan window ${last > first ? Math.round(100 * Math.max(0, Math.min(last - first, nowMin - first)) / (last - first)) : 0}% elapsed.` : 'No calendar blocks today yet.';
  const pace = !tasks.length ? 'Nothing on the calendar yet.' : late.length ? `${late.length} past planned end.` : current ? `Now: ${current.title} until ${fmtClock(current.start_minute + dur(current))}.`
    : next ? `Next: ${next.title} at ${fmtClock(next.start_minute)}.` : open.length ? `${fmtDuration(sum(open))} remains but no later block is scheduled.` : 'Planned work is clear for today.';
  return { base, pace, late };
}

export function journal(tasks, people, monday){
  const name = id => people.get(id)?.display_name || 'Unassigned', sum = l => l.reduce((n, t) => n + dur(t), 0), plural = n => `${n} block${n === 1 ? '' : 's'}`;
  const done = tasks.filter(isDone), long = { day:'2-digit', month:'short', year:'numeric' };
  const lines = [`# RECALL weekly journal, ${fmtDate(monday, long)} to ${fmtDate(addDays(monday, 6), long)}`, '', '## Week summary', '',
    `- Planned: ${fmtDuration(sum(tasks))} across ${plural(tasks.length)}`, `- Completed: ${fmtDuration(sum(done))} across ${plural(done.length)}`, `- Remaining: ${fmtDuration(Math.max(0, sum(tasks) - sum(done)))}`];
  if (tasks.length){
    lines.push('', '### Time by team member', '');
    const by = new Map(); tasks.forEach(t => { const s = by.get(name(t.assigned_person_id)) || [0, 0]; s[0] += dur(t); if (isDone(t)) s[1] += dur(t); by.set(name(t.assigned_person_id), s); });
    [...by].sort((a, b) => b[1][0] - a[1][0] || a[0].localeCompare(b[0])).forEach(([n, [p, c]]) => lines.push(`- **${n}:** ${fmtDuration(p)} planned / ${fmtDuration(c)} completed`));
  }
  lines.push('', '## Daily journal', '');
  for (let i = 0; i < 7; i++){
    const d = addDays(monday, i), day = tasks.filter(t => t.local_date === d).sort((a, b) => a.start_minute - b.start_minute);
    lines.push(`### ${fmtDate(d, { weekday:'long', day:'2-digit', month:'long' })}`, '');
    if (!day.length){ lines.push('_No time blocks._', ''); continue; }
    day.forEach(t => { const p = priorityLabel(t.priority_hint);
      lines.push(`- **${fmtClock(t.start_minute)} to ${fmtClock(t.start_minute + dur(t))}, ${t.title}**, ${name(t.assigned_person_id)}, ${fmtDuration(dur(t))}, ${isDone(t) ? 'Done' : 'Open'}${p ? ', ' + p : ''}`);
      (t.notes || '').trim().split('\n').filter(l => l.trim()).forEach(l => lines.push(`  - ${l.trim()}`)); });
    lines.push('');
  }
  lines.push('## End-of-week reflection', '', '- Wins:', '- What moved forward:', '- What needs to roll into next week:', '- Blockers / follow-ups:', '- Notes for next week:', '');
  return lines.join('\n');
}

/* ===== Session matching: suggests ClickUp deliverables for a block. Nothing links without the user. ===== */
const STOP = new Set(['the','and','for','with','from','this','that','into','onto','your','today','tomorrow','quick','quickly','work','task','tasks','block','session','time','daily','team','content','video','videos','asset','assets','make','doing','done','focus','some','all','our','out']);
const words = text => (String(text || '').toLowerCase().match(/[a-z0-9]+/g) || []).filter(w => w.length >= 3 && !STOP.has(w));
export function inferSessionType(t){
  const blob = `${t.title || ''} ${t.notes || ''}`.toLowerCase(), has = l => l.some(k => blob.includes(k));
  return has(['shoot','film','photo','photograph','capture']) ? 'shoot' : has(['review','approve','approval','check','feedback']) ? 'review' : has(['plan','planning','brief','ideation','strategy']) ? 'planning'
    : has(['meeting','call','powwow','sync']) ? 'meeting' : has(['email','admin','reply','shipping','organise','organize']) ? 'admin' : 'focus';
}
export function suggestionScore(task, row, now = today()){
  const title = task.title || '', raw = row.raw || {}, anchors = words(title), noteWords = new Set(words(task.notes)), name = row.name || '';
  const context = [name, (row.tags || []).join(' '), raw.list_name, raw.folder_name, raw.space_name].map(v => v || '').join(' ').toLowerCase();
  const nameWords = new Set(words(name)), ctxWords = new Set(words(context)), l = title.toLowerCase().trim(), kind = inferSessionType(task), any = list => list.some(w => ctxWords.has(w));
  let score = l && context.includes(l) ? 8 : 0;
  anchors.forEach(w => { if (nameWords.has(w)) score += 4; else if (ctxWords.has(w)) score += 2; });
  noteWords.forEach(w => { if (nameWords.has(w)) score += 1; });
  if (kind === 'shoot' && any(['shoot','film','reel','photo','photograph','capture'])) score += 2.5;
  else if (kind === 'review' && any(['review','approval','approve','feedback','check'])) score += 2;
  else if (kind === 'planning' && any(['brief','plan','planning','strategy','concept'])) score += 2;
  if (score >= 4 && row.due_at){ const days = (new Date(row.due_at) - new Date(now + 'T00:00:00Z')) / 864e5; if (days <= 7) score += 1; else if (days <= 21) score += .5; }
  return score;
}
export function suggestLinks(task, rows, linked = new Set(), now = today()){
  const open = rows.filter(r => !r.is_closed && !linked.has(r.clickup_task_id));
  const scored = open.map(r => [suggestionScore(task, r, now), r]).filter(([s]) => s >= 4.5);
  const rank = (a, b) => b[0] - a[0] || String(a[1].due_at || '9999').localeCompare(String(b[1].due_at || '9999')) || String(a[1].name).localeCompare(String(b[1].name));
  scored.sort(rank);
  if (scored.length){ // batches of related work live beside each other in ClickUp
    const top = scored[0][1], anchors = new Set(words(task.title)), have = new Set(scored.map(([, r]) => r.clickup_task_id));
    open.forEach(r => { if (have.has(r.clickup_task_id)) return;
      const near = (top.clickup_folder_id && r.clickup_folder_id === top.clickup_folder_id) || (top.clickup_list_id && r.clickup_list_id === top.clickup_list_id);
      if (near && words(r.name).some(w => anchors.has(w))) scored.push([4.6, r]); });
    scored.sort(rank);
  }
  return scored.slice(0, 12).map(([, r]) => r);
}

/* ===== Reads ===== */
let dayIndex = null;
store.on(set => { if (set.has('tasks')) dayIndex = null; });
function index(){
  if (dayIndex) return dayIndex;
  dayIndex = new Map();
  for (const t of store.rows('tasks').values()){ if (!t.local_date || t.state === 'bank' || t.state === 'cancelled') continue;
    if (!dayIndex.has(t.local_date)) dayIndex.set(t.local_date, []); dayIndex.get(t.local_date).push(t); }
  dayIndex.forEach(l => l.sort((a, b) => a.start_minute - b.start_minute || String(a.id).localeCompare(b.id)));
  return dayIndex;
}
export const dayTasks = date => index().get(date) || [];
export const rangeTasks = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(...dayTasks(d)); return out; };
export const queue = () => store.all('tasks').filter(t => t.state === 'bank' && !t.completed_at).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

export function dayStats(date){
  const tasks = dayTasks(date), done = tasks.filter(isDone), sum = l => l.reduce((n, t) => n + dur(t), 0);
  return { plannedMinutes:sum(tasks), completedMinutes:sum(done), scheduledCount:tasks.length, completedCount:done.length, top3Completed:done.filter(isTop3).length };
}
export const dayMetrics = date => metrics(dayTasks(date), queue().length, date, today(), nowMinute());

/* ===== Writes. Each returns an undo function where the action can be undone. ===== */
const place = (date, minute) => ({ local_date:date, start_minute:minute, scheduled_start:melbourneISO(date, minute) });
const snapshot = ids => { const rows = ids.map(id => ({ ...store.get('tasks', id) })); return () => rows.forEach(r => store.put('tasks', r)); };
const applySlots = changes => changes.forEach(([id, p]) => store.patch('tasks', id, { priority_hint:p, is_important:false }));

function exception(ruleId, date, action, taskId){
  const hit = store.all('recurrence_exceptions').find(e => e.recurrence_rule_id === ruleId && e.occurrence_date === date); // unique on rule + date
  if (hit){ if (hit.action !== action) store.put('recurrence_exceptions', { ...hit, action, task_id:taskId ?? hit.task_id }); return; }
  store.put('recurrence_exceptions', { id:crypto.randomUUID(), recurrence_rule_id:ruleId, occurrence_date:date, action, task_id:taskId || null, created_at:new Date().toISOString() });
}
const noteOccurrence = (t, action) => { if (t.recurrence_rule_id && t.recurrence_local_date) exception(t.recurrence_rule_id, t.recurrence_local_date, action, t.id); };

export function createBlock(f){
  const placed = newTask({ ...f, priority:0 });
  if (f.priority) setPriority(placed.id, f.priority);
  return store.get('tasks', placed.id);
}

// Save fields from the editor. Date and time always move together.
export function updateTask(id, f){
  const t = store.get('tasks', id), changes = { title:f.title, notes:f.notes, duration_minutes:f.duration, assigned_person_id:f.personId || null, color:f.color || null };
  if (t.state !== 'bank' && (f.date !== t.local_date || f.minute !== t.start_minute)) moveTask(id, f.date, f.minute);
  store.patch('tasks', id, changes);
  if (f.priority !== t.priority_hint) setPriority(id, f.priority);
  return store.get('tasks', id);
}

// pushed: [{ id, minute }] from pushPlan, applied in one step.
export function moveTask(id, date, minute, pushed = []){
  const t = store.get('tasks', id), slots = t.local_date !== date && isTop3(t) ? slotChanges(dayTasks(date), id, t.priority_hint) : [];
  const undo = snapshot([id, ...pushed.map(p => p.id), ...slots.map(([h]) => h)]);
  applySlots(slots);
  pushed.forEach(p => store.patch('tasks', p.id, place(date, p.minute)));
  store.patch('tasks', id, place(date, minute));
  if (t.local_date !== date || t.start_minute !== minute) noteOccurrence(t, 'moved');
  return undo;
}
export const clampDuration = (start, duration) => Math.max(SLOT, Math.min(duration, 24 * 60 - start)); // a block ends the day it starts
export const resizeTask = (id, duration) => { const undo = snapshot([id]); store.patch('tasks', id, { duration_minutes:duration }); return undo; };

export function toggleDone(id){
  const t = store.get('tasks', id), done = !isDone(t), stamp = done ? new Date().toISOString() : null;
  return store.patch('tasks', id, t.state === 'bank' ? { completed_at:stamp } : { state:done ? 'completed' : 'scheduled', completed_at:stamp });
}

export function setPriority(id, priority){
  const t = store.get('tasks', id);
  if (t.local_date) applySlots(slotChanges(dayTasks(t.local_date), id, priority, t.priority_hint));
  store.patch('tasks', id, { priority_hint:priority, is_important:priority === 4 });
}

export function toQueue(id){
  const t = store.get('tasks', id), undo = snapshot([id]);
  noteOccurrence(t, 'detached'); // or the occurrence would look unclaimed to anything reading the series
  store.patch('tasks', id, { state:'bank', scheduled_start:null, local_date:null, start_minute:null });
  return undo;
}
export function fromQueue(id, date, minute, pushed = []){
  const t = store.get('tasks', id), slots = isTop3(t) ? slotChanges(dayTasks(date), id, t.priority_hint) : [];
  const undo = snapshot([id, ...pushed.map(p => p.id), ...slots.map(([h]) => h)]);
  applySlots(slots);
  pushed.forEach(p => store.patch('tasks', p.id, place(date, p.minute)));
  store.patch('tasks', id, { ...place(date, minute), state:t.completed_at ? 'completed' : 'scheduled' });
  return undo;
}

export function deleteTask(id){
  const t = store.get('tasks', id), had = t.recurrence_rule_id && store.all('recurrence_exceptions').some(e => e.recurrence_rule_id === t.recurrence_rule_id && e.occurrence_date === t.recurrence_local_date);
  noteOccurrence(t, 'skip');
  const row = store.remove('tasks', id);
  return () => { store.put('tasks', { ...row, deleted_at:null });
    if (!had) store.all('recurrence_exceptions').filter(e => e.recurrence_rule_id === t.recurrence_rule_id && e.occurrence_date === t.recurrence_local_date).forEach(e => store.remove('recurrence_exceptions', e.id)); };
}

export function nextFree(task, fromDate = task.local_date || today(), minute = null){
  return nextFreeSlot(dayTasks, +task.duration_minutes, { date:fromDate, minute, excludeId:task.id });
}

// One row per occurrence, written once at creation. Other devices receive the rows, so nothing regenerates there.
export function createSeries(f){
  const rule = store.put('recurrence_rules', { id:crypto.randomUUID(), title:f.title, notes:f.notes || '', frequency:f.frequency, interval_count:1, weekdays:f.frequency === 'weekly' ? f.weekdays : null,
    local_time:`${String(Math.floor(f.minute / 60)).padStart(2, '0')}:${String(f.minute % 60).padStart(2, '0')}:00`, duration_minutes:f.duration, timezone:'Australia/Melbourne', starts_on:f.date, ends_on:f.until,
    assigned_person_id:f.personId || null, campaign_id:null, color:f.color || null, active:true, created_by:store.ctx.userId, priority_hint:f.priority || 0, deleted_at:null, created_at:new Date().toISOString() });
  const dates = occurrenceDates(rule);
  dates.forEach(d => { const taken = [1, 2, 3].includes(f.priority) && dayTasks(d).some(t => t.priority_hint === f.priority);
    newTask({ ...f, date:d, priority:taken ? 0 : f.priority, ruleId:rule.id, occurrence:d }); });
  return dates.length;
}
const seriesTasks = (ruleId, from = '') => store.all('tasks').filter(t => t.recurrence_rule_id === ruleId && t.state !== 'bank' && (t.recurrence_local_date || '') >= from);
export function stopSeries(ruleId, fromDate){
  const rule = store.get('recurrence_rules', ruleId), cutoff = addDays(fromDate, -1);
  // ends_on may not precede starts_on, so stopping from the first date retires the rule instead.
  store.put('recurrence_rules', cutoff >= rule.starts_on ? { ...rule, ends_on:cutoff } : { ...rule, active:false });
  seriesTasks(ruleId, fromDate).forEach(t => store.remove('tasks', t.id));
}
export function deleteSeries(ruleId){
  seriesTasks(ruleId).forEach(t => store.remove('tasks', t.id));
  store.all('recurrence_exceptions').filter(e => e.recurrence_rule_id === ruleId).forEach(e => store.remove('recurrence_exceptions', e.id));
  store.remove('recurrence_rules', ruleId);
}

export const reminders = () => store.all('reminders').sort((a, b) => !!a.completed_at - !!b.completed_at || String(b.created_at).localeCompare(String(a.created_at)));
export const addReminder = (title, personId = null) => store.put('reminders', { id:crypto.randomUUID(), title, notes:null, assigned_person_id:personId, due_at:null, completed_at:null, converted_task_id:null, created_by:store.ctx.userId, deleted_at:null, created_at:new Date().toISOString() });
export const toggleReminder = id => store.patch('reminders', id, { completed_at:store.get('reminders', id).completed_at ? null : new Date().toISOString() });
export function deleteReminder(id){ const row = store.remove('reminders', id); return () => store.put('reminders', { ...row, deleted_at:null }); }
export function reminderToQueue(id){
  const r = store.get('reminders', id), t = newTask({ title:r.title, personId:r.assigned_person_id, duration:30 });
  store.put('reminders', { ...r, converted_task_id:t.id }); store.remove('reminders', id);
  return t;
}

/* ===== Work sessions: a calendar block is the session, ClickUp tasks are what gets batched into it. ===== */
export const sessionFor = taskId => store.all('work_sessions').find(s => s.planner_task_id === taskId);
export const sessionLinks = sessionId => store.all('work_session_clickup_tasks').filter(l => l.session_id === sessionId).sort((a, b) => (a.sequence_order || 0) - (b.sequence_order || 0));
export function ensureSession(task){
  return sessionFor(task.id) || store.put('work_sessions', { id:crypto.randomUUID(), planner_task_id:task.id, session_type:inferSessionType(task), status:'planned', batch_label:null, actual_started_at:null, actual_ended_at:null, actual_minutes:null, outcome_note:null, created_by:store.ctx.userId, created_at:new Date().toISOString() });
}
export const linkClickUp = (session, row) => store.put('work_session_clickup_tasks', { session_id:session.id, clickup_task_id:row.clickup_task_id, sequence_order:sessionLinks(session.id).length, planned_minutes:row.time_estimate_minutes > 0 ? row.time_estimate_minutes : null, completed_in_session_at:null, result_note:null, created_at:new Date().toISOString() });
export const unlinkClickUp = (sessionId, cid) => store.remove('work_session_clickup_tasks', sessionId + '|' + cid);
export const toggleLinkDone = link => store.put('work_session_clickup_tasks', { ...link, completed_in_session_at:link.completed_in_session_at ? null : new Date().toISOString() });
export const startSession = s => store.put('work_sessions', { ...s, status:'in_progress', actual_started_at:s.actual_started_at || new Date().toISOString() });
export function finishSession(s){
  const now = new Date(), minutes = s.actual_started_at ? Math.max(0, Math.round((now - new Date(s.actual_started_at)) / 60000)) : s.actual_minutes;
  return store.put('work_sessions', { ...s, status:'completed', actual_ended_at:now.toISOString(), actual_minutes:minutes });
}

export { mondayOf };
