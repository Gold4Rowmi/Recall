// Today: execute. Blocks are reconciled by id, so a tick touches one element, and a drag moves transforms only.
import * as store from '../store.js';
import * as P from '../planner.js';
import { DAY_START, DAY_END, SLOT, fmtClock, priorityLabel, isDone } from '../planner.js';
import { toast, react, celebrate, SFX } from '../brand.js';
import { esc, icon, sheet, menu, confirmSheet, loadingBlock, stateBlock, fill, backBtn, toggle, fieldErr } from '../ui.js';
import { today, addDays, fmtDate, fmtDuration, mondayOf, nowMinute } from '../time.js';
import { openExternal, getStatus, onStatus, syncNow } from '../sync.js';
import { isIgnored } from '../analytics.js';
import * as calendar from '../calendar.js';
import * as quest from './quest.js';
import { mountFollowUps, renderFollowUps, personOptions } from './utilities.js';

const phone = matchMedia('(max-width:600px)');
let SLOT_PX = 24, PX = SLOT_PX / SLOT; // a 30 minute block has to be a 44 px target on a phone
const S = { mode:localStorage.getItem('recall.mode') || (matchMedia('(max-width:600px)').matches ? 'day' : 'week'), date:today(), drawer:null, drag:null };
const $ = (root, sel) => root.querySelector(sel);
const person = id => store.get('workspace_people', id);
const colourOf = t => t.color || person(t.assigned_person_id)?.color || 'var(--soft)';
const DASH = '–'; // shown instead of any number or reassurance until the plan has loaded
const write = (el, html) => { if (el._html !== html){ el._html = html; el.innerHTML = html; } }; // skip identical repaints

const cap = s => { s = String(s ?? '').replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); };
const TIPS = { Focus:'Focus is follow-through on your P1 to P3 blocks. If none are set, it uses planned-time completion.',
  Completion:'Completion counts finished blocks whose planned end has already passed.', 'Plan done':'Plan done is completed planned minutes divided by all planned minutes.' };

let root, cal, health, queueEl, rail, drawer;
const blocks = new Map(); // task id -> element, for the day and week grids
let gridKey = '', range = [DAY_START, DAY_END];

