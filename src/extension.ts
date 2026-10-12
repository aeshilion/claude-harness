import * as vscode from 'vscode';
import {
  Asset,
  createAsset,
  duplicateAsset,
  globalScope,
  HarnessScope,
  Kind,
  KINDS,
  knownRepos,
  renameAsset,
  repoScope,
  scan,
  ScopeView,
  setPluginEnabled,
  validateName,
} from './harness';
import { HarnessPanel, PanelHost } from './panel';
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
  const scopeOf = (asset: Asset) => scopes.find(s => s.id === asset.scope) ?? global;

  const loadScopes = () => {
    const folders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
    scopes = [global, ...knownRepos(folders).map(repoScope)];
  };

  const refresh = () => {
    views = scopes.map(s => ({ id: s.id, label: s.label, path: s.base, categories: scan(s) }));
    tree.setCategories(views[0].categories);
    HarnessPanel.update();
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

  const showFile = (file: string) => {
    const asset = assets().find(a => a.file === file);
    if (asset) HarnessPanel.show(context, host, asset.id);
  };

  const status = vscode.window.createStatusBarItem('claudeHarness.status', vscode.StatusBarAlignment.Left, 0);
  status.name = 'Claude Harness';
  status.text = '$(hubot) Claude Harness';
  status.tooltip = 'Open the global Claude harness';
  status.command = 'claudeHarness.open';
  status.show();

  context.subscriptions.push(
    status,
    vscode.window.createTreeView('claudeHarness.tree', { treeDataProvider: tree, showCollapseAll: true }),
    { dispose: () => watcher?.dispose() },
    vscode.workspace.onDidChangeConfiguration(e => {
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
    vscode.commands.registerCommand('claudeHarness.refresh', () => {
      loadScopes();
      refresh();
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

    vscode.commands.registerCommand('claudeHarness.delete', async (arg?: unknown) => {
      const asset = assetOf(arg);
      if (!asset) return;
      const target = asset.dir ?? asset.file;
      const choice = await vscode.window.showWarningMessage(`Move ${asset.name} to the trash?`, { modal: true, detail: target }, 'Move to Trash');
      if (choice !== 'Move to Trash') return;
      await vscode.workspace.fs.delete(vscode.Uri.file(target), { recursive: true, useTrash: true });
      refresh();
    }),

    vscode.commands.registerCommand('claudeHarness.togglePlugin', (arg?: unknown) => {
      const asset = assetOf(arg);
      if (asset?.kind === 'plugin') run(() => setPluginEnabled(scopeOf(asset), asset.name, !asset.enabled));
    })
  );

  loadScopes();
  watch();
  refresh();
}

export function deactivate(): void {}
