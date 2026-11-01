// Made-up ClickUp data and config for ?demo. Real values live in Supabase, never in this public repo.
import * as store from './store.js';
import { today, addDays, melbourneISO } from './time.js';

const iso = days => melbourneISO(addDays(today(), days), 540);
const config = {
  me_clickup_user_id:'1', campaign_space_id:'camp', project_list_id:'projects',
  delivery_lists:{ content:['content'], graphics:['graphics'], web:['web'], edm:['edm'], copy:['copy'], pc_design:['design'] },
  delivery_labels:{ content:'Content', graphics:'Graphics', web:'Web', edm:'EDM', copy:'Copy', pc_design:'Product design' },
  coverage_order:['content', 'graphics', 'pc_design', 'web', 'edm', 'copy'],
  project_stop_words:['launch', 'campaign', 'the', 'and'],
  expected_keywords:{ content:['video', 'reel'], graphics:['banner'], web:['landing page'], edm:['edm', 'newsletter'], copy:['copy'], pc_design:['product design'] },
  team_roster:[{ name:'Riley Stone', ids:['1'], shared:false }, { name:'Art Desk', ids:['2'], shared:true, lead:'Noor', workers:['Noor', 'Theo', 'Mina'] }, { name:'Video Desk', ids:['3'], shared:true, lead:'Lena', workers:['Lena', 'Omar'] }],
  production_teams:{ graphics:{ account:'Art Desk', rate:4.5, cats:['graphics', 'edm', 'pc_design'], label:'Graphics' }, content:{ account:'Video Desk', rate:4, cats:['content'], label:'Content' } },
  team_for_cat:{ graphics:'graphics', edm:'graphics', pc_design:'graphics', content:'content' },
};
const row = (id, list, name, status, due, names, ids, worker, extra = {}) => ({ clickup_task_id:id, clickup_list_id:list, clickup_space_id:'space', clickup_folder_id:'f', parent_task_id:null, name, description:'', status, priority:null,
  due_at:due == null ? null : iso(due), time_estimate_minutes:120, assignee_names:names, tags:[], url:'https://example.com/' + id, is_closed:false, synced_at:new Date().toISOString(), raw:{ assignee_ids:ids, worker_name:worker }, ...extra });

export function seedInsightsDemo(){
  if (store.get('workspace_integrations', 'recall')) return;
  store.applyRemote('clickup_tasks', [
    row('p1', 'projects', 'Aurora Headset Launch', 'concept phase', 4, ['Riley Stone'], ['1'], '', { description:'Needs a video reel, banner, landing page and newsletter.' }),
    row('p2', 'projects', 'Harbour Pop-up Campaign', 'in progress', 12, ['Riley Stone'], ['1'], '', { description:'Banner set and a short reel.' }),
    row('p3', 'projects', 'Winter Catalogue', 'on hold', 40, [], [], ''),
    row('c1', 'content', 'Aurora Headset reel', 'in progress', 2, ['Video Desk'], ['3'], 'Lena'),
    row('c2', 'content', 'Harbour Pop-up reel', 'to do', 6, [], [], ''),
    row('g1', 'graphics', 'Aurora Headset banner', 'ready to do', 3, ['Art Desk'], ['2'], 'Noor'),
    row('g2', 'graphics', 'Harbour Pop-up banner set', 'in progress', 9, ['Art Desk'], ['2'], ''),
    row('w1', 'web', 'Pricing page sign off', 'review', 0, ['Riley Stone'], ['1'], '', { priority:'urgent' }),
    row('x1', 'camp-list', 'Spring offer approval', 'review', -1, ['Sam'], ['9'], '', { clickup_space_id:'camp', priority:'high', raw:{ assignee_ids:['9'], folder_name:'Spring offer' } }),
  ]);
  store.applyRemote('workspace_integrations', [{ workspace_id:store.ctx.workspaceId, provider:'recall', config, updated_at:new Date().toISOString() }]);
}
