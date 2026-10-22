import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import * as os from 'node:os';
import { projectSlug } from '../../src/fleet';
import { PLANS, WEEK_MS, accountWeek, addWeek, findAccountSession, listAccountSessions, listSessions, messageCost, parseAccounts, planLimit, weekEntries, WeekModel } from '../../src/sessions';

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

const NOW = Date.parse('2026-10-22T12:00:00.000Z');
const reply = (id: string, model: string, at: number, usage: object = { input_tokens: 1000, output_tokens: 1000 }) => ({
  type: 'assistant',
  uuid: `u-${id}`,
  timestamp: new Date(at).toISOString(),
  message: { id, model, usage, content: [] },
});

test('weekly totals keep the 7-day window edges and group by model', () => {
  const models = new Map<string, WeekModel>();
  addWeek(
    models,
    new Set(),
    weekEntries([
      reply('a', 'claude-opus-5-5', NOW - 1000),
      reply('b', 'claude-opus-5-5', NOW - WEEK_MS + 1000),
      reply('c', 'claude-opus-5-5', NOW - WEEK_MS - 1000),
      reply('d', 'claude-sonnet-5-5', NOW - 5000),
    ]),
    NOW - WEEK_MS,
    NOW
  );
  assert.deepEqual([...models.keys()].sort(), ['claude-opus-5-5', 'claude-sonnet-5-5']);
  const opus = models.get('claude-opus-5-5')!;
  assert.equal(opus.messages, 2, 'the reply 1 s outside the window is left out');
  assert.equal(opus.input, 2000);
  assert.equal(opus.output, 2000);
  assert.equal(opus.cost, 2 * messageCost('claude-opus-5-5', { input_tokens: 1000, output_tokens: 1000 }));
  assert.equal(models.get('claude-sonnet-5-5')!.messages, 1);
});

test('weekly totals count a repeated message id once, across files', () => {
  const models = new Map<string, WeekModel>();
  const seen = new Set<string>();
  const once = weekEntries([reply('a', 'claude-opus-5-5', NOW - 1000), reply('a', 'claude-opus-5-5', NOW - 900)]);
  addWeek(models, seen, once, NOW - WEEK_MS, NOW);
  addWeek(models, seen, weekEntries([reply('a', 'claude-opus-5-5', NOW - 1000)]), NOW - WEEK_MS, NOW);
  assert.equal(models.get('claude-opus-5-5')!.messages, 1);
});

test('weekEntries skips synthetic models, records without usage and without a time', () => {
  const entries = weekEntries([
    reply('a', '<synthetic>', NOW),
    { type: 'assistant', timestamp: new Date(NOW).toISOString(), message: { id: 'x', model: 'claude-opus-5-5' } },
    { type: 'assistant', message: { id: 'y', model: 'claude-opus-5-5', usage: { input_tokens: 1 } } },
    { type: 'user', timestamp: new Date(NOW).toISOString(), message: { id: 'z', model: 'claude-opus-5-5', usage: { input_tokens: 1 } } },
    reply('ok', 'claude-opus-5-5', NOW),
  ]);
  assert.deepEqual(entries.map(e => e.key), ['ok']);
});

test('accountWeek sums every repo and the agent files of an account, as a share of its plan', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-week-'));
  const root = path.join(tmp, '.claude');
  const write = (file: string, records: unknown[]) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n');
  };
  const usage = { input_tokens: 1_000_000 };
  write(path.join(root, 'projects', 'repo-one', 's1.jsonl'), [reply('a', 'claude-opus-5-5', NOW - 1000, usage)]);
  write(path.join(root, 'projects', 'repo-two', 's2.jsonl'), [reply('a', 'claude-opus-5-5', NOW - 1000, usage), reply('b', 'claude-opus-5-5', NOW - 2000, usage)]);
  write(path.join(root, 'projects', 'repo-two', 's2', 'subagents', 'agent-1.jsonl'), [reply('c', 'claude-sonnet-5-5', NOW - 3000, usage)]);
  write(path.join(root, 'projects', 'repo-two', 'old.jsonl'), [reply('d', 'claude-opus-5-5', NOW - WEEK_MS - 5000, usage)]);
  const week = await accountWeek({ label: 'Work', root, plan: 'team-standard' }, NOW);
  assert.equal(week.account, 'Work');
  assert.deepEqual(week.models.map(m => [m.model, m.messages]), [['claude-opus-5-5', 2], ['claude-sonnet-5-5', 1]]);
  const cost = messageCost('claude-opus-5-5', { input_tokens: 1_000_000 }) * 2 + messageCost('claude-sonnet-5-5', { input_tokens: 1_000_000 });
  assert.ok(Math.abs(week.cost - cost) < 1e-9);
  assert.equal(week.tokens, 3_000_000);
  assert.equal(week.limit, planLimit('team-standard'));
  assert.ok(Math.abs((week.share ?? 0) - cost / planLimit('team-standard')) < 1e-9);
  assert.equal((await accountWeek({ label: 'Plain', root }, NOW)).share, undefined);
});
