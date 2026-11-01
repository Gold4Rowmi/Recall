// In-memory mirror of the cloud, persisted to IndexedDB. Every read is synchronous, every write is optimistic:
// memory changes now, the outbox (also in IndexedDB) carries the row to Supabase whenever it can.

// pk: columns of the primary key minus workspace_id. cur: delta cursor column. soft: tombstone column.
// ro: pull only. FK order matters: rows are pushed in this order.
export const TABLES = {
  workspace_people:          { pk:['id'], cur:'updated_at' },
  recurrence_rules:          { pk:['id'], cur:'updated_at', soft:'deleted_at' },
  tasks:                     { pk:['id'], cur:'updated_at', soft:'deleted_at' },
  recurrence_exceptions:     { pk:['id'], cur:'updated_at' },
  reminders:                 { pk:['id'], cur:'updated_at', soft:'deleted_at' },
  work_sessions:             { pk:['id'], cur:'updated_at' },
  work_session_clickup_tasks:{ pk:['session_id','clickup_task_id'], cur:'updated_at' },
  daily_context:             { pk:['user_id','context_date'], cur:'updated_at', own:true },
  app_preferences:           { pk:['user_id'], cur:'updated_at', own:true },
  game_progress:             { pk:['user_id'], cur:'updated_at', own:true },
  daily_scores:              { pk:['user_id','score_date'], cur:'finalized_at', own:true },
  user_achievements:         { pk:['user_id','achievement_key','unlocked_on'], cur:'unlocked_at', own:true },
  boss_rewards:              { pk:['user_id','week_start'], cur:'defeated_at', own:true },
  planning_rules:            { pk:['rule_key'], cur:'updated_at', ro:true },
  workspace_integrations:    { pk:['provider'], cur:'updated_at', ro:true },
  achievements:              { pk:['key'], ro:true, global:true },
  clickup_tasks:             { pk:['clickup_task_id'], cur:'synced_at', ro:true,
    select:'clickup_task_id,clickup_space_id,clickup_folder_id,clickup_list_id,parent_task_id,name,description,status,priority,due_at,start_at,time_estimate_minutes,assignee_names,tags,url,is_closed,synced_at,date_updated_at,date_closed_at,raw' },
};
export const keyOf = (table, row) => TABLES[table].pk.map(c => row[c]).join('|');

const NAMES = Object.keys(TABLES);
const mem = Object.fromEntries(NAMES.map(t => [t, new Map()]));
const pending = new Map();        // 'table|key' -> { id, table, key, op, row, seq }
const meta = new Map();
const listeners = new Set();
let db = null, seq = 0, dirty = new Set(), scheduled = false, pushHook = () => {};

export const ctx = { workspaceId:null, userId:null, demo:false };
export const rows = table => mem[table];
export const all = table => [...mem[table].values()];
export const get = (table, key) => mem[table].get(key);
export const getMeta = k => meta.get(k);
export const pendingCount = () => pending.size;
export const pendingEntries = () => [...pending.values()].sort((a, b) => a.seq - b.seq);
export const isPending = (table, key) => pending.has(table + '|' + key);
export const onPush = fn => { pushHook = fn; };

export function on(fn){ listeners.add(fn); return () => listeners.delete(fn); }
function touch(table){ dirty.add(table); if (scheduled) return; scheduled = true;
  queueMicrotask(() => { scheduled = false; const set = dirty; dirty = new Set(); listeners.forEach(fn => fn(set)); }); }

const reqP = r => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
function idb(name){ return new Promise((ok, no) => { const r = indexedDB.open(name, 1);
  r.onupgradeneeded = () => { const d = r.result; NAMES.forEach(t => d.createObjectStore(t)); d.createObjectStore('_outbox', { keyPath:'id' }); d.createObjectStore('_meta'); };
  r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }); }

