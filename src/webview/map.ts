// @ts-nocheck
// The Delegation map and its process diagram.
import { state } from './core';
import { DECISION_LABELS, decisionCard } from './decisions';
import { clip, el, fmtDur, fmtTime, plural, shortModel, shortType, svg } from './dom';
import { hideHover, placeCard } from './hover';
import { colorsOf, endOfAgent, modeSwitch, widthOf } from './session-common';
import { bindAgent, bindMainHover, laneName } from './timeline';

export const MAP_MODES = [
  ['sum', 'Sum', 'merge', 'Agents summed up by type under whoever started them; click a type to drill down to its runs.'],
  ['timeline', 'Full timeline', 'history', 'Your prompts as a process from top to bottom: each delegation branches into the agents it started, and their reports join the main thread again.'],
];

// Every row in the map shows the same facts in the same right-aligned columns: model (runs for a type), run time, tools, messages.
export const MAP_ROW_H = 30;

export const MAP_FACT_ENDS = [244, 172, 100, 28];

// The narrowest a row gets before the map scrolls: the four fact columns plus a short agent name.
export const MAP_ROW_MIN = 400;

export const fmtRun = ms => (ms > 0 ? fmtDur(ms) : '-');

export const mapCells = (right, y, list) => list.map((t, i) => svg('text', { x: right - MAP_FACT_ENDS[i], y, class: 'dg-meta', 'text-anchor': 'end' }, t));

export const mapNameRoom = (x, right) => Math.floor((right - MAP_FACT_ENDS[0] - 70 - x) / 6.6);

export function mapFacts(d) {
  const msgs = new Map();
  for (const e of d.events) if (e.kind === 'message' && e.agent) msgs.set(e.agent, (msgs.get(e.agent) || 0) + 1);
  return { msgs, toolsOf: a => Object.values(a.tools).reduce((n, v) => n + v, 0), runOf: a => (typeof a.start === 'number' && a.end > a.start ? a.end - a.start : 0) };
}

export function mapAgentRow(a, x, y, right, d, colors, msgs, selected) {
  const { toolsOf, runOf } = mapFacts({ events: [] });
  const family = a.model ? String(a.model).replace(/^claude-/, '').replace(/-\d.*$/, '') : '-';
  const g = svg(
    'g',
    { class: 'dg-agent' },
    svg('rect', { x, y, width: right - x, height: MAP_ROW_H, rx: 5, class: `dg-node${a.status === 'failed' ? ' failed' : a.status === 'unknown' ? ' silent' : ''}${selected === a.id ? ' sel' : ''}` }),
    svg('rect', { x, y, width: 4, height: MAP_ROW_H, class: `dg-tone ${colors.tone(a)}` }),
    svg('text', { x: x + 12, y: y + 19, class: 'dg-label' }, clip(laneName(a), mapNameRoom(x, right))),
    mapCells(right, y + 19, [family, fmtRun(runOf(a)), plural(toolsOf(a), 'tool'), plural(msgs.get(a.id) || 0, 'msg')])
  );
  bindAgent(g, a, d, colors);
  return g;
}

