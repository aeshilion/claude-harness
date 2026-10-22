import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import * as os from 'node:os';
import { projectSlug } from '../../src/fleet';
import { PLANS, findAccountSession, listAccountSessions, listSessions, parseAccounts, planLimit } from '../../src/sessions';

test('PLANS matches the BILLING table of the panel, ids, labels and figures', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'media', 'panel.js'), 'utf8');
  const table = /const BILLING = \[([\s\S]*?)\n  \];/.exec(source)?.[1] ?? '';
  const rows = [...table.matchAll(/\['([^']+)', '([^']+)', '[^']+', (\d+)\]/g)].map(m => ({ id: m[1], label: m[2], limit: Number(m[3]) }));
  assert.deepEqual(rows, PLANS);
  assert.equal(PLANS[PLANS.length - 1].id, 'api', 'api stays last: the panel falls back to the last row');
});

test('Team Standard is a fifth of Team Premium and Pro a fifth of Max 5x, rounded', () => {
  assert.equal(planLimit('team-standard'), Math.round(planLimit('team') / 5));
  assert.equal(planLimit('pro'), Math.round(planLimit('max5') / 5));
});

test('an unknown or missing plan has no limit', () => {
  assert.equal(planLimit(undefined), 0);
  assert.equal(planLimit('platinum'), 0);
  assert.equal(planLimit('api'), 0);
});

test('parseAccounts with no setting is the main folder alone', () => {
  assert.deepEqual(parseAccounts('/h/.claude', undefined, undefined, '/h'), [{ label: 'Default', root: '/h/.claude', plan: undefined }]);
  assert.deepEqual(parseAccounts('/h/.claude', 'team', [], '/h'), [{ label: 'Default', root: '/h/.claude', plan: 'team' }]);
});

test('parseAccounts expands ~, defaults the label, and drops bad entries and repeats', () => {
  const list = parseAccounts(
    '/h/.claude',
    'bogus',
    [
      { path: '~/.claude-work', plan: 'team-standard' },
      { label: 'Side', path: '/x/side', plan: 'platinum' },
      { label: 'Again', path: '/h/.claude-work/' },
      { label: 'Main again', path: '/h/.claude' },
      { label: 'No path' },
      { path: '   ' },
      null,
      'text',
    ],
    '/h'
  );
  assert.deepEqual(list, [
    { label: 'Default', root: '/h/.claude', plan: undefined },
    { label: '.claude-work', root: path.join('/h', '.claude-work'), plan: 'team-standard' },
    { label: 'Side', root: '/x/side', plan: undefined },
  ]);
  assert.deepEqual(parseAccounts('/m', undefined, 'not an array', '/h').length, 1);
});

function twoAccounts() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-accounts-'));
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  const make = (name: string, id: string, at: string) => {
    const root = path.join(tmp, name);
    const file = path.join(root, 'projects', projectSlug(repo), `${id}.jsonl`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ type: 'user', timestamp: at, sessionId: id, message: { role: 'user', content: `prompt of ${name}` } }) + '\n');
    return root;
  };
  const a = make('.claude', '11111111-2222-3333-4444-555555555555', '2026-10-20T10:00:00.000Z');
  const b = make('.claude-work', '66666666-7777-8888-9999-000000000000', '2026-10-20T11:00:00.000Z');
  return { repo, a, b };
}

test('listAccountSessions lists every account, labeled, and one account stays unlabeled', () => {
  const { repo, a, b } = twoAccounts();
  const one = listAccountSessions(repo, [{ label: 'Default', root: a }]);
  assert.deepEqual(one, listSessions(repo, a));
  assert.equal(one[0].account, undefined);
  const both = listAccountSessions(repo, [{ label: 'Default', root: a }, { label: 'Work', root: b, plan: 'team' }]);
  assert.deepEqual(both.map(s => [s.title, s.account, s.accountRoot]), [
    ['prompt of .claude-work', 'Work', b],
    ['prompt of .claude', 'Default', a],
  ]);
});

test('findAccountSession finds a session of the second account', () => {
  const { repo, a, b } = twoAccounts();
  const accounts = [{ label: 'Default', root: a }, { label: 'Work', root: b }];
  assert.equal(findAccountSession(repo, accounts, '66666666-7777-8888-9999-000000000000')?.account, 'Work');
  assert.equal(findAccountSession(repo, accounts, 'ffffffff-7777-8888-9999-000000000000'), undefined);
});
