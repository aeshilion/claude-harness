import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { PLANS, planLimit } from '../../src/sessions';

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
