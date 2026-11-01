// ?demo: a fully offline, made-up workspace for development and UI checks. No real names or ClickUp data.
import * as store from './store.js';
import { today, addDays } from './time.js';
import { newTask } from './tasks.js';
import { seedInsightsDemo } from './demo-insights.js';

export function seedDemo(){
  store.ctx.workspaceId = '00000000-0000-4000-8000-000000000001';
  store.ctx.userId = '00000000-0000-4000-8000-000000000002';
  seedInsightsDemo();
  if (store.all('tasks').length) return;
  const d = today();
  const me = store.put('workspace_people', { id:crypto.randomUUID(), display_name:'Me', color:'#5F6B7A', active:true, linked_user_id:store.ctx.userId, created_at:new Date().toISOString() });
  store.put('workspace_people', { id:crypto.randomUUID(), display_name:'Sam', color:'#1F7A4D', active:true, created_at:new Date().toISOString() });
  [['Plan the launch week', 540, 60, 1], ['Review hero banner', 600, 30, 2], ['Write product copy', 660, 90, 3], ['Team check-in', 780, 30, 0], ['Sort newsletter draft', 840, 60, 4]]
    .forEach(([title, minute, duration, priority]) => newTask({ title, date:d, minute, duration, priority, personId:me.id }));
  [-1, -2, -3].forEach(n => [['Inbox zero', 540, 30], ['Campaign notes', 600, 60]].forEach(([title, minute, duration]) => {
    const t = newTask({ title, date:addDays(d, n), minute, duration, personId:me.id }); if (n !== -1 || minute === 540) store.put('tasks', { ...t, state:'completed', completed_at:new Date().toISOString() }); }));
  store.setPref('game_adventure_started', addDays(d, -3)); // so the Quest scene has days to show
  ['Book the photo shoot', 'Draft Q1 calendar'].forEach(title => newTask({ title, duration:60, personId:me.id }));
  ['Chase the print quote', 'Send the brief'].forEach(title => store.put('reminders', { id:crypto.randomUUID(), title, created_by:store.ctx.userId, created_at:new Date().toISOString(), completed_at:null, deleted_at:null }));
  store.pendingEntries().forEach(e => store.settle(e)); // demo rows never go anywhere
}
