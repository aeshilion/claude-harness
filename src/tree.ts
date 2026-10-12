import * as path from 'path';
import * as vscode from 'vscode';
import { Asset, Category } from './harness';

export type Node =
  | { type: 'category'; category: Category }
  | { type: 'asset'; asset: Asset }
  | { type: 'file'; asset: Asset; rel: string; file: string; isDir: boolean; children: string[] };

function fileNodes(asset: Asset, prefix: string): Node[] {
  const files = (asset.files ?? []).filter(f => f !== 'SKILL.md' && f.startsWith(prefix));
  const level = new Map<string, string[]>();
  for (const f of files) {
    const rest = f.slice(prefix.length);
    const head = rest.split('/')[0];
    const list = level.get(head) ?? [];
    if (rest.includes('/')) list.push(f);
    level.set(head, list);
  }
  return [...level.entries()]
    .map(([head, children]) => {
      const rel = prefix + head;
      return { type: 'file' as const, asset, rel, file: path.join(asset.dir!, ...rel.split('/')), isDir: children.length > 0, children };
    })
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.rel.localeCompare(b.rel));
}

export class HarnessTree implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private categories: Category[] = [];

  setCategories(categories: Category[]): void {
    this.categories = categories;
    this.changed.fire(undefined);
  }

  getChildren(node?: Node): Node[] {
    if (!node) return this.categories.map(category => ({ type: 'category', category }));
    if (node.type === 'category') return node.category.items.map(asset => ({ type: 'asset', asset }));
    if (node.type === 'asset' && node.asset.kind === 'skill') return fileNodes(node.asset, '');
    if (node.type === 'file' && node.isDir) return fileNodes(node.asset, `${node.rel}/`);
    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.type === 'category') {
      const { category } = node;
      const item = new vscode.TreeItem(category.label, category.items.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
      item.id = `category:${category.kind}`;
      item.description = String(category.items.length);
      item.iconPath = new vscode.ThemeIcon(category.icon);
      item.contextValue = category.creatable ? 'category.creatable' : `category.${category.kind}`;
      return item;
    }
    if (node.type === 'asset') {
      const { asset } = node;
      const item = new vscode.TreeItem(asset.name, asset.kind === 'skill' && (asset.files?.length ?? 0) > 1 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
      item.id = asset.id;
      item.description = asset.description;
      item.tooltip = new vscode.MarkdownString(`**${asset.name}**\n\n${asset.description}\n\n\`${asset.file}\``);
      item.iconPath =
        asset.kind === 'plugin'
          ? new vscode.ThemeIcon(asset.enabled ? 'pass-filled' : 'circle-large-outline', asset.enabled ? new vscode.ThemeColor('testing.iconPassed') : undefined)
          : new vscode.ThemeIcon(this.categories.find(c => c.kind === asset.kind)?.icon ?? 'file');
      item.contextValue = asset.kind === 'mcp' && asset.file && asset.jsonPath ? 'asset.mcp.stored' : `asset.${asset.kind}`;
      item.command = { command: 'claudeHarness.open', title: 'Open', arguments: [asset.id] };
      return item;
    }
    const item = new vscode.TreeItem(path.posix.basename(node.rel), node.isDir ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    item.id = `${node.asset.id}/${node.rel}`;
    item.resourceUri = vscode.Uri.file(node.file);
    item.contextValue = node.isDir ? 'folder' : 'file';
    if (!node.isDir) item.command = { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(node.file)] };
    return item;
  }
}
