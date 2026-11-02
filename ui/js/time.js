// Dates are local 'YYYY-MM-DD' strings in Australia/Melbourne, matching tasks.local_date; minutes count from midnight.
const TZ = 'Australia/Melbourne';
const pad = n => String(n).padStart(2, '0');
const fmt = new Intl.DateTimeFormat('en-AU', { timeZone:TZ, hourCycle:'h23', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' });
function parts(d){ const o = {}; fmt.formatToParts(d).forEach(p => { o[p.type] = +p.value; }); return o; }

export function today(now = new Date()){ const p = parts(now); return `${p.year}-${pad(p.month)}-${pad(p.day)}`; }
export function nowMinute(now = new Date()){ const p = parts(now); return p.hour * 60 + p.minute; }
export function localAt(ms){ const p = parts(new Date(ms)); return { date:`${p.year}-${pad(p.month)}-${pad(p.day)}`, minute:p.hour * 60 + p.minute }; }
export const addDays =(date, n) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const weekday = date => (new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7; // Monday = 0, as Python's date.weekday()
export const mondayOf = date => addDays(date, -weekday(date));
export const fmtMinute = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export const fmtDuration = m => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m}m`;
export const fmtDate = (date, opts = { weekday:'short', day:'numeric', month:'short' }) => new Date(date + 'T12:00:00Z').toLocaleDateString('en-AU', { ...opts, timeZone:'UTC' });

// The instant a Melbourne wall-clock time happens, for tasks.scheduled_start. Handles DST by measuring the offset.
export function melbourneISO(date, minute){
  const guess = new Date(`${date}T${pad(Math.floor(minute / 60))}:${pad(minute % 60)}:00Z`);
  const p = parts(guess), shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return new Date(guess.getTime() - (shown - guess.getTime())).toISOString();
}
