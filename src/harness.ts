import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyEdits, modify, parse as parseJsonc } from 'jsonc-parser';
import { isSeq, parse as parseYaml, parseDocument, stringify as stringifyYaml, YAMLSeq } from 'yaml';

export type Kind =
  | 'memory'
  | 'rule'
  | 'agent'
  | 'skill'
  | 'command'
  | 'outputStyle'
  | 'workflow'
  | 'hook'
  | 'mcp'
  | 'plugin'
  | 'settings';

export interface KindInfo {
  kind: Kind;
  label: string;
  icon: string;
  creatable: boolean;
  markdown: boolean;
  fields: string[];
}

export const KINDS: KindInfo[] = [
  { kind: 'memory', label: 'Memory', icon: 'note', creatable: false, markdown: true, fields: [] },
  { kind: 'rule', label: 'Rules', icon: 'law', creatable: true, markdown: true, fields: ['paths'] },
  {
    kind: 'agent',
    label: 'Agents',
    icon: 'hubot',
    creatable: true,
    markdown: true,
    fields: ['name', 'description', 'tools', 'disallowedTools', 'model', 'effort', 'permissionMode', 'skills', 'mcpServers', 'memory', 'isolation', 'color'],
  },
  {
    kind: 'skill',
    label: 'Skills',
    icon: 'mortar-board',
    creatable: true,
    markdown: true,
    fields: ['name', 'description', 'argument-hint', 'allowed-tools', 'model', 'effort', 'context', 'agent', 'disable-model-invocation', 'user-invocable'],
  },
  {
    kind: 'command',
    label: 'Commands',
    icon: 'terminal',
    creatable: true,
    markdown: true,
    fields: ['description', 'argument-hint', 'allowed-tools', 'model', 'disable-model-invocation'],
  },
  { kind: 'outputStyle', label: 'Output Styles', icon: 'symbol-color', creatable: true, markdown: true, fields: ['name', 'description', 'keep-coding-instructions'] },
  { kind: 'workflow', label: 'Workflows', icon: 'type-hierarchy', creatable: true, markdown: false, fields: [] },
  { kind: 'hook', label: 'Hooks', icon: 'zap', creatable: false, markdown: false, fields: [] },
  { kind: 'mcp', label: 'MCP Servers', icon: 'server', creatable: false, markdown: false, fields: [] },
  { kind: 'plugin', label: 'Plugins', icon: 'extensions', creatable: false, markdown: false, fields: [] },
  { kind: 'settings', label: 'Settings', icon: 'settings-gear', creatable: false, markdown: false, fields: [] },
];

export const kindInfo = (kind: Kind): KindInfo => KINDS.find(k => k.kind === kind)!;

export interface Asset {
  id: string;
  scope: string;
  kind: Kind;
  name: string;
  description: string;
  file: string;
  dir?: string;
  files?: string[];
  enabled?: boolean;
  jsonPath?: (string | number)[];
  mtime: number;
  source?: McpSource;
  about?: string;
  target?: string;
  status?: string;
  offIn?: number;
  folders?: number;
}

export type McpSource = 'user' | 'local' | 'project' | 'claude.ai' | 'plugin';

export interface Category extends KindInfo {
  items: Asset[];
}

export interface HarnessScope {
  id: string;
  label: string;
  base: string;
  root: string;
  memory: string[];
  mcpFile: string;
  userConfig: string;
  installedPlugins: boolean;
}

export interface ScopeView {
  id: string;
  label: string;
  path: string;
  categories: Category[];
}

export const globalScope = (root?: string): HarnessScope => {
  const dir = root && root.trim() ? root : path.join(os.homedir(), '.claude');
  const userConfig = path.join(os.homedir(), '.claude.json');
  return { id: 'global', label: 'Global', base: dir, root: dir, memory: ['CLAUDE.md'], mcpFile: userConfig, userConfig, installedPlugins: true };
};

export const repoScope = (dir: string, userConfig = path.join(os.homedir(), '.claude.json')): HarnessScope => ({
  id: `repo:${dir}`,
  label: path.basename(dir),
  base: dir,
  root: path.join(dir, '.claude'),
  memory: ['CLAUDE.md', 'CLAUDE.local.md', '.claude/CLAUDE.md'],
  mcpFile: path.join(dir, '.mcp.json'),
  userConfig,
  installedPlugins: false,
});