/* ===== Layout ===== */
const ringsHtml = (vals = {}) => ['Focus', 'Completion', 'Plan done'].map(l => { const v = vals[l]; return `<div class="ring tip" tabindex="0" data-tip="${TIPS[l]}" data-ring="${l}"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26"/><circle class="val" cx="32" cy="32" r="26" pathLength="100" style="stroke-dashoffset:${v == null ? 100 : 100 - v}"/></svg><b>${v == null ? DASH : v + '%'}</b><span>${l}</span></div>`; }).join('');
function mount(el){
  root = el;
  el.innerHTML = `<div class="tday">
    <div class="tbar">
      <button class="btn icon" type="button" data-act="prev" aria-label="Previous" title="Previous">${icon('chevron-left')}</button>
      <button class="btn" type="button" data-act="today">Today</button>
      <button class="btn icon" type="button" data-act="next" aria-label="Next" title="Next">${icon('chevron-right')}</button>
      <h1 class="pixel" id="tdate"></h1><span class="spacer"></span>
      <div class="seg" role="group" aria-label="Calendar view">${['day', 'week', 'month'].map(m => `<button type="button" data-mode="${m}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div>
      <button class="btn" type="button" data-act="wrap" hidden>Wrap up</button>
      <button class="btn" type="button" data-act="plan">Unscheduled</button>
    </div>
    <div class="health" id="thealth"></div>
    <div class="tmain">
      <div class="tleft"><div class="cal" id="tcal"></div><div class="queue" id="tqueue"></div></div>
      <aside class="rail" aria-label="Performance">
        <div id="questRail"></div>
        <div class="rail-head"><h2 class="pixel">Performance</h2><button class="btn" type="button" data-act="details">Details</button></div>
        <div class="rings">${ringsHtml()}</div>
        <section class="tip" tabindex="0" data-tip="Completed minutes by start hour over the last seven days."><h3>Completed work by hour</h3><div class="hbars" id="tbars"></div></section>
        <section class="tip" tabindex="0" data-tip="Estimated from task titles and notes: focus, meetings, admin, personal and other."><h3>Time mix</h3><div id="tmix"></div></section>
        <section><h3>Today</h3><div id="tobs" class="muted"></div></section>
        <div class="railcue" aria-hidden="true" hidden>More below</div>
      </aside>
      <aside class="drawer" id="tdrawer" aria-label="Unscheduled work"></aside>
    </div>
  </div>`;
  cal = $(el, '#tcal'); health = $(el, '#thealth'); queueEl = $(el, '#tqueue'); rail = $(el, '.rail'); drawer = $(el, '#tdrawer');
  el.addEventListener('click', onClick);
  cal.addEventListener('pointerdown', onCalDown);
  queueEl.addEventListener('pointerdown', onQueueDown);
  drawer.addEventListener('pointerdown', onQueueDown);
  [cal, queueEl, drawer].forEach(x => x.addEventListener('touchmove', e => { if (S.drag) e.preventDefault(); }, { passive:false })); // once a held block lifts, the finger drags it instead of the page
  el.addEventListener('contextmenu', e => { if (S.drag) e.preventDefault(); });
  el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.blk,.mchip')){ e.preventDefault(); openEditor(store.get('tasks', e.target.dataset.id)); } });
  addEventListener('keydown', e => { if (el.hidden || document.querySelector('dialog[open], .menu') || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return; if (e.key === 'ArrowLeft'){ SFX.tick(); step(-1); } else if (e.key === 'ArrowRight'){ SFX.tick(); step(1); } else if (e.key === 'Escape' && S.drawer){ SFX.back(); setDrawer(null); } });
  addEventListener('recall:drawer', e => setDrawer(e.detail));
  quest.mountRail?.($(el, '#questRail'));
  const cue = () => { $(rail, '.railcue').hidden = rail.scrollHeight - rail.clientHeight - rail.scrollTop <= 16; };
  let railShown = false; // renderRail skips a hidden rail, so catch up when widening brings it back
  rail.addEventListener('scroll', cue, { passive:true }); new ResizeObserver(() => { const on = !!rail.offsetParent; if (on && !railShown) renderRail(P.dayMetrics(S.date)); railShown = on; cue(); }).observe(rail);
  onStatus(() => { if (!ready()) render(); });
  setInterval(tick, 30000);
}

function step(n){ const d = S.mode === 'day' ? n : S.mode === 'week' ? 7 * n : 0;
  if (d) S.date = addDays(S.date, d); else { const x = new Date(S.date + 'T12:00:00Z'); x.setUTCMonth(x.getUTCMonth() + n, 1); S.date = x.toISOString().slice(0, 10); }
  render(); }

const ready = () => store.ctx.demo || store.all('tasks').length > 0 || !!store.getMeta('cur:tasks');
function notReady(){
  gridKey = ''; blocks.clear(); cal.className = 'cal'; cal._html = null;
  const failed = getStatus().state === 'error';
  fill(cal, failed ? stateBlock('sad', 'Couldn’t load your plan', 'Check your connection and try again.', '<button class="btn primary" type="button" data-act="retry"><span class="glyph">A</span>Try again</button>') : loadingBlock('Getting your plan.'));
}
function render(){
  if (!root || S.drag) return;
  const title = S.mode === 'month' ? fmtDate(S.date, { month:'long', year:'numeric' }) : S.mode === 'week' ? `${fmtDate(mondayOf(S.date), { day:'numeric', month:'short' })} to ${fmtDate(addDays(mondayOf(S.date), 6), { day:'numeric', month:'short' })}` : fmtDate(S.date, { weekday:'long', day:'numeric', month:'long' });
  $(root, '#tdate').textContent = title;
  root.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === S.mode));
  const m = P.dayMetrics(S.date);
  renderHealth(m);
  if (!ready()) notReady(); else if (S.mode === 'month') renderMonth(); else renderGrid();
  renderQueue(); renderRail(m); renderDrawer();
  const shown = S.mode === 'month' ? Array.from({ length:31 }, (_, i) => addDays(S.date.slice(0, 8) + '01', i)) : visibleDates();
  if (ready() && !shown.some(d => P.dayTasks(d).length)) root.dataset.rest = 'sleepy'; else delete root.dataset.rest; // the planner is never blank, so the header dog shows it
  syncWrapChip();
}

function renderHealth(m){
  const q = m.queueCount, cell = (l, v, d, c = '') => `<div class="hcell ${c}"><span>${esc(l)}</span><b>${esc(v)}</b><span>${esc(d)}</span></div>`;
  if (!ready()) return write(health, ['Planned', 'Free time', 'Unscheduled', 'Plan health'].map(l => cell(l, DASH, 'Waiting for your plan')).join(''));
  const on = S.mode === 'day' ? '' : `, ${fmtDate(S.date)}`; // the strip is one day's figures; say which when the calendar shows more
  const last = m.needsPlan ? cell('Plan health', 'Needs planning', `${q} waiting, ${fmtDuration(m.free)} free`, 'warn') : m.count ? cell('Plan health', 'Plan is covered', `${m.coverage}% of capacity planned`, 'good') : cell('Plan health', 'Start the plan', 'Add the first useful block', 'warn');
  write(health, cell(`Planned${on}`, `${fmtDuration(m.planned) || '0m'} / 8h`, `${m.coverage}% of daily capacity`) + cell(`Free time${on}`, fmtDuration(m.free), 'Room inside an 8h day') + cell('Unscheduled', `${q} task${q === 1 ? '' : 's'}`, 'Waiting for a slot') + last);
}

/* ===== Day and week grid ===== */
const visibleDates = () => S.mode === 'day' ? [S.date] : Array.from({ length:7 }, (_, i) => addDays(mondayOf(S.date), i));
const yOf = minute => (minute - range[0]) * PX;

function lanes(tasks){ // side-by-side columns for overlapping blocks
  const out = new Map(); let group = [], end = -1, cols = [];
  const flush = () => { group.forEach(t => out.get(t.id).of = cols.length); group = []; cols = []; };
  for (const t of tasks){
    if (t.start_minute >= end){ flush(); end = -1; }
    let lane = cols.findIndex(e => e <= t.start_minute); if (lane < 0){ lane = cols.length; cols.push(0); }
    cols[lane] = t.start_minute + t.duration_minutes; end = Math.max(end, cols[lane]);
    out.set(t.id, { lane, of:1 }); group.push(t);
  }
  flush(); return out;
}

function renderGrid(){
  const dates = visibleDates(), all = dates.flatMap(P.busyOn), now = today();
  const lo = Math.min(DAY_START, ...all.map(t => Math.floor(t.start_minute / 60) * 60));
  const hi = Math.max(DAY_END, ...all.map(t => Math.ceil((t.start_minute + t.duration_minutes) / 60) * 60));
  SLOT_PX = phone.matches ? 44 : 24; PX = SLOT_PX / SLOT;
  const key = `${S.mode}|${dates[0]}|${lo}|${hi}|${now}|${SLOT_PX}`;
  if (key !== gridKey){
    gridKey = key; range = [lo, hi]; blocks.clear(); cal._html = null;
    const hours = []; for (let h = lo; h < hi; h += 60) hours.push(`<i style="top:${yOf(h)}px">${fmtClock(h).replace(':00', '')}</i>`);
    cal.className = 'cal grid' + (dates.length > 1 ? ' week' : '');
    cal.innerHTML = `<div class="calhead" style="--cols:${dates.length}"><span></span>${dates.map(d => `<b class="${d === now ? 'isnow' : ''}">${esc(fmtDate(d, dates.length > 1 ? { weekday:'short', day:'numeric' } : { weekday:'long', day:'numeric' }))}</b>`).join('')}</div>
      <div class="calbody" style="--cols:${dates.length};--slot:${SLOT_PX}px;height:${yOf(hi)}px"><div class="gutter">${hours.join('')}</div>${dates.map(d => `<div class="col${d === now ? ' isnow' : ''}" data-date="${d}">${d === now ? '<div class="nowline"></div>' : ''}</div>`).join('')}</div>`;
    placeNow();
    cal.scrollTop = Math.max(0, yOf(dates.includes(now) ? openAt(now) : 8 * 60));
    const nowCol = cal.querySelector('.col.isnow'); cal.scrollLeft = phone.matches && dates.length > 1 && nowCol ? Math.max(0, nowCol.offsetLeft - 40) : 0; // a phone's week scrolls sideways, starting at today
  }
  const seen = new Set();
  for (const d of dates){
    const tasks = P.dayTasks(d), meetings = calendar.eventsOn(d), lay = lanes([...tasks, ...meetings].sort((a, b) => a.start_minute - b.start_minute)), col = cal.querySelector(`[data-date="${d}"]`);
    for (const x of meetings){ // read-only: they sit beside the blocks, and nothing on them can be dragged or ticked
      seen.add(x.id);
      const { lane, of } = lay.get(x.id), sig = [x.title, x.start_minute, x.duration_minutes, lane, of, SLOT_PX].join('|');
      let el = blocks.get(x.id);
      if (!el){ el = document.createElement('div'); el.className = 'xblk'; blocks.set(x.id, el); }
      if (el.parentNode !== col) col.appendChild(el);
      if (el.dataset.sig === sig) continue;
      el.dataset.sig = sig; el.classList.toggle('short', x.duration_minutes <= SLOT);
      el.style.cssText = `top:${yOf(x.start_minute)}px;height:${x.duration_minutes * PX - 2}px;left:calc(${lane * 100 / of}% + 2px);width:calc(${100 / of}% - 4px)`;
      el.title = `${x.title}, ${fmtClock(x.start_minute)}, ${fmtDuration(x.duration_minutes)}. From your calendar.`;
      el.innerHTML = `<span class="tt">${esc(x.title)}</span>`;
    }
    for (const t of tasks){
      seen.add(t.id);
      const { lane, of } = lay.get(t.id), done = isDone(t), p = priorityLabel(t.priority_hint), c = colourOf(t);
      const sig = [t.title, t.start_minute, t.duration_minutes, done, p, c, lane, of, SLOT_PX].join('|');
      let el = blocks.get(t.id);
      if (!el){ el = document.createElement('div'); el.className = 'blk'; el.dataset.id = t.id; el.tabIndex = 0; el.setAttribute('role', 'button'); blocks.set(t.id, el); }
      if (el.parentNode !== col) col.appendChild(el);
      if (el.dataset.sig === sig) continue;
      el.dataset.sig = sig; el.classList.toggle('isdone', done); el.classList.toggle('short', t.duration_minutes <= SLOT);
      el.style.cssText = `top:${yOf(t.start_minute)}px;height:${t.duration_minutes * PX - 2}px;left:calc(${lane * 100 / of}% + 2px);width:calc(${100 / of}% - 4px);--c:${c}`;
      el.title = `${t.title}, ${fmtClock(t.start_minute)}, ${fmtDuration(t.duration_minutes)}`;
      el.innerHTML = `<button class="tick" type="button" data-act="done" aria-label="Mark ${esc(t.title)} ${done ? 'not done' : 'done'}">${done ? icon('check') : ''}</button><span class="tx"><span class="tt">${esc(t.title)}</span><span class="tm">${fmtClock(t.start_minute)}${p ? ' · ' + p : ''}</span></span><button class="more" type="button" data-act="more" data-x aria-label="More for ${esc(t.title)}">${icon('more')}</button><i class="rz"></i>`;
    }
  }
  for (const [id, el] of blocks) if (!seen.has(id)){ el.remove(); blocks.delete(id); }
}
function placeNow(){ const n = cal.querySelector('.nowline'); if (n) n.style.top = yOf(nowMinute()) + 'px'; }
// Open two hours before now, unless that window is empty while today has blocks: then open on the one nearest now.
function openAt(date){
  const n = nowMinute(), from = n - 120, to = from + (cal.clientHeight || 400) / PX, tasks = P.dayTasks(date);
  if (!tasks.length || tasks.some(t => t.start_minute < to && t.start_minute + t.duration_minutes > from)) return from;
  return tasks.reduce((a, t) => Math.abs(t.start_minute - n) < Math.abs(a.start_minute - n) ? t : a).start_minute - 60;
}
// After a save or a schedule, show where the block went: move to its day, scroll it into view and mark it.
// Store changes reach the day index in a microtask, so this runs after it.
const reveal = id => queueMicrotask(() => queueMicrotask(() => revealNow(id)));
function revealNow(id){
  const t = store.get('tasks', id); if (!t?.local_date || !root || root.hidden) return;
  if (S.mode === 'month' ? t.local_date.slice(0, 7) !== S.date.slice(0, 7) : !visibleDates().includes(t.local_date)) S.date = t.local_date;
  render();
  const el = blocks.get(id); if (!el) return;
  const top = yOf(t.start_minute), bottom = top + t.duration_minutes * PX, head = 40;
  if (top < cal.scrollTop || bottom > cal.scrollTop + cal.clientHeight - head) cal.scrollTop = Math.max(0, top - head - 24);
  el.classList.remove('fresh'); void el.offsetWidth; el.classList.add('fresh');
}

function renderMonth(){
  gridKey = ''; blocks.clear();
  const first = S.date.slice(0, 8) + '01', start = mondayOf(first), now = today(), month = S.date.slice(0, 7);
  const cells = Array.from({ length:42 }, (_, i) => { const d = addDays(start, i), tasks = P.dayTasks(d);
    return `<div class="mcell${d.slice(0, 7) === month ? '' : ' off'}${d === now ? ' isnow' : ''}" data-date="${d}"><button class="mday" type="button" data-act="day" aria-label="Open ${esc(fmtDate(d))}">${+d.slice(8)}</button>
      ${tasks.slice(0, 3).map(t => `<div class="mchip${isDone(t) ? ' isdone' : ''}" data-id="${esc(t.id)}" tabindex="0" role="button" style="--c:${esc(colourOf(t))}">${esc(t.title)}</div>`).join('')}${tasks.length > 3 ? `<button class="mmore" type="button" data-act="day">${tasks.length - 3} more</button>` : ''}${tasks.length ? `<button class="mcount" type="button" data-act="day" aria-label="${tasks.length} block${tasks.length === 1 ? '' : 's'}">${tasks.length}</button>` : ''}</div>`; }).join('');
  cal.className = 'cal month';
  write(cal, `<div class="mhead">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<b>${d}</b>`).join('')}</div><div class="mgrid">${cells}</div>`);
}

