import { ChildProcess, execFile, spawn } from 'child_process';

export interface McpInfo {
  server?: string;
  version?: string;
  instructions?: string;
  tools?: { name: string; description: string }[];
  error?: string;
  signIn?: boolean;
}

type Rpc = { id?: number; result?: Record<string, unknown>; error?: { message?: string } };

function readRpc(text: string, contentType: string, id: number): Rpc | undefined {
  const messages = contentType.includes('text/event-stream')
    ? text
        .split(/\r?\n/)
        .filter(l => l.startsWith('data:'))
        .map(l => l.slice(5).trim())
    : [text];
  for (const m of messages) {
    try {
      const parsed = JSON.parse(m) as Rpc | Rpc[];
      const found = (Array.isArray(parsed) ? parsed : [parsed]).find(r => r.id === id);
      if (found) return found;
    } catch {
      // not json
    }
  }
  return undefined;
}

export async function probeHttp(url: string, headers: Record<string, string> = {}): Promise<McpInfo> {
  let session: string | undefined;
  const post = async (body: object, id?: number) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers, ...(session ? { 'mcp-session-id': session } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error('Needs sign-in.'), { signIn: true });
    if (!res.ok) throw new Error(`The server answered ${res.status} ${res.statusText}.`);
    session = res.headers.get('mcp-session-id') ?? session;
    return id === undefined ? undefined : readRpc(await res.text(), res.headers.get('content-type') ?? '', id);
  };
  try {
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-harness', version: '1' } } }, 1);
    if (!init?.result) throw new Error(init?.error?.message ?? 'No answer to initialize.');
    const serverInfo = (init.result.serverInfo ?? {}) as { name?: string; version?: string };
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => undefined);
    const list = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, 2);
    const tools = ((list?.result?.tools ?? []) as { name: string; description?: string }[]).map(t => ({ name: t.name, description: (t.description ?? '').trim() }));
    return { server: serverInfo.name, version: serverInfo.version, instructions: typeof init.result.instructions === 'string' ? init.result.instructions : undefined, tools };
  } catch (e) {
    return { error: (e as Error).name === 'TimeoutError' ? 'The server did not answer within 10 seconds.' : (e as Error).message, signIn: (e as { signIn?: boolean }).signIn };
  }
}

export interface StdioConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

const expand = (text: string, env: NodeJS.ProcessEnv) => text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_m, name: string, fallback?: string) => env[name] ?? fallback ?? '');
const quote = (arg: string) => (/^[\w@%+=:,./\-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`);

export function probeStdio(config: StdioConfig, cwd: string, timeoutMs = 60000): Promise<McpInfo> {
  const env = { ...process.env, ...Object.fromEntries(Object.entries(config.env ?? {}).map(([k, v]) => [k, expand(String(v), process.env)])) };
  const command = expand(config.command, env);
  const args = (config.args ?? []).map(a => expand(String(a), env));
  const windows = process.platform === 'win32';
  return new Promise(resolve => {
    let child: ChildProcess;
    try {
      child = windows ? spawn([command, ...args].map(quote).join(' '), { cwd, env, shell: true, windowsHide: true }) : spawn(command, args, { cwd, env, windowsHide: true });
    } catch (e) {
      resolve({ error: `Could not start it: ${(e as Error).message}` });
      return;
    }
    const waiting = new Map<number, (r: Rpc) => void>();
    let buffer = '';
    let stderr = '';
    let done = false;
    const finish = (info: McpInfo) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (windows && child.pid) execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => undefined);
      else child.kill();
      resolve(info);
    };
    const timer = setTimeout(() => finish({ error: `The server did not answer within ${timeoutMs / 1000} seconds.` }), timeoutMs);
    const send = (body: object) => child.stdin?.write(`${JSON.stringify(body)}\n`);
    const call = (id: number, method: string, params: object) =>
      new Promise<Rpc>(res => {
        waiting.set(id, res);
        send({ jsonrpc: '2.0', id, method, params });
      });
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        try {
          const msg = JSON.parse(line) as Rpc;
          if (typeof msg.id === 'number' && waiting.has(msg.id)) waiting.get(msg.id)!(msg);
        } catch {
          // not json
        }
      }
    });
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => (stderr = (stderr + chunk).slice(-2000)));
    child.stdin?.on('error', () => undefined);
    child.on('error', e => finish({ error: `Could not start it: ${e.message}` }));
    child.on('exit', code => finish({ error: `It exited with code ${code} before listing its tools.${stderr.trim() ? ` ${stderr.trim().split(/\r?\n/).slice(-3).join(' ')}` : ''}` }));
    void (async () => {
      const init = await call(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-harness', version: '1' } });
      if (!init.result) return finish({ error: init.error?.message ?? 'No answer to initialize.' });
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      const list = await call(2, 'tools/list', {});
      const serverInfo = (init.result.serverInfo ?? {}) as { name?: string; version?: string };
      const tools = ((list.result?.tools ?? []) as { name: string; description?: string }[]).map(t => ({ name: t.name, description: (t.description ?? '').trim() }));
      finish({ server: serverInfo.name, version: serverInfo.version, instructions: typeof init.result.instructions === 'string' ? init.result.instructions : undefined, tools });
    })();
  });
}
