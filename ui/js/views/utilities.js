// Rare work: follow-ups, weekly export, settings.
import * as store from '../store.js';
import * as P from '../planner.js';
import * as sync from '../sync.js';
import * as calendar from '../calendar.js';
import { toast, setMuted, setVolume, setDogSounds, paintDogs, SFX } from '../brand.js';
import * as ui from '../ui.js';
import { esc, icon, sheet, confirmSheet, fill, stateBlock, backBtn, toggle, isOn } from '../ui.js';
import { today, mondayOf, addDays } from '../time.js';

const COLORS = ['#5F6B7A', '#4E9F6C', '#B77AD9', '#D98B5F', '#C85F72', '#5B9AA0', '#997A5B']; // person colours are user data, not UI tokens
const set = (fn, v) => localStorage.setItem(fn, v);
const applyTheme = t => { if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t; };
export const applyMotion = () => { const m = store.pref('ui_motion_enabled', '1') === '0' ? 'off' : 'on'; document.documentElement.dataset.motion = m; localStorage.setItem('recall.motion', m); }; // js/prefs.js reads it back before the store opens
store.on(set => { if (set.has('app_preferences')) applyMotion(); });

export const people = () => store.all('workspace_people').filter(p => p.active !== false).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
export const personOptions = sel => `<option value="">Unassigned</option>` + people().map(p => `<option value="${esc(p.id)}"${p.id === sel ? ' selected' : ''}>${esc(p.display_name)}</option>`).join('');

/* ===== Follow-ups ===== */
export function openFollowUps(){
  dispatchEvent(new CustomEvent('recall:go', { detail:'today' }));
  dispatchEvent(new CustomEvent('recall:drawer', { detail:'followups' }));
}
let showDone = false;
export function mountFollowUps(el){
  el.innerHTML = `<form class="capture"><input aria-label="New follow-up" placeholder="Add a follow-up" required><button class="btn" type="submit">Add</button></form>
    ${toggle('Show done', showDone, 'data-done')}<div class="fu-list"></div>`;
  el.querySelector('form').onsubmit = e => { e.preventDefault(); const i = e.target.querySelector('input'); P.addReminder(i.value.trim()); i.value = ''; };
  el.querySelector('[data-done]').onclick = e => { showDone = isOn(e.currentTarget); renderFollowUps(el); };
  el.querySelector('.fu-list').onclick = e => { const b = e.target.closest('[data-fu]'); if (!b) return; if (b.dataset.fu === 'add') return el.querySelector('input').focus();
    const id = b.closest('[data-id]').dataset.id;
    if (b.dataset.fu === 'done') P.toggleReminder(id);
    else if (b.dataset.fu === 'queue'){ P.reminderToQueue(id); toast('Moved to Unscheduled.', 'success'); }
    else if (b.dataset.fu === 'del') toast('Follow-up deleted.', null, { label:'Undo', run:P.deleteReminder(id) }); };
  el.querySelector('.fu-list').onchange = e => { const s = e.target.closest('select'); if (s) store.patch('reminders', s.closest('[data-id]').dataset.id, { assigned_person_id:s.value || null }); };
  renderFollowUps(el);
}
export function renderFollowUps(el){
  const list = el.querySelector('.fu-list'), rows = P.reminders().filter(r => showDone || !r.completed_at);
  const html = rows.length ? rows.map(r => `<div class="qrow furow${r.completed_at ? ' isdone' : ''}" data-id="${esc(r.id)}">
      <button class="tick big" type="button" data-fu="done" aria-pressed="${!!r.completed_at}" aria-label="Mark done">${r.completed_at ? icon('check') : ''}</button>
      <span class="qtext">${esc(r.title)}</span>
      <select aria-label="Assigned to">${personOptions(r.assigned_person_id)}</select>
      <button class="btn" type="button" data-fu="queue" title="Move to Unscheduled">Unscheduled</button><button class="btn ghost danger-text" type="button" data-fu="del" data-sfx="back" data-x><span class="glyph">X</span>Delete</button></div>`).join('')
    : stateBlock('sleepy', 'No follow-ups', 'Add anything you need to chase up.', '<button class="btn primary" type="button" data-fu="add"><span class="glyph">A</span>Add a follow-up</button>');
  if (list.dataset.html !== html){ list.dataset.html = html; fill(list, html); }
}

