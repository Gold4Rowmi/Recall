// Command: manage. All five panels stay mounted; a sub-tab change flips `hidden`, never recomputes.
import { toast, bonk, SFX } from '../brand.js';
import { newTask } from '../tasks.js';
import { queue } from '../planner.js';
import { esc, fill, fillRolling, stateBlock, slide } from '../ui.js';
import { fmtDate } from '../time.js';
import { cap } from '../analytics.js';
import * as insights from '../insights.js';
import { workRow, metricStrip, openRow, dueText, panelState, staleBanner, noClickUp, sharedClick, errorBuzz } from './brief.js';

const PANELS = [['attention', 'Attention'], ['projects', 'Projects'], ['team', 'Team'], ['campaigns', 'Campaigns'], ['review', 'Review']];
const METRICS = [['decisions', 'Decisions'], ['risk', 'At risk'], ['gaps', 'Planning gaps'], ['capacity', 'People free']];
const KPIS = [['completion', 'Completion'], ['deep', 'Deep work'], ['reactive', 'Reactive'], ['top3', 'Top 3']];
const TONE = { RED:'bad', AMBER:'warn', GREEN:'good', PAUSED:'info' };
const WORD = { RED:'Red', AMBER:'Amber', GREEN:'Green', PAUSED:'Paused' };
const h1 = m => (m / 60).toFixed(1) + 'h';
const queued = title => queue().some(t => t.title === title); // a move already waiting in the queue can't be added twice
const showName = n => n === 'Worker not set' ? 'No worker named' : n.replace('Other / unmapped: ', 'Other: ');

function teamRows(horizon, query){
  const rows = horizon.flatMap(h => [{ ...h, child:false }, ...(h.children || []).map(c => ({ ...c, child:true }))]);
  const people = horizon.reduce((n, h) => n + (h.children?.length ? h.children.filter(c => c.name !== 'Worker not set' && !c.name.startsWith('Other / unmapped:')).length : 1), 0);
  return { people, rows:rows.filter(r => !query || r.name.toLowerCase().includes(query)) };
}

function chart(week){
  const max = Math.max(...week.map(d => d.minutes), 1), peak = week.reduce((b, d) => d.minutes > b.minutes ? d : b, week[0]);
  const bars = week.map(d => { const name = fmtDate(d.date, { weekday:'short', day:'numeric', month:'short' });
    return `<div class="bar" tabindex="0" aria-label="${esc(name)}, ${h1(d.minutes)} done"><span class="tip">${esc(name)}: ${h1(d.minutes)}</span>${d.minutes && d.minutes === peak.minutes ? `<span class="small peak">${h1(d.minutes)}</span>` : ''}<i style="height:${d.minutes ? Math.max(4, Math.round(d.minutes * 88 / max)) : 0}%"></i></div>`; }).join('');
  const days = week.map(d => `<span class="small muted">${esc(fmtDate(d.date, { weekday:'short' }))}</span>`).join('');
  return `<div class="bars" role="img" aria-label="Completed hours for the last seven days">${bars}</div><div class="baraxis">${days}</div>`;
}

