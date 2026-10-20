import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse as parseJsonc } from 'jsonc-parser';

export type Level = 'FAIL' | 'REVIEW' | 'INFO';

export interface Location {
  file: string;
  line: number | null;
  token?: string;
}

export interface Finding {
  level: Level;
  code?: string;
  text: string;
  locations: Location[];
}

export interface CheckResult {
  repo: string;
  kind: string;
  layout?: string;
  metrics?: { lines?: number; emDashes?: number };
  fail: number;
  review: number;
  findings: Finding[];
}

/** A plugin that ships `.claude-plugin/harness-standard.json` provides the harness standard features. */
export interface Provider {
  name: string;
  dir: string;
  check: string;
  fix?: string;
  scaffold?: string;
  standard?: string;
  align?: string;
  ownerPattern?: string;
  keepCopies?: { folders?: string[]; claudeMdPattern?: string };
}

export const MANIFEST = path.join('.claude-plugin', 'harness-standard.json');
export const NO_PROVIDER = 'No harness standard provider plugin is installed.';

const readJson = (file: string): Record<string, unknown> => {
  try {
    const value = parseJsonc(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
};

const keepOf = (value: unknown): Provider['keepCopies'] => {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as { folders?: unknown; claudeMdPattern?: unknown };
  const folders = Array.isArray(v.folders) ? v.folders.filter((f): f is string => typeof f === 'string' && !!f) : undefined;
  const claudeMdPattern = typeof v.claudeMdPattern === 'string' && v.claudeMdPattern ? v.claudeMdPattern : undefined;
  return folders?.length || claudeMdPattern ? { folders, claudeMdPattern } : undefined;
};

export function providerAt(dir: string): Provider | undefined {
  const m = readJson(path.join(dir, MANIFEST));
  const at = (key: string) => (typeof m[key] === 'string' && m[key] ? path.join(dir, ...(m[key] as string).split('/')) : undefined);
  const check = at('check');
  if (!check || !fs.existsSync(check)) return undefined;
  return {
    name: typeof m.name === 'string' && m.name ? m.name : path.basename(dir),
    dir,
    check,
    fix: at('fix'),
    scaffold: at('scaffold'),
    standard: at('standard'),
    align: typeof m.align === 'string' && m.align ? m.align : undefined,
    ownerPattern: typeof m.ownerPattern === 'string' && m.ownerPattern ? m.ownerPattern : undefined,
    keepCopies: keepOf(m.keepCopies),
  };
}

export function findProvider(dirs: { dir: string; installed: boolean }[]): Provider | undefined {
  for (const d of [...dirs.filter(x => !x.installed), ...dirs.filter(x => x.installed)]) {
    const found = providerAt(d.dir);
    if (found) return found;
  }
  return undefined;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

const env = () => ({ ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' });

export function run(command: string, args: string[], cwd?: string, timeout = 60000): Promise<RunResult> {
  return new Promise(resolve =>
    execFile(command, args, { cwd, env: env(), windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : -1) : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? err?.message ?? '') })
    )
  );
}

let python: Promise<string[] | undefined> | undefined;

export function findPython(): Promise<string[] | undefined> {
  python ??= (async () => {
    for (const candidate of [['python'], ['py', '-3'], ['python3']]) {
      const r = await run(candidate[0], [...candidate.slice(1), '--version'], undefined, 15000);
      if (r.code === 0 && /^Python 3\./m.test(`${r.stdout}${r.stderr}`)) return candidate;
    }
    return undefined;
  })();
  return python;
}

export const needsPython = (script: string) => /\.py$/i.test(script);

export const runScript = (py: string[] | undefined, script: string, args: string[], cwd?: string) =>
  needsPython(script) ? run(py![0], [...py!.slice(1), script, ...args], cwd) : run(script, args, cwd);

export function parseCheckJson(stdout: string): CheckResult | undefined {
  const line = stdout.split(/\r?\n/).find(l => l.trim().startsWith('{'));
  if (!line) return undefined;
  try {
    const data = JSON.parse(line) as CheckResult;
    return Array.isArray(data.findings) ? data : undefined;
  } catch {
    return undefined;
  }
}

export async function checkRepo(provider: Provider, py: string[] | undefined, dir: string): Promise<CheckResult> {
  const r = await runScript(py, provider.check, [dir, '--json']);
  const parsed = parseCheckJson(r.stdout);
  if (parsed) return parsed;
  throw new Error(r.stderr.trim() || `The check of ${provider.name} printed no JSON (exit ${r.code}).`);
}

export interface Problem {
  file: string;
  line: number;
  token?: string;
  level: Level;
  message: string;
  code: string;
}

export function problemsOf(result: CheckResult, repoDir: string, lineOf: (file: string, token: string) => number | undefined = () => undefined): Problem[] {
  const out: Problem[] = [];
  for (const f of result.findings) {
    const message = f.text.replace(/^(FAIL|REVIEW|INFO) /, '');
    for (const loc of f.locations) {
      const file = path.join(repoDir, ...loc.file.split('/'));
      const line = loc.line ?? (loc.token ? lineOf(file, loc.token) : undefined) ?? 1;
      out.push({ file, line: Math.max(0, line - 1), token: loc.token, level: f.level, message, code: f.code ?? 'standard' });
    }
  }
  return out;
}

export function parseFixOutput(stdout: string): { changes: string[]; count: number } {
  const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const summary = lines.map(l => /^repo=\S* changes=(\d+)/.exec(l)).find(Boolean);
  return { changes: lines.filter(l => !/^repo=/.test(l)), count: summary ? Number(summary[1]) : 0 };
}

export interface ScaffoldForm {
  summary: string;
  areas: { name: string; globs: string; owner: string }[];
  rules: string[];
}

export function scaffoldArgs(dir: string, form: ScaffoldForm, apply: boolean): string[] {
  const args = ['--root', dir, '--summary', form.summary.trim()];
  for (const a of form.areas.filter(a => a.name.trim() && a.globs.trim() && a.owner.trim()))
    args.push('--area', `${a.name.trim()}=${a.globs.split(/[,\n]/).map(g => g.trim()).filter(Boolean).join(',')}:${a.owner.trim()}`);
  for (const r of form.rules.map(r => r.trim()).filter(Boolean)) args.push('--rule', r);
  if (apply) args.push('--apply');
  return args;
}

export function parseScaffoldOutput(stdout: string): { files: { action: 'create' | 'skip'; rel: string }[]; summary: string } {
  const lines = stdout.split(/\r?\n/).map(l => l.trimEnd()).filter(Boolean);
  return {
    files: lines.map(l => /^(create|skip)\s+(.+)$/.exec(l)).filter((m): m is RegExpExecArray => !!m).map(m => ({ action: m[1] as 'create' | 'skip', rel: m[2].trim() })),
    summary: lines.find(l => /^created=/.test(l)) ?? '',
  };
}

const SETTINGS = ['settings.json', 'settings.local.json'];

export interface FixPreview {
  changes: string[];
  files: { rel: string; before: string; after?: string }[];
  temp: string;
}

const fixArgs = (root: string, keepPlugins: boolean, globalSettings: string, apply: boolean) => [root, '--global-settings', globalSettings, ...(apply ? ['--apply'] : []), ...(keepPlugins ? ['--keep-plugins'] : [])];

export async function previewFix(provider: Provider, py: string[] | undefined, dir: string, keepPlugins: boolean, globalSettings: string): Promise<FixPreview> {
  if (!provider.fix) throw new Error(`${provider.name} has no fix.`);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-fix-'));
  const src = path.join(dir, '.claude');
  const dst = path.join(temp, '.claude');
  fs.mkdirSync(dst, { recursive: true });
  for (const name of SETTINGS) if (fs.existsSync(path.join(src, name))) fs.copyFileSync(path.join(src, name), path.join(dst, name));
  if (fs.existsSync(path.join(src, 'hooks'))) fs.cpSync(path.join(src, 'hooks'), path.join(dst, 'hooks'), { recursive: true });
  const dry = await runScript(py, provider.fix, fixArgs(dir, keepPlugins, globalSettings, false));
  if (dry.code !== 0) throw new Error(dry.stderr.trim() || `The fix exited with ${dry.code}`);
  const applied = await runScript(py, provider.fix, fixArgs(temp, keepPlugins, globalSettings, true));
  if (applied.code !== 0) throw new Error(applied.stderr.trim() || `The fix exited with ${applied.code}`);
  const files: FixPreview['files'] = [];
  for (const name of SETTINGS) {
    const before = path.join(src, name);
    if (!fs.existsSync(before)) continue;
    const after = path.join(dst, name);
    const a = fs.readFileSync(before, 'utf8');
    const b = fs.existsSync(after) ? fs.readFileSync(after, 'utf8') : undefined;
    if (b === undefined || b.replace(/\r\n/g, '\n') !== a.replace(/\r\n/g, '\n')) files.push({ rel: `.claude/${name}`, before, after: b === undefined ? undefined : after });
  }
  for (const f of fs.existsSync(path.join(src, 'hooks')) ? fs.readdirSync(path.join(src, 'hooks')) : [])
    if (!fs.existsSync(path.join(dst, 'hooks', f))) files.push({ rel: `.claude/hooks/${f}`, before: path.join(src, 'hooks', f) });
  return { changes: parseFixOutput(dry.stdout).changes, files, temp };
}

export async function applyFix(provider: Provider, py: string[] | undefined, dir: string, keepPlugins: boolean, globalSettings: string): Promise<string[]> {
  if (!provider.fix) throw new Error(`${provider.name} has no fix.`);
  const r = await runScript(py, provider.fix, fixArgs(dir, keepPlugins, globalSettings, true));
  if (r.code !== 0) throw new Error(r.stderr.trim() || `The fix exited with ${r.code}`);
  return parseFixOutput(r.stdout).changes;
}
