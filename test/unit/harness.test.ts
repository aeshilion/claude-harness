import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { createAsset, duplicateAsset, fromFields, globalScope, knownRepos, readMarkdown, renameAsset, repoScope, scan, serializeMarkdown, setPluginEnabled, toFields } from '../../src/harness';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-'));
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  write('CLAUDE.md', '# Rules\n');
  write('agents/dotnet-expert.md', '---\nname: dotnet-expert\ndescription: >-\n  .NET work\n  in any repo.\ntools: Read, Write\n---\n\nBody\n');
  write('skills/hugo/SKILL.md', '---\nname: hugo\ndescription: Hugo engine\n---\n\n# Hugo\n');
  write('skills/hugo/references/traps.md', '# Traps\n');
  write('commands/git/push.md', '---\ndescription: Push\n---\n\nDo it\n');
  write('workflows/scaffold.js', "export const meta = {\n  name: 'scaffold',\n  description: 'Scaffold a portal',\n}\n");
  write('settings.json', '{\n  "enabledPlugins": {\n    "a@m": true,\n    "b@m": false\n  },\n  "hooks": {\n    "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "guard.sh" }] }]\n  }\n}\n');
  const userConfig = path.join(root, 'user.json');
  fs.writeFileSync(userConfig, JSON.stringify({ mcpServers: { github: { type: 'http', url: 'https://x' } } }));
  return { ...globalScope(root), mcpFile: userConfig };
}

test('scan finds every kind', () => {
  const paths = fixture();
  const byKind = Object.fromEntries(scan(paths).map(c => [c.kind, c.items]));
  assert.equal(byKind.memory.length, 1);
  assert.equal(byKind.agent[0].description, '.NET work in any repo.');
  assert.deepEqual(byKind.skill[0].files, ['references/traps.md', 'SKILL.md']);
  assert.equal(byKind.command[0].name, 'git:push');
  assert.equal(byKind.workflow[0].description, 'Scaffold a portal');
  assert.equal(byKind.hook[0].name, 'PreToolUse · Bash');
  assert.equal(byKind.mcp[0].name, 'github');
  assert.deepEqual(byKind.plugin.map((p: { enabled?: boolean }) => p.enabled), [true, false]);
  assert.equal(byKind.settings.length, 1);
});

test('unchanged frontmatter keeps its folded style', () => {
  const original = '---\nname: x\ndescription: >-\n  long\n  text\n---\n\nBody\n';
  const doc = readMarkdownFromText(original);
  assert.equal(serializeMarkdown(original, doc.data, doc.body), original);
  const edited = serializeMarkdown(original, { ...doc.data, model: 'opus' }, doc.body);
  assert.match(edited, /description: >-\n {2}long text\nmodel: opus\n---/);
});

test('crlf files stay crlf', () => {
  const original = '---\r\nname: x\r\n---\r\n\r\nBody\r\n';
  const out = serializeMarkdown(original, { name: 'y' }, '\nBody 2\n');
  assert.equal(out, '---\r\nname: y\r\n---\r\n\r\nBody 2\r\n');
});

test('fields round trip', () => {
  const data = { name: 'a', description: 'b', tools: ['Read', 'Write'], 'user-invocable': false, hooks: { PreToolUse: [{ matcher: 'x' }] } };
  assert.deepEqual(fromFields(toFields(data)), data);
});

test('create, rename and duplicate update names', () => {
  const paths = fixture();
  const file = createAsset(paths, 'agent', 'new-agent');
  assert.equal(readMarkdown(file).data.name, 'new-agent');
  const skill = scan(paths).find(c => c.kind === 'skill')!.items[0];
  const renamed = renameAsset(paths, skill, 'hugo-engine');
  assert.equal(readMarkdown(renamed).data.name, 'hugo-engine');
  assert.ok(fs.existsSync(path.join(paths.root, 'skills', 'hugo-engine', 'references', 'traps.md')));
  assert.ok(!fs.existsSync(path.join(paths.root, 'skills', 'hugo')));
  const wf = scan(paths).find(c => c.kind === 'workflow')!.items[0];
  const copy = duplicateAsset(paths, wf, 'scaffold-two');
  assert.match(fs.readFileSync(copy, 'utf8'), /name: 'scaffold-two'/);
  assert.throws(() => createAsset(paths, 'agent', 'new-agent'));
});

test('plugin toggle edits only that key', () => {
  const paths = fixture();
  setPluginEnabled(paths, 'b@m', true);
  const text = fs.readFileSync(path.join(paths.root, 'settings.json'), 'utf8');
  assert.match(text, /"b@m": true/);
  assert.match(text, /"hooks"/);
});

function readMarkdownFromText(text: string) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'md-')), 'x.md');
  fs.writeFileSync(file, text);
  return readMarkdown(file);
}

test('unquoted colons in a description still parse and save as valid yaml', () => {
  const original = '---\nname: maf\ndescription: Expert in X. Example tasks: "a", "b"\ntools:\n  - Read\n  - Bash\n---\n\nBody\n';
  const doc = readMarkdownFromText(original);
  assert.equal(doc.data.description, 'Expert in X. Example tasks: "a", "b"');
  assert.deepEqual(doc.data.tools, ['Read', 'Bash']);
  assert.equal(serializeMarkdown(original, doc.data, doc.body), original);
  const edited = serializeMarkdown(original, { ...doc.data, model: 'opus' }, doc.body);
  assert.equal(readMarkdownFromText(edited).data.description, 'Expert in X. Example tasks: "a", "b"');
  assert.equal(readMarkdownFromText(edited).data.model, 'opus');
});

test('repo scope reads project memory, .claude assets and .mcp.json', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-'));
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# Repo\n');
  fs.mkdirSync(path.join(repo, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.claude', 'agents', 'local.md'), '---\nname: local\ndescription: Local agent\n---\n');
  fs.writeFileSync(path.join(repo, '.mcp.json'), JSON.stringify({ mcpServers: { db: { command: 'node', args: ['db.js'] } } }));
  const scope = repoScope(repo);
  const byKind = Object.fromEntries(scan(scope).map(c => [c.kind, c.items]));
  assert.equal(byKind.memory[0].name, 'CLAUDE.md');
  assert.equal(byKind.agent[0].id, `repo:${repo}|agent:local`);
  assert.equal(byKind.mcp[0].description, 'stdio · node db.js');
  const file = createAsset(scope, 'skill', 'repo-skill');
  assert.equal(file, path.join(repo, '.claude', 'skills', 'repo-skill', 'SKILL.md'));
});

test('workspace folders with a local harness are listed even under the temp folder', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'local-'));
  fs.mkdirSync(path.join(repo, '.claude', 'agents'), { recursive: true });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'scratch-'));
  fs.writeFileSync(path.join(scratch, 'CLAUDE.md'), '# x\n');
  const config = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-')), 'user.json');
  fs.writeFileSync(config, JSON.stringify({ projects: { [scratch]: {} } }));
  const repos = knownRepos([repo], config).map(r => r.toLowerCase());
  assert.ok(repos.includes(path.resolve(repo).toLowerCase()));
  assert.ok(!repos.includes(path.resolve(scratch).toLowerCase()));
});
