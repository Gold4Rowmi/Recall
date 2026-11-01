// Rare work: follow-ups, weekly export, settings.
import * as store from '../store.js';
import * as P from '../planner.js';
import * as sync from '../sync.js';
import { toast, setMuted, paintDogs } from '../brand.js';
import * as ui from '../ui.js';
import { esc, icon, sheet, confirmSheet, fill, stateBlock } from '../ui.js';
import { today, mondayOf, addDays } from '../time.js';

const COLORS = ['#5F6B7A', '#4E9F6C', '#B77AD9', '#D98B5F', '#C85F72', '#5B9AA0', '#997A5B']; // person colours are user data, not UI tokens
const set = (fn, v) => localStorage.setItem(fn, v);
const applyTheme = t => { if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t; };
const applyMotion = () => { document.documentElement.dataset.motion = store.pref('ui_motion_enabled', '1') === '0' ? 'off' : 'on'; };
applyTheme(localStorage.getItem('recall.theme') || 'system');
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
    <label class="check"><input type="checkbox" data-done>Show done</label><div class="fu-list"></div>`;
  el.querySelector('form').onsubmit = e => { e.preventDefault(); const i = e.target.querySelector('input'); P.addReminder(i.value.trim()); i.value = ''; };
  el.querySelector('[data-done]').onchange = e => { showDone = e.target.checked; renderFollowUps(el); };
  el.querySelector('.fu-list').onclick = e => { const b = e.target.closest('[data-fu]'); if (!b) return; const id = b.closest('[data-id]').dataset.id;
    if (b.dataset.fu === 'done') P.toggleReminder(id);
    else if (b.dataset.fu === 'queue'){ P.reminderToQueue(id); toast('Moved to Queue.', 'success'); }
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
      <button class="btn" type="button" data-fu="queue">Queue</button><button class="btn danger-text" type="button" data-fu="del" data-sfx="back" data-x>Delete</button></div>`).join('')
    : stateBlock('sleepy', 'No follow-ups', 'Add anything you need to chase up.');
  if (list.dataset.html !== html){ list.dataset.html = html; fill(list, html); }
}

/* ===== Export ===== */
export function exportWeek(){
  const monday = mondayOf(today()), peopleMap = new Map(store.all('workspace_people').map(p => [p.id, p]));
  const text = P.journal(P.rangeTasks(monday, addDays(monday, 6)), peopleMap, monday);
  sheet('Export week', (b, close) => {
    b.innerHTML = `<textarea rows="16" readonly aria-label="Weekly journal">${esc(text)}</textarea>
      <div class="sheet-actions"><button class="btn" type="button" data-close>Close</button><button class="btn" type="button" data-copy>Copy</button><button class="btn primary" type="button" data-save><span class="glyph">A</span>Download</button></div>`;
    b.querySelector('[data-close]').onclick = () => close();
    b.querySelector('[data-copy]').onclick = async () => { try { await navigator.clipboard.writeText(text); toast('Copied.', 'success'); } catch { toast('Couldn’t copy. Select the text and copy it instead.', 'error'); } };
    b.querySelector('[data-save]').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type:'text/markdown' })); a.download = `recall-week-${monday}.md`; a.click(); URL.revokeObjectURL(a.href); toast('Download started.', 'success'); };
  }, { wide:true });
}

/* ===== Settings ===== */
function teamRows(){
  return people().map(p => `<div class="qrow" data-id="${esc(p.id)}"><input type="color" aria-label="Colour" value="${esc(p.color || COLORS[0])}"><input type="text" aria-label="Name" value="${esc(p.display_name)}"><button class="btn danger-text" type="button" data-remove data-sfx="back">Remove</button></div>`).join('');
}
export function openSettings(){
  sheet('Settings', (b, close) => {
    const theme = localStorage.getItem('recall.theme') || 'system', muted = store.pref('sound_muted', '0') === '1', motion = store.pref('ui_motion_enabled', '1') !== '0';
    const brk = store.pref('break_reminders_enabled', '1') !== '0', minute = +store.pref('break_reminder_minute', 780), hhmm = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    b.innerHTML = `<div class="settings">
      <label class="field">Theme<select data-theme-pick><option value="system">Match Windows</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
      <label class="check"><input type="checkbox" data-sound ${muted ? '' : 'checked'}>Sounds</label>
      <label class="check"><input type="checkbox" data-motion ${motion ? 'checked' : ''}>Motion</label>
      <label class="check"><input type="checkbox" data-break ${brk ? 'checked' : ''}>Daily break reminder</label>
      <label class="field">Break time<input type="time" step="1800" data-break-at value="${hhmm}"></label>
      <label class="field">Team capacity hours per week<input type="number" min="0" max="168" data-capacity value="${esc(store.pref('team_capacity_hours', '30'))}"></label>
      <h3 class="pixel sect">ClickUp</h3><div class="row" data-cu><span class="muted">Checking the connection</span></div>
      <h3 class="pixel sect">Team</h3><div data-team>${teamRows()}</div>
      <form class="capture" data-add><input aria-label="New team member" placeholder="Add a team member" required><button class="btn" type="submit">Add</button></form>
      <h3 class="pixel sect">Keyboard</h3><dl class="keys">${(ui.SHORTCUTS || []).map(s => { const [k, d] = Array.isArray(s) ? s : [s.keys ?? s.key, s.label ?? s.action]; return `<dt>${esc(k)}</dt><dd>${esc(d)}</dd>`; }).join('')}</dl>
      <h3 class="pixel sect">Account</h3><button class="btn" type="button" data-out data-sfx="back">Sign out</button>
      </div><div class="sheet-actions"><button class="btn" type="button" data-close>Close</button></div>`;
    const $ = s => b.querySelector(s);
    $('[data-theme-pick]').value = theme;
    $('[data-theme-pick]').onchange = e => { set('recall.theme', e.target.value); applyTheme(e.target.value); paintDogs(); };
    $('[data-sound]').onchange = e => { store.setPref('sound_muted', e.target.checked ? '0' : '1'); setMuted(!e.target.checked); };
    $('[data-motion]').onchange = e => store.setPref('ui_motion_enabled', e.target.checked ? '1' : '0');
    $('[data-break]').onchange = e => store.setPref('break_reminders_enabled', e.target.checked ? '1' : '0');
    $('[data-break-at]').onchange = e => { const [h, m] = e.target.value.split(':').map(Number); if (!isNaN(h)) store.setPref('break_reminder_minute', String(h * 60 + m)); };
    $('[data-capacity]').onchange = e => store.setPref('team_capacity_hours', e.target.value);
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
  });
}
