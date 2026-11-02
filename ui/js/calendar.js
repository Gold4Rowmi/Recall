// Meetings from the user's calendar link. They show on Today and automatic planning works around them. The link lives in the user's own
// preferences row (private to them); the meetings are cached on this device and never written back to the cloud.
import * as store from './store.js';
import * as P from './planner.js';
import { parseICS, occurrences } from './ics.js';
import { calendarFeed } from './sync.js';
import { mondayOf, addDays, today } from './time.js';
import { DEMO_ICS } from './demo.js';

const EVERY = 15 * 60 * 1000;
export const HOSTS = /(^|\.)(outlook\.office365\.com|outlook\.live\.com|outlook\.office\.com|calendar\.google\.com|icloud\.com)$/; // the edge function enforces the same list
let model = null, cache = new Map(), demo = false;

export const feedUrl = () => store.pref('calendar_feed_url', '');
export const hostOf = url => { try { return new URL(url).hostname; } catch { return ''; } };
export const updatedAt = () => store.getMeta('calAt') || 0;
const changed = () => { cache.clear(); dispatchEvent(new CustomEvent('recall:calendar')); };

// A week at a time: one pass over the feed fills seven days.
export function eventsOn(date){
  if (!model) return [];
  if (!cache.has(date)){
    const monday = mondayOf(date), found = occurrences(model, monday, addDays(monday, 6));
    for (let i = 0; i < 7; i++) cache.set(addDays(monday, i), []);
    found.forEach(e => cache.get(e.date).push(e));
  }
  return cache.get(date);
}
export const countThisWeek = () => { const m = mondayOf(today()); return Array.from({ length:7 }, (_, i) => eventsOn(addDays(m, i)).length).reduce((a, b) => a + b, 0); };

function load(text){ model = parseICS(text); changed(); }

// Throws with a sentence the user can act on.
export async function refresh(){
  const url = feedUrl(); if (demo || !url) return;
  const { data, error } = await calendarFeed(url);
  if (error){ const body = await error.context?.json?.().catch(() => null); throw new Error(body?.error || 'Couldn’t reach the calendar. Try again in a moment.'); } // the function's own message rides on the failed response
  if (!data?.ics) throw new Error('Couldn’t read that calendar link.');
  store.setMeta('calText', data.ics); store.setMeta('calAt', Date.now()); load(data.ics);
}
export async function connect(raw){
  const url = raw.trim().replace(/^webcal:/i, 'https:');
  if (!/^https:\/\//i.test(url) || !HOSTS.test(hostOf(url))) throw new Error('That doesn’t look like an Outlook, Google or iCloud calendar link.');
  const before = feedUrl();
  store.setPref('calendar_feed_url', url);
  try { await refresh(); } catch (e){ store.setPref('calendar_feed_url', before); throw e; }
}
const clear = () => { store.setMeta('calText', ''); store.setMeta('calAt', 0); model = null; changed(); };
export function disconnect(){ store.setPref('calendar_feed_url', ''); clear(); }

export function init(isDemo){
  demo = isDemo; P.setExternal(eventsOn);
  if (demo){ load(DEMO_ICS()); return; }
  const cached = store.getMeta('calText'); if (cached) load(cached);
  let busy = false;
  const tick = () => { if (busy || !feedUrl() || Date.now() - updatedAt() <= EVERY) return; busy = true; refresh().catch(e => console.warn('calendar refresh failed', e)).finally(() => { busy = false; }); };
  setTimeout(tick, 2000); setInterval(tick, EVERY / 3); addEventListener('focus', tick);
  store.on(set => { if (!set.has('app_preferences')) return; if (!feedUrl() && model) clear(); else tick(); }); // disconnected on another PC, or the link arrived with the first pull
}
