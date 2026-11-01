// Management analytics, ported from TimeBlock's AssistantAnalytics. Pure functions: runs in a Worker so it can never
// block a tab switch. Team names, ClickUp ids and scope rules are data (workspace_integrations provider 'recall'), not code.
import { today as melbourneToday, addDays, weekday, mondayOf, fmtDate, fmtDuration, nowMinute } from './time.js';

const REVIEW_WORDS = ['review', 'approval', 'approve', 'feedback', 'sign off', 'sign-off', 'qa'];
const BLOCK_WORDS = ['blocked', 'waiting', 'stuck', 'hold'];
const TERMINAL_EXACT = new Set(['complete', 'completed', 'done', 'closed', 'cancelled', 'canceled', 'live', 'approved', 'copy approved']);
const PROJECT_TERMINAL = new Set(['complete', 'completed', 'closed', 'cancelled', 'canceled']);
const START_WORDS = ['concept', 'plan', 'not started', 'ready to do', 'to do'];
const FAR = '9999-12-31';
const has = (text, words) => words.some(w => text.includes(w));
const r1 = n => Math.round(n * 10) / 10;
const lc = v => String(v ?? '').toLowerCase();
export const cap = s => { s = String(s ?? ''); return s.charAt(0).toUpperCase() + s.slice(1); };
const WINDOW_TEXT = { 'ON HOLD':'On hold', 'NO DATE':'No date', OVERDUE:'Overdue', '0–7d':'Due within 7 days', '8–14d':'Due in 8 to 14 days', '15–21d':'Due in 15 to 21 days', LATER:'Later' };

