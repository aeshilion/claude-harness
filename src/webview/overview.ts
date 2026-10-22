// @ts-nocheck
// The overview page.
import { assetDesc, labelOf, matches, mcpDesc, persist, select, showRepo, state, total } from './core';
import { el, icon, logo, pressable } from './dom';
import { showKindPage } from './kind-page';

export function renderOverview() {
  const [global, ...repos] = state.views;
  const categories = global ? global.categories : [];
  const all = state.views.flatMap(v => v.categories.flatMap(c => c.items.map(a => Object.assign({ icon: c.icon, scopeLabel: v.label }, a))));
  const recent = all
    .filter(a => ['memory', 'rule', 'agent', 'skill', 'command', 'outputStyle', 'workflow'].includes(a.kind))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 12);
  const results = el('div', { className: 'recent' });
  const showResults = () => {
    const q = state.overviewFilter.toLowerCase();
    const hits = q ? all.filter(a => matches(a, q)) : [];
    results.replaceChildren(
      ...(q
        ? [
            el('div', { className: 'group-label' }, `Results (${hits.length})`),
            hits.length
              ? hits.map(a =>
                  el(
                    'div',
                    { className: 'row', title: a.description, onclick: () => select(a.id) },
                    icon(a.icon),
                    el('span', { className: 'name' }, labelOf(a)),
                    el('span', { className: 'desc' }, [a.scopeLabel, a.kind === 'mcp' ? mcpDesc(a) : assetDesc(a)].filter(Boolean).join(' · '))
                  )
                )
              : el('div', { className: 'empty flush' }, 'No matches'),
          ]
        : []
      ).flat()
    );
    results.hidden = !q;
  };
  showResults();
  const search = el(
    'div',
    { className: 'overview-search' },
    el('input', {
      type: 'search',
      placeholder: 'Search harness elements',
      value: state.overviewFilter,
      oninput: e => {
        state.overviewFilter = e.target.value;
        showResults();
      },
    })
  );
  return el(
    'section',
    { className: 'main' },
    el(
      'header',
      { className: 'main-head' },
      el('span', { className: 'big' }, logo('logo-lg')),
      el('div', { className: 'title' }, el('h1', {}, 'Claude Harness'), el('div', { className: 'path' }, `${global ? total(global) : 0} global assets · ${repos.length} repositories`))
    ),
    el(
      'div',
      { className: 'main-body' },
      el(
        'div',
        { className: 'overview' },
        categories.map(c =>
          el(
            'div',
            Object.assign({ className: 'tile' }, pressable(() => showKindPage(c.kind, global.id))),
            el('span', { className: 'n' }, c.items.length),
            el('span', { className: 'l' }, icon(c.icon), c.label)
          )
        )
      ),
      search,
      results,
      repos.length
        ? el(
            'div',
            { className: 'recent' },
            el('div', { className: 'group-label' }, 'Repositories'),
            repos.map(v =>
              el(
                'div',
                {
                  className: 'row',
                  title: v.path,
                  onclick: () => {
                    state.openRepos.add(v.id);
                    persist();
                    showRepo(v.id);
                  },
                },
                icon('repo'),
                el('span', { className: 'name' }, v.label),
                el(
                  'span',
                  { className: 'desc' },
                  v.categories
                    .filter(c => c.items.length)
                    .map(c => `${c.items.length} ${c.label.toLowerCase()}`)
                    .join(' · ') || 'empty'
                )
              )
            )
          )
        : null,
      el(
        'div',
        { className: 'recent' },
        el('div', { className: 'group-label' }, 'Recently changed'),
        recent.map(a =>
          el(
            'div',
            { className: 'row', onclick: () => select(a.id) },
            icon(a.icon),
            el('span', { className: 'name' }, a.name),
            el('span', { className: 'desc' }, `${a.scopeLabel} · ${new Date(a.mtime).toLocaleString()}`)
          )
        )
      )
    )
  );
}