/* ===== Export ===== */
export function exportWeek(){
  const monday = mondayOf(today()), peopleMap = new Map(store.all('workspace_people').map(p => [p.id, p]));
  const text = P.journal(P.rangeTasks(monday, addDays(monday, 6)), peopleMap, monday);
  sheet('Export week', (b, close) => {
    b.innerHTML = `<textarea rows="16" readonly aria-label="Weekly journal">${esc(text)}</textarea>
      <div class="sheet-actions">${backBtn()}<button class="btn" type="button" data-copy>Copy</button><button class="btn primary" type="button" data-save><span class="glyph">A</span>Download</button></div>`;
    b.querySelector('[data-close]').onclick = () => close();
    b.querySelector('[data-copy]').onclick = async () => { try { await navigator.clipboard.writeText(text); toast('Copied.', 'success'); } catch { toast('Couldn’t copy. Select the text and copy it instead.', 'error'); } };
    b.querySelector('[data-save]').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type:'text/markdown' })); a.download = `recall-week-${monday}.md`; a.click(); URL.revokeObjectURL(a.href); toast('Download started.', 'big'); };
  }, { wide:true });
}

/* ===== Settings ===== */
function teamRows(){
  return people().map(p => `<div class="qrow" data-id="${esc(p.id)}"><input type="color" aria-label="Colour" value="${esc(p.color || COLORS[0])}"><input type="text" aria-label="Name" value="${esc(p.display_name)}"><button class="btn ghost danger-text" type="button" data-remove data-sfx="back">Remove</button></div>`).join('');
}
export function openSettings(){
  sheet('Settings', (b, close) => {
    const theme = localStorage.getItem('recall.theme') || 'system', muted = store.pref('sound_muted', '0') === '1', volume = +store.pref('sound_volume', '6'), motion = store.pref('ui_motion_enabled', '1') !== '0';
    const brk = store.pref('break_reminders_enabled', '1') !== '0', minute = +store.pref('break_reminder_minute', 780), hhmm = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    const wrap = +store.pref('wrapup_minute', 1050), wrapAt = `${String(Math.floor(wrap / 60)).padStart(2, '0')}:${String(wrap % 60).padStart(2, '0')}`;
    b.innerHTML = `<div class="settings">
      <label class="field">Theme<select data-theme-pick><option value="system">${window.__TAURI__ ? 'Match Windows' : 'Match this device'}</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
      ${toggle('Sound', !muted, 'data-sound')}
      <div class="detent-ctl"><label class="field">Volume<input type="range" min="0" max="10" step="1" value="${volume}" data-volume></label><div class="ticks" aria-hidden="true">${Array.from({ length:11 }, (_, i) => `<i class="${i <= volume ? 'on' : ''}"></i>`).join('')}</div></div>
      ${toggle('Dog sounds', store.pref('dog_sounds', '1') !== '0', 'data-dogs')}
      ${toggle('Motion', motion, 'data-motion')}
      <h3 class="pixel sect">Reminders</h3>
      ${toggle('Daily break reminder', brk, 'data-break')}
      <label class="field">Break time<input type="time" step="1800" data-break-at value="${hhmm}"><span class="help">Shows once a day, up to three hours after this time.</span></label>
      ${toggle('Heads-up 5 minutes before blocks', store.pref('block_headsup', '1') !== '0', 'data-headsup')}
      ${toggle('End-of-day wrap-up', store.pref('wrapup_enabled', '1') !== '0', 'data-wrap')}
      <label class="field">Wrap-up time<input type="time" step="1800" data-wrap-at value="${wrapAt}"><span class="help">Offers to carry what’s left to tomorrow, once a day.</span></label>
      <h3 class="pixel sect">Planning</h3>
      <label class="field">Team capacity hours per week<input type="number" min="0" max="168" data-capacity value="${esc(store.pref('team_capacity_hours', '30'))}"></label>
      <h3 class="pixel sect">Calendar</h3><div data-calendar></div>
      <h3 class="pixel sect">ClickUp</h3><div class="row" data-cu><span class="muted">Checking the connection</span></div>
      <h3 class="pixel sect">Team</h3><div data-team>${teamRows()}</div>
      <form class="capture" data-add><input aria-label="New team member" placeholder="Add a team member" required><button class="btn" type="submit">Add</button></form>
      <h3 class="pixel sect">Keyboard</h3><dl class="keys">${(ui.SHORTCUTS || []).map(s => { const [k, d] = Array.isArray(s) ? s : [s.keys ?? s.key, s.label ?? s.action]; return `<dt>${esc(k)}</dt><dd>${esc(d)}</dd>`; }).join('')}</dl>
      <h3 class="pixel sect">Account</h3><button class="btn" type="button" data-about>About RECALL</button><button class="btn" type="button" data-out data-sfx="back">Sign out</button>
      </div><div class="sheet-actions">${backBtn()}</div>`;
    const $ = s => b.querySelector(s);
    $('[data-theme-pick]').value = theme;
    $('[data-theme-pick]').onchange = e => { set('recall.theme', e.target.value); applyTheme(e.target.value); paintDogs(); };
    $('[data-sound]').onclick = e => { const on = isOn(e.currentTarget); store.setPref('sound_muted', on ? '0' : '1'); setMuted(!on); };
    $('[data-volume]').oninput = e => { const v = +e.target.value; setVolume(v); SFX.detent(v); b.querySelectorAll('.ticks i').forEach((t, i) => t.classList.toggle('on', i <= v)); };
    $('[data-volume]').onchange = e => store.setPref('sound_volume', e.target.value);
    $('[data-dogs]').onclick = e => { const on = isOn(e.currentTarget); store.setPref('dog_sounds', on ? '1' : '0'); setDogSounds(on); };
    $('[data-motion]').onclick = e => store.setPref('ui_motion_enabled', isOn(e.currentTarget) ? '1' : '0');
    $('[data-break]').onclick = e => store.setPref('break_reminders_enabled', isOn(e.currentTarget) ? '1' : '0');
    $('[data-about]').onclick = () => { close(true); document.getElementById('about').showModal(); };
    $('[data-break-at]').onchange = e => { const [h, m] = e.target.value.split(':').map(Number); if (!isNaN(h)) store.setPref('break_reminder_minute', String(h * 60 + m)); };
    $('[data-capacity]').onchange = e => store.setPref('team_capacity_hours', e.target.value);
    $('[data-headsup]').onclick = e => store.setPref('block_headsup', isOn(e.currentTarget) ? '1' : '0');
    $('[data-wrap]').onclick = e => store.setPref('wrapup_enabled', isOn(e.currentTarget) ? '1' : '0');
    $('[data-wrap-at]').onchange = e => { const [h, m] = e.target.value.split(':').map(Number); if (!isNaN(h)) store.setPref('wrapup_minute', String(h * 60 + m)); };
    const calBox = $('[data-calendar]');
    const ago = () => { const n = Math.round((Date.now() - calendar.updatedAt()) / 6e4); return n < 1 ? 'just now' : n < 60 ? `${n} min ago` : `${Math.round(n / 60)} h ago`; };
    const paintCal = () => { const url = calendar.feedUrl();
      if (store.ctx.demo){ calBox.innerHTML = '<span class="muted">The demo shows two made-up meetings.</span>'; return; }
      calBox.innerHTML = url
        ? `<div class="row"><span>Connected to ${esc(calendar.hostOf(url))}</span><span class="spacer"></span><button class="btn" type="button" data-cal-sync>Update now</button><button class="btn ghost danger-text" type="button" data-cal-off data-sfx="back">Disconnect</button></div><p class="help">${calendar.updatedAt() ? 'Updated ' + ago() : 'Not updated yet'}. Meetings show on Today, and Fill my day works around them.</p>`
        : `<form data-cal-form><label class="field">Calendar link<input type="url" data-cal-url placeholder="Paste your calendar’s ICS link" autocomplete="off" spellcheck="false" required><span class="help">Outlook: Settings, Calendar, Shared calendars, Publish a calendar, then ICS. Google: Settings, your calendar, Secret address in iCal format.</span></label><button class="btn" type="submit">Connect</button></form>`; };
    paintCal();
    calBox.onsubmit = async e => { e.preventDefault(); const input = $('[data-cal-url]'), btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Connecting';
      try { await calendar.connect(input.value); toast(`Calendar connected. ${calendar.countThisWeek()} meetings this week.`, 'success'); paintCal(); }
      catch (err){ ui.fieldErr(input, err.message); btn.disabled = false; btn.textContent = 'Connect'; } };
    calBox.onclick = async e => {
      if (e.target.closest('[data-cal-off]')){ calendar.disconnect(); toast('Calendar disconnected.'); paintCal(); }
      else if (e.target.closest('[data-cal-sync]')){ try { await calendar.refresh(); toast('Calendar is up to date.', 'success'); } catch (err){ toast(err.message, 'error'); } paintCal(); } };
    $('[data-close]').onclick = () => close();
    const team = $('[data-team]');
    team.onchange = e => { const id = e.target.closest('[data-id]').dataset.id; if (e.target.type === 'color') store.patch('workspace_people', id, { color:e.target.value }); else if (e.target.value.trim()) store.patch('workspace_people', id, { display_name:e.target.value.trim() }); };
    // People are retired rather than deleted: their blocks keep their history.
    team.onclick = e => { if (e.target.closest('[data-remove]')){ store.patch('workspace_people', e.target.closest('[data-id]').dataset.id, { active:false }); team.innerHTML = teamRows(); } };
    $('[data-add]').onsubmit = e => { e.preventDefault(); const i = e.target.querySelector('input'); store.put('workspace_people', { id:crypto.randomUUID(), display_name:i.value.trim(), color:COLORS[people().length % COLORS.length], active:true, linked_user_id:null, created_at:new Date().toISOString() }); i.value = ''; team.innerHTML = teamRows(); };
    $('[data-out]').onclick = async () => {
      const n = store.pendingCount();
      if (n && !await confirmSheet('Sign out', `${n} change${n === 1 ? ' has' : 's have'} not reached the cloud yet. Signing out now loses ${n === 1 ? 'it' : 'them'}.`, 'Sign out anyway', true, 'Cancel')) return;
      close(true); await sync.signOut(); location.reload();
    };
    const cu = $('[data-cu]');
    if (store.ctx.demo){ cu.innerHTML = '<span class="muted">Not available in demo mode.</span>'; return; }
    sync.clickupStatus().then(s => {
      cu.innerHTML = s?.connected ? '<span>Connected</span><span class="spacer"></span><button class="btn" type="button" data-cu-sync>Sync now</button>' : '<span class="muted">Not connected</span><span class="spacer"></span><button class="btn" type="button" data-cu-go>Connect</button>';
      const go = cu.querySelector('[data-cu-go]'), now = cu.querySelector('[data-cu-sync]');
      if (go) go.onclick = () => sync.connectClickUp().catch(() => toast('Couldn’t reach ClickUp. Try again in a moment.', 'error'));
      if (now) now.onclick = async () => { const ok = await sync.syncNow(); toast(ok ? 'ClickUp is up to date.' : 'Couldn’t sync. Try again when you’re online.', ok ? 'success' : 'error'); };
    }).catch(() => { cu.innerHTML = '<span class="muted">Couldn’t check the connection. It needs you online.</span>'; });
  }, { work:true });
}
