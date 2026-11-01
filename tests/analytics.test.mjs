// node --test tests/  Fixtures are invented; the real roster and ids live in Supabase, not this public repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalytics, isIgnored, computeSnapshot, dayPlan, growth } from '../ui/js/analytics.js';
import { today as now, addDays, melbourneISO } from '../ui/js/time.js';

const TODAY = now(), iso = d => melbourneISO(addDays(TODAY, d), 540), day = d => addDays(TODAY, d);
const config = {
  me_clickup_user_id:'100', campaign_space_id:'campspace', project_list_id:'PROJECT',
  delivery_lists:{ content:['CONTENT'], graphics:['GRAPHICS'], web:['WEB'], edm:['EDM'], copy:['COPY'], pc_design:['SPECIAL'] },
  delivery_labels:{ content:'Content', graphics:'Graphics', web:'Web', edm:'EDM', copy:'Copy', pc_design:'Special design' },
  coverage_order:['content', 'graphics', 'pc_design', 'web', 'edm', 'copy'],
  project_stop_words:['launch', 'campaign', 'collaboration', 'the'],
  expected_keywords:{ content:['video', 'talking head', 'reel'], graphics:['graphic', 'banner'], web:['landing page'], edm:['edm'], copy:['press release'], pc_design:['chassis design'] },
  team_roster:[
    { name:'Pat Lead', ids:['100'], shared:false }, { name:'Quinn', ids:['101'], shared:false },
    { name:'Art Desk', ids:['200'], shared:true, lead:'Ari', workers:['Ari', 'Bo', 'Cy'] },
    { name:'Video Desk', ids:['300'], shared:true, lead:'Dee', workers:['Dee', 'Eli'] },
  ],
  production_teams:{ graphics:{ account:'Art Desk', rate:4.5, cats:['graphics', 'edm', 'pc_design'], label:'Graphics' }, content:{ account:'Video Desk', rate:4, cats:['content'], label:'Content' } },
  team_for_cat:{ graphics:'graphics', edm:'graphics', pc_design:'graphics', content:'content' },
  point_keywords:{ graphics_heavy:['chassis design'], content_long:['youtube'] },
  ignored:{ folder_ids:['ADFOLDER'], list_ids:['ADLIST', 'SOCIALLIST'], folder_names:['Ad Hub'], folder_name_suffixes:['ad hub'], workflow_statuses:['delay copy writing'], delay_workstreams:['copy writing', 'copywriting'] },
};
const task = (id, list, name, status, due, names, ids, worker, extra = {}) => ({ clickup_task_id:id, clickup_list_id:list, parent_task_id:null, name, description:'', status, is_closed:false, due_at:due == null ? null : iso(due), assignee_names:names, raw:{ assignee_ids:ids, ...(worker ? { worker_name:worker } : {}) }, url:'https://example.com/' + id, ...extra });

const horizonRows = [
  task('p1', 'PROJECT', 'Orbit VISOR Webcam Launch', 'concept phase', 5, ['Pat Lead'], ['100'], '', { description:'Launch requires talking head reel, lifestyle gallery, landing page and EDM.', raw:{ launch_date:iso(3), end_date:iso(7), assignee_ids:['100'] } }),
  task('c1', 'CONTENT', 'ORBIT VISOR WEBCAM LAUNCH TALKING HEAD REEL', 'in progress', 2, ['Video Desk'], ['300'], 'Dee'),
  task('c2', 'CONTENT', 'Orbit VISOR Webcam Hero capture', 'complete', -1, ['Pat Lead'], ['100'], '', { is_closed:true }),
  task('p2', 'PROJECT', 'MiraStreams collaboration', 'in progress', 4, ['Pat Lead'], ['100'], '', { description:'Creator campaign with reels and social coverage.' }),
  task('c3', 'CONTENT', '[Expo] Mira Streams | booth gallery, separate campaign', 'to do', 2, [], [], ''),
  task('g1', 'GRAPHICS', 'VISOR Webcam launch banner', 'ready to do', 2, ['Art Desk'], ['200'], 'Ari'),
  task('g2', 'SPECIAL', 'Botanical panel chassis design', 'concepting', 10, ['Art Desk'], ['200'], 'Bo'),
  task('hold', 'PROJECT', 'Held Project', 'on hold', -50, [], [], ''),
  task('live', 'PROJECT', 'Live Project', 'live', 30, [], [], ''),
  task('review', 'PROJECT', 'Review Project', 'in review', 1, [], [], ''),
];

test('portfolio states stay active on the project list', () => {
  const a = createAnalytics({ clickup:horizonRows, config, today:TODAY });
  horizonRows.slice(-3).forEach(r => assert.equal(a.terminal(r), false, r.status));
  assert.equal(a.terminal({ status:'live', clickup_list_id:'GRAPHICS' }), true);
});