/* ===== Queue, rail, drawer ===== */
function queueRow(t){
  const who = person(t.assigned_person_id)?.display_name, p = priorityLabel(t.priority_hint);
  return `<div class="qrow" data-qid="${esc(t.id)}"><span class="qdrag" aria-hidden="true"></span><span class="qtext"><span class="clip">${esc(t.title)}</span><span class="small muted clip">${[fmtDuration(t.duration_minutes), who, p].filter(Boolean).map(esc).join(' · ')}</span></span>
    <span class="qacts"><button class="btn" type="button" data-act="qplan" title="Schedule in the next free slot">Schedule</button><button class="btn icon" type="button" data-act="qdel" data-sfx="back" data-x aria-label="Delete" title="Remove from Unscheduled. Undo is available.">${icon('trash')}</button><button class="btn icon" type="button" data-act="qmore" aria-label="More">${icon('more')}</button></span></div>`;
}
function renderQueue(){
  if (!ready()) return write(queueEl, `<div class="qhead"><h2>Unscheduled work</h2></div><p class="muted small qempty">${DASH}</p>`);
  const q = P.queue(), show = (q.length ? '<button class="btn" type="button" data-act="fill">Fill my day</button>' : '') + (q.length > 3 ? `<button class="btn" type="button" data-act="plan">Show all ${q.length}</button>` : q.length ? '<button class="btn qshow" type="button" data-act="plan">Show</button>' : ''); // .qshow only appears when short windows hide the rows
  write(queueEl, `<div class="qhead"><h2>Unscheduled work${q.length ? ` · ${q.length}` : ''}</h2><span class="qbtns">${show}</span></div>${q.length ? q.slice(0, 3).map(queueRow).join('') : '<p class="muted small qempty">Nothing unscheduled. Everything captured has a place.</p>'}`);
}
function renderRail(m){
  if (!rail.offsetParent) return; // removed below the breakpoint rather than squeezed
  const live = ready();
  [['Focus', m.focus], ['Completion', m.completion], ['Plan done', m.planDone]].forEach(([l, v]) => { const r = $(rail, `[data-ring="${l}"]`); $(r, '.val').style.strokeDashoffset = live ? 100 - v : 100; $(r, 'b').textContent = live ? v + '%' : DASH; });
  if (!live){ ['#tbars', '#tmix'].forEach(id => write($(rail, id), `<p class="muted small">${DASH}</p>`)); write($(rail, '#tobs'), `<p>${DASH}</p>`); return; }
  const end = S.date < today() ? S.date : today(), hist = P.rangeTasks(addDays(end, -6), end), bins = P.hourBins(hist), max = Math.max(...bins.map(b => b[1]), 1);
  write($(rail, '#tbars'), bins.map(([h, v]) => `<div class="hbar"><i style="height:${Math.round(100 * v / max)}%" class="${v ? 'on' : ''}"></i><span>${h > 12 ? h - 12 : h}</span></div>`).join(''));
  write($(rail, '#tmix'), P.timeMix(P.dayTasks(S.date)).map(x => `<div class="mix"><span>${x.name}</span><i><b style="width:${x.pct}%"></b></i><span>${x.pct}%</span></div>`).join(''));
  write($(rail, '#tobs'), P.observations(m, P.rangeTasks(addDays(today(), -6), today())).map(o => `<p>${esc(o)}</p>`).join(''));
  rail.dispatchEvent(new Event('scroll'));
}

