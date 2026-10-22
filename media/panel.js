(function () {
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || {};
  const state = {
    views: [],
    openRepos: new Set(saved.openRepos || []),
    detail: undefined,
    repo: undefined,
    draft: undefined,
    filter: saved.filter || '',
    overviewFilter: '',
    expanded: new Set(saved.expanded || []),
    mcpSort: saved.mcpSort || 'name',
    repoSort: saved.repoSort || 'recent',
    mcpInfo: {},
    checks: {},
    page: undefined,
    fleet: undefined,
    effective: {},
    ruleInfo: {},
    markets: undefined,
    init: undefined,
    sessions: {},
    allSessions: new Set(),
    session: undefined,
    sessionView: saved.sessionView || 'timeline',
    decisionMode: saved.decisionView || 'timeline',
    mapMode: saved.mapMode || 'timeline',
    billing: saved.billing || 'api',
    styleModel: saved.styleModel || 'sonnet',
  };
  const app = document.getElementById('app');

  const el = (tag, attrs, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (k === 'className') node.className = v;
      else if (k === 'value') node.value = v;
      else if (k === 'checked') node.checked = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c !== undefined && c !== null && c !== false) node.append(c.nodeType ? c : String(c));
    return node;
  };
  const icon = name => el('span', { className: `codicon codicon-${name}` });
  const logo = size => (document.body.dataset.logo ? el('img', { className: `logo ${size}`, src: document.body.dataset.logo, alt: '' }) : icon('hubot'));
  const iconBtn = (name, title, onclick, disabled) => el('button', { className: 'icon-btn', title, 'aria-label': title, onclick, disabled }, icon(name));

  const persist = () => vscode.setState({ filter: state.filter, expanded: [...state.expanded], openRepos: [...state.openRepos], mcpSort: state.mcpSort, repoSort: state.repoSort, sessionView: state.sessionView, decisionView: state.decisionMode, mapMode: state.mapMode, billing: state.billing, styleModel: state.styleModel });
  const SOURCES = {
    user: { icon: 'account', label: 'Your config (~/.claude.json)' },
    local: { icon: 'lock', label: 'Local to this repo (~/.claude.json)' },
    project: { icon: 'repo', label: 'Repo .mcp.json' },
    'claude.ai': { icon: 'cloud', label: 'claude.ai connector' },
    plugin: { icon: 'extensions', label: 'Plugin' },
  };
  const SOURCE_ORDER = Object.keys(SOURCES);
  const labelOf = a =>
    a.kind !== 'mcp' ? a.name : a.source === 'claude.ai' ? a.name.replace(/^claude\.ai /, '') : a.source === 'plugin' ? a.name.split(':').slice(2).join(':') : a.name;
  const pluginOf = a => (a.source === 'plugin' ? a.name.split(':')[1] : '');
  const mcpDesc = a => [pluginOf(a) && `${pluginOf(a)} plugin`, a.enabled === false ? 'off' : a.offIn ? `off in ${a.offIn} folders` : '', a.status || a.target].filter(Boolean).join(' · ');
  const assetDesc = a => [a.version && `v${a.version}`, a.copies && a.copies.length ? `also in ${a.copies.map(c => `${c.label} (${c.same ? 'identical' : 'differs'})`).join(', ')}` : '', a.description].filter(Boolean).join(' · ');
  const statusRank = a => (a.enabled === false ? 9 : /^connected/i.test(a.status || '') ? 0 : /auth/i.test(a.status || '') ? 1 : /not configured/i.test(a.status || '') ? 3 : 2);
  const byLabel = (a, b) => labelOf(a).localeCompare(labelOf(b)) || a.name.localeCompare(b.name);
  const SORTS = {
    name: byLabel,
    source: (a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source) || byLabel(a, b),
    status: (a, b) => statusRank(a) - statusRank(b) || byLabel(a, b),
  };
  const editable = () => state.detail && ['markdown', 'code', 'settings'].includes(state.detail.mode);
  const snapshot = d => JSON.stringify({ fields: d.fields, body: d.body });
  const isDirty = () => !!(state.draft && state.detail && snapshot(state.draft) !== snapshot(state.detail));
  const pending = () => (isDirty() ? { id: state.detail.asset.id, fields: state.draft.fields, body: state.draft.body } : undefined);
  const categoryOf = kind => (state.views[0] ? state.views[0].categories.find(c => c.kind === kind) : undefined);
  const viewOf = id => state.views.find(v => v.id === id);
  const RENAMABLE = ['agent', 'skill', 'command', 'outputStyle', 'rule', 'workflow'];
  const TOOL_FIELDS = ['tools', 'disallowedTools', 'allowed-tools'];
  const MODELS = ['inherit', 'sonnet', 'opus', 'haiku', 'fable'];

  const select = id => {
    if (state.detail && state.detail.asset.id === id) return;
    vscode.postMessage({ type: 'select', id, pending: pending() });
  };
  const showRepo = id => {
    state.repo = id;
    state.page = undefined;
    if (id) state.effective[id] = undefined;
    if (id) state.sessions[id] = undefined;
    if (state.detail) select(undefined);
    else render();
  };
  const showPage = (page, extra) => {
    state.page = page;
    state.repo = undefined;
    if (page === 'init') state.init = { dir: extra, form: { summary: '', areas: [{ name: '', globs: '', owner: '' }], rules: '' }, data: undefined, result: undefined };
    if (page === 'fleet') vscode.postMessage({ type: 'fleet' });
    if (page === 'marketplaces') vscode.postMessage({ type: 'marketplaces' });
    if (page === 'init') vscode.postMessage({ type: 'initForm', dir: extra });
    if (state.detail) select(undefined);
    else render();
  };
  const CHECK = {
    pass: ['pass', 'ok', 'Passes the harness standard'],
    fail: ['error', 'bad', 'Fails the harness standard'],
    review: ['warning', 'warn', 'Lines to review'],
    running: ['sync', 'muted', 'Checking...'],
    error: ['circle-slash', 'bad', 'Check failed'],
    'no-plugin': ['circle-slash', 'muted', 'No provider plugin'],
    'no-python': ['circle-slash', 'muted', 'Python 3 not found'],
  };
  const checkText = c =>
    !c || c.state === 'unchecked'
      ? 'not checked'
      : c.state === 'pass'
        ? 'pass'
        : c.state === 'fail'
          ? `fail ${c.fail || 0}${c.review ? ` · review ${c.review}` : ''}`
          : c.state === 'review'
            ? `review ${c.review || 0}`
            : c.state === 'running'
              ? 'checking...'
              : c.error || c.state;
  const std = feature => (state.standard && (!feature || state.standard[feature]) ? state.standard : undefined);
  const checkBadge = c => {
    if (!c || !CHECK[c.state]) return null;
    const [glyph, tone, title] = CHECK[c.state];
    return el('span', { className: `check-badge ${tone}`, title: c.error || `${title}${c.fail !== undefined ? ` (fail ${c.fail}, review ${c.review})` : ''}` }, icon(glyph));
  };
  const command = (cmd, extra) => vscode.postMessage(Object.assign({ type: 'command', command: cmd }, extra));
  const save = () => {
    if (isDirty()) vscode.postMessage({ type: 'save', pending: pending() });
  };

  const matches = (a, q) => !q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || (a.about || '').toLowerCase().includes(q);
  const total = view => view.categories.reduce((n, c) => n + c.items.length, 0);

  function renderCategories(list, view, q, nested) {
    for (const cat of view.categories) {
      const items = cat.items.filter(a => matches(a, q));
      if (cat.kind === 'mcp') items.sort(SORTS[state.mcpSort] || SORTS.name);
      if (!items.length && (q || nested)) continue;
      const key = `${view.id}|${cat.kind}`;
      const collapsed = !state.expanded.has(key) && !q;
      list.append(
        el(
          'div',
          {
            className: `section-head${nested ? ' nested' : ''}`,
            onclick: () => {
              collapsed ? state.expanded.add(key) : state.expanded.delete(key);
              persist();
              render();
            },
          },
          icon(collapsed ? 'chevron-right' : 'chevron-down'),
          el('span', { className: 'label' }, cat.label),
          cat.kind === 'mcp' && !collapsed && items.length > 1
            ? el(
                'select',
                {
                  className: 'sort',
                  title: 'Sort by',
                  onclick: e => e.stopPropagation(),
                  onchange: e => {
                    state.mcpSort = e.target.value;
                    persist();
                    render();
                  },
                },
                Object.keys(SORTS).map(k => el('option', { value: k, selected: state.mcpSort === k }, `Sort: ${k}`))
              )
            : null,
          cat.kind === 'mcp' && view.id === 'global'
            ? iconBtn('link-external', 'Add a connector on claude.ai', e => {
                e.stopPropagation();
                command('openConnectors');
              })
            : null,
          cat.kind === 'mcp' || cat.kind === 'plugin'
            ? iconBtn('add', cat.kind === 'mcp' ? 'Add MCP Server...' : 'Install Plugin...', e => {
                e.stopPropagation();
                command(cat.kind === 'mcp' ? 'addMcp' : 'installPlugin', { scope: view.id });
              })
            : null,
          cat.creatable
            ? iconBtn('add', `New ${cat.label}`, e => {
                e.stopPropagation();
                command('create', { kind: cat.kind, scope: view.id });
              })
            : null,
          el('span', { className: 'count' }, items.length)
        )
      );
      if (collapsed) continue;
      if (!items.length) list.append(el('div', { className: 'empty' }, 'None'));
      for (const a of items) {
        const selected = state.detail && state.detail.asset.id === a.id;
        const glyph = a.kind === 'plugin' ? (a.enabled ? 'pass-filled' : 'circle-large-outline') : a.kind === 'mcp' && SOURCES[a.source] ? SOURCES[a.source].icon : cat.icon;
        const off = (a.kind === 'plugin' || a.kind === 'mcp') && a.enabled === false;
        const desc = a.kind === 'mcp' ? mcpDesc(a) : assetDesc(a);
        list.append(
          el(
            'div',
            {
              className: `row${nested ? ' nested' : ''}${selected ? ' selected' : ''}${off ? ' disabled' : ''}`,
              title: desc,
              onclick: () => select(a.id),
            },
            icon(glyph),
            el('span', { className: 'name' }, labelOf(a)),
            desc ? el('span', { className: 'desc' }, desc) : null
          )
        );
      }
    }
  }

  function renderSessionsNode(list, view, q) {
    const sessions = state.sessions[view.id];
    if (sessions === undefined) {
      state.sessions[view.id] = null;
      vscode.postMessage({ type: 'sessions', scope: view.id });
    }
    const all = (sessions || []).filter(s => !q || s.title.toLowerCase().includes(q));
    if (q && !all.length) return;
    const key = `${view.id}|sessions`;
    const collapsed = !state.expanded.has(key) && !q;
    const toggle = e => {
      e.stopPropagation();
      collapsed ? state.expanded.add(key) : state.expanded.delete(key);
      persist();
      render();
    };
    const current = !state.detail && state.page === 'sessions' && state.sessionsPage && state.sessionsPage.scope === view.id;
    list.append(
      el(
        'div',
        { className: `section-head nested${current ? ' selected' : ''}`, title: 'Search and filter the sessions', onclick: () => showSessionsPage(view.id) },
        el('span', { className: 'twistie', onclick: toggle, title: collapsed ? 'Expand' : 'Collapse' }, icon(collapsed ? 'chevron-right' : 'chevron-down')),
        el('span', { className: 'label' }, 'Sessions'),
        iconBtn('desktop-download', 'Import a session transcript', e => {
          e.stopPropagation();
          vscode.postMessage({ type: 'importSession', scope: view.id });
        }),
        iconBtn('search', 'Search sessions', e => {
          e.stopPropagation();
          showSessionsPage(view.id);
        }),
        el('span', { className: 'count' }, sessions ? all.length : '...')
      )
    );
    if (collapsed) return;
    if (!sessions || !all.length) {
      list.append(el('div', { className: 'empty' }, sessions ? 'None' : 'Reading the sessions...'));
      return;
    }
    const shown = state.allSessions.has(view.id) || q ? all : all.slice(0, 10);
    for (const s of shown) {
      const selected = !state.detail && state.page === 'session' && state.session && state.session.id === s.id;
      list.append(
        el(
          'div',
          { className: `row nested${selected ? ' selected' : ''}`, title: `${s.title}\n${sessionDesc(s)}`, onclick: () => showSession(view.id, s.id) },
          sessionIcon(s),
          el('span', { className: 'name' }, s.title),
          el('span', { className: 'desc' }, sessionDesc(s))
        )
      );
    }
    if (all.length > shown.length)
      list.append(
        el(
          'div',
          {
            className: 'row nested',
            onclick: () => {
              state.allSessions.add(view.id);
              render();
            },
          },
          icon('ellipsis'),
          el('span', { className: 'name' }, `Show all ${all.length} sessions`)
        )
      );
  }

  function renderSidebar() {
    const q = state.filter.toLowerCase();
    const list = el('div', { className: 'list', onscroll: hideHover });
    const [global, ...repos] = state.views;
    if (global) {
      const block = el('div', { className: 'scope-block' });
      renderCategories(block, global, q, false);
      list.append(block);
    }
    const visibleRepos = repos
      .filter(v => !q || v.categories.some(c => c.items.some(a => matches(a, q))))
      .sort((a, b) => Number(!!b.local) - Number(!!a.local) || (state.repoSort === 'recent' ? (b.lastUsed || 0) - (a.lastUsed || 0) : 0) || a.label.localeCompare(b.label));
    const sortToggle = (id, glyph, title) =>
      el(
        'button',
        {
          className: `icon-btn toggle${state.repoSort === id ? ' active' : ''}`,
          title,
          'aria-label': title,
          'aria-pressed': state.repoSort === id ? 'true' : 'false',
          onclick: () => {
            if (state.repoSort === id) return;
            state.repoSort = id;
            persist();
            app.querySelector('.sidebar').replaceWith(renderSidebar());
          },
        },
        icon(glyph)
      );
    list.append(
      el(
        'div',
        { className: 'scope-head' },
        el('span', { className: 'label' }, 'Repositories'),
        sortToggle('recent', 'history', 'Sort by last used'),
        sortToggle('name', 'case-sensitive', 'Sort A-Z'),
        iconBtn('repo-create', 'Add Repo...', () => command('addRepo')),
        iconBtn('trash', 'Remove Repo...', () => command('removeRepo')),
        el('span', { className: 'count' }, visibleRepos.length)
      )
    );
    visibleRepos.forEach((view, i) => {
      if (i > 0 && visibleRepos[i - 1].local && !view.local) list.append(el('div', { className: 'repo-separator' }));
      const open = state.openRepos.has(view.id) || !!q;
      const count = q ? view.categories.reduce((n, c) => n + c.items.filter(a => matches(a, q)).length, 0) : total(view);
      list.append(
        el(
          'div',
          {
            className: `repo-head${!state.detail && state.repo === view.id ? ' selected' : ''}`,
            'aria-label': `${view.label}, ${view.path}`,
            onclick: () => {
              hideHover();
              open ? state.openRepos.delete(view.id) : state.openRepos.add(view.id);
              persist();
              showRepo(view.id);
            },
            onmouseenter: e => {
              clearTimeout(state.repoHoverTimer);
              const at = { x: e.clientX, y: e.clientY };
              state.repoHoverAt = at;
              state.repoHoverTimer = setTimeout(() => placeCard(`repo:${view.id}`, () => repoCard(view), state.repoHoverAt), 350);
            },
            onmousemove: e => {
              state.repoHoverAt = { x: e.clientX, y: e.clientY };
              if (hover && hover.dataset.key === `repo:${view.id}` && hover.classList.contains('show')) placeCard(`repo:${view.id}`, () => repoCard(view), state.repoHoverAt);
            },
            onmouseleave: () => {
              clearTimeout(state.repoHoverTimer);
              hideHover();
            },
          },
          icon(open ? 'chevron-down' : 'chevron-right'),
          icon('repo'),
          el('span', { className: 'label' }, view.label),
          checkBadge(state.checks[view.id]) || el('span', { className: 'check-badge', 'aria-hidden': 'true' }),
          iconBtn('terminal', `Open Claude in ${view.label}`, e => {
            e.stopPropagation();
            command('openClaude', { scope: view.id });
          }),
          iconBtn('add', `New in ${view.label}`, e => {
            e.stopPropagation();
            command('create', { scope: view.id });
          }),
          el('span', { className: 'count' }, count)
        )
      );
      if (open) {
        renderSessionsNode(list, view, q);
        renderCategories(list, view, q, true);
      }
    });
    const search = el('input', {
      type: 'search',
      placeholder: 'Search the harness',
      value: state.filter,
      oninput: e => {
        state.filter = e.target.value;
        persist();
        const sidebar = app.querySelector('.sidebar');
        sidebar.replaceWith(renderSidebar());
        const input = app.querySelector('.search input');
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      },
    });
    return el(
      'aside',
      { className: 'sidebar' },
      el(
        'div',
        { className: 'sidebar-head' },
        logo('logo-sm'),
        el('span', {}, 'Claude Harness'),
        el('span', { className: 'spacer' }),
        iconBtn('home', 'Overview', () => showRepo(undefined)),
        iconBtn('dashboard', 'Fleet overview', () => showPage('fleet')),
        iconBtn('package', 'Marketplace health', () => showPage('marketplaces')),
        iconBtn('add', 'New...', () => command('create')),
        iconBtn('refresh', 'Refresh', () => command('refresh'))
      ),
      el('div', { className: 'search' }, search),
      list
    );
  }

  function renderOverview() {
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
              {
                className: 'tile',
                onclick: () => {
                  state.expanded.add(`${global.id}|${c.kind}`);
                  persist();
                  if (c.items[0]) select(c.items[0].id);
                },
              },
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

  function renderRepo(view) {
    const items = view.categories.flatMap(c => c.items.map(a => Object.assign({ icon: c.icon }, a)));
    const recent = items.sort((a, b) => b.mtime - a.mtime).slice(0, 12);
    return el(
      'section',
      { className: 'main' },
      el(
        'header',
        { className: 'main-head' },
        el('span', { className: 'big' }, icon('repo')),
        el('div', { className: 'title' }, el('h1', {}, view.label), el('div', { className: 'path', title: view.path }, `${total(view)} assets · ${view.path}`)),
        el(
          'div',
          { className: 'toolbar' },
          std() ? iconBtn('checklist', 'Check against the harness standard', () => command('checkRepos', { scope: view.id })) : null,
          std('align') ? iconBtn('wand', 'Align CLAUDE.md...', () => command('alignClaudeMd', { scope: view.id })) : null,
          std('fix') ? iconBtn('wrench', 'Fix settings and hooks...', () => command('fixSettings', { scope: view.id })) : null,
          std('scaffold') ? iconBtn('new-folder', 'Scaffold repo harness...', () => showPage('init', view.path)) : null,
          iconBtn('add', `New in ${view.label}`, () => command('create', { scope: view.id })),
          iconBtn('trash', `Remove ${view.label} from the harness`, () => {
            state.repo = undefined;
            command('removeRepo', { id: view.id });
          })
        )
      ),
      el(
        'div',
        { className: 'main-body' },
        el(
          'div',
          { className: 'overview' },
          view.categories.map(c =>
            el(
              'div',
              {
                className: 'tile',
                onclick: () => {
                  state.expanded.add(`${view.id}|${c.kind}`);
                  state.openRepos.add(view.id);
                  persist();
                  if (c.items[0]) select(c.items[0].id);
                  else render();
                },
              },
              el('span', { className: 'n' }, c.items.length),
              el('span', { className: 'l' }, icon(c.icon), c.label)
            )
          )
        ),
        recent.length
          ? el(
              'div',
              { className: 'recent' },
              el('div', { className: 'group-label' }, 'Recently changed'),
              recent.map(a =>
                el(
                  'div',
                  { className: 'row', onclick: () => select(a.id) },
                  icon(a.icon),
                  el('span', { className: 'name' }, a.name),
                  el('span', { className: 'desc' }, new Date(a.mtime).toLocaleString())
                )
              )
            )
          : null,
        renderSessionList(view),
        std() ? renderStandard(view) : null,
        renderEffective(view)
      )
    );
  }

  const openAt = (file, line) => vscode.postMessage({ type: 'openAt', file, line });
  const LEVEL_ICONS = { FAIL: 'error', REVIEW: 'warning', INFO: 'info' };

  function renderStandard(view) {
    const eff = state.effective[view.id];
    const live = state.checks[view.id];
    const c = eff && eff.check && (!live || eff.check.state === live.state) ? eff.check : live;
    const findings = (c && c.findings) || [];
    return el(
      'div',
      { className: 'recent' },
      el('div', { className: 'group-label' }, 'Harness standard'),
      el('div', { className: 'check-line' }, checkBadge(c) || icon('circle-large-outline'), el('span', {}, checkText(c)), c && c.kind ? el('span', { className: 'desc' }, `${c.kind} repo`) : null),
      findings.map(f =>
        el(
          'div',
          { className: 'row', title: f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : f.text, onclick: f.file ? () => openAt(f.file, f.line) : undefined },
          el('span', { className: `check-badge ${f.level === 'FAIL' ? 'bad' : f.level === 'REVIEW' ? 'warn' : 'muted'}` }, icon(LEVEL_ICONS[f.level] || 'info')),
          el('span', { className: 'name wrap' }, f.text.replace(/^(FAIL|REVIEW|INFO) /, ''))
        )
      )
    );
  }

  function memoryRows(node, depth) {
    return [
      el(
        'div',
        { className: `row indent-${Math.min(depth, 5)}`, title: node.file, onclick: node.exists ? () => openAt(node.file) : undefined },
        icon(depth ? 'arrow-small-right' : 'markdown'),
        el('span', { className: 'name' }, node.label),
        el('span', { className: 'desc' }, node.exists ? (depth ? 'imported' : node.file) : 'not found')
      ),
      ...node.imports.flatMap(n => memoryRows(n, depth + 1)),
    ];
  }

  function renderEffective(view) {
    const eff = state.effective[view.id];
    if (eff === undefined) {
      state.effective[view.id] = null;
      vscode.postMessage({ type: 'effective', scope: view.id });
    }
    if (!eff) return el('div', { className: 'empty flush' }, 'Reading what a session here loads...');
    const e = eff.effective;
    const plugin = p =>
      [
        ['user', p.user],
        ['project', p.project],
        ['local', p.local],
      ]
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k} ${v ? 'on' : 'off'}`)
        .join(' · ');
    return el(
      'div',
      { className: 'effective' },
      el('div', { className: 'group-label' }, 'Effective harness: what a session here loads'),
      el('div', { className: 'sub-label' }, 'Memory, imports expanded'),
      e.memory.length ? e.memory.flatMap(n => memoryRows(n, 0)) : el('div', { className: 'empty flush' }, 'No CLAUDE.md'),
      el('div', { className: 'sub-label' }, `Rules (${e.rules.length})`),
      e.rules.length
        ? e.rules.map(r =>
            el(
              'div',
              { className: 'row', title: r.file, onclick: () => openAt(r.file) },
              icon(r.always ? 'law' : r.total ? 'filter' : 'warning'),
              el('span', { className: 'name' }, `${r.scope === view.label ? '' : `${r.scope} · `}${r.name}`),
              el('span', { className: 'desc' }, r.always ? 'always loaded' : `${r.globs.map(g => g.glob).join(', ')} · ${r.total} ${r.total === 1 ? 'file' : 'files'}${e.capped ? '+' : ''}`)
            )
          )
        : el('div', { className: 'empty flush' }, 'No rules'),
      el('div', { className: 'sub-label' }, `Plugins (${e.plugins.filter(p => p.enabled).length} on)`),
      e.plugins.length
        ? e.plugins.map(p =>
            el(
              'div',
              { className: `row${p.enabled ? '' : ' disabled'}` },
              icon(p.enabled ? 'pass-filled' : 'circle-large-outline'),
              el('span', { className: 'name' }, p.key),
              el('span', { className: `desc${p.duplicate ? ' warn' : ''}` }, [plugin(p), p.duplicate ? 'duplicate: already on for the user' : ''].filter(Boolean).join(' · '))
            )
          )
        : el('div', { className: 'empty flush' }, 'No plugins'),
      el('div', { className: 'sub-label' }, `Hooks (${e.hooks.length})`),
      e.hooks.length
        ? e.hooks.map(h =>
            el(
              'div',
              { className: 'row', title: h.command },
              icon(h.event === 'mod' ? 'extensions' : 'zap'),
              el('span', { className: 'name' }, h.matcher ? `${h.event} · ${h.matcher}` : h.event),
              el('span', { className: 'desc' }, `${h.command} · ${h.source}`)
            )
          )
        : el('div', { className: 'empty flush' }, 'No hooks')
    );
  }

  function renderRuleInfo(a) {
    const info = state.ruleInfo[a.id];
    if (info === undefined) {
      state.ruleInfo[a.id] = null;
      vscode.postMessage({ type: 'ruleInfo', id: a.id });
    }
    if (!info) return el('div', { className: 'empty flush' }, 'Matching paths...');
    return el(
      'div',
      {},
      el('div', { className: 'group-label' }, 'Paths'),
      info.base ? el('div', { className: 'empty flush' }, `Matched against ${info.base}`) : null,
      info.globs.length
        ? info.globs.map(g =>
            el(
              'div',
              { className: 'row', title: g.sample.join('\n') },
              icon(g.matches ? 'pass' : 'warning'),
              el('span', { className: 'name' }, g.glob),
              el('span', { className: 'desc' }, `${g.matches} ${g.matches === 1 ? 'file' : 'files'}${info.capped ? '+' : ''}${g.sample.length ? ` · ${g.sample.join(', ')}` : ''}`)
            )
          )
        : el('div', { className: 'empty flush' }, 'No paths: the rule loads in every session'),
      !std('owner')
        ? null
        : info.owner
        ? el(
            'div',
            { className: 'row' },
            icon(info.ownerFound ? 'pass' : 'error'),
            el('span', { className: 'name' }, `Owner agent: ${info.owner}`),
            el('span', { className: 'desc' }, info.ownerFound ? 'found on disk' : 'no agent with this name on disk')
          )
        : el('div', { className: 'empty flush' }, 'No Owner agent line')
    );
  }

  function pageHead(glyph, title, sub, ...tools) {
    return el('header', { className: 'main-head' }, el('span', { className: 'big' }, icon(glyph)), el('div', { className: 'title' }, el('h1', {}, title), el('div', { className: 'path' }, sub)), el('div', { className: 'toolbar' }, ...tools));
  }

  const liveCheck = r => state.checks[r.id] || { state: r.checkState };

  function renderFleet() {
    const rows = state.fleet;
    const body = el('div', { className: 'main-body' });
    if (!rows) body.append(el('div', { className: 'empty flush' }, 'Reading the repos...'));
    else {
      const s = std();
      const cols = [
        ['Repo', '', r => el('span', { className: 'cell' }, icon('repo'), r.label)],
        s && ['Layout', '', r => r.layout || '', r => (r.layout && r.layout !== 'router' ? 'warn' : '')],
        s && ['Standard', '', r => el('span', { className: 'cell' }, checkBadge(liveCheck(r)), checkText(liveCheck(r)))],
        ['Lines', 'num', r => r.lines || '', r => (s && r.lines > 120 ? 'warn' : '')],
        s && ['Em dashes', 'num', r => (r.emDashes === undefined ? '' : r.emDashes), r => (r.emDashes ? 'warn' : '')],
        s && ['Review', 'num', r => (r.check ? r.check.review : ''), r => (r.check && r.check.review ? 'warn' : '')],
        ['Plugins', 'num', r => r.plugins.length || ''],
        ['Hook copies', 'num', r => r.hookCopies || ''],
        ['Copies', 'num', r => r.copies || ''],
      ].filter(Boolean);
      const heads = cols.map(c => c[0]);
      body.append(
        el(
          'div',
          { className: 'table-wrap' },
          el(
            'table',
            { className: 'grid' },
            el('thead', {}, el('tr', {}, cols.map(c => el('th', { className: c[1] }, c[0])))),
            el(
              'tbody',
              {},
              rows.map(r =>
                el(
                  'tr',
                  {
                    className: 'clickable',
                    title: r.path,
                    onclick: () => {
                      state.openRepos.add(r.id);
                      persist();
                      showRepo(r.id);
                    },
                  },
                  cols.map(c => el('td', { className: [c[1], c[3] ? c[3](r) : ''].filter(Boolean).join(' '), title: c[0] === 'Plugins' ? r.plugins.join('\n') : undefined }, c[2](r)))
                )
              )
            )
          )
        ),
        el(
          'div',
          { className: 'empty flush' },
          `Lines count the root CLAUDE.md.${s ? ` Layout, Standard, Em dashes and Review come from ${s.name}.` : ''} Copies count skills and agents that also exist in another scope or a plugin.`
        )
      );
    }
    return el(
      'section',
      { className: 'main' },
      pageHead(
        'dashboard',
        'Fleet overview',
        rows ? `${rows.length} repositories` : 'Reading...',
        std() ? iconBtn('checklist', 'Check every repo against the harness standard', () => command('checkRepos')) : null,
        std('fix') ? iconBtn('wrench', 'Fix settings and hooks...', () => command('fixSettings')) : null,
        iconBtn('archive', 'Retire clean copies...', () => command('retireCopies')),
        iconBtn('refresh', 'Reload the table', () => vscode.postMessage({ type: 'fleet' }))
      ),
      body
    );
  }

  const SOURCE_ICONS = { github: 'github', git: 'source-control', directory: 'folder', file: 'file', url: 'globe' };

  function renderMarkets() {
    const list = state.markets;
    const body = el('div', { className: 'main-body' });
    if (!list) body.append(el('div', { className: 'empty flush' }, 'Reading the marketplaces...'));
    else if (!list.length) body.append(el('div', { className: 'empty flush' }, 'No marketplace registered. Add one with claude plugin marketplace add.'));
    else
      for (const m of list) {
        const ahead = m.plugins.filter(p => p.ahead).length;
        body.append(
          el(
            'div',
            { className: 'recent' },
            el('div', { className: 'market-head' }, icon('package'), el('span', { className: 'label' }, m.name), ahead ? el('span', { className: 'tag warn' }, `${ahead} ahead`) : null, el('span', { className: 'spacer' }),
              m.kind === 'directory' ? el('button', { className: 'secondary', onclick: () => command('renameMarketplace', { market: m.name }) }, icon('edit'), 'Rename...') : null),
            el('div', { className: 'facts' }, [
              [el('span', { className: 'key' }, 'Source', el('span', { className: `codicon codicon-${SOURCE_ICONS[m.kind] ?? 'question'}`, title: m.kind, 'aria-label': m.kind })), el('span', { className: 'value' }, m.source)],
              [el('span', { className: 'key' }, 'Location'), el('span', { className: 'value' }, m.location)],
            ].flat()),
            m.plugins.length
              ? el(
                  'div',
                  { className: 'table-wrap' },
                  el(
                    'table',
                    { className: 'grid' },
                    el('thead', {}, el('tr', {}, ['Plugin', 'Installed', 'Source', 'State'].map(h => el('th', {}, h)))),
                    el(
                      'tbody',
                      {},
                      m.plugins.map(p =>
                        el(
                          'tr',
                          {},
                          el('td', {}, p.name),
                          el('td', {}, p.installed || 'not installed'),
                          el('td', {}, p.source || ''),
                          el('td', { className: p.ahead ? 'warn' : '' }, [p.ahead ? 'source ahead of the installed copy' : p.installed ? 'current' : '', p.enabled ? 'enabled' : ''].filter(Boolean).join(' · '))
                        )
                      )
                    )
                  )
                )
              : el('div', { className: 'empty flush' }, 'No plugins installed from it')
          )
        );
      }
    return el('section', { className: 'main' }, pageHead('package', 'Marketplace health', list ? `${list.length} marketplaces` : 'Reading...', iconBtn('refresh', 'Reload', () => vscode.postMessage({ type: 'marketplaces' }))), body);
  }

  const initForm = () => ({ summary: state.init.form.summary, areas: state.init.form.areas, rules: state.init.form.rules.split(/\r?\n/) });

  function renderInit() {
    const s = state.init;
    const data = s.data;
    const body = el('div', { className: 'main-body' });
    let createBtn;
    const syncCreate = () => {
      if (createBtn) createBtn.disabled = !(s.result && !s.result.error && !s.applied && s.previewKey === JSON.stringify(initForm()));
    };
    if (!data) body.append(el('div', { className: 'empty flush' }, 'Loading...'));
    else {
      if (data.error) body.append(el('div', { className: 'notice bad' }, data.error));
      if (data.hasClaudeMd) body.append(el('div', { className: 'notice' }, 'This folder has a CLAUDE.md. Init only creates missing files and never overwrites one.'));
      const owners = data.agents || [];
      body.append(
        el('div', { className: 'group-label' }, 'Summary'),
        el('textarea', { className: 'text', rows: 3, placeholder: 'One to three sentences: what the product is and its stack.', value: s.form.summary, oninput: e => ((s.form.summary = e.target.value), syncCreate()) }),
        el('div', { className: 'group-label' }, 'Areas'),
        el(
          'div',
          { className: 'areas' },
          s.form.areas.map((a, i) =>
            el(
              'div',
              { className: 'area' },
              el('input', { type: 'text', placeholder: 'name, e.g. api', value: a.name, oninput: e => ((a.name = e.target.value), syncCreate()) }),
              el('input', { type: 'text', placeholder: 'globs, e.g. src/api/**', value: a.globs, oninput: e => ((a.globs = e.target.value), syncCreate()) }),
              el(
                'select',
                { onchange: e => ((a.owner = e.target.value), syncCreate()) },
                el('option', { value: '', selected: !a.owner }, 'Owner agent'),
                owners.map(o => el('option', { value: o, selected: a.owner === o }, o))
              ),
              iconBtn('close', 'Remove area', () => {
                s.form.areas.splice(i, 1);
                renderMain();
              })
            )
          )
        ),
        el('div', { className: 'add-field' }, el('button', { className: 'secondary', onclick: () => (s.form.areas.push({ name: '', globs: '', owner: '' }), renderMain()) }, icon('add'), 'Add area')),
        el('div', { className: 'group-label' }, 'Repo rules'),
        el('textarea', { className: 'text', rows: 3, placeholder: 'One repo-only hard rule per line.', value: s.form.rules, oninput: e => ((s.form.rules = e.target.value), syncCreate()) })
      );
      createBtn = el(
        'button',
        {
          className: 'primary',
          onclick: () => vscode.postMessage({ type: 'initRun', dir: s.dir, form: initForm(), apply: true }),
        },
        icon('new-file'),
        'Create files'
      );
      body.append(
        el(
          'div',
          { className: 'toolbar' },
          el(
            'button',
            {
              className: 'secondary',
              onclick: () => {
                s.pendingKey = JSON.stringify(initForm());
                vscode.postMessage({ type: 'initRun', dir: s.dir, form: initForm(), apply: false });
              },
            },
            icon('eye'),
            'Preview'
          ),
          createBtn
        )
      );
      syncCreate();
      if (s.result) {
        if (s.result.error) body.append(el('div', { className: 'notice bad' }, s.result.error));
        else
          body.append(
            el(
              'div',
              {},
              el('div', { className: 'group-label' }, s.applied ? 'Created' : 'Preview: nothing is written yet'),
              (s.result.files || []).map(f => el('div', { className: 'row' }, icon(f.action === 'create' ? 'new-file' : 'circle-slash'), el('span', { className: 'name' }, f.rel), el('span', { className: 'desc' }, f.action === 'create' ? (s.applied ? 'created' : 'will be created') : 'exists, skipped'))),
              el('div', { className: 'empty flush' }, s.result.summary || '')
            )
          );
      }
    }
    const wrap = el('div', { className: 'init-form' });
    wrap.append(...[...body.childNodes]);
    body.append(wrap);
    return el('section', { className: 'main' }, pageHead('new-folder', 'Scaffold repo harness', s.dir), body);
  }

  const fit = box => {
    box.style.height = 'auto';
    box.style.height = `${box.scrollHeight + 2}px`;
  };

  function fieldInput(f, i) {
    const update = value => {
      state.draft.fields[i] = Object.assign({}, f, { value });
      refreshHead();
    };
    if (f.type === 'boolean') return el('input', { type: 'checkbox', checked: f.value === true, onchange: e => update(e.target.checked) });
    if (TOOL_FIELDS.includes(f.key)) {
      const box = el('textarea', { className: 'tools', rows: 1, value: f.value, spellcheck: false, placeholder: 'comma separated', oninput: e => (update(e.target.value), fit(box)) });
      requestAnimationFrame(() => fit(box));
      return el(
        'div',
        { className: 'tools-field' },
        box,
        el('button', { className: 'link', onclick: () => vscode.postMessage({ type: 'configureTools', id: state.detail.asset.id, key: f.key, value: String(state.draft.fields[i].value) }) }, 'Configure Tools...')
      );
    }
    if (f.type === 'text' || f.type === 'yaml')
      return el('textarea', { className: f.type, rows: f.type === 'text' ? 4 : 3, value: f.value, oninput: e => update(e.target.value), spellcheck: f.type === 'text' });
    const input = el('input', { type: 'text', value: f.value, oninput: e => update(e.target.value) });
    if (f.key === 'model') {
      input.setAttribute('list', 'models');
      return el('div', {}, input, el('datalist', { id: 'models' }, MODELS.map(m => el('option', { value: m }))));
    }
    if (f.type === 'list') input.placeholder = 'comma separated';
    return input;
  }

  function renderFields() {
    const d = state.detail;
    const grid = el('div', { className: 'fields' });
    state.draft.fields.forEach((f, i) => {
      grid.append(
        el('span', { className: 'key', title: f.key }, f.key),
        fieldInput(f, i),
        iconBtn('close', `Remove ${f.key}`, () => {
          state.draft.fields.splice(i, 1);
          renderMain();
        })
      );
    });
    const present = new Set(state.draft.fields.map(f => f.key));
    const options = d.knownFields.filter(k => !present.has(k));
    const keyInput = el('input', { type: 'text', placeholder: 'field name', list: 'known-fields' });
    const add = () => {
      const key = keyInput.value.trim();
      if (!key || present.has(key)) return;
      const type = key === 'description' ? 'text' : ['disable-model-invocation', 'user-invocable', 'keep-coding-instructions'].includes(key) ? 'boolean' : 'string';
      state.draft.fields.push({ key, type, value: type === 'boolean' ? false : '' });
      renderMain();
    };
    keyInput.addEventListener('keydown', e => e.key === 'Enter' && add());
    return el(
      'div',
      {},
      el('div', { className: 'group-label' }, 'Frontmatter'),
      state.draft.fields.length ? grid : el('div', { className: 'empty flush' }, 'No frontmatter'),
      el(
        'div',
        { className: 'add-field' },
        keyInput,
        el('datalist', { id: 'known-fields' }, options.map(k => el('option', { value: k }))),
        el('button', { className: 'secondary', onclick: add }, icon('add'), 'Add field')
      )
    );
  }

  function renderFiles() {
    const files = (state.detail.asset.files || []).filter(f => f !== 'SKILL.md');
    if (!files.length) return null;
    return el(
      'div',
      {},
      el('div', { className: 'group-label' }, `Files (${files.length})`),
      el(
        'div',
        { className: 'files' },
        files.map(f =>
          el('div', { className: 'file', onclick: () => command('openFile', { id: state.detail.asset.id, rel: f }) }, icon(/\.md$/i.test(f) ? 'markdown' : 'file'), f)
        )
      )
    );
  }

  const retirable = a =>
    (a.kind === 'skill' || a.kind === 'agent') && a.scope !== 'global' && (a.copies || []).some(c => c.same && (c.scope === 'global' || c.scope.startsWith('plugin:')));

  let headNode;
  function renderHead() {
    const d = state.detail;
    const cat = categoryOf(d.asset.kind);
    const dirty = isDirty();
    const canRename = RENAMABLE.includes(d.asset.kind);
    return el(
      'header',
      { className: 'main-head' },
      el('span', { className: 'big' }, icon(d.asset.kind === 'mcp' && SOURCES[d.asset.source] ? SOURCES[d.asset.source].icon : cat ? cat.icon : 'file')),
      el(
        'div',
        { className: 'title' },
        el('h1', {}, labelOf(d.asset), el('span', { className: 'tag' }, cat ? cat.label.replace(/s$/, '') : d.asset.kind), d.asset.scope !== 'global' && viewOf(d.asset.scope) ? el('span', { className: 'tag scope', title: viewOf(d.asset.scope).path }, icon('repo'), viewOf(d.asset.scope).label) : null, dirty ? el('span', { className: 'dirty', title: 'Unsaved changes' }) : null),
        el('div', { className: 'path', title: d.asset.file }, d.asset.file)
      ),
      el(
        'div',
        { className: 'toolbar' },
        d.asset.kind === 'mcp' && d.asset.source !== 'claude.ai' && d.asset.source !== 'plugin' ? iconBtn('copy', 'Copy as claude mcp add command', () => command('copyMcpAdd', { id: d.asset.id })) : null,
        canRename ? iconBtn('edit', 'Rename', () => command('rename', { id: d.asset.id })) : null,
        canRename ? iconBtn('copy', 'Duplicate', () => command('duplicate', { id: d.asset.id })) : null,
        iconBtn('go-to-file', 'Open in editor', () => command('openFile', { id: d.asset.id })),
        iconBtn('folder-opened', 'Reveal in File Explorer', () => command('reveal', { id: d.asset.id })),
        retirable(d.asset) ? iconBtn('archive', 'Retire this copy: back it up, then delete it', () => command('retire', { id: d.asset.id })) : null,
        canRename || (d.asset.kind === 'mcp' && d.asset.file && d.asset.jsonPath) ? iconBtn('trash', 'Delete', () => command('delete', { id: d.asset.id })) : null,
        d.asset.kind === 'plugin' ? iconBtn('trash', 'Uninstall plugin', () => command('uninstallPlugin', { id: d.asset.id })) : null
      ),
      editable()
        ? el(
            'div',
            { className: 'toolbar' },
            el(
              'button',
              {
                className: 'secondary',
                disabled: !dirty,
                onclick: () => {
                  state.draft = clone(state.detail);
                  renderMain();
                },
              },
              'Revert'
            ),
            el('button', { className: 'primary', disabled: !dirty, onclick: save, title: 'Ctrl+S' }, icon('save'), 'Save')
          )
        : null
    );
  }
  function refreshHead() {
    const next = renderHead();
    headNode.replaceWith(next);
    headNode = next;
  }

  function renderDetail() {
    const d = state.detail;
    const body = el('div', { className: 'main-body' });
    if (d.mode === 'markdown') {
      body.append(renderFields());
      if (d.asset.kind === 'rule') body.append(renderRuleInfo(d.asset));
      body.append(
        el(
          'div',
          { className: 'editor' },
          el('div', { className: 'group-label' }, 'Instructions'),
          el('textarea', {
            value: state.draft.body,
            spellcheck: false,
            oninput: e => {
              state.draft.body = e.target.value;
              refreshHead();
            },
          })
        )
      );
      const files = renderFiles();
      if (files) body.append(files);
    } else if (d.mode === 'code' || d.mode === 'settings') {
      body.append(
        el(
          'div',
          { className: 'editor' },
          el('div', { className: 'group-label' }, d.mode === 'settings' ? 'JSON' : 'Script'),
          el('textarea', {
            value: state.draft.body,
            spellcheck: false,
            oninput: e => {
              state.draft.body = e.target.value;
              refreshHead();
            },
          })
        )
      );
    } else if (d.mode === 'mcp') {
      body.append(renderMcp(d));
    } else if (d.mode === 'plugin') {
      body.append(
        el(
          'div',
          { className: 'switch' },
          el('input', { type: 'checkbox', id: 'plugin-enabled', checked: d.asset.enabled, onchange: () => command('togglePlugin', { id: d.asset.id }) }),
          el('label', { for: 'plugin-enabled' }, 'Enabled'),
          el('span', { className: 'desc' }, d.asset.description)
        )
      );
    } else {
      body.append(el('pre', { className: 'json' }, d.body));
    }
    headNode = renderHead();
    return el('section', { className: 'main' }, headNode, body);
  }

  function renderMcp(d) {
    const a = d.asset;
    const repo = a.scope !== 'global' && viewOf(a.scope);
    const info = state.mcpInfo[a.id];
    const facts = [
      ['Source', el('span', {}, icon(SOURCES[a.source] ? SOURCES[a.source].icon : 'server'), ' ', SOURCES[a.source] ? SOURCES[a.source].label : 'Config')],
      pluginOf(a) ? ['Plugin', pluginOf(a)] : null,
      ['Name in Claude', a.name],
      a.target ? ['Address', a.target] : null,
      a.status ? ['Status', a.status] : null,
    ].filter(Boolean);
    const box = el('div', { className: 'mcp' });
    box.append(
      el(
        'div',
        { className: 'switch' },
        el('input', { type: 'checkbox', id: 'mcp-enabled', checked: a.enabled !== false, onchange: () => command('toggleMcp', { id: a.id }) }),
        el('label', { for: 'mcp-enabled' }, repo ? `Enabled in ${repo.label}` : 'Enabled in every folder'),
        !repo && a.offIn ? el('span', { className: 'desc' }, `Off in ${a.offIn} of ${a.folders} folders. Switch on to enable it everywhere.`) : null
      ),
      el('div', { className: 'facts' }, facts.flatMap(([k, v]) => [el('span', { className: 'key' }, k), el('span', { className: 'value' }, v)]))
    );
    if (a.about) box.append(el('p', { className: 'about' }, a.about));
    if (!info) box.append(el('div', { className: 'empty flush' }, 'Asking the server for its tools...'));
    else if (info.error)
      box.append(
        el('div', { className: 'empty flush' }, info.error),
        el(
          'div',
          { className: 'toolbar' },
          info.signIn ? el('button', { className: 'primary', onclick: () => vscode.postMessage({ type: 'mcpSignIn', id: a.id }) }, icon('sign-in'), 'Sign in') : null,
          el('button', { className: 'secondary', onclick: () => vscode.postMessage({ type: 'mcpRetry', id: a.id }) }, icon('refresh'), 'Retry')
        )
      );
    else {
      box.append(
        el('div', { className: 'group-label' }, `Tools (${(info.tools || []).length})`),
        el(
          'div',
          { className: 'tool-list' },
          (info.tools || []).map(t => el('div', { className: 'tool' }, el('span', { className: 'name' }, t.name)))
        )
      );
    }
    if (d.body) box.append(el('div', { className: 'group-label' }, 'Config'), el('pre', { className: 'json' }, d.body));
    return box;
  }

  const clone = d => ({ fields: d.fields.map(f => Object.assign({}, f)), body: d.body });

  const fmtTime = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const fmtDate = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmtDur = ms => {
    const minutes = Math.round(ms / 60000);
    if (ms < 60000) return `${Math.max(0, Math.round(ms / 1000))} s`;
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
  };
  const fmtNum = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${Math.round(n / 1e3)} k` : String(n));
  const shortType = t => String(t || '').split(':').pop();
  const shortModel = m => (m ? String(m).replace(/^claude-/, '') : '');
  const topTools = tools =>
    Object.entries(tools || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([k, v]) => `${k} ${v}`)
      .join(' · ');
  const agentLabel = a => `${shortType(a.type)}${a.name ? ` ${a.name}` : ''}${a.description ? `: ${a.description}` : ''}`;
  const AGENT_STATUS = { running: 'running', done: 'reported back', stopped: 'stopped', failed: 'failed', unknown: 'never reported back' };
  const sessionDesc = s =>
    [
      s.start ? fmtDate(s.start) : '',
      s.start ? fmtDur(s.end - s.start) : '',
      s.agents ? `${s.agents} ${s.agents === 1 ? 'agent' : 'agents'}` : '',
      s.children && s.children.length ? `${s.children.length} headless` : '',
      s.headless ? 'headless' : '',
      s.live || '',
    ]
      .filter(Boolean)
      .join(' · ');
  const sessionIcon = s =>
    s.live ? el('span', { className: 'codicon codicon-circle-filled live' }) : icon(s.headless ? 'terminal' : s.agents ? 'type-hierarchy-sub' : 'comment-discussion');

  const showSessionsPage = scope => {
    state.page = 'sessions';
    state.repo = undefined;
    state.sessionsPage = { scope, query: '', facets: [], open: false, active: 0, focus: true };
    if (state.sessions[scope] === undefined) {
      state.sessions[scope] = null;
      vscode.postMessage({ type: 'sessions', scope });
    }
    if (state.detail) select(undefined);
    else render();
  };

  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  const FACET_ICONS = { type: 'hubot', branch: 'git-branch', state: 'filter' };
  const STATE_FACETS = [
    ['running', 'Running now', s => !!s.live],
    ['today', 'Started today', s => !!s.start && sameDay(s.start, Date.now())],
    ['agents', 'With agents', s => s.agents > 0],
    ['headless', 'With headless runs', s => !!s.headless || (s.children || []).length > 0],
  ];
  const facetTest = f =>
    f.kind === 'type' ? s => (s.types || []).includes(f.value) : f.kind === 'branch' ? s => s.branch === f.value : (STATE_FACETS.find(x => x[0] === f.value) || [0, 0, () => true])[2];
  const searchText = s => [s.title, s.branch, ...(s.types || []), s.start ? fmtDate(s.start) : ''].join(' ').toLowerCase();
  const filterSessions = (list, q, facets) => list.filter(s => facets.every(f => facetTest(f)(s)) && (!q || searchText(s).includes(q)));
  const highlight = (text, q) => {
    const i = q ? text.toLowerCase().indexOf(q) : -1;
    return i < 0 ? text : [text.slice(0, i), el('mark', {}, text.slice(i, i + q.length)), text.slice(i + q.length)];
  };

  function suggestionsFor(list, q, facets) {
    const has = f => facets.some(x => x.kind === f.kind && x.value === f.value);
    const pool = filterSessions(list, '', facets);
    const types = [...new Set(pool.flatMap(s => s.types || []))].sort();
    const branches = [...new Set(pool.map(s => s.branch).filter(Boolean))].sort();
    const facetItems = [
      ...STATE_FACETS.map(([value, label]) => ({ kind: 'state', value, label })),
      ...types.map(value => ({ kind: 'type', value, label: `Agent: ${value}` })),
      ...branches.map(value => ({ kind: 'branch', value, label: `Branch: ${value}` })),
    ]
      .map(f => Object.assign(f, { n: pool.filter(facetTest(f)).length }))
      .filter(f => f.n > 0 && !has(f) && (!q || f.label.toLowerCase().includes(q)));
    const sessions = q ? pool.filter(s => s.title.toLowerCase().includes(q)).slice(0, 5).map(s => ({ kind: 'session', s, label: s.title })) : [];
    return [...facetItems.slice(0, q ? 4 : 6), ...sessions].slice(0, 9);
  }

  function renderSessionsPage() {
    const p = state.sessionsPage;
    const view = viewOf(p.scope);
    let list = state.sessions[p.scope];
    if (list === undefined) {
      state.sessions[p.scope] = null;
      vscode.postMessage({ type: 'sessions', scope: p.scope });
    }
    const back = iconBtn('arrow-left', `Back to ${view ? view.label : 'the repo'}`, () => showRepo(p.scope));
    const reload = iconBtn('refresh', 'Read the sessions again', () => {
      state.sessions[p.scope] = null;
      vscode.postMessage({ type: 'sessions', scope: p.scope });
      p.refresh();
    });
    const results = el('div', { className: 'recent' });
    const suggest = el('div', { className: 'suggest', role: 'listbox', id: 'session-suggest', hidden: true });
    const chips = el('div', { className: 'chips', hidden: true });
    const input = el('input', {
      type: 'search',
      id: 'session-search',
      placeholder: 'Search sessions by prompt, agent, branch or date',
      value: p.query,
      autocomplete: 'off',
      spellcheck: 'false',
      role: 'combobox',
      'aria-label': 'Search sessions',
      'aria-expanded': 'false',
      'aria-controls': 'session-suggest',
      'aria-autocomplete': 'list',
    });
    let items = [];
    const q = () => p.query.trim().toLowerCase();
    const drawResults = () => {
      if (!list) {
        results.replaceChildren(el('div', { className: 'empty flush' }, 'Reading the sessions...'));
        return;
      }
      const hits = filterSessions(list, q(), p.facets);
      results.replaceChildren(
        ...[
          el('div', { className: 'group-label' }, q() || p.facets.length ? `${hits.length} of ${list.length} sessions` : `${list.length} sessions`),
          hits.length
            ? hits.map(s =>
                el(
                  'div',
                  { className: 'row', title: s.file, onclick: () => showSession(p.scope, s.id) },
                  sessionIcon(s),
                  el('span', { className: 'name' }, highlight(s.title, q())),
                  el('span', { className: 'desc' }, [sessionDesc(s), (s.types || []).join(', ')].filter(Boolean).join(' · '))
                )
              )
            : el('div', { className: 'empty flush' }, 'No session matches. Press Esc to clear the search.'),
        ].flat()
      );
    };
    const drawChips = () => {
      chips.replaceChildren(
        ...p.facets.map(f =>
          el(
            'button',
            {
              className: 'chip',
              title: `Remove the filter ${f.label}`,
              onclick: () => {
                p.facets = p.facets.filter(x => x !== f);
                update();
                input.focus();
              },
            },
            icon(FACET_ICONS[f.kind] || 'filter'),
            el('span', {}, f.label),
            icon('close')
          )
        )
      );
      chips.hidden = !p.facets.length;
    };
    const drawSuggest = () => {
      items = list ? suggestionsFor(list, q(), p.facets) : [];
      if (p.active >= items.length) p.active = 0;
      suggest.replaceChildren(
        ...items.map((it, i) =>
          el(
            'div',
            {
              className: `suggest-item${i === p.active ? ' active' : ''}`,
              role: 'option',
              id: `session-suggest-${i}`,
              'aria-selected': i === p.active ? 'true' : 'false',
              onmousedown: e => {
                e.preventDefault();
                pick(it);
              },
            },
            it.kind === 'session' ? sessionIcon(it.s) : icon(FACET_ICONS[it.kind] || 'filter'),
            el('span', { className: 'name' }, it.kind === 'session' ? highlight(it.label, q()) : it.label),
            el('span', { className: 'desc' }, it.kind === 'session' ? 'Open' : `${it.n} ${it.n === 1 ? 'session' : 'sessions'}`)
          )
        )
      );
      const show = p.open && items.length > 0;
      suggest.hidden = !show;
      input.setAttribute('aria-expanded', show ? 'true' : 'false');
      if (show) input.setAttribute('aria-activedescendant', `session-suggest-${p.active}`);
      else input.removeAttribute('aria-activedescendant');
    };
    const update = () => {
      drawChips();
      drawResults();
      drawSuggest();
    };
    const pick = it => {
      if (it.kind === 'session') {
        showSession(p.scope, it.s.id);
        return;
      }
      p.facets = [...p.facets, { kind: it.kind, value: it.value, label: it.label }];
      p.query = '';
      input.value = '';
      p.active = 0;
      update();
    };
    const cancel = () => {
      p.query = '';
      p.facets = [];
      p.open = false;
      p.active = 0;
      input.value = '';
      update();
    };
    input.addEventListener('input', () => {
      p.query = input.value;
      p.open = true;
      p.active = 0;
      update();
    });
    input.addEventListener('focus', () => {
      p.open = true;
      drawSuggest();
    });
    input.addEventListener('blur', () => {
      p.open = false;
      drawSuggest();
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        p.open = true;
        if (items.length) p.active = (p.active + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
        drawSuggest();
      } else if (e.key === 'Enter') {
        if (p.open && items[p.active]) {
          e.preventDefault();
          pick(items[p.active]);
        }
      } else if (e.key === 'Backspace' && !input.value && p.facets.length) {
        p.facets = p.facets.slice(0, -1);
        update();
      }
    });
    p.refresh = () => {
      list = state.sessions[p.scope];
      update();
    };
    update();
    if (p.focus) {
      p.focus = false;
      requestAnimationFrame(() => input.focus());
    }
    return el(
      'section',
      { className: 'main' },
      pageHead('history', 'Sessions', view ? `${view.label} · ${view.path}` : '', back, reload),
      el('div', { className: 'main-body' }, el('div', { className: 'session-search' }, el('div', { className: 'combo' }, icon('search'), input, suggest), chips), results)
    );
  }

  const showSession = (scope, id) => {
    state.page = 'session';
    state.repo = undefined;
    state.session = { scope, id, data: undefined, selected: undefined };
    vscode.postMessage({ type: 'session', scope, id });
    if (state.detail) select(undefined);
    else render();
  };

  function renderSessionList(view) {
    const list = state.sessions[view.id];
    if (list === undefined) {
      state.sessions[view.id] = null;
      vscode.postMessage({ type: 'sessions', scope: view.id });
    }
    const all = list || [];
    const shown = state.allSessions.has(view.id) ? all : all.slice(0, 10);
    return el(
      'div',
      { className: 'recent' },
      el('div', { className: 'group-label' }, `Sessions${list ? ` (${list.length})` : ''}`),
      !list
        ? el('div', { className: 'empty flush' }, 'Reading the sessions...')
        : !list.length
          ? el('div', { className: 'empty flush' }, 'No Claude Code session ran in this repo yet.')
          : shown.map(s =>
              el('div', { className: 'row', title: s.title, onclick: () => showSession(view.id, s.id) }, sessionIcon(s), el('span', { className: 'name' }, s.title), el('span', { className: 'desc' }, sessionDesc(s)))
            ),
      list && list.length > shown.length
        ? el(
            'div',
            {
              className: 'row',
              onclick: () => {
                state.allSessions.add(view.id);
                renderMain();
              },
            },
            icon('ellipsis'),
            el('span', { className: 'name' }, `Show all ${list.length} sessions`)
          )
        : null
    );
  }

  const peakParallel = agents => {
    const edges = agents
      .filter(a => typeof a.start === 'number' && typeof a.end === 'number')
      .flatMap(a => [
        [a.start, 1],
        [Math.max(a.end, a.start + 1), -1],
      ])
      .sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    let n = 0;
    let peak = 0;
    for (const [, k] of edges) {
      n += k;
      peak = Math.max(peak, n);
    }
    return peak;
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs, ...children) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, String(v));
    }
    for (const c of children.flat()) if (c !== undefined && c !== null && c !== false) node.append(c.nodeType ? c : document.createTextNode(String(c)));
    return node;
  };
  const clip = (text, chars) => (text.length > chars ? `${text.slice(0, Math.max(1, chars - 3))}...` : text);
  const tokensText = u => `${fmtNum(u.input + u.cacheCreate)} in · ${fmtNum(u.output)} out · ${fmtNum(u.cacheRead)} cache reads`;
  const STATUS_TONE = { done: 'ok', failed: 'bad', stopped: 'warn', unknown: 'muted', running: 'run' };
  // A report reads as plain lines: no code blocks, table rules, heading or emphasis markers.
  const summaryText = text =>
    String(text || '')
      .slice(0, 4000)
      .replace(/```[\s\S]*?```/g, ' ')
      .split(/\r?\n/)
      .map(l =>
        l
          .replace(/^\s*#{1,6}\s*/, '')
          .replace(/^\s*[-*]\s+/, '• ')
          .replace(/\*\*|__|`/g, '')
          .trim()
      )
      .filter(l => l && !/^[\s|:-]+$/.test(l))
      .join('\n');

  const forkNote = (a, parent) =>
    a.type !== 'fork'
      ? undefined
      : parent
        ? `Nested fork: another agent ${a.status === 'failed' ? 'tried to start' : 'started'} it, not the main thread, so its lane is indented under that agent (${shortType(parent.type)}${parent.name ? ` ${parent.name}` : ''}${parent.description ? ` "${parent.description}"` : ''}).`
        : 'Fork of the main session: it starts with the whole conversation so far, runs on the same model in the background and reports back when it finishes.';

  function hoverCard(a, color, parent) {
    const note = forkNote(a, parent);
    const u = a.usage;
    const tokenIn = u.input + u.cacheCreate;
    const total = Math.max(1, tokenIn + u.output + u.cacheRead);
    const toolUses = Object.values(a.tools || {}).reduce((n, v) => n + v, 0);
    const stat = (label, value, key) => el('div', { className: 'hc-stat' }, el('span', { className: `hc-k${key ? ` k-${key}` : ''}` }, label), el('span', { className: 'hc-v' }, value));
    const bar = el('div', { className: 'hc-bar', 'aria-hidden': 'true' }, ['in', 'out', 'read'].map(k => el('span', { className: `seg ${k}` })));
    [tokenIn, u.output, u.cacheRead].forEach((n, i) => (bar.children[i].style.width = `${(n / total) * 100}%`));
    const summary = summaryText(a.result);
    return el(
      'div',
      { className: 'hc' },
      el(
        'div',
        { className: 'hc-head' },
        el('span', { className: `swatch hc-dot ${color}` }),
        el('span', { className: 'hc-type' }, shortType(a.type)),
        a.name ? el('span', { className: 'hc-name' }, a.name) : null,
        el('span', { className: 'hc-spacer' }),
        el('span', { className: `hc-pill ${STATUS_TONE[a.status] || 'muted'}` }, AGENT_STATUS[a.status])
      ),
      a.description ? el('div', { className: 'hc-title' }, a.description) : null,
      note ? el('div', { className: 'hc-note' }, icon('repo-forked'), el('span', {}, note)) : null,
      el(
        'div',
        { className: 'hc-grid' },
        stat('Model', shortModel(a.model) || 'inherit'),
        stat('Ran', typeof a.start === 'number' && a.end ? fmtDur(a.end - a.start) : 'n/a'),
        stat('Tool uses', String(toolUses)),
        stat('Tokens in', fmtNum(tokenIn), 'in'),
        stat('Tokens out', fmtNum(u.output), 'out'),
        stat('Cache reads', fmtNum(u.cacheRead), 'read')
      ),
      bar,
      a.error ? el('div', { className: 'hc-error' }, a.error) : null,
      a.prompt ? el('div', { className: 'hc-sec' }, el('div', { className: 'hc-label' }, 'Prompt'), el('div', { className: 'hc-text clamp-3' }, a.prompt.slice(0, 800).replace(/\s+/g, ' ').trim())) : null,
      el(
        'div',
        { className: 'hc-sec' },
        el('div', { className: 'hc-label' }, 'What it did'),
        summary ? el('div', { className: 'hc-text hc-summary clamp-6' }, summary) : el('div', { className: 'hc-text muted' }, a.status === 'running' ? 'Still running.' : 'No report.')
      ),
      el('div', { className: 'hc-foot' }, el('span', {}, typeof a.launchedAt === 'number' ? `Launched ${fmtTime(a.launchedAt)}` : ''), el('span', {}, 'Click for the full brief and report'))
    );
  }

  let hover;
  const hideHover = () => hover && hover.classList.remove('show');
  const showHover = (a, color, at, parent) => placeCard(`agent:${a.id}`, () => hoverCard(a, color, parent), at);
  // One floating card for every rich hover; `build` runs again when the card's data arrives later.
  function placeCard(key, build, at) {
    if (!hover) {
      hover = el('div', { className: 'tl-hover', role: 'tooltip' });
      document.body.append(hover);
    }
    if (hover.dataset.key !== key) {
      hover.replaceChildren(build());
      hover.dataset.key = key;
      hover.build = build;
    }
    hover.classList.add('show');
    const gap = 14;
    const w = hover.offsetWidth;
    const h = hover.offsetHeight;
    let left = at.x + gap;
    let top = at.y + gap;
    if (left + w > window.innerWidth - 8) left = Math.max(8, at.x - w - gap);
    if (top + h > window.innerHeight - 8) top = Math.max(8, at.y - h - gap);
    hover.style.left = `${left}px`;
    hover.style.top = `${top}px`;
  }
  const refreshCard = key => {
    if (hover && hover.dataset.key === key && hover.classList.contains('show') && hover.build) hover.replaceChildren(hover.build());
  };

  // Every `title` tooltip in the house hover style. On the first hover the title moves to `data-tip`, so the
  // browser's own tooltip never shows; the card opens after the repo card's pause, and at once on focus.
  let tipTimer;
  let tipTarget;
  const tipCard = (text, glyph) => {
    const [first, ...rest] = text.split('\n');
    return el(
      'div',
      { className: 'hc hc-tip' },
      el('div', { className: 'hc-head' }, glyph ? icon(glyph) : null, el('span', { className: 'hc-type' }, first)),
      rest.length ? el('div', { className: 'hc-text tip-lines' }, rest.join('\n')) : null
    );
  };
  const tipHost = node => (node instanceof Element ? node.closest('[title], [data-tip]') : null);
  const showTip = (t, delay) => {
    if (t.hasAttribute('title')) {
      const title = t.getAttribute('title');
      t.removeAttribute('title');
      if (title) {
        t.dataset.tip = title;
        if (!t.hasAttribute('aria-label') && !t.hasAttribute('aria-description')) t.setAttribute('aria-description', title);
      }
    }
    clearTimeout(tipTimer);
    tipTarget = t;
    const text = t.dataset.tip;
    if (!text) return;
    const own = t.querySelector(':scope > .codicon');
    const glyph = own && [...own.classList].find(c => c.startsWith('codicon-') && !c.startsWith('codicon-modifier'));
    tipTimer = setTimeout(() => {
      if (tipTarget !== t || !t.isConnected) return;
      const r = t.getBoundingClientRect();
      placeCard(`tip:${text}`, () => tipCard(text, glyph && glyph.slice('codicon-'.length)), { x: r.left - 14, y: r.bottom - 6 });
    }, delay);
  };
  const hideTip = () => {
    clearTimeout(tipTimer);
    tipTarget = undefined;
    if (hover && (hover.dataset.key || '').startsWith('tip:')) hideHover();
  };
  document.addEventListener('mouseover', e => {
    const t = tipHost(e.target);
    if (t && t !== tipTarget) showTip(t, 350);
  });
  document.addEventListener('mouseout', e => {
    const t = tipHost(e.target);
    if (t && t === tipTarget && !t.contains(e.relatedTarget)) hideTip();
  });
  document.addEventListener('focusin', e => {
    const t = tipHost(e.target);
    if (t) showTip(t, 0);
  });
  document.addEventListener('focusout', hideTip);
  document.addEventListener('mousedown', hideTip);
  const ago = t => {
    const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : fmtDate(t);
  };

  function repoCard(view) {
    const c = state.checks[view.id];
    const s = std();
    const sessions = state.sessions[view.id];
    if (sessions === undefined) {
      state.sessions[view.id] = null;
      vscode.postMessage({ type: 'sessions', scope: view.id });
    }
    const cats = view.categories.filter(cat => cat.items.length);
    const tone = !c ? 'muted' : c.state === 'pass' ? 'ok' : c.state === 'fail' || c.state === 'error' ? 'bad' : c.state === 'review' ? 'warn' : 'muted';
    const latest = sessions && sessions[0];
    const running = sessions ? sessions.filter(x => x.live).length : 0;
    const agentCount = sessions ? sessions.reduce((n, x) => n + x.agents, 0) : 0;
    return el(
      'div',
      { className: 'hc' },
      el(
        'div',
        { className: 'hc-head' },
        icon('repo'),
        el('span', { className: 'hc-type' }, view.label),
        view.local ? el('span', { className: 'hc-name' }, 'this workspace') : null,
        el('span', { className: 'hc-spacer' }),
        s && c && c.state !== 'unchecked' ? el('span', { className: `hc-pill ${tone}` }, checkText(c)) : null
      ),
      el('div', { className: 'hc-path' }, view.path),
      cats.length
        ? el(
            'div',
            { className: 'hc-grid' },
            cats.map(cat => el('div', { className: 'hc-stat' }, el('span', { className: 'hc-k' }, cat.label), el('span', { className: 'hc-v' }, String(cat.items.length))))
          )
        : el('div', { className: 'hc-text muted' }, 'No harness files yet.'),
      el(
        'div',
        { className: 'hc-sec' },
        el('div', { className: 'hc-label' }, 'Sessions'),
        !sessions
          ? el('div', { className: 'hc-text muted' }, 'Reading the sessions...')
          : !sessions.length
            ? el('div', { className: 'hc-text muted' }, 'No Claude Code session ran here yet.')
            : [
                el('div', { className: 'hc-text' }, [`${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'}`, `${agentCount} agents`, running ? `${running} running now` : `last ${ago(latest.end)}`].join(' · ')),
                el('div', { className: 'hc-text clamp-3' }, `Latest: ${latest.title}`),
              ]
      ),
      s && c && c.findings && c.findings.length
        ? el(
            'div',
            { className: 'hc-sec' },
            el('div', { className: 'hc-label' }, 'Harness standard'),
            el('div', { className: 'hc-text clamp-3' }, c.findings.slice(0, 3).map(f => f.text.replace(/^(FAIL|REVIEW|INFO) /, '')).join(' · '))
          )
        : null,
      el('div', { className: 'hc-foot' }, el('span', {}, `${cats.reduce((n, cat) => n + cat.items.length, 0)} harness items`), el('span', {}, 'Click to open the repo page'))
    );
  }

  const TICKS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 240, 360, 720, 1440].map(m => m * 60000);
  const LANE = 22;
  const BAR = 12;
  const AXIS = 22;

  // Claude Code's agent colors; an agent definition's `color` field or a teammate's spawn color wins over the palette.
  const AGENT_COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'];

  // The palette classes c0 to c5 by the hue they paint, so a palette type and a named type of one hue count as a clash.
  const PALETTE_HUES = ['blue', 'green', 'orange', 'purple', 'yellow', 'red'];

  function colorsOf(d) {
    const map = new Map();
    const namedOf = type => (AGENT_COLORS.includes((d.agentColors || {})[type]) ? d.agentColors[type] : undefined);
    for (const a of d.agents) if (!map.has(a.type)) map.set(a.type, -1);
    // A type without its own color takes a palette hue no named type uses, while one is left.
    const taken = new Set([...map.keys()].map(namedOf).filter(Boolean));
    let next = 0;
    for (const type of map.keys()) {
      if (namedOf(type)) continue;
      const free = PALETTE_HUES.findIndex(h => !taken.has(h));
      const i = free >= 0 ? free : next++ % PALETTE_HUES.length;
      taken.add(PALETTE_HUES[i]);
      map.set(type, i);
    }
    const baseOf = type => (namedOf(type) ? `ac-${namedOf(type)}` : `c${map.get(type)}`);
    const hueOf = base => (base.startsWith('ac-') ? base.slice(3) : PALETTE_HUES[Number(base.slice(1))]);
    // Types that share a hue keep it; the second and third get a lighter and a deeper shade.
    const shade = new Map();
    const seen = new Map();
    for (const type of map.keys()) {
      const hue = hueOf(baseOf(type));
      const k = seen.get(hue) || 0;
      seen.set(hue, k + 1);
      shade.set(type, k ? ` tint-${((k - 1) % 2) + 1}` : '');
    }
    const typeTone = type => `${baseOf(type)}${shade.get(type) || ''}`;
    const tone = a => (AGENT_COLORS.includes(a.color) && `ac-${a.color}` !== baseOf(a.type) ? `ac-${a.color}` : typeTone(a.type));
    return { tone, typeTone, types: [...map.keys()] };
  }

  const endOfAgent = a => (a.status === 'running' ? Math.max(a.end || 0, Date.now()) : a.end);
  // Diagram width: the host's inner width, a pixel short so rounding never adds a scrollbar.
  const widthOf = (host, min) => Math.max(min, Math.floor(host.clientWidth || 0) - 1);

  // Time axis shared by the timeline and the concurrency view: idle stretches longer than GAP shrink to a thin band.
  function timeAxis(d, left, W, right) {
    const endOf = endOfAgent;
    const times = [d.start, d.end, ...d.prompts.map(p => p.at), ...d.agents.flatMap(a => [a.launchedAt, a.start, endOf(a), ...a.reports]), ...d.children.flatMap(c => [c.start, c.end])].filter(
      t => typeof t === 'number' && isFinite(t)
    );
    const t0 = Math.min(...times);
    const t1 = Math.max(...times, t0 + 60000);
    // Idle stretches (no agent, prompt or message) longer than GAP shrink to a thin band so the active parts get the width.
    const GAP = Math.max(15 * 60000, (t1 - t0) * 0.06);
    const GAP_PX = 22;
    const spans = [
      ...d.agents.map(a => [typeof a.launchedAt === 'number' ? a.launchedAt : a.start, Math.max(endOf(a) || 0, ...a.reports)]),
      ...d.children.map(c => [c.start, c.end]),
      ...d.prompts.map(p => [p.at - 60000, p.at + 60000]),
      ...d.events.map(e => [e.at - 30000, e.at + 30000]),
    ]
      .filter(([a, b]) => isFinite(a) && isFinite(b))
      .map(([a, b]) => [Math.max(t0, a), Math.min(t1, Math.max(a, b))])
      .sort((p, q) => p[0] - q[0]);
    const segs = [];
    const push = (a, b, gap) => {
      if (b <= a) return;
      const last = segs[segs.length - 1];
      if (last && !gap && !last.gap) last.b = b;
      else segs.push({ a, b, gap });
    };
    let cursor = t0;
    for (const [a, b] of spans) {
      if (b <= cursor) continue;
      if (a > cursor) push(cursor, a, a - cursor > GAP);
      push(Math.max(cursor, a), b, false);
      cursor = b;
    }
    if (t1 > cursor) push(cursor, t1, t1 - cursor > GAP);
    if (!segs.length) segs.push({ a: t0, b: t1, gap: false });
    const gaps = segs.filter(s => s.gap).length;
    const activeTotal = Math.max(1, segs.filter(s => !s.gap).reduce((n, s) => n + (s.b - s.a), 0));
    const avail = Math.max(60, W - left - right - gaps * GAP_PX);
    let off = left;
    for (const s of segs) {
      s.x = off;
      s.w = s.gap ? GAP_PX : ((s.b - s.a) / activeTotal) * avail;
      off += s.w;
    }
    const x = t => {
      const s = segs.find(g => t <= g.b) || segs[segs.length - 1];
      if (t <= s.a) return s.x;
      return s.x + Math.min(1, (t - s.a) / (s.b - s.a)) * s.w;
    };
    const perPx = activeTotal / avail;
    // Gap bands, grid lines and time labels; labels sit 10px above `top`.
    const grid = (root, top, bottom) => {
      const step = TICKS.find(s => s / perPx >= 80) || TICKS[TICKS.length - 1];
      let lastLabel = -Infinity;
      for (const s of segs) {
        if (s.gap) {
          root.append(
            svg('rect', { x: s.x, y: top - 4, width: s.w, height: bottom - top + 4, class: 'tl-gap' }, svg('title', {}, `${fmtDur(s.b - s.a)} idle, ${fmtTime(s.a)} to ${fmtTime(s.b)}`)),
            svg('path', { d: `M ${s.x + 6} ${top - 2} L ${s.x + 10} ${top - 12} M ${s.x + 12} ${top - 2} L ${s.x + 16} ${top - 12}`, class: 'tl-break' })
          );
          continue;
        }
        for (let t = Math.ceil(s.a / step) * step; t <= s.b; t += step) {
          const tx = x(t);
          root.append(svg('line', { x1: tx, x2: tx, y1: top - 4, y2: bottom, class: 'tl-grid' }));
          if (tx - lastLabel < 64) continue;
          root.append(svg('text', { x: tx, y: top - 10, class: 'tl-axis', 'text-anchor': 'middle' }, fmtTime(t)));
          lastLabel = tx;
        }
      }
    };
    return { x, segs, grid };
  }

  function drawTimeline(host, d) {
    const W = widthOf(host, 480);
    const LABEL = Math.max(150, Math.min(300, Math.round(W * 0.32)));
    const RIGHT = 14;
    const colors = colorsOf(d);
    const endOf = endOfAgent;
    const { x, grid } = timeAxis(d, LABEL, W, RIGHT);
    const lanes = 1 + d.agents.length + d.children.length;
    const H = AXIS + lanes * LANE + 6;
    const cy = i => AXIS + i * LANE + LANE / 2;
    const laneOf = new Map(d.agents.map((a, i) => [a.id, i + 1]));
    const selected = state.session && state.session.selected;
    const root = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'tl', role: 'img', 'aria-label': 'Delegation timeline' });
    grid(root, AXIS, H);

    const row = (i, label, depth, onclick, isSelected, extraClass) =>
      svg(
        'g',
        { class: `tl-lane${extraClass ? ` ${extraClass}` : ''}`, onclick },
        svg('rect', { x: 0, y: AXIS + i * LANE, width: W, height: LANE, class: `tl-row${isSelected ? ' sel' : ''}` }),
        svg('text', { x: 8 + depth * 12, y: cy(i) + 4, class: `tl-label${i === 0 ? ' main' : ''}` }, clip(label, Math.floor((LABEL - 16 - depth * 12) / 6.2)))
      );

    const main = row(0, 'Main thread', 0, undefined, false, 'main-lane');
    bindMainHover(main, d);
    main.append(svg('line', { x1: x(d.start), x2: x(d.end), y1: cy(0), y2: cy(0), class: 'tl-main' }));
    for (const a of d.agents) {
      if (a.background || a.teammate || a.parent || typeof a.launchedAt !== 'number') continue;
      const until = a.reports[0] || a.end || a.launchedAt;
      main.append(svg('rect', { x: x(a.launchedAt), y: cy(0) - 3, width: Math.max(2, x(until) - x(a.launchedAt)), height: 6, class: 'tl-wait' }, svg('title', {}, `Main thread waits for ${agentLabel(a)}`)));
    }
    const roots = d.agents.filter(a => !a.parent && typeof a.launchedAt === 'number').sort((p, q) => p.launchedAt - q.launchedAt);
    for (let i = 0; i < roots.length; ) {
      let j = i + 1;
      while (j < roots.length && roots[j].launchedAt - roots[j - 1].launchedAt <= 60000) j++;
      if (j - i > 1) main.append(svg('text', { x: x(roots[i].launchedAt), y: cy(0) - 5, class: 'tl-fan' }, `×${j - i}`, svg('title', {}, `${j - i} agents launched together at ${fmtTime(roots[i].launchedAt)}`)));
      i = j;
    }
    for (const p of d.prompts) main.append(svg('circle', { cx: x(p.at), cy: cy(0), r: 3.5, class: 'tl-prompt' }, svg('title', {}, `${fmtTime(p.at)} you: ${clip(p.text, 300)}`)));
    for (const a of d.agents)
      if (!a.parent) for (const t of a.reports) main.append(svg('circle', { cx: x(t), cy: cy(0), r: 3, class: `tl-dot ${colors.tone(a)}` }, svg('title', {}, `${fmtTime(t)} result from ${agentLabel(a)}`)));
    root.append(main);

    d.agents.forEach((a, k) => {
      const i = k + 1;
      const color = colors.tone(a);
      const parent = a.parent ? d.agents.find(p => p.id === a.parent) : undefined;
      const g = row(i, a.type === 'claude' && a.name ? a.name : shortType(a.type), a.depth, () => selectAgent(a.id), selected === a.id);
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', `${agentLabel(a)}, ${AGENT_STATUS[a.status]}`);
      g.dataset.agent = a.id;
      g.addEventListener('mouseenter', e => showHover(a, color, { x: e.clientX, y: e.clientY }, parent));
      g.addEventListener('mousemove', e => showHover(a, color, { x: e.clientX, y: e.clientY }, parent));
      g.addEventListener('mouseleave', hideHover);
      g.addEventListener('focus', () => {
        const r = g.getBoundingClientRect();
        showHover(a, color, { x: r.left + LABEL, y: r.bottom }, parent);
      });
      g.addEventListener('blur', hideHover);
      g.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        selectAgent(a.id, true);
      });
      const from = a.parent && laneOf.has(a.parent) ? laneOf.get(a.parent) : 0;
      const start = typeof a.start === 'number' ? a.start : a.launchedAt;
      const end = endOf(a) || start;
      if (typeof a.launchedAt === 'number') {
        g.append(svg('line', { x1: x(a.launchedAt), x2: x(a.launchedAt), y1: cy(from) + (from ? BAR / 2 : 3), y2: cy(i) - BAR / 2, class: 'tl-link' }));
        if (start - a.launchedAt > 5000) g.append(svg('line', { x1: x(a.launchedAt), x2: x(start), y1: cy(i), y2: cy(i), class: 'tl-queue' }, svg('title', {}, `Waited ${fmtDur(start - a.launchedAt)} before it started`)));
      }
      if (typeof start === 'number') {
        g.append(
          svg('rect', { x: x(start), y: cy(i) - BAR / 2, width: Math.max(3, x(end) - x(start)), height: BAR, rx: a.teammate ? 6 : 2, class: `tl-bar ${color} ${a.status}` })
        );
      }
      for (const t of a.reports) g.append(svg('circle', { cx: x(t), cy: cy(i), r: 2.5, class: `tl-dot ${color}` }, svg('title', {}, `${fmtTime(t)} reported`)));
      for (const e of d.events) {
        if (e.agent !== a.id) continue;
        const ex = x(e.at);
        const top = cy(i) - BAR / 2;
        g.append(
          e.kind === 'stop'
            ? svg(
                'g',
                { class: 'tl-stop' },
                svg('circle', { cx: ex, cy: cy(i), r: 6, class: 'tl-stop-bg' }),
                svg('path', { d: `M ${ex - 2.5} ${cy(i) - 2.5} L ${ex + 2.5} ${cy(i) + 2.5} M ${ex + 2.5} ${cy(i) - 2.5} L ${ex - 2.5} ${cy(i) + 2.5}`, class: 'tl-stop-x' }),
                svg('title', {}, `${fmtTime(e.at)} stopped`)
              )
            : svg('path', { d: `M ${ex - 4} ${top - 7} L ${ex + 4} ${top - 7} L ${ex} ${top - 1} Z`, class: 'tl-msg' }, svg('title', {}, `${fmtTime(e.at)} message: ${clip(e.text, 300)}`))
        );
      }
      root.append(g);
    });

    d.children.forEach((c, k) => {
      const i = 1 + d.agents.length + k;
      const g = row(i, `claude -p: ${c.title}`, 0, () => showSession(state.session.scope, c.id), false, 'child-lane');
      if (typeof c.start === 'number')
        g.append(svg('rect', { x: x(c.start), y: cy(i) - BAR / 2, width: Math.max(3, x(c.end) - x(c.start)), height: BAR, rx: 2, class: 'tl-child' }, svg('title', {}, `Headless session: ${clip(c.title, 300)}\n${fmtDur(c.end - c.start)} · click to open`)));
      root.append(g);
    });
    host.replaceChildren(root);
  }

  function renderAgent(d) {
    const a = d.agents.find(x => x.id === (state.session && state.session.selected));
    if (!a) return el('div', { className: 'agent-detail empty flush', hidden: d.agents.length > 0 }, d.agents.length ? '' : 'No subagent ran in this session.');
    const parent = a.parent && d.agents.find(x => x.id === a.parent);
    const facts = [
      ['Type', a.type],
      a.name && ['Name', a.name],
      ['Model', shortModel(a.model) || 'inherit'],
      ['Mode', `${a.teammate ? 'teammate' : a.background ? 'background' : 'foreground'} · started by ${parent ? agentLabel(parent) : 'the main thread'}`],
      ['Status', AGENT_STATUS[a.status]],
      typeof a.launchedAt === 'number' && ['Launched', fmtTime(a.launchedAt)],
      typeof a.start === 'number' && a.end && ['Ran', `${fmtTime(a.start)} to ${fmtTime(a.end)} · ${fmtDur(a.end - a.start)}`],
      a.reports.length && ['Reported', a.reports.map(fmtTime).join(', ')],
      ['Turns', a.turns],
      Object.keys(a.tools).length && ['Tools', topTools(a.tools)],
      ['Tokens', tokensText(a.usage)],
      a.error && ['Error', a.error],
    ].filter(Boolean);
    return el(
      'div',
      { className: 'agent-detail' },
      el('div', { className: 'group-label' }, agentLabel(a)),
      el(
        'div',
        { className: 'facts' },
        facts.flatMap(([k, v]) => [el('span', { className: 'key' }, k), el('span', { className: 'value' }, String(v))])
      ),
      a.prompt ? el('details', {}, el('summary', {}, 'Brief'), el('pre', { className: 'json wrap' }, a.prompt)) : null,
      a.result ? el('details', { open: true }, el('summary', {}, 'Report'), el('pre', { className: 'json wrap' }, a.result)) : null
    );
  }

  const hcStat = (label, value, key) => el('div', { className: 'hc-stat' }, el('span', { className: `hc-k${key ? ` k-${key}` : ''}` }, label), el('span', { className: 'hc-v' }, value));
  function tokenBar(u) {
    const tokenIn = u.input + u.cacheCreate;
    const total = Math.max(1, tokenIn + u.output + u.cacheRead);
    const bar = el('div', { className: 'hc-bar', 'aria-hidden': 'true' }, ['in', 'out', 'read'].map(k => el('span', { className: `seg ${k}` })));
    [tokenIn, u.output, u.cacheRead].forEach((n, i) => (bar.children[i].style.width = `${(n / total) * 100}%`));
    return bar;
  }

  // Card for the main thread: the orchestrator's own facts.
  function mainCard(d) {
    const u = d.usage;
    const toolUses = Object.values(d.tools || {}).reduce((n, v) => n + v, 0);
    return el(
      'div',
      { className: 'hc' },
      el(
        'div',
        { className: 'hc-head' },
        el('span', { className: 'swatch hc-dot tone-main' }),
        el('span', { className: 'hc-type' }, 'Main thread'),
        el('span', { className: 'hc-name' }, 'orchestrator'),
        el('span', { className: 'hc-spacer' }),
        d.live ? el('span', { className: 'hc-pill run' }, d.live) : null
      ),
      el('div', { className: 'hc-note' }, icon('info'), el('span', {}, 'The session itself: reads your prompts, runs its own tools, starts the agents.')),
      el(
        'div',
        { className: 'hc-grid' },
        hcStat('Model', shortModel(d.model) || 'n/a'),
        hcStat('Ran', d.start && d.end ? fmtDur(d.end - d.start) : 'n/a'),
        hcStat('Prompts', String(d.prompts.length)),
        hcStat('Tool uses', String(toolUses)),
        hcStat('File edits', String(d.edits || 0)),
        hcStat('Agents started', String(d.agents.filter(a => !a.parent).length)),
        hcStat('Tokens in', fmtNum(u.input + u.cacheCreate), 'in'),
        hcStat('Tokens out', fmtNum(u.output), 'out'),
        hcStat('Cache reads', fmtNum(u.cacheRead), 'read')
      ),
      tokenBar(u),
      el('div', { className: 'hc-sec' }, el('div', { className: 'hc-label' }, 'Top tools'), el('div', { className: 'hc-text' }, topTools(d.tools) || 'none')),
      el('div', { className: 'hc-foot' }, el('span', {}, `Est. cost ${fmtUsd(u.cost || 0)}`), el('span', {}, `${d.turns} turns`))
    );
  }

  function bindMainHover(g, d) {
    g.addEventListener('mouseenter', e => placeCard('main', () => mainCard(d), { x: e.clientX, y: e.clientY }));
    g.addEventListener('mousemove', e => placeCard('main', () => mainCard(d), { x: e.clientX, y: e.clientY }));
    g.addEventListener('mouseleave', hideHover);
  }

  // Hover, focus, click and keyboard wiring for one agent mark in any diagram.
  function bindAgent(g, a, d, colors) {
    const color = colors.tone(a);
    const parent = a.parent ? d.agents.find(p => p.id === a.parent) : undefined;
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', `${agentLabel(a)}, ${AGENT_STATUS[a.status]}`);
    g.dataset.agent = a.id;
    g.addEventListener('click', () => selectAgent(a.id));
    g.addEventListener('mouseenter', e => showHover(a, color, { x: e.clientX, y: e.clientY }, parent));
    g.addEventListener('mousemove', e => showHover(a, color, { x: e.clientX, y: e.clientY }, parent));
    g.addEventListener('mouseleave', hideHover);
    g.addEventListener('focus', () => {
      const r = g.getBoundingClientRect();
      showHover(a, color, { x: r.right, y: r.bottom }, parent);
    });
    g.addEventListener('blur', hideHover);
    g.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      selectAgent(a.id, true);
    });
  }

  const tokensOf = u => u.input + u.cacheCreate + u.cacheRead + u.output;
  const laneName = a => (a.type === 'claude' && a.name ? a.name : shortType(a.type));

  // The Sum / Full timeline switch above a diagram; `pick` stores the mode and redraws, the focus stays on the button.
  function modeSwitch(host, modes, current, label, pick) {
    return el(
      'div',
      { className: 'dg-modes', role: 'group', 'aria-label': label },
      modes.map(([id, text, glyph, about]) => {
        const tip = target => {
          const r = target.getBoundingClientRect();
          placeCard(`mode:${id}`, () => tabTip(text, glyph, about), { x: r.left - 14, y: r.bottom - 6 });
        };
        return el(
          'button',
          {
            className: `view-tab dg-mode${current === id ? ' active' : ''}`,
            'aria-pressed': current === id ? 'true' : 'false',
            'aria-description': about,
            onclick: () => {
              hideHover();
              pick(id);
              persist();
              const b = host.querySelector(`.dg-mode[data-mode="${id}"]`);
              if (b) b.focus();
            },
            onmouseenter: e => tip(e.currentTarget),
            onmouseleave: hideHover,
            onfocus: e => tip(e.currentTarget),
            onblur: hideHover,
            'data-mode': id,
          },
          icon(glyph),
          el('span', {}, text)
        );
      })
    );
  }

  const MAP_MODES = [
    ['sum', 'Sum', 'merge', 'Agents summed up by type under whoever started them; click a type to drill down to its runs.'],
    ['timeline', 'Full timeline', 'history', 'Your prompts as a process from top to bottom: each delegation branches into the agents it started, and their reports join the main thread again.'],
  ];

  // Every row in the map shows the same facts in the same right-aligned columns: model (runs for a type), run time, tools, messages.
  const MAP_ROW_H = 30;
  const MAP_FACT_ENDS = [244, 172, 100, 28];
  // The narrowest a row gets before the map scrolls: the four fact columns plus a short agent name.
  const MAP_ROW_MIN = 400;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const fmtRun = ms => (ms > 0 ? fmtDur(ms) : '-');
  const mapCells = (right, y, list) => list.map((t, i) => svg('text', { x: right - MAP_FACT_ENDS[i], y, class: 'dg-meta', 'text-anchor': 'end' }, t));
  const mapNameRoom = (x, right) => Math.floor((right - MAP_FACT_ENDS[0] - 70 - x) / 6.6);
  function mapFacts(d) {
    const msgs = new Map();
    for (const e of d.events) if (e.kind === 'message' && e.agent) msgs.set(e.agent, (msgs.get(e.agent) || 0) + 1);
    return { msgs, toolsOf: a => Object.values(a.tools).reduce((n, v) => n + v, 0), runOf: a => (typeof a.start === 'number' && a.end > a.start ? a.end - a.start : 0) };
  }
  function mapAgentRow(a, x, y, right, d, colors, msgs, selected) {
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

  function drawMap(host, d) {
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
  function drawProcess(W, d) {
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

  const ACTIONS = ['delegated', 'worked on the main thread', 'followed up an agent', 'answered directly'];
  const DECISION_LABELS = { 'worked on the main thread': 'worked itself', 'followed up an agent': 'followed up agent', 'answered directly': 'answered' };
  const TEAM_SHAPES = { 'agents together': 'together', 'agents one after another': 'one after another' };
  const DECISION_MODES = [
    ['sum', 'Sum', 'merge', 'Your prompts summed up: what the main thread did, which agent or team, and how it ended.'],
    ['timeline', 'Full timeline', 'history', 'Every prompt in order: what the main thread did, the agent it launched or its team, and each team member.'],
  ];

  const STATUS_GLYPH = { done: 'pass', failed: 'error', stopped: 'debug-stop', unknown: 'question', running: 'clock' };

  // The prompts on a time rail. Each prompt carries the agents it launched, one by name or several as a team,
  // and every agent gets a run bar on a track that spans the prompt to the last report.
  function decisionCard(label, items, d) {
    const promptAt = new Map(d.prompts.map(p => [p.at, p.text]));
    const byId = new Map(d.agents.map(a => [a.id, a]));
    const colors = colorsOf(d);
    const sorted = [...items].sort((p, q) => p.at - q.at);
    const shown = sorted.slice(0, 6);
    const first = sorted[0].at;
    const last = sorted[sorted.length - 1].at;
    const launches = items.reduce((n, x) => n + x.launches, 0);
    const span = [last > first ? `${fmtTime(first)} to ${fmtTime(last)}` : fmtTime(first), last > first ? fmtDur(last - first) : '', launches ? `${launches} ${launches === 1 ? 'agent' : 'agents'}` : ''];
    const run = (a, from, to) => {
      const start = typeof a.start === 'number' ? a.start : typeof a.launchedAt === 'number' ? a.launchedAt : from;
      const end = endOfAgent(a) || a.reports[0] || start;
      const seg = el('span', { className: `hc-run-seg swatch ${colors.tone(a)}` });
      seg.style.left = `${((start - from) / (to - from)) * 100}%`;
      seg.style.width = `${Math.max(1.5, ((end - start) / (to - from)) * 100)}%`;
      return el(
        'div',
        { className: 'hc-run' },
        el('span', { className: `swatch hc-dot ${colors.tone(a)}` }),
        el('span', { className: 'hc-run-name' }, laneName(a)),
        el('span', { className: 'hc-run-desc' }, a.description || ''),
        el('span', { className: `hc-run-status ${STATUS_TONE[a.status] || 'muted'}` }, icon(STATUS_GLYPH[a.status] || 'circle-outline'), AGENT_STATUS[a.status]),
        el('span', { className: 'hc-run-track', 'aria-hidden': 'true' }, seg),
        el('span', { className: 'hc-run-dur' }, end > start ? fmtDur(end - start) : '')
      );
    };
    return el(
      'div',
      { className: 'hc hc-decision' },
      el('div', { className: 'hc-head' }, icon('type-hierarchy'), el('span', { className: 'hc-type' }, label), el('span', { className: 'hc-spacer' }), el('span', { className: 'hc-pill muted' }, `${items.length} ${items.length === 1 ? 'prompt' : 'prompts'}`)),
      el('div', { className: 'hc-sub' }, span.filter(Boolean).join(' · ')),
      el(
        'ol',
        { className: 'hc-tl' },
        shown.map((x, i) => {
          const runs = (x.agents || []).map(id => byId.get(id)).filter(Boolean);
          const to = Math.max(x.at + 1000, ...runs.map(a => endOfAgent(a) || a.reports[0] || a.start || a.launchedAt || x.at));
          const together = x.shape === 'agents together';
          return el(
            'li',
            { className: `hc-tl-item${runs.length ? ' delegated' : ''}` },
            el('div', { className: 'hc-tl-when' }, el('span', { className: 'hc-tl-time' }, fmtTime(x.at)), i ? el('span', { className: 'hc-tl-gap' }, `+${fmtDur(x.at - shown[i - 1].at)}`) : null),
            el('div', { className: 'hc-tl-prompt' }, promptAt.get(x.at) || ''),
            runs.length
              ? el(
                  'div',
                  { className: `hc-tl-runs${runs.length > 1 ? ` team${together ? '' : ' serial'}` : ''}` },
                  runs.length > 1 ? el('div', { className: 'hc-tl-team' }, icon(together ? 'organization' : 'list-ordered'), `Team of ${runs.length} · ${TEAM_SHAPES[x.shape] || ''}`) : null,
                  runs.map(a => run(a, x.at, to))
                )
              : null
          );
        })
      ),
      sorted.length > shown.length ? el('div', { className: 'hc-text muted' }, `and ${sorted.length - shown.length} more`) : null
    );
  }

  function drawDecisions(host, d) {
    const W = widthOf(host, 560);
    const list = d.decisions || [];
    const total = list.length;
    if (!total) {
      host.replaceChildren(el('div', { className: 'empty flush dg-empty' }, 'No prompts in this session.'));
      return;
    }
    const colors = colorsOf(d);
    const selected = state.session && state.session.selected;
    const byId = new Map(d.agents.map(a => [a.id, a]));
    // Tree: prompts -> action -> agent name or team -> outcome -> each agent launched.
    const node = (label, items, children = [], extra = {}) => ({ label, items, children, ...extra });
    const groupBy = (items, keyOf) => {
      const groups = new Map();
      for (const x of items) groups.set(keyOf(x), [...(groups.get(keyOf(x)) || []), x]);
      return [...groups.entries()];
    };
    const mode = state.decisionMode === 'timeline' ? 'timeline' : 'sum';
    const launchedBy = x => (x.agents || []).map(id => byId.get(id)).filter(Boolean);
    const runs = items => items.flatMap(x => launchedBy(x).map(a => node(laneName(a), [x], [], { agent: a })));
    const delegated = items => {
      const agents = groupBy(
        items.filter(x => x.launches === 1),
        x => x.types[0] || 'agent'
      )
        .sort((p, q) => q[1].length - p[1].length)
        .map(([name, v]) => node(name, v, groupBy(v, x => x.outcome).map(([outcome, w]) => node(outcome, w, runs(w), { title: `${name} · ${outcome}` }))));
      const team = items.filter(x => x.launches > 1);
      if (!team.length) return agents;
      const members = groupBy(team, x => `${x.types.join(' + ') || 'agent'}|${x.outcome}`).map(([k, w]) => node(k.split('|')[0], w, runs(w), { outcome: k.split('|')[1] }));
      return [...agents, node('team', team, members)];
    };
    const sum = () =>
      node(
        'Your prompts',
        list,
        ACTIONS.map(action => {
          const items = list.filter(x => x.action === action);
          return node(action, items, action === 'delegated' ? delegated(items) : []);
        }).filter(a => a.items.length)
      );
    // Full timeline: every prompt in order with what the main thread did, the agent it launched by name or its team, and each team member.
    const timeline = () =>
      node(
        'Your prompts',
        list,
        list.map(x => {
          const launched = launchedBy(x);
          const agents = launched.map(a => node(laneName(a), [x], [], { agent: a }));
          return node(fmtTime(x.at), [x], launched.length > 1 ? [node('team', [x], agents, { outcome: TEAM_SHAPES[x.shape] })] : agents, { prompt: x });
        })
      );
    const tree = mode === 'timeline' ? timeline() : sum();
    const keyed = (n, key, depth) => {
      n.key = key;
      n.depth = depth;
      n.children.forEach(c => keyed(c, `${key}/${c.agent ? c.agent.id : c.prompt ? c.prompt.at : c.title || (c.outcome ? `${c.label}|${c.outcome}` : c.label)}`, depth + 1));
    };
    keyed(tree, mode, 0);
    // Drilldown: the sum opens three levels by default, the timeline opens everything; every node with children folds on click.
    const open = state.session ? (state.session.decisionOpen = state.session.decisionOpen || {}) : {};
    // The timeline hides the root: its prompts sit in the first column on a time rail.
    const base = mode === 'timeline' ? 1 : 0;
    const isOpen = n => n.children.length > 0 && ((base && n === tree) || (n.key in open ? open[n.key] : mode === 'timeline' || n.depth < 3));
    const RAIL = mode === 'timeline' ? 18 : 0;
    const promptText = new Map(d.prompts.map(p => [p.at, p.text]));
    const PAD = 12;
    const SLOT = 46;
    const NODE_H = 34;
    const GAP = 48;
    let leaf = 0;
    let deepest = 0;
    const place = n => {
      deepest = Math.max(deepest, n.depth);
      if (!isOpen(n)) {
        n.y = PAD + 20 + leaf * SLOT;
        leaf++;
      } else {
        n.children.forEach(place);
        n.y = (n.children[0].y + n.children[n.children.length - 1].y) / 2;
      }
    };
    place(tree);
    const cols = Math.max(mode === 'timeline' ? 3 : 4, deepest + 1 - base);
    const nodeW = Math.max(130, Math.floor((W - PAD * 2 - RAIL - (cols - 1) * GAP) / cols));
    const colX = c => PAD + RAIL + (c - base) * (nodeW + GAP);
    const width = Math.max(W, colX(cols - 1 + base) + nodeW + PAD);
    const H = PAD + 20 + leaf * SLOT;
    const root = svg('svg', { width, height: H, viewBox: `0 0 ${width} ${H}`, class: 'tl dg', role: 'img', 'aria-label': mode === 'timeline' ? 'Orchestrator decisions, prompt by prompt' : 'Orchestrator decision tree' });
    const headers = mode === 'timeline' ? ['prompt and what the main thread did', 'agent or team', 'each agent in the team'] : ['', 'what the main thread did', 'agent or team', 'outcome', 'each agent'];
    root.append(...headers.slice(0, cols).map((t, i) => (t ? svg('text', { x: colX(i + base), y: PAD + 6, class: 'dg-meta' }, t) : null)).filter(Boolean));
    const onDelegated = n => n === tree || n.label === 'delegated' || n.items.every(x => x.action === 'delegated');
    if (mode === 'timeline') {
      const ys = tree.children.map(c => c.y + NODE_H / 2);
      const rx = PAD + 5;
      root.append(svg('line', { x1: rx, x2: rx, y1: ys[0], y2: ys[ys.length - 1], class: 'dg-rail' }));
      tree.children.forEach((c, i) =>
        root.append(svg('line', { x1: rx, x2: colX(1), y1: ys[i], y2: ys[i], class: 'dg-rail' }), svg('circle', { cx: rx, cy: ys[i], r: 4.5, class: `dg-rail-dot${c.prompt.action === 'delegated' ? ' gold' : ''}` }))
      );
    }
    const toggle = (n, refocus) => {
      open[n.key] = !isOpen(n);
      hideHover();
      drawDecisions(host, d);
      if (!refocus) return;
      const g = [...host.querySelectorAll('.dg-decision')].find(x => x.dataset.key === n.key);
      if (g) g.focus();
    };
    const drawNode = n => {
      if (n === tree && base) {
        n.children.forEach(drawNode);
        return;
      }
      if (isOpen(n))
        for (const c of n.children) {
          const w = Math.max(1.5, (c.items.length / total) * 22);
          const x1 = colX(n.depth) + nodeW;
          const x2 = colX(c.depth);
          const y1 = n.y + NODE_H / 2;
          const y2 = c.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          root.append(svg('path', { d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`, class: `dg-flow${onDelegated(c) ? ' gold' : ''}`, 'stroke-width': w }));
          drawNode(c);
        }
      const x0 = colX(n.depth);
      if (n.agent) {
        const a = n.agent;
        const g = svg(
          'g',
          { class: 'dg-agent' },
          svg('rect', { x: x0, y: n.y, width: nodeW, height: NODE_H, rx: 5, class: `dg-node${a.status === 'failed' ? ' failed' : a.status === 'unknown' ? ' silent' : ''}${selected === a.id ? ' sel' : ''}` }),
          svg('rect', { x: x0, y: n.y, width: 4, height: NODE_H, class: `dg-tone ${colors.tone(a)}` }),
          svg('text', { x: x0 + 10, y: n.y + 14, class: 'dg-label strong' }, clip(n.label, Math.floor((nodeW - 16) / 6.6))),
          svg('text', { x: x0 + 10, y: n.y + 28, class: 'dg-meta' }, clip(a.description || AGENT_STATUS[a.status], Math.floor((nodeW - 16) / 5.6)))
        );
        bindAgent(g, a, d, colors);
        root.append(g);
        return;
      }
      const fold = n.children.length > 0;
      const p = n.prompt;
      const title = p ? fmtTime(p.at) : n.title || (n.outcome ? `${n.label} · ${n.outcome}` : n.label);
      const launches = n.items.reduce((s, x) => s + x.launches, 0);
      const label = p ? `${fmtTime(p.at)} · ${DECISION_LABELS[p.action] || p.action}` : DECISION_LABELS[n.label] || n.label;
      const meta = p
        ? String(promptText.get(p.at) || '').replace(/\s+/g, ' ')
        : [n.outcome, base ? '' : `${n.items.length} ${n.items.length === 1 ? 'prompt' : 'prompts'}`, n.depth >= 2 ? `${launches} ${launches === 1 ? 'agent' : 'agents'}` : ''].filter(Boolean).join(' · ');
      const g = svg(
        'g',
        { class: 'dg-decision' },
        svg('rect', { x: x0, y: n.y, width: nodeW, height: NODE_H, rx: 5, class: `dg-node${n === tree ? ' main' : ''}${n.label === 'delegated' || (p && p.action === 'delegated') ? ' gold' : ''}` }),
        svg('text', { x: x0 + 8, y: n.y + 14, class: 'dg-label strong' }, clip(label, Math.floor((nodeW - (fold ? 28 : 14)) / 6.6))),
        svg('text', { x: x0 + 8, y: n.y + 28, class: 'dg-meta' }, clip(meta, Math.floor((nodeW - 14) / 5.6))),
        fold ? svg('text', { x: x0 + nodeW - 8, y: n.y + 16, class: 'dg-fold', 'text-anchor': 'end' }, isOpen(n) ? '▾' : '▸') : null
      );
      g.dataset.key = n.key;
      g.addEventListener('mouseenter', e => placeCard(`decision:${n.key}`, () => decisionCard(title, n.items, d), { x: e.clientX, y: e.clientY }));
      g.addEventListener('mousemove', e => placeCard(`decision:${n.key}`, () => decisionCard(title, n.items, d), { x: e.clientX, y: e.clientY }));
      g.addEventListener('mouseleave', hideHover);
      if (fold) {
        g.setAttribute('tabindex', '0');
        g.setAttribute('role', 'button');
        g.setAttribute('aria-expanded', isOpen(n) ? 'true' : 'false');
        g.setAttribute('aria-label', `${title}, ${n.items.length} ${n.items.length === 1 ? 'prompt' : 'prompts'}`);
        g.addEventListener('click', () => toggle(n));
        g.addEventListener('keydown', e => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          toggle(n, true);
        });
      }
      root.append(g);
    };
    drawNode(tree);
    const modes = modeSwitch(host, DECISION_MODES, mode, 'Decision views', id => {
      state.decisionMode = id;
      drawDecisions(host, d);
    });
    host.replaceChildren(modes, root);
  }

  function drawConcurrency(host, d) {
    const W = widthOf(host, 480);
    const colors = colorsOf(d);
    const LEFT = 36;
    const TOP = AXIS + 8;
    const PLOT = 170;
    const bottom = TOP + PLOT;
    const H = bottom + 26;
    const { x, grid } = timeAxis(d, LEFT, W, 14);
    const runs = d.agents.filter(a => typeof a.start === 'number' && endOfAgent(a) > a.start);
    const cuts = [...new Set(runs.flatMap(a => [a.start, endOfAgent(a)]))].sort((p, q) => p - q);
    const steps = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const t = cuts[i];
      const by = new Map();
      for (const a of runs) if (a.start <= t && endOfAgent(a) > t) by.set(a.type, (by.get(a.type) || 0) + 1);
      const n = [...by.values()].reduce((s, v) => s + v, 0);
      if (n) steps.push({ a: t, b: cuts[i + 1], by, n });
    }
    const max = Math.max(1, ...steps.map(s => s.n));
    const yOf = n => bottom - (n / max) * PLOT;
    const root = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'tl dg', role: 'img', 'aria-label': 'Agents running over time' });
    grid(root, TOP, bottom);
    const tick = max <= 6 ? 1 : max <= 12 ? 2 : 5;
    for (let n = 0; n <= max; n += tick) {
      root.append(svg('line', { x1: LEFT, x2: W - 14, y1: yOf(n), y2: yOf(n), class: 'dg-hgrid' }), svg('text', { x: LEFT - 6, y: yOf(n) + 4, class: 'tl-axis', 'text-anchor': 'end' }, String(n)));
    }
    // One rounded bar per run in its agent's color. A run takes the lowest lane free at its start and keeps it
    // until it ends, so the bars never move and the height is the number of agents running.
    const ordered = [...runs].sort((p, q) => p.start - q.start || endOfAgent(q) - endOfAgent(p));
    const laneEnds = [];
    const pill = (x0, x1, y0, y1) => {
      const r = Math.min(10, (x1 - x0) / 2, (y1 - y0) / 2);
      return `M ${x0 + r} ${y0} H ${x1 - r} A ${r} ${r} 0 0 1 ${x1} ${y0 + r} V ${y1 - r} A ${r} ${r} 0 0 1 ${x1 - r} ${y1} H ${x0 + r} A ${r} ${r} 0 0 1 ${x0} ${y1 - r} V ${y0 + r} A ${r} ${r} 0 0 1 ${x0 + r} ${y0} Z`;
    };
    for (const a of ordered) {
      let lane = laneEnds.findIndex(e => e <= a.start);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = endOfAgent(a);
      const d0 = pill(x(a.start), Math.max(x(endOfAgent(a)), x(a.start) + 2), yOf(lane + 1) + 2, yOf(lane) - 2);
      const tone = colors.typeTone(a.type);
      const g = svg('g', { class: 'dg-agent' }, svg('path', { d: d0, class: `dg-area ${tone}` }), svg('path', { d: d0, class: `dg-ridge ${tone}` }));
      bindAgent(g, a, d, colors);
      root.append(g);
    }
    const peak = steps.find(s => s.n === max);
    if (peak) {
      const px = x(peak.a);
      root.append(svg('line', { x1: px, x2: px, y1: yOf(max) - 4, y2: yOf(max) - 12, class: 'dg-edge' }), svg('text', { x: Math.min(px + 4, W - 120), y: yOf(max) - 14, class: 'dg-label strong' }, `Peak ${max} at ${fmtTime(peak.a)}`));
    }
    for (const p of d.prompts) root.append(svg('line', { x1: x(p.at), x2: x(p.at), y1: bottom + 6, y2: bottom + 14, class: 'dg-tick' }, svg('title', {}, `${fmtTime(p.at)} ${clip(p.text, 200)}`)));
    root.append(svg('text', { x: LEFT - 6, y: bottom + 14, class: 'tl-axis', 'text-anchor': 'end' }, 'prompts'));
    host.replaceChildren(root);
  }

  const OUTCOMES = [
    ['done', 'reported back'],
    ['unknown', 'no report'],
    ['stopped', 'stopped'],
    ['failed', 'failed'],
    ['running', 'running'],
  ];

  function drawFlow(host, d) {
    const W = widthOf(host, 560);
    const colors = colorsOf(d);
    const PAD = 12;
    const BAR = 12;
    const GAP = 12;
    const MIN_SLOT = 30;
    const mids = [{ key: 'main', label: 'Main thread', tone: 'tone-main', tokens: tokensOf(d.usage), cost: d.usage.cost || 0, out: new Map() }];
    for (const type of colors.types) {
      const agents = d.agents.filter(a => a.type === type);
      const out = new Map();
      for (const a of agents) out.set(a.status, (out.get(a.status) || 0) + tokensOf(a.usage));
      mids.push({ key: type, label: shortType(type), tone: colors.typeTone(type), tokens: agents.reduce((s, a) => s + tokensOf(a.usage), 0), cost: agents.reduce((s, a) => s + (a.usage.cost || 0), 0), out, count: agents.length });
    }
    const total = mids.reduce((s, m) => s + m.tokens, 0);
    if (!total) {
      host.replaceChildren(el('div', { className: 'empty flush dg-empty' }, 'No token usage recorded.'));
      return;
    }
    const rights = OUTCOMES.map(([status, label]) => ({ status, label, tokens: mids.reduce((s, m) => s + (m.out.get(status) || 0), 0), count: d.agents.filter(a => a.status === status).length })).filter(r => r.count);
    const k = 260 / total;
    const hOf = t => Math.max(2, t * k);
    const stack = list => {
      let y = PAD + 18;
      for (const n of list) {
        n.h = hOf(n.tokens);
        n.y = y;
        y += Math.max(n.h, MIN_SLOT) + GAP;
      }
      return y;
    };
    const H = Math.max(stack(mids), stack(rights), PAD + 18 + 260) + PAD;
    const xL = PAD + 96;
    const xM = Math.round(W * 0.36);
    const xMend = xM + BAR + 150;
    const xR = W - PAD - 150;
    const left = { y: PAD + 18, h: Math.max(hOf(total), 4) };
    const root = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'tl dg', role: 'img', 'aria-label': 'Token flow' });
    const band = (x1, a1, b1, x2, a2, b2, cls, tip) => {
      const mx = (x1 + x2) / 2;
      root.append(svg('path', { d: `M ${x1} ${a1} C ${mx} ${a1}, ${mx} ${a2}, ${x2} ${a2} L ${x2} ${b2} C ${mx} ${b2}, ${mx} ${b1}, ${x1} ${b1} Z`, class: `dg-band ${cls}` }, svg('title', {}, tip)));
    };
    let lo = left.y;
    for (const m of mids) {
      const h = m.tokens * k;
      band(xL + BAR, lo, lo + h, xM, m.y, m.y + h, m.tone, `${m.label}: ${fmtNum(m.tokens)} tokens`);
      lo += h;
    }
    const rOff = new Map(rights.map(r => [r.status, r.y]));
    for (const m of mids) {
      let mo = m.y;
      for (const r of rights) {
        const t = m.out.get(r.status) || 0;
        if (!t) continue;
        const h = t * k;
        root.append(svg('rect', { x: xM + BAR, y: mo, width: xMend - xM - BAR, height: Math.max(h, 1), class: `dg-band faint ${m.tone}` }));
        band(xMend, mo, mo + h, xR, rOff.get(r.status), rOff.get(r.status) + h, m.tone, `${m.label} → ${r.label}: ${fmtNum(t)} tokens`);
        rOff.set(r.status, rOff.get(r.status) + h);
        mo += h;
      }
    }
    root.append(
      svg('rect', { x: xL, y: left.y, width: BAR, height: left.h, class: 'dg-bar tone-ink' }),
      svg('text', { x: xL - 6, y: left.y + 14, class: 'dg-label strong', 'text-anchor': 'end' }, 'Session'),
      svg('text', { x: xL - 6, y: left.y + 28, class: 'dg-meta', 'text-anchor': 'end' }, `${fmtNum(total)} tokens`)
    );
    for (const m of mids)
      root.append(
        svg('rect', { x: xM, y: m.y, width: BAR, height: m.h, class: `dg-bar ${m.tone}` }),
        svg('text', { x: xM + BAR + 6, y: m.y + 12, class: 'dg-label strong' }, m.label + (m.count ? ` · ${m.count}` : '')),
        svg('text', { x: xM + BAR + 6, y: m.y + 25, class: 'dg-meta' }, `${fmtNum(m.tokens)} · ${fmtUsd(m.cost)}${m.key === 'main' ? ' · not delegated' : ''}`)
      );
    for (const r of rights)
      root.append(
        svg('rect', { x: xR, y: r.y, width: BAR, height: r.h, class: `dg-bar ${r.status === 'failed' ? 'tone-bad' : r.status === 'done' ? 'tone-ok' : 'tone-muted'}` }),
        svg('text', { x: xR + BAR + 6, y: r.y + 12, class: 'dg-label strong' }, `${r.label} · ${r.count}`),
        svg('text', { x: xR + BAR + 6, y: r.y + 25, class: 'dg-meta' }, `${fmtNum(r.tokens)} tokens`)
      );
    host.replaceChildren(root);
  }

  function drawScatter(host, d) {
    const W = widthOf(host, 480);
    const colors = colorsOf(d);
    const selected = state.session && state.session.selected;
    const pts = d.agents
      .map(a => ({ a, rt: typeof a.start === 'number' && a.end ? a.end - a.start : 0, tok: a.usage.input + a.usage.cacheCreate + a.usage.cacheRead, tools: Object.values(a.tools).reduce((n, v) => n + v, 0) }))
      .filter(p => p.rt > 0 && p.tok > 0);
    if (!pts.length) {
      host.replaceChildren(el('div', { className: 'empty flush dg-empty' }, 'No agent with run time and tokens to plot.'));
      return;
    }
    const L = 58;
    const R = 16;
    const T = 16;
    const B = 34;
    const H = 320;
    const lg = Math.log10;
    const span = (vals, pad) => [lg(Math.min(...vals) / pad), lg(Math.max(...vals) * pad)];
    const [x0, x1] = span(pts.map(p => p.rt), 1.6);
    const [y0, y1] = span(pts.map(p => p.tok), 1.6);
    const sx = v => L + ((lg(v) - x0) / Math.max(0.001, x1 - x0)) * (W - L - R);
    const sy = v => H - B - ((lg(v) - y0) / Math.max(0.001, y1 - y0)) * (H - T - B);
    const root = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'tl dg', role: 'img', 'aria-label': 'Agents by run time and tokens' });
    const XT = [1, 5, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400].map(s => s * 1000);
    let last = -Infinity;
    for (const t of XT) {
      if (lg(t) < x0 || lg(t) > x1) continue;
      const xx = sx(t);
      root.append(svg('line', { x1: xx, x2: xx, y1: T, y2: H - B, class: 'dg-hgrid' }));
      if (xx - last > 46) {
        root.append(svg('text', { x: xx, y: H - B + 16, class: 'tl-axis', 'text-anchor': 'middle' }, fmtDur(t)));
        last = xx;
      }
    }
    for (let e = Math.ceil(y0); e <= Math.floor(y1); e++) {
      const v = 10 ** e;
      root.append(svg('line', { x1: L, x2: W - R, y1: sy(v), y2: sy(v), class: 'dg-hgrid' }), svg('text', { x: L - 6, y: sy(v) + 4, class: 'tl-axis', 'text-anchor': 'end' }, fmtNum(v)));
    }
    root.append(svg('text', { x: L, y: H - 4, class: 'dg-meta' }, 'run time (log)'), svg('text', { x: 4, y: T - 4, class: 'dg-meta' }, 'tokens in, incl. cache (log)'));
    const median = vals => {
      const s = [...vals].sort((p, q) => p - q);
      return s[Math.floor(s.length / 2)];
    };
    const mx = median(pts.map(p => p.rt));
    const my = median(pts.map(p => p.tok));
    root.append(svg('line', { x1: sx(mx), x2: sx(mx), y1: T, y2: H - B, class: 'dg-median' }), svg('line', { x1: L, x2: W - R, y1: sy(my), y2: sy(my), class: 'dg-median' }));
    // Circle area follows the agent's cost; the costliest is drawn first so smaller ones stay on top.
    const costOf = p => p.a.usage.cost || 0;
    const maxCost = Math.max(0, ...pts.map(costOf));
    for (const p of [...pts].sort((p, q) => costOf(q) - costOf(p))) {
      const r = 4 + (maxCost ? Math.sqrt(costOf(p) / maxCost) : 0) * 18;
      const g = svg('g', { class: 'dg-agent' }, svg('circle', { cx: sx(p.rt), cy: sy(p.tok), r, class: `dg-dot ${colors.tone(p.a)}${selected === p.a.id ? ' sel' : ''}` }));
      g.append(svg('text', { x: sx(p.rt) + r + 4, y: sy(p.tok) + 4, class: 'dg-label' }, laneName(p.a)));
      bindAgent(g, p.a, d, colors);
      root.append(g);
    }
    host.replaceChildren(root);
  }

  const SESSION_VIEWS = [
    ['timeline', 'Timeline', 'graph-line', 'When each agent ran, next to your prompts.'],
    ['map', 'Delegation map', 'list-tree', 'Who started which agent, and which agents worked as a team.'],
    ['decisions', 'Decisions', 'type-hierarchy', 'What happened after each prompt: handed to agents, done directly, or just answered.'],
    ['concurrency', 'Concurrency', 'pulse', 'How many agents were busy at the same time.'],
    ['flow', 'Token flow', 'git-merge', 'Where the tokens went: the main thread or the agents, and whether their work came back.'],
    ['scatter', 'Scatter', 'graph-scatter', 'Every agent by time and tokens, so the slow or costly ones stand out.'],
  ];
  const tabTip = (label, glyph, text) => el('div', { className: 'hc hc-tip' }, el('div', { className: 'hc-head' }, icon(glyph), el('span', { className: 'hc-type' }, label)), el('div', { className: 'hc-text' }, text));
  const currentView = () => (SESSION_VIEWS.some(v => v[0] === state.sessionView) ? state.sessionView : 'timeline');
  const drawView = (host, d) => ({ timeline: drawTimeline, map: drawMap, decisions: drawDecisions, concurrency: drawConcurrency, flow: drawFlow, scatter: drawScatter })[currentView()](host, d);

  // Legend under each diagram: the marks it uses, in a few words each.
  function viewLegend(d) {
    const colors = colorsOf(d);
    const types = colors.types.map(type => el('span', { className: 'legend-item' }, el('span', { className: `swatch ${colors.typeTone(type)}` }), shortType(type)));
    const fact = text => el('span', { className: 'legend-item muted' }, text);
    const main = el('span', { className: 'legend-item' }, el('span', { className: 'swatch tone-main' }), 'main thread');
    const parts = {
      timeline: [...types, el('span', { className: 'legend-break' }), fact('● prompt'), fact('○ result'), fact('▼ message'), el('span', { className: 'legend-item' }, el('span', { className: 'stop-glyph', 'aria-hidden': 'true' }, '×'), 'stopped')],
      map: [main, ...types],
      decisions: [fact('one prompt = the time until the next prompt'), fact('line width: prompts'), fact('gold: delegated'), fact('▸ click to drill down, ▾ to collapse')],
      concurrency: [...types, fact('height: agents running'), fact('one bar per agent run'), fact('ticks: prompts')],
      flow: [main, ...types, fact('width: tokens in, cache and out')],
      scatter: [...types, fact('size: cost'), fact('dashed: medians'), fact('log scales')],
    };
    return parts[currentView()];
  }

  function viewTabs(d, host, legend) {
    const tabs = el('div', { className: 'view-tabs', role: 'tablist', 'aria-label': 'Session views' });
    const buttons = SESSION_VIEWS.map(([id, label, glyph, about]) => {
      const tip = target => {
        const r = target.getBoundingClientRect();
        placeCard(`tab:${id}`, () => tabTip(label, glyph, about), { x: r.left - 14, y: r.bottom - 6 });
      };
      return el(
        'button',
        {
          className: 'view-tab',
          role: 'tab',
          'data-view': id,
          'aria-description': about,
          onclick: () => setView(id),
          onmouseenter: e => tip(e.currentTarget),
          onmouseleave: hideHover,
          onfocus: e => tip(e.currentTarget),
          onblur: hideHover,
        },
        icon(glyph),
        el('span', {}, label)
      );
    });
    const sync = () =>
      buttons.forEach(b => {
        const on = b.dataset.view === currentView();
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.setAttribute('tabindex', on ? '0' : '-1');
      });
    const setView = id => {
      state.sessionView = id;
      persist();
      sync();
      hideHover();
      drawView(host, d);
      legend.replaceChildren(...viewLegend(d));
    };
    tabs.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const i = SESSION_VIEWS.findIndex(v => v[0] === currentView());
      const next = SESSION_VIEWS[(i + (e.key === 'ArrowRight' ? 1 : SESSION_VIEWS.length - 1)) % SESSION_VIEWS.length][0];
      setView(next);
      buttons.find(b => b.dataset.view === next).focus();
    });
    tabs.append(...buttons);
    sync();
    return tabs;
  }

  const selectAgent = (id, refocus) => {
    if (!state.session || !state.session.data) return;
    state.session.selected = state.session.selected === id ? undefined : id;
    const host = app.querySelector('.timeline');
    if (host) drawView(host, state.session.data);
    if (host && refocus) {
      const lane = [...host.querySelectorAll('.tl-lane')].find(g => g.dataset.agent === id);
      if (lane) lane.focus();
    }
    const detail = app.querySelector('.agent-detail');
    if (detail) detail.replaceWith(renderAgent(state.session.data));
  };

  const fmtUsd = v => (v <= 0 ? '$0' : v < 0.01 ? '<$0.01' : v < 1000 ? `$${v.toFixed(2)}` : `$${Math.round(v).toLocaleString()}`);
  const fmtShare = (v, grant) => {
    const p = (v / grant) * 100;
    return p <= 0 ? '0%' : p < 0.01 ? '<0.01%' : `${p < 10 ? p.toFixed(2) : p < 100 ? p.toFixed(1) : Math.round(p)}%`;
  };
  const COST_KINDS = [
    ['cacheRead', 'Cache reads'],
    ['cacheWrite', 'Cache writes'],
    ['output', 'Output'],
    ['input', 'Input'],
  ];
  // Weekly limits valued at API list prices. Anthropic publishes none: Max 5x from botfarm.run (March 2026),
  // Max 20x and Team Premium from wokey.ai (accounts measured 2026-10-12 to 2026-10-19). API billing has no grant.
  // Two figures are derived, not measured: Pro is one fifth of Max 5x (about 105) and Team Standard one fifth of
  // Team Premium (about 172), because claude.com/pricing sells Max 5x at 5 times Pro and Premium at 5 times Standard.
  // The ids and figures match PLANS in src/sessions.ts, which a unit test compares. Keep `api` last.
  const BILLING = [
    ['pro', 'Pro', 'account', 105],
    ['max5', 'Max 5x', 'dashboard', 523],
    ['max20', 'Max 20x', 'rocket', 1643],
    ['team-standard', 'Team Standard', 'organization', 172],
    ['team', 'Team Premium', 'organization', 861],
    ['api', 'API billing', 'credit-card', 0],
  ];
  const TEAM_PLANS = new Set(['team', 'team-standard']);
  const billingAbout = (label, grant) => (grant ? `This session as a share of one ${label} weekly limit, which measures at about $${grant.toLocaleString()} of API list prices.` : 'This session at Anthropic API list prices.');

  function costBar(parts, total, label, fmt) {
    const bar = el('div', { className: 'cost-bar', role: 'img', 'aria-label': `${label}: ${parts.map(p => `${p.label} ${fmt(p.cost)}`).join(', ')}` });
    for (const p of parts) {
      if (p.cost <= 0) continue;
      const seg = el('span', { className: `swatch cost-seg ${p.tone}`, title: `${p.label}: ${fmt(p.cost)} (${Math.round((p.cost / total) * 100)}%)` });
      seg.style.width = `${(p.cost / total) * 100}%`;
      bar.append(seg);
    }
    return bar;
  }

  const costLegend = (parts, total, fmt) =>
    el(
      'div',
      { className: 'cost-legend' },
      parts
        .filter(p => p.cost > 0)
        .map(p =>
          el('span', { className: 'cost-item' }, el('span', { className: `swatch ${p.tone}` }), el('span', { className: 'cost-name' }, p.label), el('b', {}, fmt(p.cost)), el('span', { className: 'cost-pct' }, `${Math.round((p.cost / total) * 100)}%`))
        )
    );

  // Cost row: the session total, split by who spent it and by what it was spent on.
  // A subscription plan shows every amount as a share of that plan's weekly limit, API billing in dollars.
  function renderCost(d, colors) {
    const byType = new Map();
    for (const a of d.agents) byType.set(a.type, (byType.get(a.type) || 0) + (a.usage.cost || 0));
    const spenders = [{ label: 'Main thread', tone: 'tone-main', cost: d.usage.cost || 0 }, ...[...byType.entries()].sort((x, y) => y[1] - x[1]).map(([type, cost]) => ({ label: shortType(type), tone: colors.typeTone(type), cost }))];
    const total = spenders.reduce((n, p) => n + p.cost, 0);
    const kindTotals = COST_KINDS.map(([key, label]) => ({
      label,
      tone: `kind-${key}`,
      cost: [d.usage, ...d.agents.map(a => a.usage)].reduce((n, u) => n + ((u.costParts || {})[key] || 0), 0),
    }));
    // The plan set for the session's account in the settings is the default; a click on the switch overrides it.
    const billingId = state.billingPick || (BILLING.some(b => b[0] === d.plan) ? d.plan : state.billing);
    const [, planLabel, , grant] = BILLING.find(b => b[0] === billingId) || BILLING[BILLING.length - 1];
    const fmt = grant ? v => fmtShare(v, grant) : fmtUsd;
    const plans = modeSwitch(
      app,
      BILLING.map(([id, label, glyph, g]) => [id, label, glyph, billingAbout(label, g)]),
      billingId,
      'Billing',
      id => {
        state.billing = id;
        state.billingPick = id;
        card.replaceWith(renderCost(d, colors));
      }
    );
    const card = el(
      'div',
      { className: 'cost-card' },
      el(
        'div',
        { className: 'cost-head' },
        el('div', {}, el('div', { className: 'cost-k' }, grant ? 'Weekly limit used' : 'Estimated cost'), el('div', { className: 'cost-v' }, fmt(total), grant ? '*' : '')),
        plans,
        el(
          'div',
          { className: 'cost-basis' },
          grant
            ? [
                billingAbout(planLabel, grant),
                el('div', {}, '* Not exact prices: Anthropic publishes no figure for a weekly limit, so this is an estimate.'),
                TEAM_PLANS.has(billingId) ? el('div', {}, 'Team plans expose no rate limits to Claude Code, so the share cannot be read from the status line.') : null,
              ]
            : 'At Anthropic API list prices for the tokens in this session and its agents. A Claude subscription bills differently.'
        )
      ),
      total > 0
        ? [
            el('div', { className: 'cost-row' }, el('div', { className: 'cost-label' }, 'Who spent it'), costBar(spenders, total, 'Cost by thread', fmt), costLegend(spenders, total, fmt)),
            el('div', { className: 'cost-row' }, el('div', { className: 'cost-label' }, 'Spent on'), costBar(kindTotals, total, 'Cost by token kind', fmt), costLegend(kindTotals, total, fmt)),
          ]
        : el('div', { className: 'empty flush' }, 'No priced model usage in this session.')
    );
    return card;
  }

  const STYLE_MODELS = [
    ['sonnet', 'Sonnet'],
    ['opus', 'Opus'],
    ['haiku', 'Haiku'],
  ];
  const STYLE_KINDS = { length: 'Length', format: 'Format', language: 'Language', repetition: 'Repetition', asking: 'Asking' };

  // Output style: what the transcript says about how replies should read, and Claude drafting a style from it.
  function renderStyle(d) {
    const s = state.session;
    const scan = d.style;
    if (!scan) return null;
    const r = scan.replies;
    const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const draft = s.styleDraft || { state: 'idle' };
    const running = draft.state === 'running';
    const facts = [
      `Active: ${scan.active.length ? scan.active.join(', ') : 'default'}`,
      count(scan.prompts, 'prompt', 'prompts'),
      count(scan.corrections.length, 'correction', 'corrections'),
      count(scan.interrupts, 'interrupt', 'interrupts'),
      `${count(r.count, 'reply', 'replies')}: median ${r.medianWords} words, longest ${r.longest}`,
      `${r.headings} with headings, ${r.tables} with tables, ${r.lists} with lists`,
    ];
    return el(
      'div',
      { className: 'recent' },
      el('div', { className: 'group-label' }, 'Output style'),
      el('div', { className: 'legend' }, facts.map(t => el('span', { className: 'legend-item muted' }, t))),
      scan.corrections.length
        ? scan.corrections.map(c => el('div', { className: 'row style-row' }, el('span', { className: 'style-kind' }, STYLE_KINDS[c.kind] || c.kind), el('span', { className: 'name wrap' }, c.text)))
        : el('div', { className: 'empty flush' }, 'No corrections about length, format, language or repetition in this session.'),
      el(
        'div',
        { className: 'style-draft' },
        el(
          'select',
          {
            'aria-label': 'Model',
            disabled: running,
            onchange: e => {
              state.styleModel = e.target.value;
              persist();
            },
          },
          STYLE_MODELS.map(([id, label]) => el('option', { value: id, selected: state.styleModel === id }, label))
        ),
        el(
          'button',
          { className: 'primary', disabled: running, onclick: () => vscode.postMessage({ type: 'draftStyle', scope: s.scope, id: s.id, model: state.styleModel }) },
          running ? el('span', { className: 'codicon codicon-loading codicon-modifier-spin' }) : icon('sparkle'),
          running ? 'Drafting...' : 'Draft output style'
        ),
        draft.state === 'done'
          ? el('button', { className: 'link', onclick: () => openAt(draft.file) }, `Drafted ${draft.file.split(/[\\/]/).pop()}`)
          : draft.state === 'error'
            ? el('span', { className: 'style-error' }, draft.error)
            : null
      )
    );
  }

  function renderSession() {
    const s = state.session;
    const d = s.data;
    const view = viewOf(s.scope);
    const back = iconBtn('arrow-left', `Back to ${view ? view.label : 'the repo'}`, () => showRepo(s.scope));
    const reload = iconBtn('refresh', 'Read the transcript again', () => {
      s.data = undefined;
      vscode.postMessage({ type: 'session', scope: s.scope, id: s.id });
      renderMain();
    });
    if (state.timelineObserver) state.timelineObserver.disconnect();
    hideHover();
    if (!d || d.error)
      return el('section', { className: 'main' }, pageHead('type-hierarchy-sub', 'Session', view ? view.label : '', back, reload), el('div', { className: 'main-body' }, el('div', { className: 'empty flush' }, d ? d.error : 'Reading the transcript...')));
    const sub = [d.repo, d.start ? `${fmtDate(d.start)} to ${fmtTime(d.end)}` : '', d.start ? fmtDur(d.end - d.start) : '', d.branch, shortModel(d.model), d.live].filter(Boolean).join(' · ');
    const colors = colorsOf(d);
    const usages = [d.usage, ...d.agents.map(a => a.usage)];
    const sum = key => usages.reduce((n, u) => n + (u[key] || 0), 0);
    const totalCost = sum('cost');
    const agentCost = totalCost - (d.usage.cost || 0);
    const inputAll = sum('input') + sum('cacheCreate') + sum('cacheRead');
    const failed = d.agents.filter(a => a.status === 'failed').length;
    const silent = d.agents.filter(a => a.status === 'unknown' || a.status === 'stopped').length;
    const pct = v => `${Math.round(v * 100)}%`;
    const kpis = [
      [String(d.agents.length), 'Agents', 'type-hierarchy-sub', failed ? `${failed} failed` : silent ? `${silent} without a report` : d.agents.length ? 'all reported back' : 'none started', failed || silent ? 'warn' : ''],
      [String(peakParallel(d.agents)), 'Peak parallel', 'layers', 'agents running at the same time'],
      [totalCost ? pct(agentCost / totalCost) : '0%', 'Delegated', 'arrow-swap', 'of the cost ran in agents'],
      [inputAll ? pct(sum('cacheRead') / inputAll) : '0%', 'Cache hits', 'database', 'of input tokens read from cache'],
    ];
    const timeline = el('div', { className: 'timeline', onmouseleave: hideHover });
    const legend = el('div', { className: 'legend below' }, viewLegend(d));
    const observer = new ResizeObserver(() => {
      if (timeline.isConnected) drawView(timeline, d);
    });
    observer.observe(timeline);
    state.timelineObserver = observer;
    const exportBtn = iconBtn('export', 'Export the transcript as JSONL', () => vscode.postMessage({ type: 'exportSession', scope: s.scope, id: s.id }));
    const head = pageHead('type-hierarchy-sub', clip(d.title, 140), sub, back, exportBtn, reload);
    head.classList.add('session-head');
    head.querySelector('h1').setAttribute('title', d.title);
    return el(
      'section',
      { className: 'main' },
      head,
      el(
        'div',
        { className: 'main-body', onscroll: hideHover },
        renderCost(d, colors),
        el(
          'div',
          { className: 'kpis' },
          kpis.map(([n, l, i, note, tone]) =>
            el('div', { className: 'tile static' }, el('span', { className: 'n' }, n), el('span', { className: 'l' }, icon(i), l), el('span', { className: `kpi-note${tone ? ` ${tone}` : ''}` }, note))
          )
        ),
        el(
          'div',
          { className: 'recent' },
          el('div', { className: 'group-label' }, 'Delegation'),
          viewTabs(d, timeline, legend),
          timeline,
          legend
        ),
        renderAgent(d),
        d.findings.length
          ? el(
              'div',
              { className: 'recent' },
              el('div', { className: 'group-label' }, `Findings (${d.findings.length})`),
              d.findings.map(f =>
                el(
                  'div',
                  { className: 'row', onclick: f.agent ? () => selectAgent(f.agent) : undefined },
                  el('span', { className: `check-badge ${f.level === 'warn' ? 'warn' : 'muted'}` }, icon(f.level === 'warn' ? 'warning' : 'info')),
                  el('span', { className: 'name wrap' }, f.text)
                )
              )
            )
          : null,
        renderStyle(d),
        d.children.length
          ? el(
              'div',
              { className: 'recent' },
              el('div', { className: 'group-label' }, `Headless runs (${d.children.length})`),
              d.children.map(c =>
                el('div', { className: 'row', title: c.file, onclick: () => showSession(s.scope, c.id) }, icon('terminal'), el('span', { className: 'name' }, c.title), el('span', { className: 'desc' }, sessionDesc(c)))
              )
            )
          : null
      )
    );
  }

  function renderMain() {
    const repo = state.repo && viewOf(state.repo);
    const main = state.detail
      ? renderDetail()
      : state.page === 'fleet'
        ? renderFleet()
        : state.page === 'session' && state.session
          ? renderSession()
        : state.page === 'sessions' && state.sessionsPage
          ? renderSessionsPage()
        : state.page === 'marketplaces'
          ? renderMarkets()
          : state.page === 'init' && state.init
            ? renderInit()
            : repo
              ? renderRepo(repo)
              : renderOverview();
    const current = app.querySelector('.main');
    current ? current.replaceWith(main) : app.append(main);
  }

  function render() {
    const scroll = app.querySelector('.list') ? app.querySelector('.list').scrollTop : 0;
    app.replaceChildren(renderSidebar());
    renderMain();
    app.querySelector('.list').scrollTop = scroll;
  }

  window.addEventListener('message', e => {
    const m = e.data;
    if (m.type === 'state') {
      state.views = m.views || (m.categories ? [{ id: 'global', label: 'Global', path: '', categories: m.categories }] : []);
      const before = state.checks;
      state.checks = m.checks || {};
      state.standard = m.standard;
      const scroll = app.querySelector('.list') ? app.querySelector('.list').scrollTop : 0;
      const sidebar = renderSidebar();
      const current = app.querySelector('.sidebar');
      current ? current.replaceWith(sidebar) : render();
      app.querySelector('.list').scrollTop = scroll;
      if (state.repo && before[state.repo] && state.checks[state.repo] && before[state.repo].state !== state.checks[state.repo].state && !['running', 'unchecked'].includes(state.checks[state.repo].state))
        vscode.postMessage({ type: 'effective', scope: state.repo });
      if (state.page === 'fleet' && !state.detail) {
        clearTimeout(state.fleetTimer);
        state.fleetTimer = setTimeout(() => vscode.postMessage({ type: 'fleet' }), 400);
      }
      if (current && !state.detail && (state.repo || state.page === 'fleet')) renderMain();
    } else if (m.type === 'page') {
      if (m.page === 'session' && m.repo && m.session) showSession(m.repo, m.session);
      else if (m.repo) {
        state.openRepos.add(m.repo);
        persist();
        state.effective[m.repo] = undefined;
        showRepo(m.repo);
      } else if (m.page) showPage(m.page, m.dir);
    } else if (m.type === 'fleet') {
      state.fleet = m.rows;
      if (state.page === 'fleet' && !state.detail) renderMain();
    } else if (m.type === 'marketplaces') {
      state.markets = m.list;
      if (state.page === 'marketplaces' && !state.detail) renderMain();
    } else if (m.type === 'sessions') {
      state.sessions[m.scope] = m.list || [];
      refreshCard(`repo:${m.scope}`);
      const current = app.querySelector('.sidebar');
      if (current) {
        const scroll = app.querySelector('.list').scrollTop;
        current.replaceWith(renderSidebar());
        app.querySelector('.list').scrollTop = scroll;
      }
      if (!state.detail && !state.page && state.repo === m.scope) renderMain();
      if (!state.detail && state.page === 'sessions' && state.sessionsPage && state.sessionsPage.scope === m.scope && state.sessionsPage.refresh) state.sessionsPage.refresh();
    } else if (m.type === 'session') {
      if (state.session && state.session.scope === m.scope && state.session.id === m.id) {
        state.session.data = m.data;
        if (state.page === 'session' && !state.detail) renderMain();
      }
    } else if (m.type === 'styleDraft') {
      if (state.session && state.session.scope === m.scope && state.session.id === m.id) {
        state.session.styleDraft = m;
        if (state.page === 'session' && !state.detail) renderMain();
      }
    } else if (m.type === 'effective') {
      state.effective[m.scope] = m.data || { effective: { memory: [], rules: [], plugins: [], hooks: [] } };
      if (!state.detail && state.repo === m.scope) renderMain();
    } else if (m.type === 'ruleInfo') {
      state.ruleInfo[m.id] = m.info || { globs: [], base: '' };
      if (state.detail && state.detail.asset.id === m.id) renderMain();
    } else if (m.type === 'initForm') {
      if (state.init && state.init.dir === m.dir) {
        state.init.data = m.data || { agents: [] };
        if (state.page === 'init' && !state.detail) renderMain();
      }
    } else if (m.type === 'initResult') {
      if (state.init && state.init.dir === m.dir) {
        state.init.result = m.data;
        state.init.applied = !!m.apply && m.data && !m.data.error;
        if (!m.apply) state.init.previewKey = state.init.pendingKey;
        if (state.page === 'init' && !state.detail) renderMain();
      }
    } else if (m.type === 'mcpInfo') {
      state.mcpInfo[m.id] = m.info;
      if (state.detail && state.detail.asset.id === m.id) renderMain();
    } else if (m.type === 'tools') {
      if (!state.draft || !state.detail || state.detail.asset.id !== m.id) return;
      const f = state.draft.fields.find(x => x.key === m.key);
      if (!f) return;
      f.value = m.value;
      renderMain();
    } else if (m.type === 'detail') {
      if (m.external && isDirty()) return;
      if (m.external && m.detail && state.detail && snapshot(m.detail) === snapshot(state.detail) && m.detail.asset.enabled === state.detail.asset.enabled) return;
      state.detail = m.detail;
      if (m.detail && m.detail.asset.kind === 'rule' && !m.external) state.ruleInfo[m.detail.asset.id] = undefined;
      if (m.detail) {
        state.expanded.add(`${m.detail.asset.scope || 'global'}|${m.detail.asset.kind}`);
        if (m.detail.asset.scope && m.detail.asset.scope !== 'global') state.openRepos.add(m.detail.asset.scope);
        persist();
      }
      state.draft = m.detail ? clone(m.detail) : undefined;
      render();
    }
  });

  window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
