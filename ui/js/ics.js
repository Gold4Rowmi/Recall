// Reads a published calendar feed (the .ics link Outlook and Google give out) into busy blocks in Melbourne time.
// shortcut: all-day, free and cancelled events are skipped, a handful of Windows zone names are mapped and unknown zones read as Melbourne time. Add to WIN_ZONES if a meeting lands at the wrong hour.
import { addDays, localAt, mondayOf, weekday } from './time.js';

const HOME = 'Australia/Melbourne', DAY = 864e5, DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const WIN_ZONES = { 'AUS Eastern Standard Time':'Australia/Sydney', 'E. Australia Standard Time':'Australia/Brisbane', 'Cen. Australia Standard Time':'Australia/Adelaide', 'AUS Central Standard Time':'Australia/Darwin',
  'W. Australia Standard Time':'Australia/Perth', 'Tasmania Standard Time':'Australia/Hobart', 'New Zealand Standard Time':'Pacific/Auckland', 'Singapore Standard Time':'Asia/Singapore', 'Tokyo Standard Time':'Asia/Tokyo',
  'India Standard Time':'Asia/Kolkata', 'GMT Standard Time':'Europe/London', 'W. Europe Standard Time':'Europe/Berlin', 'Central Europe Standard Time':'Europe/Budapest', 'Eastern Standard Time':'America/New_York',
  'Central Standard Time':'America/Chicago', 'Pacific Standard Time':'America/Los_Angeles', 'UTC':'UTC' };
const pad = n => String(n).padStart(2, '0');
const ymd = w => `${w.y}-${pad(w.mo)}-${pad(w.d)}`;