type ServerConfig = { type?: string; command?: string; url?: string; args?: string[] };
const serverTarget = (server: ServerConfig) => `${server.type ?? 'stdio'} · ${server.url ?? [server.command, ...(server.args ?? [])].filter(Boolean).join(' ')}`;
const samePath = (a: string, b: string) => {
  const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
};

export const projectKey = (projects: Record<string, unknown>, dir: string): string | undefined => Object.keys(projects).find(k => samePath(k, dir));

type ProjectEntry = { disabledMcpServers?: string[]; disabledMcpjsonServers?: string[]; enabledMcpjsonServers?: string[] };

export function applyMcpState(views: ScopeView[], userConfig: string): void {
  const projects = (readJson(userConfig).projects ?? {}) as Record<string, ProjectEntry>;
  const entries = Object.values(projects);
  for (const view of views) {
    const servers = view.categories.find(c => c.kind === 'mcp')?.items ?? [];
    const entry = view.id === 'global' ? undefined : projects[projectKey(projects, view.path) ?? ''];
    for (const a of servers) {
      if (view.id === 'global') {
        a.offIn = entries.filter(p => (p.disabledMcpServers ?? []).includes(a.name)).length;
        a.folders = entries.length;
        a.enabled = a.offIn === 0;
      } else {
        const list = a.source === 'project' ? entry?.disabledMcpjsonServers : entry?.disabledMcpServers;
        a.enabled = !(list ?? []).includes(a.name);
      }
    }
  }
}

export function setMcpEnabled(userConfig: string, asset: Asset, repoDir: string | undefined, enabled: boolean): void {
  let text = readText(userConfig);
  const projects = (readJson(userConfig).projects ?? {}) as Record<string, ProjectEntry>;
  const set = (key: string, field: keyof ProjectEntry, change: (list: string[]) => string[]) => {
    const current = projects[key]?.[field] ?? [];
    const next = change(current);
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    text = applyEdits(text, modify(text, ['projects', key, field], next, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
  };
  const without = (list: string[]) => list.filter(n => n !== asset.name);
  const withName = (list: string[]) => (list.includes(asset.name) ? list : [...list, asset.name]);
  if (!repoDir) {
    for (const key of Object.keys(projects)) set(key, 'disabledMcpServers', enabled ? without : withName);
  } else {
    const key = projectKey(projects, repoDir) ?? repoDir.replace(/\\/g, '/');
    if (asset.source === 'project') {
      set(key, 'disabledMcpjsonServers', enabled ? without : withName);
      if (enabled) set(key, 'enabledMcpjsonServers', withName);
    } else set(key, 'disabledMcpServers', enabled ? without : withName);
  }
  fs.writeFileSync(userConfig, text, 'utf8');
}

export function pluginDescription(root: string, plugin: string): string {
  const candidates: string[] = [];
  const synced = path.join(root, 'plugins', 'synced');
  for (const org of safeDirs(synced)) candidates.push(path.join(synced, org, plugin, '.claude-plugin', 'plugin.json'));
  const cache = path.join(root, 'plugins', 'cache');
  for (const market of safeDirs(cache)) for (const version of safeDirs(path.join(cache, market, plugin))) candidates.push(path.join(cache, market, plugin, version, '.claude-plugin', 'plugin.json'));
  for (const file of candidates) {
    const description = readJson(file).description;
    if (typeof description === 'string' && description) return description;
  }
  return '';
}

function safeDirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name);
  } catch {
    return [];
  }
}

const isInside = (child: string, parent: string) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

const realPath = (p: string) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return p;
  }
};