export async function open(demo){
  ctx.demo = demo;
  db = await idb(demo ? 'recall-demo' : 'recall');
  const tx = db.transaction([...NAMES, '_outbox', '_meta']);
  await Promise.all(NAMES.map(async t => { const st = tx.objectStore(t), [ks, vs] = await Promise.all([reqP(st.getAllKeys()), reqP(st.getAll())]); ks.forEach((k, i) => mem[t].set(k, vs[i])); }));
  (await reqP(tx.objectStore('_outbox').getAll())).forEach(e => { pending.set(e.id, e); seq = Math.max(seq, e.seq); });
  const ms = tx.objectStore('_meta'), [mk, mv] = await Promise.all([reqP(ms.getAllKeys()), reqP(ms.getAll())]); mk.forEach((k, i) => meta.set(k, mv[i]));
  ctx.workspaceId = meta.get('workspaceId') || null; ctx.userId = meta.get('userId') || null;
  NAMES.forEach(touch);
}

export function setMeta(k, v){ meta.set(k, v); db.transaction('_meta', 'readwrite').objectStore('_meta').put(v, k); }

function persist(table, entries){ const tx = db.transaction(table, 'readwrite'), st = tx.objectStore(table); entries.forEach(([k, v]) => v === undefined ? st.delete(k) : st.put(v, k)); }
function enqueue(table, key, op, row){ const e = { id:table + '|' + key, table, key, op, row, seq:++seq }; pending.set(e.id, e); db.transaction('_outbox', 'readwrite').objectStore('_outbox').put(e); pushHook(); return e; }

// Fill scope columns and hand back the row. Returns it so callers can chain.
export function put(table, row){
  if (TABLES[table].ro) throw new Error(table + ' is read only');
  if (!TABLES[table].global) row.workspace_id ??= ctx.workspaceId;
  if (TABLES[table].own) row.user_id ??= ctx.userId;
  const cur = TABLES[table].cur; if (cur) row[cur] = new Date().toISOString();
  const key = keyOf(table, row);
  mem[table].set(key, row); persist(table, [[key, row]]); enqueue(table, key, 'upsert', row); touch(table);
  return row;
}
// Merge changes into an existing row.
export const patch = (table, key, changes) => put(table, { ...mem[table].get(key), ...changes });

export function remove(table, key){
  const row = mem[table].get(key); if (!row) return;
  const soft = TABLES[table].soft;
  mem[table].delete(key); persist(table, [[key, undefined]]);
  enqueue(table, key, soft ? 'upsert' : 'delete', soft ? { ...row, [soft]: new Date().toISOString() } : row);
  touch(table);
  return row;
}

// Rows from Supabase. A row with an unpushed local edit keeps the local edit; the push will win.
export function applyRemote(table, incoming){
  const t = TABLES[table], writes = [];
  for (const row of incoming){ const key = keyOf(table, row);
    if (pending.has(table + '|' + key)) continue;
    if (t.soft && row[t.soft]){ if (mem[table].delete(key)) writes.push([key, undefined]); continue; }
    mem[table].set(key, row); writes.push([key, row]); }
  if (writes.length){ persist(table, writes); touch(table); }
}
export function removeRemote(table, keys){ const writes = []; keys.forEach(k => { if (!pending.has(table + '|' + k) && mem[table].delete(k)) writes.push([k, undefined]); });
  if (writes.length){ persist(table, writes); touch(table); } }

export function settle(entry){ const cur = pending.get(entry.id); if (!cur || cur.seq !== entry.seq) return false;
  pending.delete(entry.id); db.transaction('_outbox', 'readwrite').objectStore('_outbox').delete(entry.id); return true; }

export function clearAll(){ NAMES.forEach(t => { mem[t].clear(); db.transaction(t, 'readwrite').objectStore(t).clear(); touch(t); });
  pending.clear(); meta.clear(); ctx.workspaceId = ctx.userId = null;
  db.transaction('_outbox', 'readwrite').objectStore('_outbox').clear(); db.transaction('_meta', 'readwrite').objectStore('_meta').clear(); }

// Preferences keep TimeBlock's flat string map inside app_preferences.preferences.
const prefRow = () => mem.app_preferences.get(ctx.userId);
export const pref = (k, fallback) => { const p = prefRow()?.preferences; return p && p[k] !== undefined ? p[k] : fallback; };
export function setPref(k, v){ const cur = prefRow(); put('app_preferences', { ...(cur || {}), preferences:{ ...(cur?.preferences || {}), [k]:v } }); }
