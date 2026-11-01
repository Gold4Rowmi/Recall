// Cloud sync: push only what changed, pull only what is newer, let Realtime deliver everything else.
// All of this runs off the UI path; nothing a view does ever waits on the network.
import * as store from './store.js';
import { TABLES, keyOf, ctx } from './store.js';

export const SUPABASE_URL = 'https://zyjnpfuuoekdjuaumvpi.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_o4HNFoCmwwcvxx6t0QxB8A_7E9s9tEy';
const tauri = window.__TAURI__;

// Tauri keeps the session in a DPAPI file; the web app uses localStorage.
const sessionStore = tauri ? {
  getItem: () => tauri.core.invoke('secret_get'),
  setItem: (_k, value) => tauri.core.invoke('secret_set', { value }),
  removeItem: () => tauri.core.invoke('secret_set', { value:null }),
} : localStorage;

export const sb = window.supabase.createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
  auth:{ storage:sessionStore, storageKey:'recall-session', persistSession:true, autoRefreshToken:true, detectSessionInUrl:false },
});

const status = { state:'idle', message:'', lastSync:null };
const statusFns = new Set();
export const onStatus = fn => { statusFns.add(fn); fn(status); };
function setStatus(state, message = ''){ status.state = state; status.message = message; statusFns.forEach(fn => fn(status)); }
export const getStatus = () => status;

const FAILED = 'Couldn’t sync. Your changes are safe here, try again in a moment.'; // the real error goes to the console, never the screen
const OVERLAP_MS = 10000; // server clocks and in-flight commits: re-read a little behind the cursor
const PAGE = 1000, BATCH = 200;