let drawerFrom = null; // where focus goes back to when the drawer closes
function setDrawer(tab){
  if (tab && !S.drawer) drawerFrom = document.activeElement;
  S.drawer = tab; drawer.classList.toggle('open', !!tab); drawer._html = null;
  if (tab){ drawer.innerHTML = `<div class="dhead"><div class="seg">${[['queue', 'Unscheduled'], ['followups', 'Follow-ups'], ['details', 'Details']].map(([k, l]) => `<button type="button" data-tab="${k}" aria-pressed="${k === tab}">${l}</button>`).join('')}</div><span class="spacer"></span><button class="btn icon" type="button" data-act="close" data-sfx="back" aria-label="Close">${icon('close')}</button></div><div class="dbody"></div>`;
    if (tab === 'queue'){ $(drawer, '.dbody').innerHTML = `<form class="capture" id="qadd"><input aria-label="New unscheduled item" placeholder="Capture something" required><button class="btn" type="submit">Add</button></form><div class="dlist"></div>`;
      $(drawer, '#qadd').onsubmit = e => { e.preventDefault(); const i = e.target.querySelector('input'); P.createBlock({ title:i.value.trim(), duration:30 }); i.value = ''; toast('Added to Unscheduled.'); }; }
    if (tab === 'followups') mountFollowUps($(drawer, '.dbody'));
    renderDrawer(); (tab === 'queue' && !phone.matches ? $(drawer, '#qadd input') : $(drawer, `[data-tab="${tab}"]`)).focus(); } // the capture field is why anyone opens Unscheduled; on a phone it would raise the keyboard and zoom the page
  else { drawerFrom?.focus(); drawerFrom = null; }
}
function renderDrawer(){
  if (!S.drawer) return; const body = $(drawer, '.dbody');
  if (!ready() && S.drawer !== 'followups') return write(S.drawer === 'queue' ? $(body, '.dlist') : body, `<p class="muted">${DASH}</p>`);
  if (S.drawer === 'followups') renderFollowUps(body);
  else if (S.drawer === 'queue'){ const q = P.queue(); write($(body, '.dlist'), q.length ? q.map(queueRow).join('') : '<p class="muted qempty">Nothing unscheduled. Everything captured has a place.</p>'); }
  else { const d = today(), tasks = P.dayTasks(d), p = P.pulse(tasks, nowMinute());
    const mets = P.dayMetrics(d), rings = rail.offsetParent ? '' : `<h3>Performance</h3><div class="rings">${ringsHtml({ Focus:mets.focus, Completion:mets.completion, 'Plan done':mets.planDone })}</div>`; // the rail is gone at this width
    write(body, `${rings}<h3>Top 3</h3><div class="top3">${[1, 2, 3].map(n => { const t = tasks.find(x => x.priority_hint === n); return `<button class="btn" type="button" data-act="slot" data-slot="${n}"><b>P${n}</b><span class="clip">${t ? esc(t.title) : 'Choose a block'}</span></button>`; }).join('')}</div>
      <h3>Day pulse</h3><p>${esc(p.base)}</p><p>${esc(p.pace)}</p>${p.late.length ? `<h3>Needs a decision</h3>${p.late.slice(0, 5).map(t => `<p class="clip">${esc(t.title)}</p>`).join('')}${p.late.length > 5 ? `<p class="muted">${p.late.length - 5} more</p>` : ''}<p class="muted">If any no longer fit today, move them.</p>` : ''}`); }
}

/* ===== Clicks ===== */
let swallowClick = false;
function onClick(e){
  if (swallowClick){ swallowClick = false; return; }
  if (e.target.closest('.xblk')) return toast('That’s from your calendar. Change it there.');
  const mode = e.target.closest('[data-mode]'); if (mode){ S.mode = mode.dataset.mode; localStorage.setItem('recall.mode', S.mode); gridKey = ''; cal._html = null; render();
    if (S.mode === 'month'){ cal.scrollTop = 0; const c = cal.querySelector('.mcell.isnow'); if (c) cal.scrollTop = Math.max(0, c.getBoundingClientRect().top - cal.querySelector('.mgrid').getBoundingClientRect().top - 8); }
    return; }
  const tab = e.target.closest('[data-tab]'); if (tab){ setDrawer(tab.dataset.tab); return; }
  const act = e.target.closest('[data-act]')?.dataset.act, blk = e.target.closest('.blk,.mchip'), q = e.target.closest('[data-qid]');
  const task = store.get('tasks', blk?.dataset.id || q?.dataset.qid);
  switch (act){
    case 'prev': return step(-1);
    case 'next': return step(1);
    case 'today': S.date = today(); return render();
    case 'plan': return setDrawer(S.drawer === 'queue' ? null : 'queue');
    case 'fill': return fillDay();
    case 'wrap': return wrapUp();
    case 'details': return setDrawer('details');
    case 'close': return setDrawer(null);
    case 'day': S.date = e.target.closest('[data-date]').dataset.date; S.mode = 'day'; cal._html = null; return render();
    case 'retry': return syncNow();
    case 'done': return toggleDone(task);
    case 'more': return blockMenu(e.target.closest('button'), task);
    case 'qplan': { const s = P.nextFree(task, today()); if (!s) return toast('No free slot in the next 30 days. Drag it onto the calendar instead.', 'error'); const undo = P.fromQueue(task.id, s.date, s.minute); reveal(task.id); return toast(`Scheduled ${fmtDate(s.date)}, ${fmtClock(s.minute)}.`, 'success', { label:'Undo', run:undo }); }
    case 'qdel': return toast('Removed from Unscheduled.', null, { label:'Undo', run:P.deleteTask(task.id) });
    case 'qmore': return menu(e.target.closest('button'), [{ label:'Edit', run:() => openEditor(task) }, ...priorityItems(task)]);
    case 'slot': { const n = +e.target.closest('[data-slot]').dataset.slot, list = P.dayTasks(today()).filter(t => !isDone(t)); if (!list.length) return toast('Add a block today first.'); return menu(e.target.closest('button'), list.slice(0, 10).map(t => ({ label:t.title, run:() => P.setPriority(t.id, n) }))); }
  }
  if (blk) return openEditor(task);
  const col = e.target.closest('.col');
  if (col){ const r = col.getBoundingClientRect(), minute = Math.floor((range[0] + (e.clientY - r.top) / PX) / SLOT) * SLOT; openEditor(null, { date:col.dataset.date, minute }); }
}
function toggleDone(task){ const t = P.toggleDone(task.id); if (isDone(t)) celebrate(); else SFX.back(); }
const priorityItems = t => [[0, 'No priority'], [1, 'Make P1'], [2, 'Make P2'], [3, 'Make P3'], [4, 'Mark important']].filter(([p]) => p !== t.priority_hint).map(([p, label]) => ({ label, run:() => P.setPriority(t.id, p) }));
function blockMenu(btn, t){
  menu(btn, [{ label:isDone(t) ? 'Mark not done' : 'Mark done', run:() => toggleDone(t) }, { label:'Edit', run:() => openEditor(t) }, { label:'Link ClickUp', run:() => openSession(t) },
    { label:'Move to next free slot', run:() => { const from = t.local_date >= today() ? t.local_date : today(), s = P.nextFree(t, from, from === t.local_date ? t.start_minute + SLOT : null);
      if (!s) return toast('No free slot in the next 30 days. Drag it instead.', 'error'); toast(`Moved to ${fmtDate(s.date)}, ${fmtClock(s.minute)}.`, 'success', { label:'Undo', run:P.moveTask(t.id, s.date, s.minute) }); reveal(t.id); } },
    { label:'Send to Unscheduled', run:() => toast('Sent to Unscheduled.', 'success', { label:'Undo', run:P.toQueue(t.id) }) }, ...priorityItems(t),
    { label:'Delete', danger:true, run:() => { SFX.back(); toast('Block deleted.', null, { label:'Undo', run:P.deleteTask(t.id) }); } }]);
}

