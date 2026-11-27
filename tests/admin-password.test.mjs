import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdmin, createSession, hasSession, loadDraft, verifyAdminCredentials, writeDraft } from '../src/lib/local-store.ts';

test('redefine a senha do administrador, invalida sessões e preserva dados do Agendador', async () => {
  process.env.AGENDADOR_DB_PATH = join(mkdtempSync(join(tmpdir(), 'gatu-admin-')), 'test.sqlite');
  const email = 'admin@example.invalid';
  const original = 'senha-antiga-para-teste';
  const replacement = 'senha-nova-para-teste';
  const originalHash = await createAdmin(email, original);
  const currentSession = createSession(originalHash);
  assert.equal(hasSession(currentSession), true);
  writeDraft('{"version":1}', 0);

  function reset(target, confirmation) {
    return spawnSync(process.execPath, ['scripts/create-admin.mjs', '--reset-password', target], {
      input: `${replacement}\n${confirmation}\n`,
      encoding: 'utf8',
    });
  }

  assert.equal(reset(email, 'uma-outra-senha').status, 1);
  assert.equal(reset('outro@example.invalid', replacement).status, 1);
  assert.equal(hasSession(currentSession), true);

  const result = reset(email, replacement);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Senha redefinida/);
  assert.doesNotMatch(result.stdout, /senha-nova-para-teste/);
  assert.equal(hasSession(currentSession), false);
  assert.equal(createSession(originalHash), null);
  assert.equal(await verifyAdminCredentials(email, original), null);
  const newHash = await verifyAdminCredentials(email, replacement);
  assert.ok(newHash);
  assert.equal(hasSession(createSession(newHash)), true);
  assert.equal(loadDraft().config, '{"version":1}');
});