async function pullTable(table){
  const t = TABLES[table], cursorKey = 'cur:' + table, since = store.getMeta(cursorKey);
  const out = []; let newest = since || null;
  for (let from = 0; ; from += PAGE){
    let q = sb.from(table).select(t.select || '*');
    if (!t.global) q = q.eq('workspace_id', ctx.workspaceId);
    if (t.own) q = q.eq('user_id', ctx.userId);
    if (t.cur){ if (since) q = q.gte(t.cur, new Date(new Date(since).getTime() - OVERLAP_MS).toISOString()); q = q.order(t.cur); }
    const { data, error } = await q.order(t.pk[0]).range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  if (t.cur) for (const r of out) if (r[t.cur] && (!newest || r[t.cur] > newest)) newest = r[t.cur];
  store.applyRemote(table, out);
  if (newest && newest !== since) store.setMeta(cursorKey, newest);
}

let pushing = false, pushAgain = false, pushT = null;
export function schedulePush(){ if (ctx.demo) return; clearTimeout(pushT); pushT = setTimeout(push, 300); }

async function push(){
  if (ctx.demo) return;
  if (pushing){ pushAgain = true; return; }
  if (!store.pendingCount()) return;
  pushing = true; setStatus('syncing');
  try {
    const order = Object.keys(TABLES), entries = store.pendingEntries();
    for (const table of order){
      const mine = entries.filter(e => e.table === table);
      if (!mine.length) continue;
      const del = mine.filter(e => e.op === 'delete');
      for (const e of del){ let q = sb.from(table).delete().eq('workspace_id', ctx.workspaceId); TABLES[table].pk.forEach(c => { q = q.eq(c, e.row[c]); }); const { error } = await q; if (error) throw error; store.settle(e); }
      const ups = mine.filter(e => e.op === 'upsert');
      for (let i = 0; i < ups.length; i += BATCH){
        // onConflict must name the real primary key: only the per-user tables include workspace_id in theirs.
        const part = ups.slice(i, i + BATCH), cols = (TABLES[table].own ? ['workspace_id', ...TABLES[table].pk] : TABLES[table].pk).join(',');
        const { data, error } = await sb.from(table).upsert(part.map(e => e.row), { onConflict:cols, defaultToNull:false }).select(); // batches mix new and pulled rows: a key one row lacks must use the column default, not NULL
        if (error) throw error;
        const settled = part.filter(e => store.settle(e)); // a newer local edit keeps its place in the outbox
        const keys = new Set(settled.map(e => e.key));
        store.applyRemote(table, data.filter(r => keys.has(keyOf(table, r))));
      }
    }
    setStatus('synced'); status.lastSync = new Date();
  } catch (e){
    console.error(e);
    if (!navigator.onLine || /fetch|network/i.test(e.message || '')) setStatus('offline');
    else setStatus('error', FAILED);
    retrySoon();
  } finally {
    pushing = false;
    if (pushAgain){ pushAgain = false; schedulePush(); }
  }
}
let retryT = null, retryMs = 2000;
function retrySoon(){ clearTimeout(retryT); retryT = setTimeout(() => { retryMs = Math.min(retryMs * 2, 60000); push(); }, retryMs); }

let pulled = 0, pulling = 0;
export const pullPct = () => pulling ? Math.round(100 * pulled / pulling) : 0;
export async function pull(tables = Object.keys(TABLES).filter(t => t !== 'clickup_tasks')){
  if (ctx.demo) return;
  pulled = 0; pulling = tables.length;
  await Promise.all(tables.map(t => pullTable(t).finally(() => { pulled++; })));
  status.lastSync = new Date();
}

let channel = null;
function listen(){
  if (channel) return;
  channel = sb.channel('recall');
  for (const [table, t] of Object.entries(TABLES)){
    if (t.ro) continue; // planning_rules, integrations and the ClickUp cache change rarely and in bursts
    channel.on('postgres_changes', { event:'*', schema:'public', table, filter:'workspace_id=eq.' + ctx.workspaceId }, p => {
      if (p.eventType === 'DELETE') store.removeRemote(table, [keyOf(table, p.old)]);
      else store.applyRemote(table, [p.new]);
    });
  }
  channel.subscribe(s => { if (s === 'SUBSCRIBED') pull().catch(() => {}); }); // catch up on anything missed while reconnecting
}

const bridge = fn => sb.functions.invoke('recall-bridge', { body:{ fn, body:{ workspace_id:ctx.workspaceId } } });
const CLICKUP_EVERY = 10 * 60 * 1000;
// A successful full sync refreshes synced_at on every in-scope active task, so active rows it left behind
// were deleted, archived or moved out of scope in ClickUp. The 75% gate guards against a partial response.
export async function syncClickUp(){
  if (ctx.demo) return null;
  const started = Date.now() - 5000;
  const { data:result, error } = await bridge('clickup-sync');
  if (error) throw error;
  store.setMeta('clickupAt', Date.now());
  await pullTable('clickup_tasks');
  const active = store.all('clickup_tasks').filter(r => !r.is_closed);
  const fresh = active.filter(r => new Date(r.synced_at).getTime() >= started);
  const expected = Number(result?.synced);
  if (Number.isFinite(expected) && !(expected > 0 && fresh.length < Math.max(1, Math.floor(expected * .75)))){
    const stale = active.filter(r => new Date(r.synced_at).getTime() < started).map(r => r.clickup_task_id);
    for (let i = 0; i < stale.length; i += 100){
      const part = stale.slice(i, i + 100);
      const { error:e } = await sb.from('clickup_tasks').delete().eq('workspace_id', ctx.workspaceId).eq('is_closed', false).in('clickup_task_id', part);
      if (!e) store.removeRemote('clickup_tasks', part); // the next sync retries whatever failed
    }
  }
  return result;
}

export async function syncNow(){
  if (ctx.demo){ setStatus('synced'); return true; }
  setStatus('syncing');
  try {
    await push();
    await pull();
    await syncClickUp();
    setStatus(store.pendingCount() ? 'offline' : 'synced');
    return !store.pendingCount(); // push keeps failed rows in the outbox rather than throwing
  } catch (e){ console.error(e); setStatus(navigator.onLine ? 'error' : 'offline', FAILED); return false; }
}

async function begin(session){
  ctx.userId = session.user.id; store.setMeta('userId', ctx.userId);
  if (!ctx.workspaceId){
    const { data, error } = await sb.rpc('planner_bootstrap_workspace');
    if (error) throw error;
    ctx.workspaceId = data; store.setMeta('workspaceId', data);
  }
  store.onPush(schedulePush);
  setStatus('syncing');
  listen();
  push();
  await pull();
  await pullTable('clickup_tasks');
  setStatus(store.pendingCount() ? 'offline' : 'synced');
  if (Date.now() - (store.getMeta('clickupAt') || 0) > CLICKUP_EVERY) syncClickUp().catch(console.error);
}

export async function start(){
  if (ctx.demo){ setStatus('synced'); return true; }
  const { data:{ session }, error } = await sb.auth.getSession();
  if (!session){
    if (error?.name !== 'AuthRetryableFetchError' || !ctx.workspaceId) return false;
    setStatus('offline'); addEventListener('online', start, { once:true }); // the token expired with no signal: keep working from the cache, not the sign-in page
    return true;
  }
  begin(session).catch(e => { console.error(e); setStatus(navigator.onLine ? 'error' : 'offline', FAILED); });
  addEventListener('online', () => { retryMs = 2000; push(); pull().catch(() => {}); });
  addEventListener('focus', () => { pull(['tasks']).catch(() => {}); if (Date.now() - (store.getMeta('clickupAt') || 0) > CLICKUP_EVERY) syncClickUp().catch(console.error); });
  return true;
}

export async function signIn(email, password){
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return start();
}
export async function signOut(){ if (channel) sb.removeChannel(channel); channel = null; await sb.auth.signOut(); store.clearAll(); }
export const clickupStatus = async () => (await sb.rpc('planner_clickup_connection_status', { p_workspace_id:ctx.workspaceId })).data;
export async function connectClickUp(){ const { data, error } = await bridge('clickup-connect'); if (error) throw error; openExternal(data.authorization_url); }
export const openExternal = url => tauri ? tauri.opener.openUrl(url) : window.open(url, '_blank', 'noopener');