test('project horizon: target preference, coverage, missing work, on hold', () => {
  const a = createAnalytics({ clickup:horizonRows, config, today:TODAY }), by = Object.fromEntries(a.projectHorizon().map(x => [x.name, x]));
  const v = by['Orbit VISOR Webcam Launch'];
  assert.equal(v.target_source, 'launch'); assert.equal(v.target, day(3));
  assert.ok(v.coverage.content.total >= 2); assert.ok(v.coverage.graphics.total >= 1);
  assert.ok(v.missing.includes('web')); assert.ok(v.missing.includes('edm'));
  const m = by['MiraStreams collaboration'];
  assert.ok(m.coverage.content.total >= 1, 'camelCase project matches spaced task'); assert.ok(m.unassigned.length >= 1);
  assert.equal(by['Held Project'].window, 'ON HOLD');
});

test('production points model and capacity', () => {
  const cap = createAnalytics({ clickup:horizonRows, config, today:TODAY }).productionCapacity();
  const gfx = Object.fromEntries(cap.graphics.workers.map(w => [w.name, w])), content = Object.fromEntries(cap.content.workers.map(w => [w.name, w]));
  assert.ok(gfx.Ari.planned >= 1); assert.ok(gfx.Bo.planned >= 1.8); assert.ok(content.Dee.planned >= 1);
  assert.ok([...cap.graphics.workers, ...cap.content.workers].every(w => w.capacity > 0));
});

test('scope rules: ads, posting bank, Copy Writing delay', () => {
  for (const row of [{ clickup_folder_id:'ADFOLDER', clickup_list_id:'future', raw:{ folder_name:'Ad Hub' } }, { clickup_folder_id:'', clickup_list_id:'ADLIST', raw:{} }, { clickup_folder_id:'x', clickup_list_id:'SOCIALLIST', raw:{ folder_name:'Social Ops' } }])
    assert.ok(isIgnored(row, config), JSON.stringify(row));
  assert.ok(!isIgnored({ clickup_folder_id:'x', clickup_list_id:'CONTENT', raw:{ folder_name:'Content' } }, config));
  for (const raw of [{ list_name:'[AU]🦘Copy Writing' }, { list_name:'AU Copy Writing' }, { folder_name:'Copy Writing' }, { list_name:'Copywriting' }, { list:{ name:'[AU]🦘Copy Writing' } }])
    assert.ok(isIgnored({ name:'SKU-1 assets', status:'delay', raw }, config), JSON.stringify(raw));
  assert.ok(!isIgnored({ name:'SKU-1 assets', status:'in progress', raw:{ list_name:'Copy Writing' } }, config), 'leaves delay, comes back');
  assert.ok(!isIgnored({ name:'Website task', status:'delay', raw:{ list_name:'Website' } }, config), 'delay elsewhere stays');
  assert.ok(!isIgnored({ name:'DELAY COPY WRITING - SKU', status:'in progress', raw:{ list_name:'Video' } }, config), 'title never drives it');
  assert.ok(isIgnored({ name:'Any', status:'Delay Copy Writing', raw:{} }, config), 'combined status');
});

const suggestRows = [
  task('p1', 'PROJECT', 'VISOR Webcam Launch', 'in progress', 5, ['Pat Lead'], ['100'], '', { description:'Needs a talking head reel, graphics banner, landing page and EDM.' }),
  task('c1', 'CONTENT', 'VISOR Webcam talking head reel', 'to do', 3, [], [], ''),
  task('g1', 'GRAPHICS', 'VISOR Webcam banner', 'ready to do', 3, ['Art Desk'], ['200'], 'Ari'),
];
test('assistant suggestions: missing, assign, capacity', () => {
  const a = createAnalytics({ clickup:suggestRows, config, today:TODAY }), s = a.suggestions();
  assert.ok(s.length);
  assert.ok(s.some(x => x.kind === 'MISSING' && x.title.includes('EDM')));
  const assign = s.filter(x => x.kind === 'ASSIGN' && x.title.toLowerCase().includes('talking head'));
  assert.ok(assign.length && ['Dee', 'Eli'].includes(assign[0].owner));
  assert.ok(s.some(x => x.kind === 'CAPACITY' && x.title.includes('Next Graphics assignment')));
});