const formats = new Map();
function zone(name){
  const tz = WIN_ZONES[name] || name || HOME;
  if (!formats.has(tz)){
    try { formats.set(tz, new Intl.DateTimeFormat('en-US', { timeZone:tz, hourCycle:'h23', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' })); }
    catch { zone(HOME); formats.set(tz, formats.get(HOME)); } // a zone name Intl doesn't know reads as Melbourne
  }
  return tz;
}
const offset = (ms, tz) => { const p = {}; formats.get(tz).formatToParts(new Date(ms)).forEach(x => { p[x.type] = +x.value; }); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms; };
// The instant a wall-clock time happens in a zone; measuring the offset twice settles the hour a daylight change moves.
function wallToMs(w, tz){ const guess = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s); return guess - offset(guess - offset(guess, tz), tz); }

function parseTime(value, params = {}){
  const m = /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)?(Z)?)?$/.exec(String(value).trim()); if (!m) return null;
  const w = { y:+m[1], mo:+m[2], d:+m[3], h:+(m[4] || 0), mi:+(m[5] || 0), s:+(m[6] || 0) }, tz = m[7] ? zone('UTC') : zone(params.TZID);
  return { w, tz, allDay:m[4] === undefined, ms:wallToMs(w, tz) };
}
function parseDuration(v){ const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v); return m ? ((+m[1] || 0) * 7 * 864e5 + (+m[2] || 0) * 864e5 + (+m[3] || 0) * 36e5 + (+m[4] || 0) * 6e4 + (+m[5] || 0) * 1e3) : 0; }
function parseRule(v){
  const r = {}; v.split(';').forEach(kv => { const [k, val = ''] = kv.split('='); r[k.toUpperCase()] = val; });
  return { freq:r.FREQ, interval:+r.INTERVAL || 1, count:+r.COUNT || 0, until:r.UNTIL ? parseTime(r.UNTIL) : null, by:(r.BYDAY || '').split(',').filter(Boolean), monthDay:+(r.BYMONTHDAY || '').split(',')[0] || 0 };
}
function prop(line){
  const i = line.indexOf(':'); if (i < 0) return null;
  const [name, ...ps] = line.slice(0, i).split(';'), params = {};
  ps.forEach(p => { const [k, v = ''] = p.split('='); params[k.toUpperCase()] = v.replace(/"/g, ''); });
  return { name:name.toUpperCase(), params, value:line.slice(i + 1) };
}
const text = s => s.replace(/\\[nN]/g, ' ').replace(/\\([,;\\])/g, '$1');

export function parseICS(source){
  const raw = [], lines = String(source).replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  let cur = null;
  for (const line of lines){
    if (line === 'BEGIN:VEVENT') cur = { ex:new Set(), title:'Busy' };
    else if (line === 'END:VEVENT'){ if (cur) raw.push(cur); cur = null; }
    else if (cur){
      const p = prop(line); if (!p) continue;
      if (p.name === 'UID') cur.uid = p.value;
      else if (p.name === 'SUMMARY') cur.title = text(p.value).trim() || 'Busy';
      else if (p.name === 'DTSTART') cur.start = parseTime(p.value, p.params);
      else if (p.name === 'DTEND') cur.end = parseTime(p.value, p.params);
      else if (p.name === 'DURATION') cur.dur = parseDuration(p.value);
      else if (p.name === 'RRULE') cur.rule = parseRule(p.value);
      else if (p.name === 'EXDATE') p.value.split(',').forEach(v => { const t = parseTime(v, p.params); if (t) cur.ex.add(t.ms); });
      else if (p.name === 'RECURRENCE-ID') cur.recId = parseTime(p.value, p.params)?.ms;
      else if (p.name === 'STATUS') cur.cancelled = /CANCELLED/i.test(p.value);
      else if (p.name === 'TRANSP') cur.free = /TRANSPARENT/i.test(p.value);
    }
  }
  const over = new Map(); // moved or cancelled single occurrences: they replace the series' own
  raw.forEach(e => { if (e.recId != null) (over.get(e.uid) || over.set(e.uid, new Set()).get(e.uid)).add(e.recId); });
  const events = raw.filter(e => e.start && !e.start.allDay && !e.cancelled && !e.free).map(e => ({ uid:e.uid, title:e.title, start:e.start, recId:e.recId, rule:e.recId != null ? null : e.rule, ex:e.ex,
    durMs:e.end ? e.end.ms - e.start.ms : e.dur || 0 })).filter(e => e.durMs > 0);
  return { events, over };
}

function validDate(d){ return new Date(d + 'T12:00:00Z').toISOString().slice(0, 10) === d; }
function nthWeekday(y, mo, byDay){ // '1MO' is the first Monday, '-1FR' the last Friday
  const m = /^(-?\d)([A-Z]{2})$/.exec(byDay); if (!m) return null;
  const wd = DAYS.indexOf(m[2]), last = new Date(Date.UTC(y, mo, 0)).getUTCDate(), hits = [];
  for (let d = 1; d <= last; d++) if (weekday(`${y}-${pad(mo)}-${pad(d)}`) === wd) hits.push(d);
  const d = +m[1] > 0 ? hits[m[1] - 1] : hits[hits.length + +m[1]];
  return d ? `${y}-${pad(mo)}-${pad(d)}` : null;
}
// Dates in the event's own zone, oldest first. The caller stops once it is past the window.
function* wallDates({ start, rule }){
  const s0 = ymd(start.w);
  if (!rule){ yield s0; return; }
  const iv = rule.interval;
  if (rule.freq === 'DAILY') for (let i = 0; i < 4000; i++) yield addDays(s0, i * iv);
  else if (rule.freq === 'WEEKLY'){
    const days = (rule.by.length ? rule.by.map(x => DAYS.indexOf(x.slice(-2))) : [weekday(s0)]).filter(i => i >= 0).sort((a, b) => a - b);
    for (let i = 0; i < 1500; i++){ const wk = addDays(mondayOf(s0), i * iv * 7); for (const dn of days){ const d = addDays(wk, dn); if (d >= s0) yield d; } }
  } else if (rule.freq === 'MONTHLY'){
    for (let i = 0; i < 600; i++){
      const t = start.w.mo - 1 + i * iv, y = start.w.y + Math.floor(t / 12), mo = t % 12 + 1;
      const d = /\d/.test(rule.by[0] || '') ? nthWeekday(y, mo, rule.by[0]) : `${y}-${pad(mo)}-${pad(rule.monthDay || start.w.d)}`;
      if (d && d >= s0 && validDate(d)) yield d;
    }
  } else if (rule.freq === 'YEARLY'){
    for (let i = 0; i < 100; i++){ const d = `${start.w.y + i * iv}-${pad(start.w.mo)}-${pad(start.w.d)}`; if (validDate(d)) yield d; }
  } else yield s0;
}

const dayMs = date => wallToMs({ y:+date.slice(0, 4), mo:+date.slice(5, 7), d:+date.slice(8, 10), h:0, mi:0, s:0 }, zone(HOME));

// Busy segments on each Melbourne day from `from` to `to`, as { id, title, date, start_minute, duration_minutes }. A meeting over midnight is split.
export function occurrences(model, from, to){
  const lo = dayMs(from) - DAY, hi = dayMs(to) + 2 * DAY, skip = addDays(from, -2), out = [];
  for (const ev of model.events){
    let n = 0;
    for (const date of wallDates(ev)){
      n++; if (ev.rule?.count && n > ev.rule.count) break;
      if (date < skip) continue;
      const ms = wallToMs({ ...ev.start.w, y:+date.slice(0, 4), mo:+date.slice(5, 7), d:+date.slice(8, 10) }, ev.start.tz);
      if (ms > hi || (ev.rule?.until && ms > ev.rule.until.ms + (ev.rule.until.allDay ? DAY : 0))) break;
      if (ms + ev.durMs < lo || ev.ex.has(ms) || (ev.recId == null && model.over.get(ev.uid)?.has(ms))) continue;
      const at = localAt(ms); let { date: day, minute } = at, left = Math.round(ev.durMs / 6e4);
      for (let guard = 0; left > 0 && guard < 14; guard++){
        const take = Math.min(left, 1440 - minute);
        if (day >= from && day <= to) out.push({ id:`x:${ev.uid}:${ms}:${day}`, title:ev.title, date:day, start_minute:minute, duration_minutes:take });
        left -= take; day = addDays(day, 1); minute = 0;
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.start_minute - b.start_minute);
}