export function expandRepoFolders(folders: string[]): string[] {
  return folders.flatMap(folder => {
    try {
      const children = fs.readdirSync(folder, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.') && !SKIP_DIRS.has(d.name));
      return [folder, ...children.map(d => path.join(folder, d.name))];
    } catch {
      return [];
    }
  });
}

export function knownRepos(extra: string[], userConfig = path.join(os.homedir(), '.claude.json')): string[] {
  const projects = Object.keys((readJson(userConfig).projects ?? {}) as Record<string, unknown>);
  const seen = new Map<string, string>();
  const candidates = [...projects.map(p => ({ p, explicit: false })), ...extra.map(p => ({ p, explicit: true }))];
  for (const { p, explicit } of candidates) {
    const dir = path.resolve(p);
    const key = process.platform === 'win32' ? dir.toLowerCase() : dir;
    if (seen.has(key) || path.relative(os.homedir(), dir) === '') continue;
    if (!explicit && isInside(realPath(dir), realPath(os.tmpdir()))) continue;
    if (!fs.existsSync(path.join(dir, '.claude')) && !fs.existsSync(path.join(dir, 'CLAUDE.md'))) continue;
    seen.set(key, dir.length > 2 && dir[1] === ':' ? dir[0].toUpperCase() + dir.slice(1) : dir);
  }
  return [...seen.values()].sort((a, b) => path.basename(a).localeCompare(path.basename(b)) || a.localeCompare(b));
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/;
const NAME = /^[a-z0-9][a-z0-9._-]*$/;
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv']);

export interface MarkdownDoc {
  data: Record<string, unknown>;
  body: string;
  hasFrontmatter: boolean;
}

export function splitFrontmatter(text: string): { yaml: string | undefined; body: string } {
  const m = FRONTMATTER.exec(text);
  return m ? { yaml: m[1], body: text.slice(m[0].length) } : { yaml: undefined, body: text };
}

export function parseMarkdown(text: string): MarkdownDoc {
  const { yaml, body } = splitFrontmatter(text);
  let data: Record<string, unknown> = {};
  if (yaml !== undefined) {
    try {
      const parsed = parseYaml(yaml);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
    } catch {
      data = lenientYaml(yaml);
    }
  }
  return { data, body, hasFrontmatter: yaml !== undefined };
}

function lenientYaml(yaml: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  let key: string | undefined;
  for (const line of yaml.split(/\r?\n/)) {
    const top = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (top) {
      key = top[1];
      data[key] = /^[|>][-+]?$/.test(top[2].trim()) ? '' : top[2].trim();
      continue;
    }
    if (!key) continue;
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item) {
      const current = data[key];
      data[key] = [...(Array.isArray(current) ? current : []), item[1].trim()];
    } else if (line.trim()) {
      data[key] = `${data[key] ?? ''} ${line.trim()}`.trim();
    }
  }
  return data;
}

export function readMarkdown(file: string): MarkdownDoc {
  return parseMarkdown(readText(file));
}

const eolOf = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n');

export function serializeMarkdown(original: string, data: Record<string, unknown>, body: string): string {
  const eol = eolOf(original);
  const { yaml } = splitFrontmatter(original);
  const normalizedBody = body.replace(/\r\n/g, '\n');
  let out: string;
  if (yaml === undefined && Object.keys(data).length === 0) {
    out = normalizedBody;
  } else if (yaml !== undefined && JSON.stringify(parseMarkdown(original).data) === JSON.stringify(data)) {
    out = `---\n${yaml.replace(/\r\n/g, '\n')}\n---\n${normalizedBody}`;
  } else {
    const doc = parseDocument(yaml ?? '');
    let front = '';
    if (Object.keys(data).length && doc.errors.length) {
      front = stringifyYaml(data, { lineWidth: 0 }).replace(/\n$/, '');
    } else if (Object.keys(data).length) {
      const current = (doc.toJS() ?? {}) as Record<string, unknown>;
      for (const key of Object.keys(current)) if (!(key in data)) doc.delete(key);
      for (const [key, value] of Object.entries(data)) {
        if (JSON.stringify(current[key]) !== JSON.stringify(value)) doc.set(key, value);
      }
      front = doc.toString({ lineWidth: 0 }).replace(/\n$/, '');
    }
    out = `---\n${front}${front ? '\n' : ''}---\n${normalizedBody}`;
  }
  return eol === '\n' ? out : out.replace(/\n/g, eol);
}

export function setFrontmatterList(text: string, key: string, items: string[]): string {
  const m = FRONTMATTER.exec(text);
  if (!m) return text;
  const eol = eolOf(text);
  const doc = parseDocument(m[1].replace(/\r\n/g, '\n'));
  const node = doc.get(key, true);
  if (isSeq(node)) {
    const seq = doc.createNode(items) as YAMLSeq;
    seq.flow = node.flow;
    doc.set(key, seq);
  } else doc.set(key, items.join(', '));
  const front = `---\n${doc.toString({ lineWidth: 0 })}---\n`;
  return (eol === '\n' ? front : front.replace(/\n/g, eol)) + text.slice(m[0].length);
}

export function writeMarkdown(file: string, data: Record<string, unknown>, body: string): void {
  const original = fs.existsSync(file) ? readText(file) : '';
  fs.writeFileSync(file, serializeMarkdown(original, data, body), 'utf8');
}

export interface CliServer {
  name: string;
  target: string;
  status: string;
}

export function parseMcpList(output: string): CliServer[] {
  return output
    .split(/\r?\n/)
    .map(line => /^(.+?): (.*?) - \S (.+)$/u.exec(line.trim()))
    .filter((m): m is RegExpExecArray => !!m)
    .map(m => ({ name: m[1], target: m[2].trim(), status: m[3].trim() }));
}

export const mcpToolPrefix = (server: string) => `mcp__${server.replace(/[^A-Za-z0-9_-]/g, '_')}__`;

export function readText(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

export function writeText(file: string, text: string): void {
  const original = fs.existsSync(file) ? readText(file) : '';
  const eol = eolOf(original);
  const normalized = text.replace(/\r\n/g, '\n');
  fs.writeFileSync(file, eol === '\n' ? normalized : normalized.replace(/\n/g, eol), 'utf8');
}

function readJson(file: string): Record<string, unknown> {
  try {
    const value = parseJsonc(readText(file));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

const oneLine = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
const mtimeOf = (file: string) => {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

function listFiles(dir: string, filter: (name: string) => boolean, recursive: boolean, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (recursive && !SKIP_DIRS.has(entry.name)) out.push(...listFiles(path.join(dir, entry.name), filter, true, base));
    } else if (filter(entry.name)) {
      out.push(path.relative(base, path.join(dir, entry.name)));
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function markdownAssets(scope: HarnessScope, dir: string, kind: Kind, recursive: boolean, nameOf: (rel: string) => string): Asset[] {
  return listFiles(dir, n => n.toLowerCase().endsWith('.md'), recursive).map(rel => {
    const file = path.join(dir, rel);
    const name = nameOf(rel);
    return { id: `${scope.id}|${kind}:${name}`, scope: scope.id, kind, name, description: oneLine(readMarkdown(file).data.description), file, mtime: mtimeOf(file) };
  });
}

const stripMd = (rel: string) => rel.replace(/\.md$/i, '').split(path.sep).join('/');

function workflowDescription(file: string): string {
  const m = /description\s*:\s*(['"`])([\s\S]*?)\1/.exec(readText(file));
  return m ? oneLine(m[2]) : '';
}

export function scan(scope: HarnessScope): Category[] {
  const { root } = scope;
  const items = new Map<Kind, Asset[]>(KINDS.map(k => [k.kind, []]));
  const make = (kind: Kind, key: string, rest: Omit<Asset, 'id' | 'scope' | 'kind'>): Asset => ({ id: `${scope.id}|${kind}:${key}`, scope: scope.id, kind, ...rest });

  for (const rel of scope.memory) {
    const file = path.join(scope.base, rel);
    if (fs.existsSync(file)) items.get('memory')!.push(make('memory', rel, { name: rel, description: '', file, mtime: mtimeOf(file) }));
  }

  items.set('rule', markdownAssets(scope, path.join(root, 'rules'), 'rule', true, stripMd));
  items.set('agent', markdownAssets(scope, path.join(root, 'agents'), 'agent', false, stripMd));
  items.set('command', markdownAssets(scope, path.join(root, 'commands'), 'command', true, rel => stripMd(rel).replace(/\//g, ':')));
  items.set('outputStyle', markdownAssets(scope, path.join(root, 'output-styles'), 'outputStyle', false, stripMd));

  const skillsDir = path.join(root, 'skills');
  if (fs.existsSync(skillsDir)) {
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      const dir = path.join(skillsDir, entry.name);
      const file = path.join(dir, 'SKILL.md');
      if (!fs.statSync(dir).isDirectory() || !fs.existsSync(file)) continue;
      items.get('skill')!.push(
        make('skill', entry.name, {
          name: entry.name,
          description: oneLine(readMarkdown(file).data.description),
          file,
          dir,
          files: listFiles(dir, () => true, true).map(f => f.split(path.sep).join('/')),
          mtime: mtimeOf(file),
        })
      );
    }
  }

  items.set(
    'workflow',
    listFiles(path.join(root, 'workflows'), n => /\.(m?js)$/i.test(n), false).map(rel => {
      const file = path.join(root, 'workflows', rel);
      const name = rel.replace(/\.m?js$/i, '');
      return make('workflow', name, { name, description: workflowDescription(file), file, mtime: mtimeOf(file) });
    })
  );

  const settingsFile = path.join(root, 'settings.json');
  const settings = readJson(settingsFile);

  const hooks = (settings.hooks ?? {}) as Record<string, Array<{ matcher?: string; hooks?: Array<{ command?: string; type?: string }> }>>;
  for (const [event, groups] of Object.entries(hooks)) {
    (Array.isArray(groups) ? groups : []).forEach((group, i) => {
      const name = group.matcher ? `${event} · ${group.matcher}` : event;
      items.get('hook')!.push(
        make('hook', `${event}:${i}`, {
          name,
          description: (group.hooks ?? []).map(h => h.command ?? h.type ?? '').join(' | '),
          file: settingsFile,
          jsonPath: ['hooks', event, i],
          mtime: mtimeOf(settingsFile),
        })
      );
    });
  }

  const servers = (readJson(scope.mcpFile).mcpServers ?? {}) as Record<string, ServerConfig>;
  const source: McpSource = scope.id === 'global' ? 'user' : 'project';
  for (const [name, server] of Object.entries(servers)) {
    items.get('mcp')!.push(
      make('mcp', name, {
        name,
        description: serverTarget(server),
        file: scope.mcpFile,
        jsonPath: ['mcpServers', name],
        mtime: mtimeOf(scope.mcpFile),
        source,
        target: server.url ?? [server.command, ...(server.args ?? [])].filter(Boolean).join(' '),
      })
    );
  }
  if (scope.id !== 'global') {
    const projects = (readJson(scope.userConfig).projects ?? {}) as Record<string, { mcpServers?: Record<string, ServerConfig> }>;
    const key = projectKey(projects, scope.base);
    for (const [name, server] of Object.entries((key && projects[key].mcpServers) || {})) {
      if (servers[name]) continue;
      items.get('mcp')!.push(
        make('mcp', `local:${name}`, {
          name,
          description: serverTarget(server),
          file: scope.userConfig,
          jsonPath: ['projects', key!, 'mcpServers', name],
          mtime: mtimeOf(scope.userConfig),
          source: 'local',
          target: server.url ?? [server.command, ...(server.args ?? [])].filter(Boolean).join(' '),
        })
      );
    }
  }

  const enabled = (settings.enabledPlugins ?? {}) as Record<string, boolean>;
  const installedFile = path.join(root, 'plugins', 'installed_plugins.json');
  const installed = (scope.installedPlugins ? readJson(installedFile).plugins ?? {} : {}) as Record<string, Array<{ scope?: string; version?: string }>>;
  const pluginKeys = new Set([...Object.keys(enabled), ...Object.entries(installed).filter(([, e]) => e.some(x => x.scope === 'user')).map(([k]) => k)]);
  for (const key of [...pluginKeys].sort((a, b) => a.localeCompare(b))) {
    const version = (installed[key] ?? []).find(x => x.scope === 'user')?.version ?? (installed[key] ?? [])[0]?.version;
    items.get('plugin')!.push(
      make('plugin', key, {
        name: key,
        description: [enabled[key] === true ? 'enabled' : 'disabled', version].filter(Boolean).join(' · '),
        file: settingsFile,
        enabled: enabled[key] === true,
        mtime: mtimeOf(settingsFile),
      })
    );
  }

  for (const name of ['settings.json', 'settings.local.json']) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    items.get('settings')!.push(
      make('settings', name, {
        name,
        description: `${Object.keys(readJson(file)).length} keys`,
        file,
        mtime: mtimeOf(file),
      })
    );
  }

  return KINDS.map(k => ({ ...k, items: items.get(k.kind)!.sort((a, b) => a.name.localeCompare(b.name)) }));
}

export function setPluginEnabled(scope: HarnessScope, key: string, value: boolean): void {
  const file = path.join(scope.root, 'settings.json');
  const text = fs.existsSync(file) ? readText(file) : '{}';
  const edits = modify(text, ['enabledPlugins', key], value, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: eolOf(text) } });
  fs.writeFileSync(file, applyEdits(text, edits), 'utf8');
}

export function validateName(name: string): string | undefined {
  return NAME.test(name) ? undefined : 'Lowercase letters, digits, dots, dashes and underscores; starts with a letter or digit.';
}

function assetTarget(scope: HarnessScope, kind: Kind, name: string): { file: string; dir?: string } {
  const { root } = scope;
  switch (kind) {
    case 'rule':
      return { file: path.join(root, 'rules', `${name}.md`) };
    case 'agent':
      return { file: path.join(root, 'agents', `${name}.md`) };
    case 'command':
      return { file: path.join(root, 'commands', ...name.split(':')) + '.md' };
    case 'outputStyle':
      return { file: path.join(root, 'output-styles', `${name}.md`) };
    case 'workflow':
      return { file: path.join(root, 'workflows', `${name}.js`) };
    case 'skill': {
      const dir = path.join(root, 'skills', name);
      return { file: path.join(dir, 'SKILL.md'), dir };
    }
    default:
      throw new Error(`${kindInfo(kind).label} cannot be created here.`);
  }
}

function template(kind: Kind, name: string): string {
  switch (kind) {
    case 'rule':
      return `# ${name}\n\n`;
    case 'agent':
      return `---\nname: ${name}\ndescription: \nmodel: inherit\n---\n\n`;
    case 'skill':
      return `---\nname: ${name}\ndescription: \n---\n\n# ${name}\n\n`;
    case 'command':
      return `---\ndescription: \n---\n\n`;
    case 'outputStyle':
      return `---\nname: ${name}\ndescription: \n---\n\n`;
    case 'workflow':
      return `export const meta = {\n  name: '${name}',\n  description: '',\n}\n`;
    default:
      return '';
  }
}

export function createAsset(scope: HarnessScope, kind: Kind, name: string): string {
  const target = assetTarget(scope, kind, name);
  if (fs.existsSync(target.dir ?? target.file)) throw new Error(`${name} already exists.`);
  fs.mkdirSync(path.dirname(target.file), { recursive: true });
  fs.writeFileSync(target.file, template(kind, name), 'utf8');
  return target.file;
}

function renameInContent(file: string, kind: Kind, newName: string): void {
  if (kind === 'workflow') {
    const text = readText(file);
    fs.writeFileSync(file, text.replace(/(\bname\s*:\s*)(['"`])[^'"`]*\2/, `$1$2${newName}$2`), 'utf8');
    return;
  }
  const doc = readMarkdown(file);
  if ('name' in doc.data && kind !== 'outputStyle') writeMarkdown(file, { ...doc.data, name: newName }, doc.body);
}

export function renameAsset(scope: HarnessScope, asset: Asset, newName: string): string {
  const target = assetTarget(scope, asset.kind, newName);
  if (fs.existsSync(target.dir ?? target.file)) throw new Error(`${newName} already exists.`);
  fs.mkdirSync(path.dirname(target.dir ?? target.file), { recursive: true });
  fs.renameSync(asset.dir ?? asset.file, target.dir ?? target.file);
  renameInContent(target.file, asset.kind, newName);
  return target.file;
}

export function duplicateAsset(scope: HarnessScope, asset: Asset, newName: string): string {
  const target = assetTarget(scope, asset.kind, newName);
  if (fs.existsSync(target.dir ?? target.file)) throw new Error(`${newName} already exists.`);
  fs.mkdirSync(path.dirname(target.dir ?? target.file), { recursive: true });
  fs.cpSync(asset.dir ?? asset.file, target.dir ?? target.file, { recursive: true });
  renameInContent(target.file, asset.kind, newName);
  return target.file;
}

export type FieldType = 'string' | 'text' | 'boolean' | 'number' | 'list' | 'yaml';

export interface Field {
  key: string;
  type: FieldType;
  value: string | boolean;
}

export function toFields(data: Record<string, unknown>): Field[] {
  return Object.entries(data).map(([key, value]) => {
    if (typeof value === 'boolean') return { key, type: 'boolean', value };
    if (typeof value === 'number') return { key, type: 'number', value: String(value) };
    if (typeof value === 'string') return { key, type: key === 'description' || value.includes('\n') ? 'text' : 'string', value };
    if (Array.isArray(value) && value.every(v => typeof v !== 'object' || v === null)) return { key, type: 'list', value: value.join(', ') };
    if (value === null || value === undefined) return { key, type: 'string', value: '' };
    return { key, type: 'yaml', value: stringifyYaml(value).replace(/\n$/, '') };
  });
}

export function fromFields(fields: Field[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const f of fields) {
    const key = f.key.trim();
    if (!key) continue;
    switch (f.type) {
      case 'boolean':
        data[key] = f.value === true;
        break;
      case 'number':
        data[key] = Number(f.value);
        break;
      case 'list':
        data[key] = String(f.value).split(/[,\n]/).map(s => s.trim()).filter(Boolean);
        break;
      case 'yaml':
        data[key] = parseYaml(String(f.value));
        break;
      default:
        data[key] = String(f.value);
    }
  }
  return data;
}
