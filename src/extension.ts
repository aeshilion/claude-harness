import { exec } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  Asset,
  addMcpServer,
  createAsset,
  jsonAt,
  marketplacePlugins,
  MCP_NAME,
  McpConfig,
  mcpAddCommand,
  splitCommandLine,
  duplicateAsset,
  globalScope,
  HarnessScope,
  Kind,
  KINDS,
  expandRepoFolders,
  knownRepos,
  linkCopies,
  McpSource,
  applyMcpState,
  parseMcpList,
  pluginDescription,
  pluginIsMod,
  removeJsonEntry,
  setMcpEnabled,
  parseMarkdown,
  renameAsset,
  repoScope,
  scan,
  ScopeView,
  setFrontmatterList,
  setPluginEnabled,
  validateName,
} from './harness';
import { HarnessPanel, PanelHost } from './panel';
import { pickTools, splitTools, TOOL_FIELDS } from './tools';
import { HarnessTree, Node } from './tree';

const WATCHED = '{CLAUDE.md,settings.json,settings.local.json,agents/**,skills/**,commands/**,output-styles/**,rules/**,workflows/**,plugins/installed_plugins.json}';

export function activate(context: vscode.ExtensionContext): void {
  let global: HarnessScope = globalScope(vscode.workspace.getConfiguration('claudeHarness').get<string>('root'));
  let scopes: HarnessScope[] = [global];
  let views: ScopeView[] = [];
  const tree = new HarnessTree();
  let watcher: vscode.FileSystemWatcher | undefined;
  let timer: NodeJS.Timeout | undefined;

  const assets = () => views.flatMap(v => v.categories.flatMap(c => c.items));
  const find = (id: string): Asset | undefined => assets().find(a => a.id === id);
  const samePath = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  const assetOfFile = (file: string) => assets().find(a => samePath(a.file, file));
  const lensesChanged = new vscode.EventEmitter<void>();
  const scopeOf = (asset: Asset) => scopes.find(s => s.id === asset.scope) ?? global;

  const loadScopes = () => {
    const folders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
    const config = vscode.workspace.getConfiguration('claudeHarness');
    const added = expandRepoFolders(config.get<string[]>('repoFolders') ?? []);
    const removed = config.get<string[]>('removedRepos') ?? [];
    const repos = knownRepos([...folders, ...added]).filter(dir => !removed.some(r => samePath(r, dir)));
    const local = (dir: string) => folders.some(f => samePath(f, dir));
    scopes = [global, ...[...repos.filter(local), ...repos.filter(dir => !local(dir))].map(dir => repoScope(dir))];
  };

  let cliServers: Asset[] = [];
  const loadCliServers = () =>
    exec('claude mcp list', { cwd: os.homedir(), timeout: 180000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (_err, stdout) => {
      const servers = parseMcpList(stdout ?? '');
      if (!servers.length) return;
      cliServers = servers.map(s => {
        const source: McpSource = s.name.startsWith('claude.ai ') ? 'claude.ai' : s.name.startsWith('plugin:') ? 'plugin' : 'user';
        const plugin = source === 'plugin' ? s.name.split(':')[1] : undefined;
        return {
          id: `${global.id}|mcp:${s.name}`,
          scope: global.id,
          kind: 'mcp',
          name: s.name,
          description: [s.target, s.status].filter(Boolean).join(' · '),
          file: '',
          mtime: 0,
          source,
          about: plugin ? pluginDescription(global.root, plugin) : undefined,
          target: s.target.replace(/\s*\((HTTP|SSE|stdio)\)$/i, ''),
          status: s.status,
        };
      });
      refresh();
    });

  const refresh = () => {
    const folders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
    views = scopes.map(s => ({ id: s.id, label: s.label, path: s.base, local: s !== global && folders.some(f => samePath(f, s.base)), categories: scan(s) }));
    const globalMcp = views[0].categories.find(c => c.kind === 'mcp');
    if (globalMcp) {
      for (const a of globalMcp.items) a.status = cliServers.find(c => c.name === a.name)?.status;
      globalMcp.items.push(...cliServers.filter(c => !globalMcp.items.some(a => a.name === c.name)).map(c => ({ ...c })));
    }
    applyMcpState(views, global.userConfig);
    linkCopies(views);
    for (const a of views.flatMap(v => v.categories.find(c => c.kind === 'plugin')?.items ?? [])) if (pluginIsMod(global.root, a.name)) a.description += ' · mod';
    tree.setCategories(views[0].categories);
    HarnessPanel.update();
    lensesChanged.fire();
  };
  const scheduleRefresh = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(refresh, 300);
  };

  const watch = () => {
    watcher?.dispose();
    watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(global.root), WATCHED));
    watcher.onDidChange(scheduleRefresh);
    watcher.onDidCreate(scheduleRefresh);
    watcher.onDidDelete(scheduleRefresh);
  };

  const host: PanelHost = { views: () => views, find, refresh };

  const assetOf = (arg: unknown): Asset | undefined => {
    if (typeof arg === 'string') return find(arg);
    const node = arg as Node | undefined;
    return node && (node.type === 'asset' || node.type === 'file') ? node.asset : undefined;
  };

  const askName = async (prompt: string, value?: string) =>
    vscode.window.showInputBox({ prompt, value, validateInput: v => validateName(v.replace(/:/g, '-')) });

  const run = (fn: () => void) => {
    try {
      fn();
      refresh();
      return true;
    } catch (e) {
      void vscode.window.showErrorMessage((e as Error).message);
      return false;
    }
  };

  const terminal = (name: string, cwd: string, text: string) => {
    const t = vscode.window.createTerminal({ name, cwd });
    t.show();
    t.sendText(text);
  };

  const cwdOf = (scope: HarnessScope) => (scope.id === global.id ? os.homedir() : scope.base);

  type ScopeItem = vscode.QuickPickItem & { scope: HarnessScope };
  const pickScope = async (arg: unknown, title: string, globalLabel = 'Global'): Promise<HarnessScope | undefined> => {
    const given = arg && typeof arg === 'object' && 'scope' in arg ? scopes.find(s => s.id === (arg as { scope?: string }).scope) : undefined;
    if (given) return given;
    if (arg && typeof arg === 'object' && 'type' in arg) return global;
    const items: ScopeItem[] = [
      ...scopes.filter(s => s.id !== global.id).map(s => ({ label: `$(repo) ${s.label}`, description: s.base, scope: s })),
      { label: `$(globe) ${globalLabel}`, scope: global },
    ];
    return (await vscode.window.showQuickPick(items, { title, matchOnDescription: true }))?.scope;
  };

  const scopeFlag = (asset: Asset): 'user' | 'project' | 'local' => (asset.source === 'project' ? 'project' : asset.source === 'local' ? 'local' : 'user');

  const showFile = (file: string) => {
    const asset = assets().find(a => a.file === file);
    if (asset) HarnessPanel.show(context, host, asset.id);
  };

  const status = vscode.window.createStatusBarItem('claudeHarness.status', vscode.StatusBarAlignment.Left, 0);
  status.name = 'Claude Harness';
  status.text = '$(hubot) Claude Harness';
  status.tooltip = 'Open the Claude harness';
  status.command = 'claudeHarness.open';
  status.show();

  const toolLenses: vscode.CodeLensProvider = {
    onDidChangeCodeLenses: lensesChanged.event,
    provideCodeLenses: doc => {
      if (!assetOfFile(doc.uri.fsPath) || doc.lineAt(0).text.trim() !== '---') return [];
      const lenses: vscode.CodeLens[] = [];
      for (let i = 1; i < doc.lineCount; i++) {
        const line = doc.lineAt(i).text;
        if (line.trim() === '---') break;
        const key = /^([A-Za-z-]+)\s*:/.exec(line)?.[1];
        if (key && TOOL_FIELDS.includes(key))
          lenses.push(new vscode.CodeLens(doc.lineAt(i).range, { title: 'Configure Tools...', command: 'claudeHarness.configureTools', arguments: [doc.uri, key] }));
      }
      return lenses;
    },
  };

  context.subscriptions.push(
    status,
    lensesChanged,
    vscode.languages.registerCodeLensProvider({ language: 'markdown', scheme: 'file' }, toolLenses),
    vscode.commands.registerCommand('claudeHarness.configureTools', async (uri: vscode.Uri, key: string) => {
      const doc = await vscode.workspace.openTextDocument(uri);
      const tools = await pickTools(views, assetOfFile(uri.fsPath), splitTools(parseMarkdown(doc.getText()).data[key]));
      if (!tools) return;
      const old = doc.getText();
      const next = setFrontmatterList(old, key, tools);
      if (next === old) return;
      let start = 0;
      while (start < old.length && start < next.length && old[start] === next[start]) start++;
      let end = 0;
      while (end < old.length - start && end < next.length - start && old[old.length - 1 - end] === next[next.length - 1 - end]) end++;
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, new vscode.Range(doc.positionAt(start), doc.positionAt(old.length - end)), next.slice(start, next.length - end));
      await vscode.workspace.applyEdit(edit);
    }),
    vscode.window.createTreeView('claudeHarness.tree', { treeDataProvider: tree, showCollapseAll: true }),
    { dispose: () => watcher?.dispose() },
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('claudeHarness.repoFolders') || e.affectsConfiguration('claudeHarness.removedRepos')) {
        loadScopes();
        refresh();
      }
      if (!e.affectsConfiguration('claudeHarness.root')) return;
      global = globalScope(vscode.workspace.getConfiguration('claudeHarness').get<string>('root'));
      loadScopes();
      watch();
      refresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      loadScopes();
      refresh();
    }),

    vscode.commands.registerCommand('claudeHarness.open', (id?: string) => HarnessPanel.show(context, host, typeof id === 'string' ? id : undefined)),
    vscode.commands.registerCommand('claudeHarness.addRepo', async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: true,
        openLabel: 'Add Repo',
        title: 'Add a repo folder, or a parent folder that holds several repos',
      });
      if (!picked?.length) return;
      const config = vscode.workspace.getConfiguration('claudeHarness');
      const current = config.get<string[]>('repoFolders') ?? [];
      const next = [...current];
      for (const uri of picked) if (!next.some(f => samePath(f, uri.fsPath))) next.push(uri.fsPath);
      const before = scopes.length;
      const removed = config.get<string[]>('removedRepos') ?? [];
      const keep = removed.filter(r => !picked.some(uri => samePath(r, uri.fsPath) || samePath(path.dirname(r), uri.fsPath)));
      if (keep.length !== removed.length) await config.update('removedRepos', keep, vscode.ConfigurationTarget.Global);
      await config.update('repoFolders', next, vscode.ConfigurationTarget.Global);
      loadScopes();
      refresh();
      const found = scopes.length - before;
      void vscode.window.showInformationMessage(
        found ? `Added ${found} ${found === 1 ? 'repo' : 'repos'} to the Claude harness.` : 'No new repo with a .claude folder or a CLAUDE.md found there.'
      );
    }),
    vscode.commands.registerCommand('claudeHarness.removeRepo', async (id?: string) => {
      const config = vscode.workspace.getConfiguration('claudeHarness');
      const folders = config.get<string[]>('repoFolders') ?? [];
      let targets: { dir: string; folder: boolean }[];
      const repo = typeof id === 'string' ? scopes.find(s => s.id === id) : undefined;
      if (repo) targets = [{ dir: repo.base, folder: false }];
      else {
        type Item = vscode.QuickPickItem & { dir?: string; folder?: boolean };
        const items: Item[] = [];
        if (folders.length) items.push({ label: 'Added folders', kind: vscode.QuickPickItemKind.Separator }, ...folders.map(f => ({ label: `$(folder) ${path.basename(f)}`, description: f, dir: f, folder: true })));
        const repos = scopes.filter(s => s.id !== global.id);
        if (repos.length) items.push({ label: 'Repositories', kind: vscode.QuickPickItemKind.Separator }, ...repos.map(s => ({ label: `$(repo) ${s.label}`, description: s.base, dir: s.base, folder: false })));
        const picked = await vscode.window.showQuickPick(items, { canPickMany: true, title: 'Remove from the Claude harness', placeHolder: 'Pick repos or added parent folders. Nothing is deleted on disk.', matchOnDescription: true });
        if (!picked?.length) return;
        targets = picked.map(p => ({ dir: p.dir!, folder: !!p.folder }));
      }
      const nextFolders = folders.filter(f => !targets.some(t => samePath(t.dir, f)));
      const removed = config.get<string[]>('removedRepos') ?? [];
      const nextRemoved = [...removed, ...targets.filter(t => !t.folder && !folders.some(f => samePath(f, t.dir)) && !removed.some(r => samePath(r, t.dir))).map(t => t.dir)];
      const before = scopes.length;
      if (nextFolders.length !== folders.length) await config.update('repoFolders', nextFolders, vscode.ConfigurationTarget.Global);
      if (nextRemoved.length !== removed.length) await config.update('removedRepos', nextRemoved, vscode.ConfigurationTarget.Global);
      loadScopes();
      refresh();
      const gone = before - scopes.length;
      void vscode.window.showInformationMessage(`Removed ${gone} ${gone === 1 ? 'repo' : 'repos'} from the Claude harness. Nothing was deleted on disk.`);
    }),
    vscode.commands.registerCommand('claudeHarness.refresh', () => {
      loadScopes();
      refresh();
      loadCliServers();
    }),

    vscode.commands.registerCommand('claudeHarness.create', async (arg?: unknown) => {
      const node = arg as Node | { kind?: Kind; scope?: string } | undefined;
      let kind: Kind | undefined = node && 'type' in node ? (node.type === 'category' ? node.category.kind : undefined) : node?.kind;
      const scope = scopes.find(s => s.id === (node && !('type' in node) ? node.scope : undefined)) ?? global;
      if (!kind) {
        const pick = await vscode.window.showQuickPick(
          KINDS.filter(k => k.creatable).map(k => ({ label: `$(${k.icon}) ${k.label}`, harnessKind: k.kind })),
          { placeHolder: `What do you want to create in ${scope.label}?` }
        );
        kind = pick?.harnessKind;
      }
      if (!kind) return;
      const name = await askName(`Name of the new ${KINDS.find(k => k.kind === kind)!.label.replace(/s$/, '').toLowerCase()} in ${scope.label}`);
      if (!name) return;
      let file = '';
      if (run(() => (file = createAsset(scope, kind!, name)))) showFile(file);
    }),

    vscode.commands.registerCommand('claudeHarness.openFile', async (arg?: unknown) => {
      const node = arg as Node | undefined;
      const file = node && typeof node === 'object' && node.type === 'file' ? node.file : assetOf(arg)?.file;
      if (file) await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file));
    }),

    vscode.commands.registerCommand('claudeHarness.reveal', async (arg?: unknown) => {
      const node = arg as Node | undefined;
      const file = node && typeof node === 'object' && node.type === 'file' ? node.file : assetOf(arg)?.dir ?? assetOf(arg)?.file;
      if (file) await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(file));
    }),

    vscode.commands.registerCommand('claudeHarness.rename', async (arg?: unknown) => {
      const asset = assetOf(arg);
      if (!asset) return;
      const name = await askName(`Rename ${asset.name} to`, asset.name);
      if (!name || name === asset.name) return;
      let file = '';
      if (run(() => (file = renameAsset(scopeOf(asset), asset, name)))) showFile(file);
    }),

    vscode.commands.registerCommand('claudeHarness.duplicate', async (arg?: unknown) => {
      const asset = assetOf(arg);
      if (!asset) return;
      const name = await askName(`Name of the copy of ${asset.name}`, `${asset.name}-copy`);
      if (!name) return;
      let file = '';
      if (run(() => (file = duplicateAsset(scopeOf(asset), asset, name)))) showFile(file);
    }),

    vscode.commands.registerCommand('claudeHarness.compare', async (arg?: unknown) => {
      const asset = assetOf(arg);
      if (!asset) return;
      if (!asset.copies?.length) {
        void vscode.window.showInformationMessage(`${asset.name} has no copy in another scope.`);
        return;
      }
      const copy =
        asset.copies.length === 1
          ? asset.copies[0]
          : (await vscode.window.showQuickPick(
              asset.copies.map(c => ({ label: c.label, description: c.same ? 'identical' : 'differs', detail: c.file, copy: c })),
              { title: `Compare ${asset.name} with` }
            ))?.copy;
      if (!copy) return;
      const label = views.find(v => v.id === asset.scope)?.label ?? asset.scope;
      await vscode.commands.executeCommand('vscode.diff', vscode.Uri.file(asset.file), vscode.Uri.file(copy.file), `${asset.name}: ${label} ↔ ${copy.label}`);
    }),

    vscode.commands.registerCommand('claudeHarness.delete', async (arg?: unknown) => {
      const asset = assetOf(arg);
      if (!asset) return;
      if (asset.kind === 'mcp') {
        if (!asset.file || !asset.jsonPath) return;
        const pick = await vscode.window.showWarningMessage(`Delete the MCP server ${asset.name}?`, { modal: true, detail: asset.file }, 'Delete');
        if (pick === 'Delete') run(() => removeJsonEntry(asset.file, asset.jsonPath!));
        return;
      }
      const target = asset.dir ?? asset.file;
      const choice = await vscode.window.showWarningMessage(`Move ${asset.name} to the trash?`, { modal: true, detail: target }, 'Move to Trash');
      if (choice !== 'Move to Trash') return;
      await vscode.workspace.fs.delete(vscode.Uri.file(target), { recursive: true, useTrash: true });
      refresh();
    }),

    vscode.commands.registerCommand('claudeHarness.addMcp', async (arg?: unknown) => {
      const scope = await pickScope(arg, 'Add the MCP server to');
      if (!scope) return;
      const name = await vscode.window.showInputBox({
        prompt: `Name of the new MCP server in ${scope.label}`,
        validateInput: v => (MCP_NAME.test(v) ? undefined : 'Letters, digits, dots, dashes and underscores; starts with a letter or digit.'),
      });
      if (!name) return;
      const kind = await vscode.window.showQuickPick(
        [
          { label: '$(terminal) Local command', stdio: true },
          { label: '$(globe) HTTP URL', stdio: false },
        ],
        { title: `How does Claude reach ${name}?` }
      );
      if (!kind) return;
      const value = await vscode.window.showInputBox(
        kind.stdio
          ? { prompt: 'Command line', placeHolder: 'npx -y @example/mcp-server', validateInput: v => (v.trim() ? undefined : 'Enter a command.') }
          : { prompt: 'URL', placeHolder: 'https://example.com/mcp', validateInput: v => (/^https?:\/\//.test(v.trim()) ? undefined : 'Starts with http:// or https://') }
      );
      if (!value) return;
      const [command, ...args] = splitCommandLine(value.trim());
      const server: McpConfig = kind.stdio ? { type: 'stdio', command, args, env: {} } : { type: 'http', url: value.trim() };
      if (!run(() => addMcpServer(scope.mcpFile, name, server))) return;
      const added = assets().find(a => a.kind === 'mcp' && a.scope === scope.id && a.name === name);
      if (added) HarnessPanel.show(context, host, added.id);
    }),

    vscode.commands.registerCommand('claudeHarness.copyMcpAdd', async (arg?: unknown) => {
      const asset = assetOf(arg);
      if (asset?.kind !== 'mcp') return;
      if (asset.source === 'claude.ai' || asset.source === 'plugin') {
        void vscode.window.showInformationMessage(`${asset.name} comes from ${asset.source === 'plugin' ? 'a plugin' : 'claude.ai'}, so there is no claude mcp add command for it.`);
        return;
      }
      let config: McpConfig;
      if (asset.file && asset.jsonPath) config = (jsonAt(asset.file, asset.jsonPath) ?? {}) as McpConfig;
      else if (/^https?:\/\//.test(asset.target ?? '')) config = { type: 'http', url: asset.target };
      else {
        const [command, ...args] = splitCommandLine(asset.target ?? '');
        config = { command, args };
      }
      const text = mcpAddCommand(asset.name, config, scopeFlag(asset));
      await vscode.env.clipboard.writeText(text);
      vscode.window.setStatusBarMessage(`$(check) Copied: ${text}`, 4000);
    }),

    vscode.commands.registerCommand('claudeHarness.openClaude', async (arg?: unknown) => {
      const scope = await pickScope(arg, 'Open Claude in', 'Home folder');
      if (scope) terminal(`Claude: ${scope.id === global.id ? 'home' : scope.label}`, cwdOf(scope), 'claude');
    }),

    vscode.commands.registerCommand('claudeHarness.installPlugin', async (arg?: unknown) => {
      const installed = new Set(views.flatMap(v => v.categories.find(c => c.kind === 'plugin')?.items ?? []).map(a => a.name));
      const items = marketplacePlugins(global.root)
        .sort((a, b) => a.key.localeCompare(b.key))
        .map(p => ({ label: p.key, description: installed.has(p.key) ? 'installed' : '', detail: p.description }));
      if (!items.length) {
        void vscode.window.showInformationMessage('No marketplace catalog found. Add one with claude plugin marketplace add first.');
        return;
      }
      const plugin = await vscode.window.showQuickPick(items, { title: 'Install a plugin', matchOnDescription: true, matchOnDetail: true });
      if (!plugin) return;
      const scope = await pickScope(arg, `Install ${plugin.label} for`, 'You, in every folder');
      if (!scope) return;
      terminal(`Install ${plugin.label}`, cwdOf(scope), `claude plugin install ${plugin.label} --scope ${scope.id === global.id ? 'user' : 'project'}`);
    }),

    vscode.commands.registerCommand('claudeHarness.uninstallPlugin', async (arg?: unknown) => {
      let asset = assetOf(arg);
      if (asset?.kind !== 'plugin') {
        const items = views.flatMap(v => (v.categories.find(c => c.kind === 'plugin')?.items ?? []).map(a => ({ label: a.name, description: v.label, detail: a.description, asset: a })));
        asset = (await vscode.window.showQuickPick(items, { title: 'Uninstall a plugin', matchOnDescription: true }))?.asset;
      }
      if (!asset) return;
      const scope = scopeOf(asset);
      const pick = await vscode.window.showWarningMessage(`Uninstall ${asset.name} from ${scope.id === global.id ? 'your user scope' : scope.label}?`, { modal: true }, 'Uninstall');
      if (pick !== 'Uninstall') return;
      terminal(`Uninstall ${asset.name}`, cwdOf(scope), `claude plugin uninstall ${asset.name} --scope ${scope.id === global.id ? 'user' : 'project'}`);
    }),

    vscode.commands.registerCommand('claudeHarness.openSettings', async () => {
      const items = views.flatMap(v =>
        (v.categories.find(c => c.kind === 'settings')?.items ?? []).map(a => ({ label: `$(settings-gear) ${a.name}`, description: v.label, detail: a.file, asset: a }))
      );
      if (!items.length) {
        void vscode.window.showInformationMessage('No settings.json or settings.local.json found.');
        return;
      }
      const pick = await vscode.window.showQuickPick(items, { title: 'Open a settings file', matchOnDescription: true, matchOnDetail: true });
      if (pick) HarnessPanel.show(context, host, pick.asset.id);
    }),

    vscode.commands.registerCommand('claudeHarness.toggleMcp', (arg?: unknown) => {
      const asset = assetOf(arg);
      if (asset?.kind !== 'mcp') return;
      const repo = asset.scope === global.id ? undefined : scopeOf(asset).base;
      run(() => setMcpEnabled(global.userConfig, asset, repo, !asset.enabled));
    }),
    vscode.commands.registerCommand('claudeHarness.openConnectors', () => vscode.env.openExternal(vscode.Uri.parse('https://claude.ai/new#customize/connectors/yours'))),
    vscode.commands.registerCommand('claudeHarness.togglePlugin', (arg?: unknown) => {
      const asset = assetOf(arg);
      if (asset?.kind === 'plugin') run(() => setPluginEnabled(scopeOf(asset), asset.name, !asset.enabled));
    })
  );

  loadScopes();
  watch();
  refresh();
  loadCliServers();
}

export function deactivate(): void {}