test('morning operating brief', () => {
  const rows = [
    task('p1', 'PROJECT', 'VISOR Webcam Launch', 'concept phase', 4, ['Pat Lead'], ['100'], '', { description:'Needs video content, graphics banner, landing page and EDM.', priority:'high' }),
    task('g1', 'GRAPHICS', 'VISOR banner', 'ready to do', 2, ['Art Desk'], ['200'], 'Ari'),
    task('c1', 'CONTENT', 'VISOR talking head', 'to do', 1, ['Video Desk'], ['300'], 'Dee'),
    task('mine', 'WEB', 'Website approval needed', 'review', 0, ['Pat Lead'], ['100'], '', { priority:'urgent' }),
    task('camp1', 'c-list', 'Campaign approval', 'review', -1, ['Someone'], ['555'], '', { clickup_space_id:'campspace', priority:'high', raw:{ assignee_ids:['555'], folder_name:'Spring Campaign' } }),
  ];
  const a = createAnalytics({ clickup:rows, config, today:TODAY }), b = a.operatingBrief(), people = Object.fromEntries(b.people.map(x => [x.name, x]));
  assert.ok(b.risk.some(x => x.title === 'VISOR Webcam Launch'));
  assert.ok(b.attention.some(x => x.title === 'Website approval needed'));
  assert.ok(b.scope.some(x => x.title === 'VISOR Webcam Launch'));
  assert.ok(people.Bo.days < 2); assert.ok(people.Ari.points >= 1);
  assert.ok(people.Bo.suggested_projects.some(p => p.includes('VISOR Webcam Launch')));
  assert.ok(a.needsMe().some(n => n.why.includes('campaign review')), 'campaign review reaches the manager unassigned');
  assert.ok(a.suggestions().some(x => x.kind === 'CAPACITY' && x.title.includes('days queued')));
});

test('team horizon keeps every configured worker at zero load', () => {
  const h = createAnalytics({ clickup:[], config, today:TODAY }).horizon();
  const names = h.flatMap(x => [x.name, ...x.children.map(c => c.name)]);
  for (const n of ['Pat Lead', 'Quinn', 'Art Desk', 'Ari', 'Bo', 'Cy', 'Video Desk', 'Dee', 'Eli']) assert.ok(names.includes(n), n);
});

test('shared account wins, and unset or unknown Workers stay visible', () => {
  const rows = [task('a', 'GRAPHICS', 'A', 'to do', 1, ['x'], ['100', '200'], 'Ari'), task('b', 'GRAPHICS', 'B', 'to do', 1, ['x'], ['200'], ''), task('c', 'GRAPHICS', 'C', 'to do', 1, ['x'], ['200'], 'Zed')];
  const h = createAnalytics({ clickup:rows, config, today:TODAY }).horizon(), by = Object.fromEntries(h.map(x => [x.name, x]));
  assert.equal(by['Pat Lead'].tasks, 0); assert.equal(by['Art Desk'].tasks, 3);
  const kids = by['Art Desk'].children.map(c => c.name);
  assert.ok(kids.includes('Worker not set')); assert.ok(kids.includes('Other / unmapped: Zed'));
});

const planTask = (title, d, state, minute, duration, priority = 0) => ({ title, source:'planner', local_date:d, state, start_minute:minute, duration_minutes:duration, priority_hint:priority });
test('day plan ranks Top 3 and flags thin days', () => {
  const tasks = [planTask('Later', TODAY, 'scheduled', 600, 30), planTask('First', TODAY, 'scheduled', 700, 30, 1), { title:'Queued', state:'bank', duration_minutes:60, priority_hint:0 }];
  const p = dayPlan({ tasks, today:TODAY });
  assert.deepEqual(p.top3.map(t => t.title), ['First', 'Later', 'Queued']);
  assert.ok(p.needs_plan);
});
test('growth covers the prior seven days only', () => {
  const g = growth({ tasks:[planTask('Deep', day(-2), 'completed', 540, 120, 1), planTask('Today', TODAY, 'completed', 540, 600)], config, today:TODAY });
  assert.equal(g.completed, 120); assert.equal(g.completion, 100); assert.equal(g.top3_done, 1);
});

test('snapshot is plain data with no raw rows', () => {
  const s = computeSnapshot({ clickup:horizonRows, tasks:[], config, today:TODAY });
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  assert.ok(!JSON.stringify(s).includes('assignee_ids'));
  assert.equal(typeof s.projects[0].matched, 'number');
});

test('words shown in the UI are plain sentence case', () => {
  const s = computeSnapshot({ clickup:suggestRows, tasks:[], config, today:TODAY });
  const shown = [...s.brief.risk, ...s.brief.attention, ...s.brief.scope, ...s.suggestions].flatMap(x => [x.title, x.why, x.action]).filter(Boolean);
  assert.ok(shown.length);
  for (const line of shown){ assert.ok(!/\bpts\b|Set Worker|protected|diluted|time is lost/.test(line), line); assert.ok(!/^[a-z]/.test(line), line); }
  assert.deepEqual(growth({ tasks:[], config, today:TODAY }).advice, [], 'no coaching for an empty week');
});