/* ===== Drag: pointer events, transforms only, one store write on drop ===== */
function onCalDown(e){
  if (e.button !== 0 || e.target.closest('button')) return;
  const b = e.target.closest('.blk,.mchip'); if (!b) return;
  const task = store.get('tasks', b.dataset.id);
  if (e.target.classList.contains('rz')) return startResize(e, b, task);
  arm(e, task, b, 'move');
}
function onQueueDown(e){ if (e.button !== 0 || e.target.closest('button,select,input')) return; const r = e.target.closest('[data-qid]'); if (r) arm(e, store.get('tasks', r.dataset.qid), r, 'queue'); }

function arm(e, task, el, kind){
  const x0 = e.clientX, y0 = e.clientY, rect = el.getBoundingClientRect(), grabY = kind === 'move' && S.mode !== 'month' ? y0 - rect.top : 8, touch = e.pointerType === 'touch';
  let last = e, hold = 0;
  const lift = ev => { off(); beginDrag(ev, task, el, kind, grabY); };
  const move = ev => { last = ev; if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < (touch ? 8 : 4)) return; touch ? off() : lift(ev); }; // a finger that moves before the hold is a scroll
  const off = () => { clearTimeout(hold); removeEventListener('pointermove', move); removeEventListener('pointerup', off); removeEventListener('pointercancel', off); };
  addEventListener('pointermove', move); addEventListener('pointerup', off); addEventListener('pointercancel', off);
  if (touch) hold = setTimeout(() => lift(last), 280);
}

function beginDrag(ev, task, el, kind, grabY){
  const month = S.mode === 'month', cells = [...cal.querySelectorAll(month ? '.mcell' : '.col')].map(c => ({ el:c, date:c.dataset.date, r:c.getBoundingClientRect() }));
  const chip = document.createElement('div'); chip.className = 'dragchip'; chip.textContent = task.title; chip.style.setProperty('--c', colourOf(task)); document.body.appendChild(chip);
  const ghost = document.createElement('div'); ghost.className = 'dragghost'; ghost.hidden = true; document.body.appendChild(ghost);
  const scroll0 = cal.scrollTop, calRect = cal.getBoundingClientRect(), dropRects = [queueEl, drawer].filter(x => x.offsetParent !== null && (x !== drawer || S.drawer)).map(x => x.getBoundingClientRect());
  const covered = kind === 'queue' && S.drawer ? drawer.getBoundingClientRect() : null; // a drawer row must not drop on the days hidden under the drawer
  const d = S.drag = { task, kind, target:null, pushed:[], px:ev.clientX, py:ev.clientY, frame:0, moved:[] };
  el.classList.add('lifted'); document.body.classList.add('dragging');

  function pick(x, y){
    if (kind === 'move' && dropRects.some(r => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) return { toQueue:true };
    if (covered && x >= covered.left && x <= covered.right && y >= covered.top && y <= covered.bottom) return null;
    if (y < calRect.top || y > calRect.bottom) return null;
    const c = cells.find(k => x >= k.r.left && x < k.r.right && (!month || (y >= k.r.top && y < k.r.bottom))); if (!c) return null;
    if (month) return { date:c.date, cell:c };
    const top = c.r.top - (cal.scrollTop - scroll0), raw = range[0] + (y - grabY - top) / PX;
    const minute = Math.max(range[0], Math.min(range[1] - task.duration_minutes, Math.round(raw / SLOT) * SLOT));
    return { date:c.date, minute, cell:c, top };
  }
  function clearPush(){ d.moved.forEach(b => { b.style.transform = ''; b.classList.remove('pushed'); }); d.moved = []; }
  function frame(){
    d.frame = 0;
    chip.style.transform = `translate(${d.px + 10}px,${d.py + 10}px)`;
    if (!month){ if (d.py < calRect.top + 32) cal.scrollTop -= 8; else if (d.py > calRect.bottom - 32) cal.scrollTop += 8; }
    const t = pick(d.px, d.py), same = t && d.target && t.date === d.target.date && t.minute === d.target.minute && !t.toQueue === !d.target.toQueue;
    if (same){ if (t.top != null){ ghost.style.transform = `translate(${t.cell.r.left + 2}px,${t.top + (t.minute - range[0]) * PX}px)`; } return; }
    cal.querySelector('.droptarget')?.classList.remove('droptarget'); queueEl.classList.toggle('dropping', !!t?.toQueue);
    clearPush(); ghost.hidden = true; d.target = t; d.pushed = [];
    if (!t || t.toQueue) return;
    if (month){ t.cell.el.classList.add('droptarget'); return; }
    ghost.hidden = false; ghost.style.width = t.cell.r.width - 4 + 'px'; ghost.style.height = task.duration_minutes * PX - 2 + 'px';
    ghost.style.transform = `translate(${t.cell.r.left + 2}px,${t.top + (t.minute - range[0]) * PX}px)`;
    d.pushed = P.pushPlan(P.dayTasks(t.date).filter(x => x.id !== task.id), t.minute, task.duration_minutes);
    d.pushed.forEach(p => { const b = blocks.get(p.id); if (b){ b.style.transform = `translateY(${(p.minute - store.get('tasks', p.id).start_minute) * PX}px)`; b.classList.add('pushed'); d.moved.push(b); } });
  }
  const schedule = () => { if (!d.frame) d.frame = requestAnimationFrame(frame); };
  const onMove = e => { d.px = e.clientX; d.py = e.clientY; schedule(); };
  function end(commit){
    removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp); removeEventListener('pointercancel', onCancel); removeEventListener('keydown', onKey, true);
    cancelAnimationFrame(d.frame); clearPush(); chip.remove(); ghost.remove(); el.classList.remove('lifted'); document.body.classList.remove('dragging');
    queueEl.classList.remove('dropping'); cal.querySelector('.droptarget')?.classList.remove('droptarget');
    S.drag = null; swallowClick = true; setTimeout(() => { swallowClick = false; });
    if (commit && d.target) drop(d);
    render();
  }
  const onUp = () => { frame(); end(true); };
  const onCancel = () => end(false);
  const onKey = e => { if (e.key === 'Escape'){ e.stopPropagation(); SFX.back(); end(false); } };
  addEventListener('pointermove', onMove); addEventListener('pointerup', onUp); addEventListener('pointercancel', onCancel); addEventListener('keydown', onKey, true);
  schedule();
}