export function drawMap(host, d) {
  const W = widthOf(host, 560);
  const colors = colorsOf(d);
  const selected = state.session && state.session.selected;
  const mode = state.mapMode === 'sum' ? 'sum' : 'timeline';
  const PAD = 12;
  const ROW = 36;
  const NODE_H = MAP_ROW_H;
  const MAIN_W = 150;
  // Sum: one node per agent type under whoever started it; a type drills down to its runs, a run shows the types it started.
  const ids = new Set(d.agents.map(a => a.id));
  const kids = new Map();
  for (const a of d.agents) if (a.parent && ids.has(a.parent)) kids.set(a.parent, [...(kids.get(a.parent) || []), a]);
  const groupsOf = (list, key) => {
    const byType = new Map();
    for (const a of list) byType.set(a.type, [...(byType.get(a.type) || []), a]);
    return [...byType.entries()].map(([type, agents]) => {
      const k = `${key}/${type}`;
      return { key: k, type, agents, children: agents.map(a => ({ key: `${k}/${a.id}`, agent: a, children: groupsOf(kids.get(a.id) || [], `${k}/${a.id}`) })) };
    });
  };
  const open = state.session ? (state.session.mapOpen = state.session.mapOpen || {}) : {};
  const isOpen = n => n.children.length > 0 && (n.agent ? true : !!open[n.key]);
  const shown = [];
  if (mode === 'sum') {
    const walk = (n, depth, parent) => {
      shown.push({ n, depth, parent });
      if (isOpen(n)) n.children.forEach(c => walk(c, depth + 1, n));
    };
    groupsOf(d.agents.filter(a => !a.parent || !ids.has(a.parent)), 'map').forEach(g => walk(g, 0));
  }
  const sw = modeSwitch(host, MAP_MODES, mode, 'Delegation map views', id => {
    state.mapMode = id;
    drawMap(host, d);
  });
  if (mode === 'timeline') {
    host.replaceChildren(sw, drawProcess(W, d));
    return;
  }
  // A tree table across the full width: rows indent by depth and end at the right edge, the facts sit in
  // right-aligned columns at the same place on every row.
  const INDENT = 22;
  const left0 = PAD + MAIN_W + 48;
  const width = Math.max(W, left0 + MAP_ROW_MIN + PAD);
  const rowRight = width - PAD;
  const { msgs, toolsOf, runOf } = mapFacts(d);
  const pos = new Map();
  let y = PAD + 18;
  for (const r of shown) {
    pos.set(r.n.key, { x: left0 + r.depth * INDENT, y });
    y += ROW;
  }
  const H = Math.max(y, PAD + 18 + 72) + PAD;
  const mainY = PAD + 18;
  const mainH = 72;
  const root = svg('svg', { width, height: H, viewBox: `0 0 ${width} ${H}`, class: 'tl dg', role: 'img', 'aria-label': 'Delegation map, summed by agent type' });
  const mainG = svg(
    'g',
    { class: 'dg-main' },
    svg('rect', { x: PAD, y: mainY, width: MAIN_W, height: mainH, rx: 6, class: 'dg-node main' }),
    svg('text', { x: PAD + 10, y: mainY + 20, class: 'dg-label strong' }, 'Main thread'),
    svg('text', { x: PAD + 10, y: mainY + 36, class: 'dg-meta' }, shortModel(d.model) || ''),
    svg('text', { x: PAD + 10, y: mainY + 50, class: 'dg-meta' }, `${d.prompts.length} prompts · ${Object.values(d.tools).reduce((n, v) => n + v, 0)} tools`)
  );
  bindMainHover(mainG, d);
  const mainRight = PAD + MAIN_W;
  const mainMid = mainY + mainH / 2;
  const edges = svg('g', {});
  for (const r of shown) {
    const c = pos.get(r.n.key);
    if (r.parent) {
      const p = pos.get(r.parent.key);
      edges.append(svg('path', { d: `M ${p.x + 10} ${p.y + NODE_H} V ${c.y + NODE_H / 2} H ${c.x}`, class: 'dg-edge' }));
    } else {
      const elbow = mainRight + (left0 - mainRight) / 2;
      edges.append(svg('path', { d: `M ${mainRight} ${mainMid} H ${elbow} V ${c.y + NODE_H / 2} H ${left0}`, class: 'dg-edge' }));
    }
  }
  root.append(edges, mainG);
  const agentNode = (a, p) => root.append(mapAgentRow(a, p.x, p.y, rowRight, d, colors, msgs, selected));
  // A type node: how many runs, their summed run time, tools and messages; a click drills down to the runs.
  const typeNode = (n, p) => {
    const runs = n.agents;
    const failed = runs.filter(a => a.status === 'failed').length;
    const name = shortType(n.type);
    const toggle = refocus => {
      open[n.key] = !isOpen(n);
      hideHover();
      drawMap(host, d);
      if (!refocus) return;
      const g = [...host.querySelectorAll('.dg-decision')].find(x => x.dataset.key === n.key);
      if (g) g.focus();
    };
    const g = svg(
      'g',
      { class: 'dg-decision', tabindex: '0', role: 'button', 'aria-expanded': isOpen(n) ? 'true' : 'false', 'aria-label': `${name}, ${runs.length} ${runs.length === 1 ? 'run' : 'runs'}` },
      svg('rect', { x: p.x, y: p.y, width: rowRight - p.x, height: NODE_H, rx: 5, class: `dg-node${failed ? ' failed' : ''}` }),
      svg('rect', { x: p.x, y: p.y, width: 4, height: NODE_H, class: `dg-tone ${colors.tone(runs[0])}` }),
      svg('text', { x: p.x + 12, y: p.y + 19, class: 'dg-label strong' }, clip(name, mapNameRoom(p.x, rowRight))),
      svg('text', { x: rowRight - 10, y: p.y + 19, class: 'dg-fold', 'text-anchor': 'end' }, isOpen(n) ? '▾' : '▸'),
      mapCells(rowRight, p.y + 19, [
        plural(runs.length, 'run'),
        fmtRun(runs.reduce((s, a) => s + runOf(a), 0)),
        plural(runs.reduce((s, a) => s + toolsOf(a), 0), 'tool'),
        plural(runs.reduce((s, a) => s + (msgs.get(a.id) || 0), 0), 'msg'),
      ])
    );
    g.dataset.key = n.key;
    g.addEventListener('click', () => toggle());
    g.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      toggle(true);
    });
    root.append(g);
  };
  for (const r of shown) (r.n.agent ? agentNode(r.n.agent, pos.get(r.n.key)) : typeNode(r.n, pos.get(r.n.key)));
  host.replaceChildren(sw, root);
}

