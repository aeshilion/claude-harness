import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CheckResult, NO_PROVIDER, Problem, Provider, checkRepo, findPython, needsPython, problemsOf } from './standard';

export type CheckState = 'unchecked' | 'running' | 'pass' | 'fail' | 'review' | 'error' | 'no-plugin' | 'no-python';

export interface RepoCheck {
  state: CheckState;
  result?: CheckResult;
  error?: string;
  key?: string;
}

export interface CheckSummary {
  state: CheckState;
  fail?: number;
  review?: number;
  kind?: string;
  error?: string;
  findings?: { level: string; text: string; file?: string; line?: number }[];
}

const mtime = (file: string) => {
  try {
    return String(fs.statSync(file).mtimeMs);
  } catch {
    return '-';
  }
};

const fileKey = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));

export class Constitution {
  private readonly checks = new Map<string, RepoCheck>();
  private readonly problems = new Map<string, Problem[]>();
  private readonly uris = new Map<string, vscode.Uri[]>();
  private readonly queue: { dir: string; force: boolean }[] = [];
  private active = 0;
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly changed = this.emitter.event;
  readonly diagnostics = vscode.languages.createDiagnosticCollection('claudeHarness.standard');

  constructor(readonly provider: () => Provider | undefined, private readonly globalSettings: () => string) {}

  dispose(): void {
    this.diagnostics.dispose();
    this.emitter.dispose();
  }

  available(): boolean {
    return !!this.provider();
  }

  async tools(): Promise<{ provider?: Provider; py?: string[]; error?: string }> {
    const provider = this.provider();
    if (!provider) return { error: NO_PROVIDER };
    const scripts = [provider.check, provider.fix, provider.scaffold].filter((s): s is string => !!s);
    const py = scripts.some(needsPython) ? await findPython() : undefined;
    if (scripts.some(needsPython) && !py) return { provider, error: 'Python 3 was not found on PATH (python, py -3 or python3).' };
    return { provider, py };
  }

  clear(): void {
    this.checks.clear();
    this.problems.clear();
    this.uris.clear();
    this.diagnostics.clear();
    this.emitter.fire();
  }

  get(dir: string): RepoCheck {
    return this.checks.get(dir) ?? { state: 'unchecked' };
  }

  summary(dir: string, withFindings = false): CheckSummary {
    const c = this.get(dir);
    const s: CheckSummary = { state: c.state, fail: c.result?.fail, review: c.result?.review, kind: c.result?.kind, error: c.error };
    if (withFindings && c.result)
      s.findings = c.result.findings.map(f => ({
        level: f.level,
        text: f.text,
        file: f.locations[0] ? path.join(dir, ...f.locations[0].file.split('/')) : undefined,
        line: f.locations[0]?.line ?? undefined,
      }));
    return s;
  }

  problemsFor(file: string): Problem[] {
    return this.problems.get(fileKey(file)) ?? [];
  }

  private keyOf(dir: string): string {
    const md = path.join(dir, 'CLAUDE.md');
    let imports: string[] = [];
    try {
      imports = fs
        .readFileSync(md, 'utf8')
        .split(/\r?\n/)
        .map(l => /^@(\S+)\s*$/.exec(l)?.[1])
        .filter((x): x is string => !!x)
        .map(rel => mtime(path.join(dir, rel)));
    } catch {
      imports = [];
    }
    return [md, path.join(dir, '.claude', 'settings.json'), path.join(dir, '.claude', 'settings.local.json'), path.join(dir, '.claude', 'hooks'), this.globalSettings()].map(mtime).concat(imports).join('|');
  }

  ensure(dirs: string[], force = false): void {
    if (!this.available()) return;
    for (const dir of dirs) {
      const current = this.checks.get(dir);
      if (current?.state === 'running') continue;
      if (!force && current && current.state !== 'unchecked' && current.key === this.keyOf(dir)) continue;
      if (this.queue.some(q => q.dir === dir)) continue;
      this.queue.push({ dir, force });
    }
    this.pump();
  }

  private pump(): void {
    while (this.active < 3 && this.queue.length) {
      const { dir } = this.queue.shift()!;
      this.active++;
      this.checks.set(dir, { ...this.get(dir), state: 'running' });
      this.emitter.fire();
      void this.runOne(dir).finally(() => {
        this.active--;
        this.emitter.fire();
        this.pump();
      });
    }
  }

  private async runOne(dir: string): Promise<void> {
    const key = this.keyOf(dir);
    const { provider, py, error } = await this.tools();
    if (!provider || error) {
      this.checks.set(dir, { state: provider ? 'no-python' : 'no-plugin', error, key });
      return;
    }
    try {
      const result = await checkRepo(provider, py, dir);
      this.checks.set(dir, { state: result.fail ? 'fail' : result.review ? 'review' : 'pass', result, key });
      this.publish(dir, result);
    } catch (e) {
      this.checks.set(dir, { state: 'error', error: (e as Error).message, key });
    }
  }

  private publish(dir: string, result: CheckResult): void {
    for (const uri of this.uris.get(dir) ?? []) {
      this.diagnostics.delete(uri);
      this.problems.delete(fileKey(uri.fsPath));
    }
    const texts = new Map<string, string[]>();
    const linesOf = (file: string) => {
      if (!texts.has(file)) {
        try {
          texts.set(file, fs.readFileSync(file, 'utf8').split(/\r?\n/));
        } catch {
          texts.set(file, []);
        }
      }
      return texts.get(file)!;
    };
    const found = problemsOf(result, dir, (file, token) => {
      const i = linesOf(file).findIndex(l => l.includes(token));
      return i < 0 ? undefined : i + 1;
    });
    const byFile = new Map<string, Problem[]>();
    for (const p of found) byFile.set(p.file, [...(byFile.get(p.file) ?? []), p]);
    const uris: vscode.Uri[] = [];
    for (const [file, list] of byFile) {
      const uri = vscode.Uri.file(file);
      uris.push(uri);
      this.problems.set(fileKey(file), list);
      this.diagnostics.set(
        uri,
        list.map(p => {
          const text = linesOf(file)[p.line] ?? '';
          const col = p.token ? text.indexOf(p.token) : -1;
          const range = col >= 0 ? new vscode.Range(p.line, col, p.line, col + p.token!.length) : new vscode.Range(p.line, 0, p.line, Math.max(text.length, 1));
          const severity = p.level === 'FAIL' ? vscode.DiagnosticSeverity.Error : p.level === 'REVIEW' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information;
          const d = new vscode.Diagnostic(range, p.message, severity);
          d.source = 'harness standard';
          d.code = p.code;
          return d;
        })
      );
    }
    this.uris.set(dir, uris);
  }
}