export default {
  active:'attention', scroll:{},
  mount(el){
    this.el = el; insights.start();
    el.innerHTML = `<div class="cmd">
      <header class="pagehead"><h1 class="pixel">Command</h1><span class="muted">What needs a decision, and who has room</span></header>
      <div data-stale></div>
      <div data-metrics></div>
      <div class="subtabs" role="tablist">${PANELS.map(([k, l]) => `<button class="subtab" role="tab" type="button" data-sub="${k}">${l}</button>`).join('')}</div>
      ${PANELS.map(([k]) => `<div class="cmd-panel" data-panel="${k}" hidden></div>`).join('')}
    </div>`;
    this.panels = Object.fromEntries(PANELS.map(([k]) => [k, el.querySelector(`[data-panel="${k}"]`)]));
    this.panels.attention.innerHTML = '<div class="split11"><section class="card flush"><h2>Needs a decision</h2><div data-needs></div></section><section class="card flush"><h2>Recommended moves</h2><div data-moves></div></section></div>';
    this.panels.projects.innerHTML = '<section class="card flush"><h2>Projects, next 21 days</h2><div data-projects></div></section>';
    this.panels.team.innerHTML = '<section class="card flush"><div class="row teamhead"><h2>Team capacity</h2><span class="small muted" data-count></span><span class="spacer"></span><input data-filter type="search" placeholder="Filter the team" aria-label="Filter the team"></div><div data-team></div></section>';
    this.panels.campaigns.innerHTML = '<section class="card flush"><h2>Campaigns</h2><div data-campaigns></div></section>';
    this.panels.review.innerHTML = `<div class="stack"><div data-kpis></div><section class="card"><h2>7-day execution</h2><div data-chart></div><div data-coachbox hidden><h2 class="mt">Coaching</h2><ol class="coach" data-coach></ol></div></section></div>`;
    // Tracked by listener, not read on switch, so changing tabs never forces a layout read.
    PANELS.forEach(([k]) => this.panels[k].addEventListener('scroll', () => { this.scroll[k] = this.panels[k].scrollTop; }, { passive:true }));
    el.addEventListener('pointerdown', e => { const b = e.target.closest('[data-sub]'); if (b) this.show(b.dataset.sub); });
    el.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      sharedClick(b);
      if (b.dataset.sub) this.show(b.dataset.sub);
      else if (b.dataset.queue) this.queue(+b.dataset.queue);
      else if ('clear' in b.dataset){ const f = el.querySelector('[data-filter]'); f.value = ''; this.renderTeam(); f.focus(); }
      else if ('today' in b.dataset) window.dispatchEvent(new CustomEvent('recall:go', { detail:'today' }));
    });
    el.querySelector('[data-filter]').addEventListener('input', e => { if (e.target.value.length === 1) SFX.sniff(); this.renderTeam(); });
    addEventListener('keydown', e => { if (el.hidden || document.querySelector('dialog[open], .menu') || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const i = PANELS.findIndex(p => p[0] === this.active), next = PANELS[i + (e.key === 'ArrowLeft' ? -1 : 1)]?.[0]; if (!next){ SFX.error(); return bonk(el.querySelector('.subtabs')); } // the ends stop, they don't wrap
      this.show(next); el.querySelector(`[data-sub="${next}"]`).focus(); });
    insights.onSnapshot(() => { if (!el.hidden) this.render(); });
    this.show(this.active);
  },
  show(key){
    if (this.current === key) return;
    const from = this.current, order = PANELS.map(p => p[0]);
    if (from) this.panels[from].hidden = true;
    this.current = this.active = key;
    this.panels[key].hidden = false; this.restore();
    if (from){ SFX.swish(); slide(this.panels[key], order.indexOf(key) > order.indexOf(from) ? 24 : -24); }
    this.el.querySelectorAll('.subtab').forEach(t => t.setAttribute('aria-selected', t.dataset.sub === key));
  },
  restore(){ const y = this.scroll[this.current]; if (y) this.panels[this.current].scrollTop = y; }, // skip at 0: setting it forces layout
  onShow(){ this.render(); this.restore(); }, // snapshots that land while hidden skip render
  queue(i){
    const item = insights.snapshot()?.suggestions[i]; if (!item) return;
    const title = item.task_title || item.title, btn = this.el.querySelector(`[data-queue="${i}"]`);
    if (!queued(title)) newTask({ title, notes:[item.why, item.action].filter(Boolean).join('\n'), duration:30 });
    if (btn){ btn.disabled = true; btn.textContent = 'Queued'; }
    toast('Added to Unscheduled work on Today.', 'success');
  },
  renderTeam(){
    const snap = insights.snapshot(); if (!snap) return;
    const query = this.el.querySelector('[data-filter]').value.trim().toLowerCase(), { people, rows } = teamRows(snap.horizon, query);
    this.el.querySelector('[data-count]').textContent = `${people} people` + (query ? ` · ${rows.length} rows` : '');
    fill(this.el.querySelector('[data-team]'), rows.map(h => {
      const signals = [h.overload.length && 'Overload', h.gaps.length && 'Planning gap', h.undated && `${h.undated} undated`].filter(Boolean);
      return workRow({ tone:h.overload.length ? 'bad' : h.gaps.length ? 'warn' : 'good', title:(h.child ? '– ' : '') + showName(h.name), meta:`This week ${h1(h.minutes[0])} · ${h.pct[0]}% · Next ${h1(h.minutes[1])}`, detail:signals.join(' · ') || 'Healthy' });
    }).join('') || (query ? stateBlock('sleepy', 'No match', 'Try another name.', '<button class="btn primary" type="button" data-clear><span class="glyph">A</span>Clear the filter</button>') : noClickUp('No team set up yet')));
  },
  render(){
    const el = this.el, snap = insights.snapshot(), q = s => el.querySelector(s);
    if (snap === this.painted && !insights.lastError() && this.stale !== true) return;
    errorBuzz(); fill(q('[data-stale]'), staleBanner()); this.stale = !!insights.lastError();
    if (!snap){
      ['[data-needs]', '[data-projects]', '[data-team]', '[data-campaigns]', '[data-chart]'].forEach(s => fill(q(s), panelState()));
      fill(q('[data-moves]'), '<p class="pad muted">Moves appear once the numbers are in.</p>');
      fill(q('[data-metrics]'), metricStrip(METRICS, { decisions:'–', risk:'–', gaps:'–', capacity:'–' }));
      fill(q('[data-kpis]'), metricStrip(KPIS, { completion:'–', deep:'–', reactive:'–', top3:'–' }));
      q('[data-coachbox]').hidden = true; q('[data-count]').textContent = '';
      return;
    }
    this.painted = snap;
    const riskProjects = snap.projects.filter(p => ['RED', 'AMBER'].includes(p.signal) && p.window !== 'ON HOLD');
    fillRolling(q('[data-metrics]'), metricStrip(METRICS, { decisions:snap.needs.length, risk:snap.brief.risk.length || riskProjects.length, gaps:snap.planning_gaps, capacity:snap.brief.people.length }));
    fill(q('[data-needs]'), snap.needs.slice(0, 7).map(n => workRow({ tone:'warn', title:n.title, meta:[n.status || 'Needs attention', dueText(n.due)].filter(Boolean).join(' · '), detail:n.why, action:n.row?.url ? openRow(n.row.url) : '' })).join('')
      || (snap.has_clickup ? stateBlock('sleepy', 'Nothing needs you', 'No decision is waiting on you.', '<button class="btn primary" type="button" data-today><span class="glyph">A</span>Go to Today</button>') : noClickUp('No ClickUp work yet')));
    fill(q('[data-moves]'), snap.suggestions.slice(0, 7).map((m, i) => workRow({ tone:'info', title:m.title, meta:m.owner, detail:m.action || m.why, action:queued(m.task_title || m.title) ? '<button class="btn" type="button" disabled>Queued</button>' : `<button class="btn" type="button" data-queue="${i}">Queue</button>` })).join('') || `<p class="pad muted">${snap.has_clickup ? 'No move is recommended right now.' : 'Moves appear once ClickUp work is in.'}</p>`);
    fill(q('[data-projects]'), snap.projects.map(p => workRow({ tone:TONE[p.signal], title:p.name, meta:`${WORD[p.signal]} · ${p.target ? dueText(p.target) : 'No target'} · ${p.coverage_text}`, detail:p.gap_text === 'covered' ? 'Covered' : cap(p.gap_text) + (p.recommendation ? ' · ' + p.recommendation : ''), action:p.row?.url ? openRow(p.row.url) : '' })).join('') || noClickUp('No projects yet'));
    this.renderTeam();
    fill(q('[data-campaigns]'), snap.campaigns.map(c => {
      const gaps = [[c.overdue, 'overdue'], [c.review, 'in review'], [c.no_owner, 'unowned'], [c.no_due, 'no due date']].filter(x => x[0]).map(x => x.join(' '));
      return workRow({ tone:TONE[c.health], title:c.name, meta:`${WORD[c.health]} · ${c.open} open` + (c.next_due ? ` · next ${dueText(c.next_due)}` : ''), detail:gaps.join(' · ') || 'No planning gap' });
    }).join('') || noClickUp('No campaigns yet'));
    const g = snap.growth;
    const hasWeek = g.planned > 0 || snap.week.some(d => d.minutes);
    fillRolling(q('[data-kpis]'), metricStrip(KPIS, hasWeek ? { completion:g.completion + '%', deep:h1(g.deep), reactive:h1(g.reactive), top3:`${g.top3_done}/${g.top3}` } : { completion:'–', deep:'–', reactive:'–', top3:'–' }));
    fill(q('[data-chart]'), hasWeek ? chart(snap.week) : stateBlock('sleepy', 'Nothing to review yet', 'Finish a few blocks and your week shows up here.', '<button class="btn primary" type="button" data-today><span class="glyph">A</span>Go to Today</button>'));
    q('[data-coachbox]').hidden = !g.advice.length;
    fill(q('[data-coach]'), g.advice.slice(0, 5).map(a => `<li>${esc(a)}</li>`).join(''));
  },
};
