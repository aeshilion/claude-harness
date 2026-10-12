export interface McpInfo {
  server?: string;
  version?: string;
  instructions?: string;
  tools?: { name: string; description: string }[];
  error?: string;
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
    if (res.status === 401 || res.status === 403) throw new Error('Needs sign-in, so only Claude can read its tools.');
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
    return { error: (e as Error).name === 'TimeoutError' ? 'The server did not answer within 10 seconds.' : (e as Error).message };
  }
}
