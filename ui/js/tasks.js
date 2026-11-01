// The one place a planner task row is shaped. tasks_check requires scheduled_start whenever state is 'scheduled'.
import * as store from './store.js';
import { melbourneISO } from './time.js';

// fields: title, notes, date, minute, duration, personId, color, priority, ruleId, occurrence, state ('scheduled' | 'bank')
export function newTask(f){
  const scheduled = f.date != null;
  return store.put('tasks', {
    id:crypto.randomUUID(), title:f.title, notes:f.notes || '', state:f.state || (scheduled ? 'scheduled' : 'bank'),
    scheduled_start:scheduled ? melbourneISO(f.date, f.minute) : null, local_date:scheduled ? f.date : null, start_minute:scheduled ? f.minute : null,
    duration_minutes:f.duration || 30, assigned_person_id:f.personId || null, color:f.color || null,
    priority_hint:f.priority || 0, is_important:f.priority === 4, recurrence_rule_id:f.ruleId || null, recurrence_local_date:f.occurrence || null,
    campaign_id:null, completed_at:null, created_by:store.ctx.userId, source:'planner', source_external_id:null,
    deleted_at:null, timezone:'Australia/Melbourne', created_at:new Date().toISOString(),
  });
}
