// Brief: orient and shape the day. Scan numbers, ranked attention, my day, yesterday.
import * as store from '../store.js';
import { toast, SFX } from '../brand.js';
import { openExternal } from '../sync.js';
import { esc, fill, fillRolling, rollDigits, stateBlock, loadingBlock } from '../ui.js';
import { today, fmtDate, fmtDuration } from '../time.js';
import { dayPlan, yesterdayRecap } from '../analytics.js';
import * as insights from '../insights.js';
import { openSettings } from './utilities.js';

const METRICS = [['risk', 'At risk'], ['attention', 'Decisions'], ['scope', 'Missing setup'], ['people', 'People free']];
const KINDS = { risk:['Risk', 'bad'], attention:['Decision', 'warn'], scope:['Setup', 'info'] };
const $ = (root, sel) => root.querySelector(sel);

export const openRow = url => `<button class="btn" type="button" data-url="${esc(url)}" title="Opens in ClickUp" aria-label="Open in ClickUp">Open</button>`;
export const workRow = ({ tone, title, meta, detail, action = '' }) => `<div class="wrow ${tone}"><i class="tone" aria-hidden="true"></i><div class="wmain"><div class="clip wtitle" title="${esc(title)}">${esc(title)}</div><div class="small muted clip">${esc(meta)}</div>${detail ? `<div class="small">${esc(detail)}</div>` : ''}</div><div class="wact">${action}</div></div>`;
export const metricStrip = (list, values) => `<div class="metrics">${list.map(([k, label]) => `<div class="metric"><span class="pixel mval" role="img" aria-label="${esc(values[k])}" data-roll="${esc(values[k])}">${rollDigits(values[k])}</span><span class="small muted">${esc(label)}</span></div>`).join('')}</div>`;
export const dueText = due => due ? fmtDate(due, { day:'2-digit', month:'short' }) : '';

const retry = '<button class="btn" type="button" data-retry><span class="glyph">A</span>Try again</button>';
// One state for every panel that has no snapshot yet: loading, or an error that can be retried.
export const panelState = () => insights.lastError() ? stateBlock('sad', 'Couldn’t read the numbers', 'Your plan is safe. Try again.', retry) : loadingBlock('Reading the numbers.');
export const staleBanner = () => insights.lastError() && insights.snapshot() ? `<div class="status warn" role="status"><span class="sq"></span><span>These numbers may be out of date.</span>${retry}</div>` : '';
export const noClickUp = title => stateBlock('sleepy', title, 'Connect ClickUp in Settings, then sync.', '<button class="btn primary" type="button" data-settings><span class="glyph">A</span>Open Settings</button>');
export const sharedClick = b => { if ('retry' in b.dataset) insights.retry(); else if ('settings' in b.dataset) openSettings(); else if (b.dataset.url) openExternal(b.dataset.url); };

// One buzz per failure, whichever screen shows it first.
let said = null;
export const errorBuzz = () => { const e = insights.lastError(); if (e && e !== said) SFX.error(); said = e; };

const contextKey = () => store.ctx.userId + '|' + today();