// Full timeline as a process from top to bottom: your prompts are the steps of the main thread; a delegation branches
// to the agents it started, and each agent's report joins the main thread again (dashed) after the step it reached.
export function drawProcess(W, d) {
  const steps = [...(d.decisions || [])].sort((p, q) => p.at - q.at);
  if (!steps.length) return el('div', { className: 'empty flush dg-empty' }, 'No prompts in this session.');
  const colors = colorsOf(d);
  const selected = state.session && state.session.selected;
  const { msgs } = mapFacts(d);
  const PAD = 12;
  const STEP_W = 124;
  const STEP_H = 34;
  const ROW = 36;
  const GAP = 22;
  const INDENT = 22;
  const stepX = PAD + 10;
  const spineX = stepX + STEP_W / 2;
  const returnX = stepX + STEP_W + 14;
  const branchX = returnX + 16;
  const agentsX = branchX + 18;
  const width = Math.max(W, agentsX + MAP_ROW_MIN + PAD);
  const right = width - PAD;
  const colOfTime = t => steps.reduce((c, s, i) => (typeof t === 'number' && s.at <= t ? i : c), 0);
  const byId = new Map(d.agents.map(a => [a.id, a]));
  const startOf = a => (typeof a.launchedAt === 'number' ? a.launchedAt : typeof a.start === 'number' ? a.start : 0);
  const ordered = [...d.agents].sort((p, q) => startOf(p) - startOf(q));
  // Each run: the step that started it (its parent's step for a nested agent) and the step its report reached.
  const task = new Map();
  const place = a => {
    if (task.has(a.id)) return task.get(a.id);
    const parent = a.parent && byId.get(a.parent) ? place(byId.get(a.parent)) : undefined;
    const c = parent ? parent.c : colOfTime(startOf(a));
    const reported = a.reports && a.reports.length ? a.reports[0] : endOfAgent(a);
    const t = { a, c, rc: Math.max(c, colOfTime(reported)), depth: parent ? parent.depth + 1 : 0, parent };
    task.set(a.id, t);
    return t;
  };
  ordered.forEach(place);
  const runs = ordered.map(a => task.get(a.id));
  // Each step owns a block of rows: the runs it started in launch order, each nested run right under its parent.
  const kids = new Map();
  for (const t of runs) if (t.parent) kids.set(t.parent.a.id, [...(kids.get(t.parent.a.id) || []), t]);
  const blocks = steps.map(() => []);
  const add = (t, list) => {
    list.push(t);
    (kids.get(t.a.id) || []).forEach(k => add(k, list));
  };
  for (const t of runs) if (!t.parent) add(t, blocks[t.c]);
  const startY = PAD + 8;
  const stepTop = [];
  const blockEnd = [];
  let y = startY + 22;
  steps.forEach((s, i) => {
    stepTop.push(y);
    blocks[i].forEach((t, k) => {
      t.x = agentsX + t.depth * INDENT;
      t.y = y + 2 + k * ROW;
    });
    const h = Math.max(STEP_H, blocks[i].length * ROW - (ROW - MAP_ROW_H) + 4);
    blockEnd.push(y + h);
    y += h + GAP;
  });
  const endY = y + 2;
  const H = endY + 8 + PAD;
  const joinY = i => blockEnd[i] + GAP / 2;
  const root = svg('svg', { width, height: H, viewBox: `0 0 ${width} ${H}`, class: 'tl dg', role: 'img', 'aria-label': 'Delegation process, prompt by prompt' });
  root.append(svg('defs', {}, svg('marker', { id: 'dg-arrow', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }, svg('path', { d: 'M 0 0 L 8 4 L 0 8 z', class: 'dg-arrowhead' }))));
  const edges = svg('g', {});
  const arrow = (dPath, back) => edges.append(svg('path', { d: dPath, class: `dg-edge${back ? ' back' : ''}`, 'marker-end': 'url(#dg-arrow)' }));
  // The main thread's flow: start, every prompt in order, end.
  arrow(`M ${spineX} ${startY + 7} V ${stepTop[0]}`);
  steps.forEach((s, i) => arrow(`M ${spineX} ${stepTop[i] + STEP_H} V ${i + 1 < steps.length ? stepTop[i + 1] : endY - 7}`));
  for (const t of runs) {
    if (t.parent) {
      const p = t.parent;
      arrow(`M ${p.x + 10} ${p.y + MAP_ROW_H} V ${t.y + MAP_ROW_H / 2} H ${t.x}`);
    } else {
      arrow(`M ${stepX + STEP_W} ${stepTop[t.c] + STEP_H / 2} H ${branchX} V ${t.y + 11} H ${t.x}`);
      arrow(`M ${t.x} ${t.y + 21} H ${returnX} V ${joinY(t.rc)} H ${spineX + 1}`, true);
    }
  }
  root.append(edges);
  root.append(svg('circle', { cx: spineX, cy: startY, r: 7, class: 'dg-event' }), svg('circle', { cx: spineX, cy: endY, r: 7, class: 'dg-event end' }));
  // A team that ran together forks at a parallel gateway beside its prompt.
  steps.forEach((s, i) => {
    if (s.launches < 2 || s.shape !== 'agents together') return;
    const gx = branchX;
    const gy = stepTop[i] + STEP_H / 2;
    root.append(svg('path', { d: `M ${gx} ${gy - 7} L ${gx + 7} ${gy} L ${gx} ${gy + 7} L ${gx - 7} ${gy} Z`, class: 'dg-gateway' }), svg('path', { d: `M ${gx - 3.5} ${gy} H ${gx + 3.5} M ${gx} ${gy - 3.5} V ${gy + 3.5}`, class: 'dg-edge' }));
  });
  steps.forEach((s, i) => {
    const yy = stepTop[i];
    const g = svg(
      'g',
      { class: 'dg-decision' },
      svg('rect', { x: stepX, y: yy, width: STEP_W, height: STEP_H, rx: 5, class: `dg-node${s.action === 'delegated' ? ' gold' : ''}` }),
      svg('text', { x: stepX + 8, y: yy + 14, class: 'dg-label strong' }, fmtTime(s.at)),
      svg('text', { x: stepX + 8, y: yy + 28, class: 'dg-meta' }, clip(DECISION_LABELS[s.action] || s.action, Math.floor((STEP_W - 14) / 5.6)))
    );
    const card = e => placeCard(`step:${s.at}`, () => decisionCard(fmtTime(s.at), [s], d), { x: e.clientX, y: e.clientY });
    g.addEventListener('mouseenter', card);
    g.addEventListener('mousemove', card);
    g.addEventListener('mouseleave', hideHover);
    root.append(g);
  });
  for (const t of runs) root.append(mapAgentRow(t.a, t.x, t.y, right, d, colors, msgs, selected));
  return root;
}
