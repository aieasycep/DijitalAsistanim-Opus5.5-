import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ROOT,
  checkText,
  extractTestIds,
  icuRegExp,
  lintFlow,
  lintMaestro,
  matchesTestId,
  requiredFlows,
  textContext,
  type Problem,
} from '../maestro-lint.ts';

test('the committed Maestro suite is clean', () => {
  const problems = lintMaestro();
  assert.deepEqual(
    problems.map((p) => `${p.file}: ${p.message}`),
    [],
  );
});

test('every E2E-M, E2E-A…J, E2E-S and TST-E2E-M ID of TEST_PLAN §9 is required', () => {
  const required = requiredFlows(readFileSync(join(ROOT, 'docs', 'TEST_PLAN.md'), 'utf8'));
  const ids = required.map((r) => r.id);
  assert.equal(ids.filter((id) => id.startsWith('E2E-M-')).length, 20);
  assert.deepEqual(
    ids.filter((id) => /^E2E-[A-J]$/.test(id)),
    ['E2E-A', 'E2E-B', 'E2E-C', 'E2E-D', 'E2E-E', 'E2E-F', 'E2E-G', 'E2E-H', 'E2E-I', 'E2E-J'],
  );
  assert.ok(ids.filter((id) => id.startsWith('E2E-S-')).length >= 22);
  assert.equal(ids.filter((id) => id.startsWith('TST-E2E-M-')).length, 4);
  assert.ok(required.some((r) => r.path === 'flows/m102/offline.yaml'));
});

test('testIDs are extracted from literals, templates and fallbacks; templates match any key', () => {
  const ids = extractTestIds(
    'testID="email.screen" testID={`approvals.card.${model.id}`} testID ?? \'list.loading\' { testID: "x.y" }',
  );
  assert.deepEqual(ids.sort(), [
    'approvals.card.${model.id}',
    'email.screen',
    'list.loading',
    'x.y',
  ]);
  assert.ok(matchesTestId('approvals.card.${output.ids.approvalCalendar}', ids));
  assert.ok(matchesTestId('approvals.card.123', ids));
  assert.ok(matchesTestId('email.screen', ids));
  assert.equal(matchesTestId('email.screens', ids), false);
  assert.equal(matchesTestId('approvals.cards.1', ids), false);
});

test('copy must be Turkish catalog text (ICU arguments match anything) or demo data', () => {
  const ctx = textContext();
  assert.equal(checkText('${output.t.reply.approveSend}', ctx), null);
  assert.match(checkText('${output.t.reply.nope}', ctx) ?? '', /unknown catalog key/);
  assert.match(checkText('${output.t.reminder.set}', ctx) ?? '', /ICU arguments/);
  assert.equal(checkText('Göndermeyi Onayla', ctx), null);
  assert.equal(checkText('Ahmet Yılmaz', ctx), null);
  assert.equal(checkText('Hatırlatıcı kuruldu · 16:00', ctx), null);
  assert.match(checkText('Bambaşka bir metin', ctx) ?? '', /neither/);
  assert.ok(icuRegExp('{count, plural, one {# mail} other {# mail}} kaldı').test('3 mail kaldı'));
});

test('unknown commands, unknown ids, missing files and a missing appId are reported', () => {
  const ctx = textContext();
  const problems: Problem[] = [];
  const flow = [
    'appId: com.example',
    'name: "x"',
    '---',
    '- tapOn: { id: "email.screen" }',
    '- tapOn: { id: "does.not.exist" }',
    '- pressKey: Enter',
    '- runFlow: ../nope.yaml',
    '- assertVisible: "Bambaşka bir metin"',
  ].join('\n');
  lintFlow(
    join(ROOT, 'apps', 'mobile', '.maestro', 'flows', 'm102', 'x.yaml'),
    flow,
    ['email.screen'],
    ctx,
    problems,
  );
  const messages = problems.map((p) => p.message).join('\n');
  assert.match(messages, /appId must be/);
  assert.match(messages, /does\.not\.exist/);
  assert.match(messages, /"pressKey" is not allowed/);
  assert.match(messages, /nope\.yaml does not exist/);
  assert.match(messages, /neither Turkish catalog copy/);
  assert.equal(messages.includes('"email.screen"'), false);
});

test('a YAML syntax error is reported instead of thrown', () => {
  const problems: Problem[] = [];
  lintFlow('bad.yaml', 'appId: [\n---\n- back', [], textContext(), problems);
  assert.match(problems[0]?.message ?? '', /^YAML:/);
});