function drop({ task, kind, target, pushed }){
  const undo = run => ({ label:'Undo', run }), note = pushed.length ? `, ${pushed.length} pushed` : '';
  if (target.toQueue) return toast('Sent to Unscheduled.', 'success', undo(P.toQueue(task.id)));
  const minute = target.minute ?? task.start_minute ?? P.nextFree(task, target.date)?.minute ?? DAY_START;
  if (kind === 'queue') return toast(`Scheduled ${fmtClock(minute)}${note}.`, 'success', undo(P.fromQueue(task.id, target.date, minute, pushed)));
  if (target.date === task.local_date && minute === task.start_minute) return SFX.tick();
  toast(`Moved to ${fmtClock(minute)}${note}.`, 'success', undo(P.moveTask(task.id, target.date, minute, pushed)));
}

function startResize(e, el, task){
  e.preventDefault(); const y0 = e.clientY, h0 = task.duration_minutes; let duration = h0, frame = 0, last = y0; S.drag = { resize:true };
  const paint = () => { frame = 0; duration = P.clampDuration(task.start_minute, h0 + Math.round((last - y0) / SLOT_PX) * SLOT); el.style.height = duration * PX - 2 + 'px'; };
  const move = ev => { last = ev.clientY; if (!frame) frame = requestAnimationFrame(paint); };
  const finish = commit => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('keydown', key, true); cancelAnimationFrame(frame); S.drag = null; swallowClick = true; setTimeout(() => { swallowClick = false; });
    if (!commit){ el.style.height = h0 * PX - 2 + 'px'; return render(); }
    paint(); if (duration !== h0) toast(`Now ${fmtDuration(duration)}.`, 'success', { label:'Undo', run:P.resizeTask(task.id, duration) }); render(); };
  const up = () => finish(true);
  const key = ev => { if (ev.key === 'Escape'){ ev.stopPropagation(); SFX.back(); finish(false); } };
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('keydown', key, true);
}