// Tuple ordering, like sorting on a Python tuple key.
const cmp = (a, b) => { for (let i = 0; i < a.length; i++){ if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; };
const sortBy = (list, key) => list.map(v => [key(v), v]).sort((x, y) => cmp(x[0], y[0])).map(x => x[1]);

const dayCache = new Map();
function dayOf(value){ if (!value) return null; let d = dayCache.get(value);
  if (d === undefined){ const t = new Date(value); d = isNaN(t) ? null : melbourneToday(t); dayCache.set(value, d); } return d; }
const daysBetween = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
function workdays(start, end){ if (!end || end < start) return 0; let n = 0; for (let d = start; d <= end; d = addDays(d, 1)) if (weekday(d) < 5) n++; return n; }

const searchText = (...values) => values.map(v => String(v ?? '')).join(' ').toLowerCase().replace(/[^\p{L}\p{N}]/gu, ' ').split(/\s+/).filter(Boolean).join(' ');
const statusName = s => s && typeof s === 'object' ? (s.status || s.name || s.label || '') : s;

// True when a cached ClickUp row belongs to deliberately hidden work. Titles never drive the delay rule.
export function isIgnored(row, config){
  const ig = config.ignored || {}, raw = row.raw || {};
  const folderId = String(row.clickup_folder_id ?? '').trim(), listId = String(row.clickup_list_id ?? '').trim();
  const folderName = String(raw.folder_name ?? '').trim().toLowerCase();
  const status = searchText(statusName(row.status), statusName(raw.status));
  const rawList = raw.list && typeof raw.list === 'object' ? raw.list : {}, rawFolder = raw.folder && typeof raw.folder === 'object' ? raw.folder : {};
  const workstream = [searchText(raw.list_name, rawList.name), searchText(raw.folder_name, rawFolder.name)].filter(Boolean).join(' ');
  const inDelayStream = (ig.delay_workstreams || []).some(n => workstream.includes(n));
  const workflow = (ig.workflow_statuses || []).includes(status) || (status === 'delay' && inDelayStream);
  return (ig.folder_ids || []).includes(folderId) || (ig.list_ids || []).includes(listId)
    || (ig.folder_names || []).some(n => n.toLowerCase() === folderName)
    || (ig.folder_name_suffixes || []).some(s => folderName.endsWith(s)) || workflow;
}

const assigneeIds = row => new Set((row.raw?.assignee_ids || []).filter(x => x != null).map(String));
function workerName(row){ const name = String(row.raw?.worker_name ?? '').trim(); return ['not assigned', 'unassigned', 'none', 'null'].includes(name.toLowerCase()) ? '' : name; }
function rawDate(row, key){ const v = row.raw?.[key]; if (!v) return null; return dayOf(v) || (/^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null); }

// LAUNCH DATE first, ClickUp due date second, END DATE third.
export function projectTarget(row){
  const launch = rawDate(row, 'launch_date'); if (launch) return [launch, 'launch'];
  const due = dayOf(row.due_at); if (due) return [due, 'due'];
  const end = rawDate(row, 'end_date'); if (end) return [end, 'end'];
  return [null, 'none'];
}
const camelGap = t => String(t ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
const compact = t => camelGap(t).toLowerCase().replace(/[^a-z0-9]+/g, '');
const words = t => (camelGap(t).toLowerCase().match(/[a-z0-9]+/g) || []).filter(w => w.length >= 2);

export function createAnalytics({ clickup, config, today = melbourneToday(), capacityHours = 30 }){
  const rows = clickup.filter(r => !isIgnored(r, config));
  const PROJECT_LIST = config.project_list_id, CAMPAIGN_SPACE = config.campaign_space_id;
  const LISTS = config.delivery_lists || {}, LABELS = config.delivery_labels || {}, ROSTER = config.team_roster || [], TEAMS = config.production_teams || {};
  const STOP = new Set(config.project_stop_words || []), EXPECTED = config.expected_keywords || {}, TEAM_FOR_CAT = config.team_for_cat || {};
  const label = cat => LABELS[cat] || cat;
  const listCat = new Map(); Object.entries(LISTS).forEach(([cat, ids]) => ids.forEach(id => { if (!listCat.has(id)) listCat.set(id, cat); }));
  const category = row => listCat.get(String(row.clickup_list_id ?? '')) || null;
  const horizonEnd = addDays(today, 20);

  function terminal(row){
    const status = lc(row.status).trim(), done = !!row.is_closed || status.startsWith('complete ') || status.startsWith('completed ') || status.includes('archiv');
    // The portfolio list treats live, in review and on hold as active project states.
    return done || (String(row.clickup_list_id ?? '') === PROJECT_LIST ? PROJECT_TERMINAL : TERMINAL_EXACT).has(status);
  }

  // Shared execution accounts win so a reviewer on the task doesn't double-count it; direct assignees split otherwise.
  function teamTargets(row){ const ids = assigneeIds(row), shared = [], direct = [];
    ROSTER.forEach(s => { if (s.ids.some(id => ids.has(id))) (s.shared ? shared : direct).push(s); });
    return shared.length ? shared.slice(0, 1) : direct; }

  function needsMe(){
    const me = String(config.me_clickup_user_id ?? ''), out = [];
    for (const row of rows){
      if (terminal(row)) continue;
      const ids = assigneeIds(row), assigned = (me && ids.has(me)) || (!me && (row.assignee_names || []).length > 0);
      const text = (lc(row.status) + ' ' + lc(row.name)), due = dayOf(row.due_at), overdue = !!(due && due < today);
      const review = has(text, REVIEW_WORDS), blocked = has(text, BLOCK_WORDS), pri = lc(row.priority);
      const campaignReview = review && String(row.clickup_space_id ?? '') === CAMPAIGN_SPACE; // reaches the manager even on a shared account
      const hot = pri === 'urgent' || pri === 'high';
      if (!((assigned && (review || blocked || overdue || hot)) || campaignReview)) continue;
      const why = [];
      if (overdue) why.push('overdue');
      if (review) why.push(campaignReview && !assigned ? 'campaign review' : 'needs review');
      if (blocked) why.push('blocked');
      if (hot) why.push(pri + ' priority');
      out.push({ score:(overdue ? 80 : 0) + (review ? 45 : 0) + (blocked ? 35 : 0) + (pri === 'urgent' ? 30 : pri === 'high' ? 18 : 0) + (campaignReview ? 12 : 0), row, why:why.join(', ') });
    }
    return sortBy(out, x => [-x.score, x.row.due_at ? new Date(x.row.due_at).getTime() : Infinity]);
  }

  const tokenMemo = new Map();
  function tokens(row){ let t = tokenMemo.get(row); if (!t){ t = [...new Set(words(row.name).filter(w => !STOP.has(w)))]; tokenMemo.set(row, t); } return t; }
  const blobMemo = new Map();
  function blob(row){ let b = blobMemo.get(row); if (!b){ const s = [row.name || '', (row.tags || []).join(' '), row.raw?.campaign_name || ''].join(' '); b = { words:new Set(words(s)), compact:compact(s) }; blobMemo.set(row, b); } return b; }
  function linked(row){ const out = new Set(); for (const k of ['linked_task_ids', 'dependency_ids']) (row.raw?.[k] || []).forEach(v => { if (v != null) out.add(String(v)); }); if (row.parent_task_id) out.add(String(row.parent_task_id)); return out; }

  // 100 explicit link, 90 same campaign, otherwise a name-overlap confidence. >= 6 counts as a match.
  function matchScore(project, row){
    const pid = String(project.clickup_task_id ?? ''), rid = String(row.clickup_task_id ?? '');
    if (rid === pid) return 0;
    if (pid && (linked(row).has(pid) || linked(project).has(rid))) return 100;
    const pc = lc(project.raw?.campaign_name).trim(), rc = lc(row.raw?.campaign_name).trim();
    if (pc && rc && pc === rc) return 90;
    const pt = tokens(project); if (!pt.length) return 0;
    const b = blob(row), overlap = pt.filter(w => b.words.has(w));
    let score = overlap.reduce((s, w) => s + (w.length >= 7 ? 3 : w.length >= 5 ? 2 : 1), 0);
    const cp = compact(project.name);
    if (cp.length >= 8 && b.compact.includes(cp)) score = Math.max(score, 8); // spacing differences: AdaStreams vs Ada Streams
    for (const t of pt){ const ct = compact(t); if (ct.length >= 7 && b.compact.includes(ct)) score = Math.max(score, 5); }
    if (overlap.length >= 2) score += 3; else if (overlap.length === 1 && overlap[0].length >= 7) score += 2;
    return score;
  }
  function expectedCats(project){ const text = ((project.name || '') + ' ' + (project.description || '')).toLowerCase(); return Object.keys(EXPECTED).filter(c => has(text, EXPECTED[c])); }

  // Output points: Graphics review .45, heavy design 1.8, standard 1. Content long-form 4, short-form 1.
  function points(row, team){
    const name = lc(row.name), status = lc(row.status), kw = config.point_keywords || {};
    if (team === 'graphics'){
      if (status.includes('review') || status.includes('changes')) return 0.45;
      if ((LISTS.pc_design || []).includes(String(row.clickup_list_id ?? '')) || has(name, kw.graphics_heavy || [])) return 1.8;
      return 1;
    }
    return team === 'content' && has(name, kw.content_long || []) ? 4 : 1;
  }
  const accountIds = spec => new Set(ROSTER.find(x => x.name === spec.account)?.ids || []);
  const canon = (spec, worker) => spec.workers.find(w => w.toLowerCase() === worker.toLowerCase());
  const teamWorkers = spec => ROSTER.find(x => x.name === spec.account)?.workers || [];

  const capMemo = new Map(); // TimeBlock recomputed this for every project, one of the chugs
  function productionCapacity(end = horizonEnd){
    end = end < horizonEnd ? end : horizonEnd;
    if (capMemo.has(end)) return capMemo.get(end);
    const days = Math.max(1, workdays(today, end)), result = {};
    for (const [key, spec0] of Object.entries(TEAMS)){
      const spec = { ...spec0, workers:teamWorkers(spec0) }, ids = accountIds(spec), loads = Object.fromEntries(spec.workers.map(w => [w, 0])); let unset = 0;
      for (const row of rows){
        if (terminal(row) || ![...ids].some(i => assigneeIds(row).has(i))) continue;
        const due = dayOf(row.due_at); if (!due || due < today || due > end) continue;
        const p = points(row, key), worker = workerName(row), c = worker ? canon(spec, worker) : null;
        if (c) loads[c] += p; else unset += p;
      }
      const capacity = r1(days * spec.rate * 0.8);
      const workers = spec.workers.map(w => { const planned = r1(loads[w]); return { name:w, planned, capacity, free:Math.max(0, r1(capacity - planned)), pct:capacity ? Math.round(planned * 100 / capacity) : 0 }; });
      result[key] = { workers, unset:r1(unset), capacity_each:capacity, workdays:days, rate:spec.rate };
    }
    capMemo.set(end, result); return result;
  }
  // Lowest utilisation, then most free points, keeping roster order on ties.
  function recommend(team, day){ const ws = productionCapacity(day)[team]?.workers || []; return ws.length ? ws.reduce((b, x) => cmp([x.pct, -x.free], [b.pct, -b.free]) < 0 ? x : b) : null; }

  let projectsMemo = null;
  function projectHorizon(){
    if (projectsMemo) return projectsMemo;
    const projects = rows.filter(r => String(r.clickup_list_id ?? '') === PROJECT_LIST && !r.parent_task_id && !terminal(r));
    const delivery = rows.filter(category), out = [];
    for (const project of projects){
      const [target, source] = projectTarget(project), status = String(project.status ?? ''), sl = status.toLowerCase(), held = sl.includes('hold');
      let window, bucket;
      if (held){ window = 'ON HOLD'; bucket = 6; }
      else if (target == null){ window = 'NO DATE'; bucket = 5; }
      else { const d = daysBetween(today, target);
        if (d < 0){ window = 'OVERDUE'; bucket = 0; } else if (d <= 7){ window = '0–7d'; bucket = 1; } else if (d <= 14){ window = '8–14d'; bucket = 2; } else if (d <= 20){ window = '15–21d'; bucket = 3; } else { window = 'LATER'; bucket = 4; } }
      const scored = []; for (const row of delivery){ const score = matchScore(project, row); if (score >= 6) scored.push([score, row]); }
      const sorted = sortBy(scored, ([s, r]) => [-s, +!!r.is_closed, String(r.due_at ?? '9999'), String(r.name ?? '')]);
      const matched = sorted.map(x => x[1]);
      const coverage = Object.fromEntries(Object.keys(LISTS).map(c => [c, { open:0, done:0, total:0 }])), unassigned = [];
      for (const row of matched){ const c = coverage[category(row)]; c.total++; if (terminal(row)) c.done++; else { c.open++; if (!(row.assignee_names || []).length) unassigned.push(row); } }
      const expected = expectedCats(project), missing = expected.filter(c => coverage[c]?.total === 0);
      const teamNeeds = key => { const cats = TEAMS[key]?.cats || []; return missing.some(c => cats.includes(c)) || unassigned.some(r => cats.includes(category(r))); };
      const recs = [];
      for (const [key, tag] of [['graphics', 'Graphics'], ['content', 'Content']]) if (teamNeeds(key)){ const rec = recommend(key, target || horizonEnd); if (rec) recs.push(`${tag}: ${rec.name} ${rec.pct}%`); }
      const urgent = !!(target && target <= addDays(today, 7)), overdue = !!(target && target < today && !held);
      let risk = overdue ? 6 : urgent ? 3 : target && target <= addDays(today, 14) ? 1 : 0;
      risk += missing.length * 2 + unassigned.length;
      if (sl.includes('concept') && urgent) risk += 2;
      const signal = held ? 'PAUSED' : risk >= 7 ? 'RED' : risk >= 3 ? 'AMBER' : 'GREEN';
      const parts = [];
      for (const c of config.coverage_order || Object.keys(LISTS)){ const v = coverage[c]; if (v && (v.total || expected.includes(c))) parts.push(v.total ? `${label(c)} ${v.done}/${v.total}` : `${label(c)} missing`); }
      const gaps = [];
      if (missing.length) gaps.push('missing ' + missing.map(label).join(', '));
      if (unassigned.length) gaps.push(`${unassigned.length} unassigned`);
      if (sorted.some(([s]) => s < 100)) gaps.push('some tasks matched by name only');
      out.push({ row:project, name:project.name || 'Untitled project', status, target, target_source:source, window, bucket, coverage, coverage_text:parts.join(' · ') || 'No production tasks matched',
        matched, missing, unassigned, recommendation:recs.join(' · ') || '', signal, gap_text:gaps.join('; ') || 'covered', risk });
    }
    projectsMemo = sortBy(out, x => [x.bucket, -x.risk, x.target || FAR, x.name.toLowerCase()]);
    return projectsMemo;
  }

  // Who runs out of assigned work soon, and which live projects could absorb them.
  function workerQueueAttention(projects = projectHorizon(), threshold = 2){
    const out = [];
    for (const [team, spec0] of Object.entries(TEAMS)){
      const spec = { ...spec0, workers:teamWorkers(spec0) }, ids = accountIds(spec), loads = Object.fromEntries(spec.workers.map(w => [w, 0]));
      for (const row of rows){
        if (terminal(row) || ![...ids].some(i => assigneeIds(row).has(i)) || !spec.cats.includes(category(row))) continue;
        const due = dayOf(row.due_at); if (due && due > horizonEnd) continue;
        const worker = workerName(row), c = worker ? canon(spec, worker) : null;
        if (c) loads[c] += points(row, team);
      }
      const candidates = sortBy(projects.filter(p => !['ON HOLD', 'LATER'].includes(p.window) && (p.missing.some(c => spec.cats.includes(c)) || p.unassigned.some(r => spec.cats.includes(category(r))))),
        p => [p.signal === 'RED' ? 0 : p.signal === 'AMBER' ? 1 : 2, p.target || FAR, -p.risk]);
      for (const worker of spec.workers){
        const pts = r1(loads[worker]), days = spec.rate ? Math.round(pts / spec.rate * 100) / 100 : 0;
        if (days >= threshold) continue;
        out.push({ team, team_label:spec.label, name:worker, points:pts, days, rate:spec.rate, shortfall:Math.max(0, r1(threshold * spec.rate - pts)), suggested_projects:candidates.slice(0, 3).map(p => p.name), project:candidates[0] || null });
      }
    }
    return sortBy(out, x => [x.days, x.team_label, x.name]);
  }

  function campaigns(){
    const groups = new Map();
    for (const row of rows){ if (String(row.clickup_space_id ?? '') !== CAMPAIGN_SPACE || terminal(row)) continue;
      const name = row.raw?.folder_name || row.raw?.list_name || config.campaign_default_name || 'Campaigns';
      if (!groups.has(name)) groups.set(name, []); groups.get(name).push(row); }
    const out = [...groups].map(([name, list]) => {
      const dues = list.map(r => dayOf(r.due_at)).filter(Boolean).sort(), overdue = dues.filter(d => d < today).length;
      const review = list.filter(r => has(lc(r.status) + ' ' + lc(r.name), REVIEW_WORDS)).length, no_owner = list.filter(r => !(r.assignee_names || []).length).length;
      const no_due = list.filter(r => !r.due_at).length, unestimated = list.filter(r => !r.time_estimate_minutes).length;
      const risk = overdue * 4 + review * 2 + no_owner * 2 + no_due + Math.floor(unestimated / 4);
      return { name, open:list.length, next_due:dues[0] || null, overdue, review, no_owner, no_due, unestimated, health:risk >= 12 ? 'RED' : risk >= 5 ? 'AMBER' : 'GREEN', risk };
    });
    return sortBy(out, x => [x.health === 'RED' ? 0 : x.health === 'AMBER' ? 1 : 2, -x.risk, x.name.toLowerCase()]);
  }

  function operatingBrief(){
    const projects = projectHorizon(), result = { risk:[], attention:[], scope:[], people:workerQueueAttention(projects) };
    for (const p of projects){
      if (p.window === 'ON HOLD' || !['RED', 'AMBER'].includes(p.signal)) continue;
      let why = `${p.signal === 'RED' ? 'Red now' : 'Amber, could go red'} · ${WINDOW_TEXT[p.window]} · ${cap(p.status) || 'No stage'}`;
      if (p.gap_text !== 'covered') why += ` · ${cap(p.gap_text)}`;
      const action = p.missing.length ? 'Create the missing workstream tasks and give them owners and dates today.' : p.unassigned.length ? 'Assign the unowned deliverables and confirm their dates today.' : 'Open the project and remove the highest-risk gap today.';
      result.risk.push({ score:100 + p.risk, title:p.name, why, action, row:p.row, due:p.target });
    }
    for (const c of campaigns()){
      if (!['RED', 'AMBER'].includes(c.health)) continue;
      const parts = [[c.overdue, 'overdue'], [c.review, 'in review'], [c.no_owner, 'unowned'], [c.no_due, 'no due date']].filter(x => x[0]).map(x => x.join(' '));
      result.risk.push({ score:80 + c.risk, title:c.name, why:`${c.health === 'RED' ? 'Red' : 'Amber'} campaign · ${parts.join(', ') || 'planning gaps'}`, action:'Clear overdue and review decisions and close ownership and date gaps.', row:null, due:c.next_due });
    }
    result.risk = sortBy(result.risk, x => [-x.score, x.due || FAR, x.title.toLowerCase()]);
    for (const { score, row, why } of needsMe()){
      const action = why.includes('blocked') ? 'Unblock it: make the decision, get the dependency, or change the plan.' : why.includes('review') || why.includes('approval') ? 'Review or approve it now, or leave clear change notes.'
        : why.includes('overdue') ? 'Decide: finish today, re-date with an owner, delegate, or close it.' : 'Confirm the outcome, owner and next concrete step.';
      result.attention.push({ score, title:row.name || 'Untitled', why:cap(why), action, row, due:dayOf(row.due_at) });
    }
    result.attention = result.attention.slice(0, 10);
    for (const p of projects){
      if (p.window === 'ON HOLD') continue;
      const status = p.status.toLowerCase(), t = p.target, issues = [];
      if (t == null) issues.push('no target date');
      if (!p.matched.length) issues.push('no tasks matched yet');
      if (p.missing.length) issues.push('missing ' + p.missing.map(label).join(', '));
      if (p.unassigned.length) issues.push(`${p.unassigned.length} unassigned`);
      if (t && t <= addDays(today, 14) && has(status, ['concept', 'plan', 'not started', 'to do'])) issues.push('not started yet');
      if (!issues.length) continue;
      const urgency = 40 + (t && t < today ? 30 : t && t <= addDays(today, 7) ? 20 : t && t <= addDays(today, 14) ? 10 : 0) + issues.length * 3;
      result.scope.push({ score:urgency, title:p.name, why:issues.map(cap).join(' · '), action:'Set the outcome, workstreams, owners and first step.', row:p.row, due:t });
    }
    for (const row of rows){
      if (terminal(row) || String(row.clickup_list_id ?? '') === PROJECT_LIST) continue;
      if (!category(row) && String(row.clickup_space_id ?? '') !== CAMPAIGN_SPACE) continue;
      const due = dayOf(row.due_at), status = lc(row.status) + ' ' + lc(row.name), unowned = !(row.assignee_names || []).length;
      const workerMissing = teamTargets(row).some(s => s.shared) && !workerName(row), lateStart = !!(due && due <= addDays(today, 3) && has(status, START_WORDS));
      if (!(lateStart || (due && due <= addDays(today, 7) && (unowned || workerMissing)))) continue;
      const issues = []; if (lateStart) issues.push('due soon, not started'); if (unowned) issues.push('no assignee'); if (workerMissing) issues.push('no worker named');
      result.scope.push({ score:55 + (due && due <= today ? 15 : 0), title:row.name || 'Untitled task', why:issues.map(cap).join(' · '), action:'Assign it and start it today, or change its scope or date.', row, due });
    }
    result.scope = sortBy(result.scope, x => [-x.score, x.due || FAR, x.title.toLowerCase()]).slice(0, 12);
    return result;
  }

  // A short ranked action queue: create missing work, assign unowned deliverables, use spare capacity.
  function suggestions(projects = projectHorizon(), production = productionCapacity()){
    const list = [], add = (score, kind, title, why, action, owner, due, row, project) => list.push({ score, kind, title, why, action, owner:owner || '', due:due || null, row:row || null, project:project || null, task_title:title });
    const dflt = addDays(today, 20);
    for (const p of projects){
      if (p.window === 'ON HOLD') continue;
      const t = p.target, urgent = !!(t && t <= addDays(today, 7));
      const base = (p.signal === 'RED' ? 30 : p.signal === 'AMBER' ? 18 : 8) + (urgent ? 8 : 0);
      if (p.missing.length){
        const owners = [...new Set(p.missing.flatMap(c => { const team = TEAM_FOR_CAT[c], rec = team ? recommend(team, t || dflt) : null; return rec ? [`${label(c)}: ${rec.name}`] : []; }))];
        const title = `Create missing ${p.missing.map(label).join(' + ')} work: ${p.name}`;
        add(base + p.missing.length * 3, 'MISSING', title, `${WINDOW_TEXT[p.window]} · The project brief mentions this work but no matching ClickUp task exists`,
          `Create the missing tasks and assign them before ${t ? fmtDate(t, { day:'2-digit', month:'short' }) : 'the project date is set'}.`, owners.join(' · ') || 'Project owner', t, p.row, p);
      }
      for (const task of p.unassigned.slice(0, 3)){
        const cat = category(task), team = TEAM_FOR_CAT[cat], rec = team ? recommend(team, t || dflt) : null, owner = rec ? rec.name : 'Project owner';
        const title = `Assign ${task.name || 'unassigned task'}`;
        add(base + 6, 'ASSIGN', title, `Unassigned ${label(cat)} for ${p.name}`, `Assign to ${owner} and confirm its due date.`, owner, dayOf(task.due_at) || t, task, p);
      }
    }
    for (const item of workerQueueAttention(projects, 2).slice(0, 4)){
      const names = item.suggested_projects.join(', '), title = `Give ${item.name} more ${item.team_label} work, ${item.days.toFixed(1)} days queued`;
      add(item.days < 1 ? 17 : 14, 'CAPACITY', title, `About ${item.days.toFixed(1)} working days of work assigned, two is the target${names ? ` · Projects that could use them: ${names}` : ''}`,
        `Give ${item.name} enough ${item.team_label.toLowerCase()} work to fill two working days.`, item.name, null, item.project?.row, item.project);
    }
    for (const [key, spec] of Object.entries(TEAMS)){
      const td = production[key], workers = td?.workers || []; if (!workers.length) continue;
      const best = workers.reduce((b, x) => cmp([x.pct, -x.free], [b.pct, -b.free]) < 0 ? x : b), name = spec.label;
      if (td.unset > 0 && best.free > 0) add(22, 'CAPACITY', `Choose who does the unassigned ${name} work`, `${best.name} is at ${best.pct}% with room for more over the next 21 days`,
        `Open the unassigned ${name.toLowerCase()} tasks and give the next ones to ${best.name}.`, best.name);
      if (workers.some(w => w.planned > 0) && best.free > 0) add(9, 'CAPACITY', `Next ${name} assignment: ${best.name}`, `Lightest load right now at ${best.pct}%`,
        `Give ${best.name} the next suitable ${name.toLowerCase()} task.`, best.name);
    }
    const seen = new Set(), out = [];
    for (const item of sortBy(list, x => [-x.score, x.due || FAR, x.title.toLowerCase()])){ const k = item.kind + '|' + item.title.toLowerCase(); if (seen.has(k)) continue; seen.add(k); out.push(item); if (out.length >= 12) break; }
    return out;
  }

  // 21-day load per roster row. Configured workers are seeded so zero-load gaps stay visible; never slice this list.
  function horizon(weeks = 3){
    const monday = mondayOf(today), cap = Math.max(1, capacityHours * 60), fresh = () => ({ minutes:Array(weeks).fill(0), unestimated:0, undated:0, tasks:0 });
    const buckets = new Map(ROSTER.map(s => [s.name, { spec:s, ...fresh(), children:new Map((s.workers || []).map(w => [w, fresh()])) }]));
    const count = (t, idx, undated, unest, share) => { t.tasks++; if (undated) t.undated++; if (unest) t.unestimated++; if (idx != null) t.minutes[idx] += share; };
    for (const row of rows){
      if (terminal(row)) continue;
      const targets = teamTargets(row); if (!targets.length) continue;
      const due = dayOf(row.due_at); let idx = null;
      if (due){ idx = Math.max(0, Math.floor(daysBetween(monday, due) / 7)); if (idx >= weeks) idx = null; } // overdue work still costs this week
      const est = Math.trunc(Number(row.time_estimate_minutes)) || 0, mins = est > 0 ? est : 30;
      const share = targets.length > 1 ? Math.max(1, Math.floor(mins / targets.length)) : mins;
      for (const spec of targets){
        const b = buckets.get(spec.name); count(b, idx, !due, est <= 0, share);
        if (!spec.shared) continue;
        const raw = workerName(row), known = (spec.workers || []).find(w => w.toLowerCase() === raw.toLowerCase());
        const name = raw ? known || `Other / unmapped: ${raw}` : 'Worker not set';
        if (!b.children.has(name)) b.children.set(name, fresh());
        count(b.children.get(name), idx, !due, est <= 0, share);
      }
    }
    return ROSTER.map(spec => {
      const b = buckets.get(spec.name), order = new Map((spec.workers || []).map((w, i) => [w, i])), pctOf = (m, c) => m.map(v => Math.round(v * 100 / c));
      const flags = pct => ({ gaps:pct.flatMap((p, i) => p < 65 ? [i] : []), overload:pct.flatMap((p, i) => p > 90 ? [i] : []) });
      const children = !spec.shared ? [] : sortBy([...b.children], ([n]) => [order.has(n) ? order.get(n) : 1000, +(n === 'Worker not set'), n.toLowerCase()]).map(([name, c]) => { const pct = pctOf(c.minutes, cap);
        return { name, minutes:c.minutes, pct, ...flags(pct), unestimated:c.unestimated, undated:c.undated, tasks:c.tasks, kind:'worker', lead:name === spec.lead }; });
      const headcount = spec.shared ? Math.max(1, (spec.workers || []).length) : 1, pct = pctOf(b.minutes, cap * headcount);
      return { name:spec.name, minutes:b.minutes, pct, ...flags(pct), unestimated:b.unestimated, undated:b.undated, tasks:b.tasks, children, headcount, kind:spec.shared ? 'shared' : 'person' };
    });
  }

  return { terminal, needsMe, projectHorizon, productionCapacity, workerQueueAttention, operatingBrief, suggestions, horizon, campaigns, category };
}

/* ===== The user's own plan: tasks table only ===== */
const asTask = t => ({ title:t.title, duration:Math.max(0, t.duration_minutes || 0), start:t.start_minute || 0, priority:t.priority_hint || 0, done:t.state === 'completed' });
const planned = tasks => tasks.filter(t => t.source === 'planner' && t.local_date && (t.state === 'scheduled' || t.state === 'completed'));
const sum = (list, fn) => list.reduce((s, x) => s + fn(x), 0);

export function dayPlan({ tasks, today = melbourneToday(), now = nowMinute() }){
  const day = planned(tasks).filter(t => t.local_date === today).map(asTask), bank = tasks.filter(t => t.state === 'bank').map(asTask);
  const minutes = sum(day, t => t.duration), capacity = 8 * 60, free = Math.max(0, capacity - minutes), open = day.filter(t => !t.done);
  const rank = (t, withStart) => [[1, 2, 3].includes(t.priority) ? t.priority : 9, t.priority === 4 ? 0 : 1, ...(withStart ? [t.start] : []), -t.duration, t.title.toLowerCase()];
  const chosen = [...sortBy(open, t => rank(t, true)).map(t => ({ kind:'calendar', title:t.title })), ...sortBy(bank, t => rank(t, false)).map(t => ({ kind:'queue', title:t.title }))].slice(0, 3);
  const needsPlan = (bank.length > 0 && free >= 30) || minutes < 5 * 60;
  const health = needsPlan ? `Needs planning. ${fmtDuration(minutes)} planned, ${fmtDuration(free)} free, ${bank.length} unscheduled.` : day.length ? `Covered. ${fmtDuration(minutes)} planned with ${fmtDuration(free)} spare.` : 'Nothing planned yet. Put the first useful block on the calendar.';
  return { health, needs_plan:needsPlan, planned:minutes, free, queue:bank.length, top3:chosen, now };
}

export function yesterdayRecap({ tasks, today = melbourneToday() }){
  const y = addDays(today, -1), day = planned(tasks).filter(t => t.local_date === y).map(asTask), done = day.filter(t => t.done);
  return { total:day.length, done:done.length, pct:Math.round(100 * done.length / Math.max(1, day.length)), completed:sum(done, t => t.duration), carry:day.filter(t => !t.done).map(t => t.title) };
}

// The prior seven days, ending yesterday. Reactive is a title heuristic: schema has no category field.
export function growth({ tasks, config, today = melbourneToday(), days = 7 }){
  const end = addDays(today, -1), start = addDays(end, 1 - days), list = planned(tasks).filter(t => t.local_date >= start && t.local_date <= end).map(asTask);
  const plannedMin = sum(list, t => t.duration), completed = sum(list.filter(t => t.done), t => t.duration), deep = sum(list.filter(t => t.done && t.duration >= 60), t => t.duration);
  const words = config.reactive_words || ['quick', 'admin', 'email', 'fix', 'rush'], reactive = sum(list.filter(t => has(t.title.toLowerCase(), words)), t => t.duration);
  const top = list.filter(t => [1, 2, 3].includes(t.priority)), topDone = top.filter(t => t.done).length, completion = plannedMin ? Math.round(completed * 100 / plannedMin) : 0;
  const advice = [];
  if (list.length){ // a week with nothing planned gets no coaching
    if (completion < 75) advice.push('Completion was under 75%. Try planning a little less or leaving more buffer.');
    if (reactive > plannedMin * .25) advice.push('Reactive and admin work took more than a quarter of planned time. Try batching it into fixed windows.');
    if (deep < 240) advice.push('Try two 90-minute focus blocks next week for strategic and campaign planning.');
    if (top.length && topDone / top.length < .75) advice.push('Under three quarters of your Top 3 got done. Try smaller, more specific goals.');
    if (!advice.length) advice.push('This week ran well. Add forward-planning time rather than more daily volume.');
  }
  return { planned:plannedMin, completed, completion, deep, reactive, top3:top.length, top3_done:topDone, advice };
}

export function weekChart({ tasks, today = melbourneToday() }){
  const days = Array.from({ length:7 }, (_, i) => addDays(today, i - 6)), done = planned(tasks).filter(t => t.state === 'completed');
  return days.map(date => ({ date, minutes:sum(done.filter(t => t.local_date === date), t => Math.max(0, t.duration_minutes || 0)) }));
}

// Rows are reduced to what a view shows, so the snapshot stays small enough to clone and cache.
const lean = obj => JSON.parse(JSON.stringify(obj, (k, v) => {
  if (k === 'row') return v ? { url:v.url, id:v.clickup_task_id } : null;
  if (k === 'matched' || k === 'unassigned') return v.length;
  if (k === 'project') return undefined;
  return v;
}));

export function computeSnapshot({ clickup = [], tasks = [], config = {}, today = melbourneToday(), capacityHours = 30 }){
  const a = createAnalytics({ clickup, config, today, capacityHours });
  const projects = a.projectHorizon(), production = a.productionCapacity(), horizon = a.horizon(), brief = a.operatingBrief();
  const needs = a.needsMe();
  return lean({
    today, computed_at:new Date().toISOString(), configured:!!config.team_roster, has_clickup:clickup.length > 0,
    needs:needs.map(n => ({ score:n.score, row:n.row, title:n.row.name || 'Untitled', status:cap(n.row.status), why:cap(n.why), due:dayOf(n.row.due_at) })),
    projects, production, horizon, brief, suggestions:a.suggestions(projects, production), campaigns:a.campaigns(),
    planning_gaps:horizon.filter(h => h.gaps.length).length,
    plan:dayPlan({ tasks, today }), yesterday:yesterdayRecap({ tasks, today }), growth:growth({ tasks, config, today }), week:weekChart({ tasks, today }),
  });
}
