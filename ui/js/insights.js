// One analytics snapshot shared by Brief and Command. Computed off the UI thread and cached, so cold start paints instantly.
import * as store from './store.js';

const WATCH = ['clickup_tasks', 'tasks', 'workspace_integrations'];
const fns = new Set();
let worker = null, current = null, failure = null, timer = 0, seq = 0, started = false;

export const snapshot = () => current;
export const lastError = () => failure;
export const onSnapshot = fn => { fns.add(fn); return () => fns.delete(fn); };
const emit = () => fns.forEach(fn => fn(current));

function post(){
  timer = 0;
  worker.postMessage({ id:++seq, input:{
    clickup:store.all('clickup_tasks'), tasks:store.all('tasks'),
    config:store.get('workspace_integrations', 'recall')?.config || {},
    capacityHours:Number(store.pref('team_capacity_hours', 30)) || 30,
  } });
}
export function refresh(){ if (started && !timer) timer = setTimeout(post, 150); }

export function start(){
  if (started) return; started = true;
  current = store.getMeta('insights') || null;
  worker = new Worker(new URL('./analytics.worker.js', import.meta.url), { type:'module' });
  worker.onmessage = e => {
    if (e.data.id !== seq) return; // a newer run is on its way
    if (e.data.error){ failure = e.data.error; console.error(failure); emit(); return; }
    failure = null; current = e.data.snapshot;
    emit(); setTimeout(() => store.setMeta('insights', current));
  };
  worker.onerror = e => { failure = e.message || 'Analytics stopped'; console.error(e); emit(); };
  store.on(set => { if (WATCH.some(t => set.has(t))) refresh(); });
  setInterval(refresh, 5 * 60 * 1000); // dates and "overdue" move on even when no row does
  refresh();
}