/* ===== Editor sheet ===== */
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
function openEditor(task, at = {}){
  const isNew = !task, bank = task?.state === 'bank', date = at.date || task?.local_date || S.date;
  const minute = at.minute ?? task?.start_minute ?? (date === today() ? Math.min(DAY_END - SLOT, Math.ceil(nowMinute() / SLOT) * SLOT) : 9 * 60);
  const dur = task?.duration_minutes || 30, durs = [...new Set([...Array.from({ length:16 }, (_, i) => (i + 1) * SLOT), dur])].sort((a, b) => a - b), pri = task?.priority_hint || 0;
  sheet(isNew ? 'New block' : 'Edit block', (b, close) => {
    b.innerHTML = `<form class="editor" novalidate><label class="field">Title<input name="title" required value="${esc(task?.title)}"></label>
      <label class="field">Notes<textarea name="notes" rows="3">${esc(task?.notes)}</textarea></label>
      <div class="two">${bank ? '' : `<label class="field">Date<input name="date" type="date" required value="${date}"></label><label class="field">Start<input name="time" type="time" step="1800" required value="${hhmm(minute)}"></label>`}
      <label class="field">Duration<select name="duration">${durs.map(d => `<option value="${d}"${d === dur ? ' selected' : ''}>${fmtDuration(d)}</option>`).join('')}</select></label>
      <label class="field">Who<select name="person">${personOptions(task?.assigned_person_id)}</select></label>
      <label class="field">Priority<select name="priority">${[[0, 'None'], [1, 'P1'], [2, 'P2'], [3, 'P3'], [4, 'Important']].map(([v, l]) => `<option value="${v}"${v === pri ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field">Colour<span class="row"><input name="color" type="color" value="${esc(task?.color || getComputedStyle(document.documentElement).getPropertyValue('--muted').trim())}" aria-label="Block colour"><button class="btn" type="button" data-nocolor${task?.color ? '' : ' hidden'}>Use person colour</button></span></label></div>
      ${isNew ? `<div class="two"><label class="field">Repeat<select name="repeat"><option value="">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option></select></label><label class="field" data-until hidden>Until<input name="until" type="date" value="${addDays(date, 90)}"></label></div>
      <fieldset class="field days" data-days hidden><legend class="small muted">Days</legend>${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => toggle(d, i < 5, `data-wd="${i}"`)).join('')}</fieldset>` : ''}
      <div class="sheet-actions">${task?.recurrence_rule_id ? '<button class="btn ghost danger-text" type="button" data-stop>Stop series from here</button><button class="btn ghost danger-text" type="button" data-delseries>Delete series</button>' : ''}${isNew ? '' : `<button class="btn ghost danger-text" type="button" data-del>Delete block</button>${bank ? '' : `<button class="btn" type="button" data-done>${isDone(task) ? 'Mark not done' : 'Mark done'}</button>`}<button class="btn" type="button" data-link>Link ClickUp</button>`}
      <span class="spacer"></span>${backBtn('Cancel')}<button class="btn primary" type="submit"><span class="glyph">A</span>Save</button></div></form>`;
    const f = $(b, 'form'), read = () => { const [h, m] = (f.time?.value || '00:00').split(':').map(Number);
      return { title:f.title.value.trim(), notes:f.notes.value.trim(), date:f.date?.value, minute:h * 60 + m, duration:+f.duration.value, personId:f.person.value, priority:+f.priority.value, color:picked ? f.color.value : null }; };
    let picked = !!task?.color;
    const fail = (el, msg) => { fieldErr(el, msg); SFX.error(); react('sad', 900); };
    f.color.oninput = () => { picked = true; $(b, '[data-nocolor]').hidden = false; };
    $(b, '[data-nocolor]').onclick = e => { picked = false; e.target.hidden = true; };
    $(b, '[data-close]').onclick = () => close();
    if (f.repeat) f.repeat.onchange = () => { $(b, '[data-until]').hidden = !f.repeat.value; $(b, '[data-days]').hidden = f.repeat.value !== 'weekly'; };
    f.onsubmit = e => { e.preventDefault(); const v = read(); if (!v.title) return fail(f.title, 'Give the block a title.');
      if (!bank && !f.date.value) return fail(f.date, 'Pick a date.');
      if (!bank && !f.time.value) return fail(f.time, 'Pick a start time.');
      if (task){ P.updateTask(task.id, v); close(true); toast('Saved.', 'success'); reveal(task.id); return; }
      if (f.repeat.value){ const wd = [...f.querySelectorAll('[data-wd][aria-checked="true"]')].map(i => +i.dataset.wd);
        if (f.repeat.value === 'weekly' && !wd.length) return fail($(b, '[data-days]'), 'Pick at least one day.');
        if (f.until.value < v.date) return fail(f.until, 'The end date needs to be after the start.');
        const n = P.createSeries({ ...v, frequency:f.repeat.value, weekdays:wd, until:f.until.value }); close(true); toast(`Added ${n} block${n === 1 ? '' : 's'}.`, 'success'); return; }
      const made = P.createBlock(v); close(true); toast('Saved.', 'success'); reveal(made.id); };
    if (task){ $(b, '[data-del]').onclick = () => { close(); toast('Block deleted.', null, { label:'Undo', run:P.deleteTask(task.id) }); };
      const doneBtn = $(b, '[data-done]'); if (doneBtn) doneBtn.onclick = () => { close(true); toggleDone(task); };
      $(b, '[data-link]').onclick = () => { close(true); openSession(task); }; }
    if (task?.recurrence_rule_id){
      $(b, '[data-stop]').onclick = async () => { const from = task.recurrence_local_date || task.local_date; if (await confirmSheet('Stop series', `Remove every occurrence from ${fmtDate(from)} onwards?`, 'Stop series', true, 'Keep series')){ P.stopSeries(task.recurrence_rule_id, from); close(true); toast('Series stopped.', 'success'); } };
      $(b, '[data-delseries]').onclick = async () => { if (await confirmSheet('Delete series', 'Remove the whole series and all its blocks?', 'Delete series', true, 'Keep series')){ P.deleteSeries(task.recurrence_rule_id); close(true); toast('Series deleted.', 'success'); } };
    }
    f.title.focus();
  }, { work:true });
}

/* ===== Work session sheet: this block is the session, linked ClickUp tasks are what gets batched into it ===== */
function openSession(task){
  const session = P.ensureSession(task), config = store.get('workspace_integrations', 'recall')?.config || {};
  const clickup = () => store.all('clickup_tasks').filter(r => !isIgnored(r, config)); // scope rules apply here too
  sheet(task.title, (b, close) => {
    b.innerHTML = `<div class="two"><label class="field">Session type<select data-type>${['focus', 'shoot', 'review', 'admin', 'planning', 'meeting', 'other'].map(t => `<option value="${t}"${t === session.session_type ? ' selected' : ''}>${cap(t)}</option>`).join('')}</select></label><label class="field">Batch label<input data-batch value="${esc(session.batch_label)}"></label></div>
      <div class="row sessbar"><button class="btn" type="button" data-start>Start</button><button class="btn" type="button" data-finish>Finish</button><span class="muted small" data-status></span></div>
      <div class="sess"><section><div class="row"><h3>ClickUp work</h3><span class="spacer"></span><button class="btn" type="button" data-suggest hidden></button></div><input data-search aria-label="Search ClickUp" placeholder="Search name, status, person, tag"><div class="sesslist" data-avail></div></section>
      <section><h3>Linked to this block</h3><div class="sesslist" data-linked></div></section></div>
      <div class="sheet-actions">${backBtn()}</div>`;
    let cur = session; const q = s => $(b, s), list = () => P.sessionLinks(session.id);
    const status = () => { q('[data-status]').textContent = cur.status === 'completed' && cur.actual_minutes != null ? `Completed, ${cur.actual_minutes}m` : cap(cur.status); };
    function paint(){
      const linked = new Set(list().map(l => l.clickup_task_id)), term = q('[data-search]').value.trim().toLowerCase(), rows = clickup().filter(r => !r.is_closed && !linked.has(r.clickup_task_id));
      const suggested = P.suggestLinks(task, clickup(), linked), sug = new Set(suggested.map(r => r.clickup_task_id));
      const shown = (term ? rows.filter(r => `${r.name} ${r.status} ${(r.assignee_names || []).join(' ')} ${(r.tags || []).join(' ')}`.toLowerCase().includes(term)) : [...suggested, ...rows.filter(r => !sug.has(r.clickup_task_id))]).slice(0, 200);
      const btn = q('[data-suggest]'); btn.hidden = !suggested.length; btn.textContent = `Link ${suggested.length} suggested`;
      q('[data-avail]').innerHTML = shown.map(r => `<div class="qrow" data-cid="${esc(r.clickup_task_id)}"><span class="qtext"><span class="clip">${esc(r.name)}</span><span class="small muted clip">${sug.has(r.clickup_task_id) ? 'Suggested · ' : ''}${[cap(r.status), (r.assignee_names || []).join(', ')].filter(Boolean).map(esc).join(' · ')}</span></span><button class="btn" type="button" data-add>Link</button></div>`).join('') || '<p class="muted">No open ClickUp work matches.</p>';
      q('[data-linked]').innerHTML = list().map(l => { const r = store.get('clickup_tasks', l.clickup_task_id) || { name:l.clickup_task_id }; return `<div class="qrow${l.completed_in_session_at ? ' isdone' : ''}" data-cid="${esc(l.clickup_task_id)}"><button class="tick big" type="button" data-result aria-pressed="${!!l.completed_in_session_at}" aria-label="Done in session">${l.completed_in_session_at ? icon('check') : ''}</button><span class="qtext"><span class="clip">${esc(r.name)}</span><span class="small muted clip">${esc(cap(r.status))}</span></span>${r.url ? '<button class="btn" type="button" data-open>Open</button>' : ''}<button class="btn" type="button" data-remove data-sfx="back">Unlink</button></div>`; }).join('') || '<p class="muted">Attach everything you plan to batch in this block. Linked estimates are effort, not extra calendar time.</p>';
    }
    q('[data-search]').oninput = e => { if (e.target.value.length === 1) SFX.sniff(); paint(); };
    q('[data-type]').onchange = e => { cur = store.put('work_sessions', { ...cur, session_type:e.target.value }); };
    q('[data-batch]').onchange = e => { cur = store.put('work_sessions', { ...cur, batch_label:e.target.value.trim() || null }); };
    q('[data-start]').onclick = () => { cur = P.startSession(cur); status(); };
    q('[data-finish]').onclick = () => { cur = P.finishSession(cur); status(); toast('Session finished.', 'success'); };
    q('[data-close]').onclick = () => close();
    q('[data-suggest]').onclick = () => { P.suggestLinks(task, clickup(), new Set(list().map(l => l.clickup_task_id))).forEach(r => P.linkClickUp(cur, r)); paint(); };
    b.addEventListener('click', e => { const row = e.target.closest('[data-cid]'); if (!row) return; const cid = row.dataset.cid;
      if (e.target.closest('[data-add]')) P.linkClickUp(cur, store.get('clickup_tasks', cid));
      else if (e.target.closest('[data-remove]')) P.unlinkClickUp(session.id, cid);
      else if (e.target.closest('[data-result]')) P.toggleLinkDone(list().find(l => l.clickup_task_id === cid));
      else if (e.target.closest('[data-open]')) return openExternal(store.get('clickup_tasks', cid).url);
      else return;
      paint(); });
    status(); paint();
  }, { wide:true });
}

/* ===== Clock: now line, day rollover, daily break ===== */
function tick(){
  if (cal?.querySelector('.nowline')) placeNow();
  if (gridKey && !gridKey.endsWith('|' + today())) render();
  maybeBreak(); maybeHeadsUp(); maybeWrapUp(); syncWrapChip();
}
const notify = (title, body) => { if (!document.hasFocus()) window.__TAURI__?.notification?.sendNotification({ title, body }); };

// Five minutes before a block or a meeting. Once per item per launch: a restart inside that window may repeat one, which is harmless.
const toldAbout = new Set();
function maybeHeadsUp(){
  if (store.pref('block_headsup', '1') === '0') return;
  const d = today(), m = nowMinute();
  const soon = [...P.dayTasks(d).filter(t => !isDone(t)), ...calendar.eventsOn(d)].filter(t => t.start_minute >= m && t.start_minute - m <= 5 && !toldAbout.has(t.id));
  if (!soon.length) return;
  soon.forEach(t => toldAbout.add(t.id));
  const t = soon[0], left = t.start_minute - m, when = left === 0 ? 'now' : `in ${left} min`, text = `${t.title} starts ${when}.`;
  notify('Up next', text);
  toast(text, 'new', store.get('tasks', t.id) ? { label:'Start', run:() => { P.startSession(P.ensureSession(t)); toast(`Started ${t.title}.`, 'success'); } } : undefined);
}

/* ===== Fill my day: waiting work goes into free time, around meetings, after a preview ===== */
function fillDay(){
  const asked = S.mode === 'day' && S.date > today() ? S.date : today(), q = P.queue();
  if (!q.length) return toast('Nothing is waiting in Unscheduled work.');
  let date = asked, found = null; // a full or finished day moves on to the next one with room, so the search isn't the user's job
  for (let i = 0; i < 7 && !found; i++){
    date = addDays(asked, i);
    const planned = P.dayTasks(date).reduce((n, t) => n + (+t.duration_minutes || 0), 0), r = P.fillPlan(P.busyOn, q, { date, planned });
    if (r.placed.length) found = r;
  }
  if (!found) return toast('No room in the next week. Make some time, or move something.');
  const { placed, left } = found, total = placed.reduce((n, p) => n + p.duration, 0), s = placed.length === 1 ? '' : 's';
  sheet(date === today() ? 'Fill my day' : `Fill ${fmtDate(date)}`, (b, close) => {
    fill(b, `<p class="muted">${date === asked ? '' : `Nothing fits ${asked === today() ? 'today' : fmtDate(asked)}. `}${placed.length} block${s}, ${fmtDuration(total)}, placed around what’s already planned.</p>
      <div class="plist">${[...placed].sort((a, c) => a.minute - c.minute).map(p => `<div class="prow"><span class="ptime">${fmtClock(p.minute)}</span><span class="clip">${esc(p.title)}</span><span class="small muted">${fmtDuration(p.duration)}</span></div>`).join('')}</div>
      ${left.length ? `<p class="small muted">${left.length} more won’t fit and stay in Unscheduled work.</p>` : ''}
      <div class="sheet-actions">${backBtn('Cancel')}<button class="btn primary" type="button" data-go><span class="glyph">A</span>Schedule ${placed.length}</button></div>`);
    $(b, '[data-close]').onclick = () => close();
    $(b, '[data-go]').onclick = () => {
      const undos = placed.map(p => P.fromQueue(p.id, p.date, p.minute)); close(true);
      toast(`Scheduled ${placed.length} block${s}.`, 'success', { label:'Undo', run:() => [...undos].reverse().forEach(u => u()) }); reveal(placed[0].id);
    };
    $(b, '[data-go]').focus();
  });
}

/* ===== Wrap up: how the day went, and one tap for what's left ===== */
function maybeWrapUp(){
  const d = today(), at = +store.pref('wrapup_minute', 1050), m = nowMinute();
  if (store.pref('wrapup_enabled', '1') === '0' || store.pref('wrapup_seen', '') === d || m < at || m > at + 180 || document.querySelector('dialog[open]') || !P.dayTasks(d).length) return;
  store.setPref('wrapup_seen', d);
  notify('Wrap up your day', 'See how today went and carry the rest over.');
  toast('Time to wrap up your day.', 'new', { label:'Review', run:wrapUp });
}
// The toast is a few seconds long; this stays in the toolbar from the set time until the day has been wrapped up.
const wrapDue = () => store.pref('wrapup_enabled', '1') !== '0' && nowMinute() >= +store.pref('wrapup_minute', 1050) && store.pref('wrapup_done', '') !== today() && P.dayTasks(today()).length > 0;
function syncWrapChip(){ const b = root && $(root, '[data-act="wrap"]'); if (b) b.hidden = !wrapDue(); }
function wrapUp(){
  const d = today(), tasks = P.dayTasks(d), open = tasks.filter(t => !isDone(t)), done = tasks.length - open.length;
  if (!tasks.length) return toast('Nothing was planned today.');
  store.setPref('wrapup_done', d); syncWrapChip();
  const minutes = tasks.filter(isDone).reduce((n, t) => n + (+t.duration_minutes || 0), 0), plan = open.length ? P.carryPlan(P.busyOn, open, { date:addDays(d, 1) }) : [];
  const tomorrow = new Map(plan.map(p => [p.id, p]));
  if (done / tasks.length >= .8) react('happy', 900);
  sheet('Wrap up your day', (b, close) => {
    const head = `<p>${done} of ${tasks.length} block${tasks.length === 1 ? '' : 's'} done, ${fmtDuration(minutes) || '0m'} finished.</p>`;
    if (!open.length){ fill(b, `${head}${stateBlock('happy', 'Everything is done', 'Nothing to carry over.')}<div class="sheet-actions">${backBtn('Close')}</div>`); $(b, '[data-close]').onclick = () => close(); return; }
    const days = new Set(plan.map(p => p.date)), one = days.size === 1 ? [...days][0] : null; // one day: say it once, not on every row
    fill(b, `${head}<h3>Still open${one ? `, moving to ${esc(fmtDate(one))}` : ''}</h3><div class="plist">${open.map(t => { const p = tomorrow.get(t.id);
        return `<div class="prow"><span class="clip">${esc(t.title)}</span><span class="small muted">${p ? (one ? fmtClock(p.minute) : `${fmtDate(p.date)}, ${fmtClock(p.minute)}`) : 'No room soon'}</span></div>`; }).join('')}</div>
      <div class="sheet-actions">${backBtn('Keep them today')}<button class="btn" type="button" data-queue data-sfx="back">Send to Unscheduled</button>${plan.length ? '<button class="btn primary" type="button" data-carry><span class="glyph">A</span>Carry to tomorrow</button>' : ''}</div>`);
    const undoAll = undos => ({ label:'Undo', run:() => [...undos].reverse().forEach(u => u()) });
    $(b, '[data-close]').onclick = () => close();
    $(b, '[data-queue]').onclick = () => { const undos = open.map(t => P.toQueue(t.id)); close(true); toast(`Sent ${open.length} to Unscheduled work.`, 'success', undoAll(undos)); };
    const go = $(b, '[data-carry]');
    if (go){ go.onclick = () => { const undos = plan.map(p => P.moveTask(p.id, p.date, p.minute)); close(true); toast(`Carried ${plan.length} to tomorrow.`, 'success', undoAll(undos)); }; go.focus(); }
  }, { wide:true });
}
function maybeBreak(){
  const d = today(), m = nowMinute(), at = +store.pref('break_reminder_minute', 780);
  if (store.pref('break_reminders_enabled', '1') === '0' || store.pref('break_reminder_seen', '') === d || m < at || m > at + 180 || document.querySelector('dialog[open]')) return;
  if (Date.now() < new Date(store.pref('break_reminder_snooze_until', '') || 0).getTime()) return;
  const text = '10 to 15 minutes away from the screen. Stand up, water, food, eyes off the monitor.';
  if (!document.hasFocus()) window.__TAURI__?.notification?.sendNotification({ title:'Take a real break', body:text });
  store.setPref('break_reminder_seen', d);
  toast(`Take a real break. ${text}`, 'new', { label:'Snooze 30 min', run:() => { store.setPref('break_reminder_seen', ''); store.setPref('break_reminder_snooze_until', new Date(Date.now() + 18e5).toISOString()); } });
}

export default { mount, render, onShow(){ tick(); render(); }, newBlock(){ if (!root) return; openEditor(null); }, fillDay, wrapUp };