export default {
  mount(el){
    this.el = el; insights.start();
    el.innerHTML = `<div class="wrap brief">
      <header class="pagehead"><h1 class="pixel">Brief</h1><span class="muted" data-date></span></header>
      <div data-stale></div>
      <div data-metrics></div>
      <div class="split21">
        <section class="card flush"><h2>What needs attention</h2><div data-list></div></section>
        <div class="stack">
          <section class="card"><h2>My day</h2><p class="small muted" data-health></p><div class="top3" data-top3></div>
            <button class="btn primary" type="button" data-plan><span class="glyph">A</span>Fill my day</button></section>
          <section class="card"><h2>Yesterday</h2><p class="small muted" data-recap></p>
            <button class="btn" type="button" data-toggle aria-expanded="false">Add context</button>
            <div data-context hidden><label class="field">Context for today<textarea data-note></textarea></label><div class="sheet-actions"><button class="btn" type="button" data-save>Save context</button></div></div></section>
        </div>
      </div></div>`;
    el.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      sharedClick(b);
      if ('plan' in b.dataset) window.dispatchEvent(new CustomEvent('recall:fill'));
      else if ('cmd' in b.dataset) window.dispatchEvent(new CustomEvent('recall:go', { detail:'command' }));
      else if ('toggle' in b.dataset) this.toggleContext(b);
      else if ('save' in b.dataset) this.saveContext();
    });
    insights.onSnapshot(() => { if (!el.hidden) this.render(); });
  },
  toggleContext(b){
    const box = $(this.el, '[data-context]'), open = box.hidden; box.hidden = !open;
    b.textContent = open ? 'Hide context' : 'Add context'; b.setAttribute('aria-expanded', open);
    if (open){ const n = $(this.el, '[data-note]'); n.value = store.get('daily_context', contextKey())?.note || ''; n.focus(); }
  },
  saveContext(){
    const cur = store.get('daily_context', contextKey());
    store.put('daily_context', { morning_summary:{ text:'' }, clickup_summary:{ text:'' }, planning_assessment:{ text:'' }, created_at:new Date().toISOString(), ...(cur || {}), context_date:today(), note:$(this.el, '[data-note]').value.trim() });
    toast('Context saved.', 'success');
  },
  onShow(){ this.render(); this.el.scrollTop = this.top || 0; }, // snapshots that land while hidden skip render
  onHide(){ this.top = this.el.scrollTop; },
  paintDay(plan, y){
    const el = this.el;
    $(el, '[data-health]').textContent = plan.health;
    fill($(el, '[data-top3]'), plan.top3.map((t, i) => `<div class="row toprow"><span class="ptag">P${i + 1}</span><span class="clip" title="${esc(t.title)}">${esc(t.title)}</span><span class="spacer"></span><span class="small muted">${t.kind === 'calendar' ? 'Calendar' : 'Unscheduled'}</span></div>`).join('') || '<p class="small muted">No Top 3 suggestion yet.</p>');
    $(el, '[data-recap]').textContent = y.total ? `${y.done}/${y.total} blocks · ${y.pct}% completion · ${fmtDuration(y.completed)} done` + (y.carry.length ? `\nCarry-over: ${y.carry.slice(0, 3).join(', ')}${y.carry.length > 3 ? '…' : ''}` : '') : 'No blocks were scheduled yesterday.';
  },
  render(){
    const el = this.el, snap = insights.snapshot();
    if (snap === this.painted && !insights.lastError() && this.stale !== true) return;
    errorBuzz(); fill($(el, '[data-stale]'), staleBanner()); this.stale = !!insights.lastError();
    $(el, '[data-date]').textContent = fmtDate(today(), { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    const list = $(el, '[data-list]');
    if (!snap){
      fill(list, panelState());
      const tasks = store.all('tasks'); this.paintDay(dayPlan({ tasks }), yesterdayRecap({ tasks })); // the user's own day needs no worker
      fill($(el, '[data-metrics]'), metricStrip(METRICS, { risk:'–', attention:'–', scope:'–', people:'–' }));
      return;
    }
    this.painted = snap;
    const ops = snap.brief;
    fillRolling($(el, '[data-metrics]'), metricStrip(METRICS, Object.fromEntries(METRICS.map(([k]) => [k, ops[k].length]))));
    const rows = [['risk', 3], ['attention', 3], ['scope', 2]].flatMap(([k, n]) => ops[k].slice(0, n).map(item => {
      const [kind, tone] = KINDS[k], due = dueText(item.due);
      return workRow({ tone, title:item.title, meta:kind + (due ? ' · ' + due : ''), detail:item.why || item.action, action:item.row?.url ? openRow(item.row.url) : '' });
    }));
    fill(list, rows.join('') || (snap.has_clickup ? stateBlock('sleepy', 'Nothing needs you', 'Start with your own plan.', '<button class="btn primary" type="button" data-plan><span class="glyph">A</span>Fill my day</button>') : noClickUp('No ClickUp work yet')) + (rows.length && (ops.risk.length > 3 || ops.attention.length > 3 || ops.scope.length > 2) ? '<div class="pad"><button class="btn" type="button" data-cmd>See all in Command</button></div>' : '')); // the tiles count everything; the list shows the top few
    this.paintDay(snap.plan, snap.yesterday);
  },
};
