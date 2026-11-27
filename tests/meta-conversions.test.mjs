import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { insertQuizResponse, publishDraft, reserveBooking, writeAgenda, writeDraft, writeMetaSettings } from '../src/lib/local-store.ts';

registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('/meta-conversions.ts') && specifier === './local-store') return next(specifier + '.ts', context);
  return next(specifier, context);
} });

process.env.AGENDADOR_DB_PATH = join(mkdtempSync(join(tmpdir(), 'gatu-meta-')), 'test.sqlite');
process.env.NODE_ENV = 'development';
process.env.META_PIXEL_ID = '123456789';
process.env.META_CONVERSIONS_ACCESS_TOKEN = 'test-token';

test('envia Schedule somente para reservas autorizadas após a confirmação', async t => {
  const { deliverMetaConversions, metaConversionsConfig } = await import('../src/lib/meta-conversions.ts');
  delete process.env.META_TEST_EVENT_CODE;
  assert.equal(metaConversionsConfig(), null);

  process.env.META_TEST_EVENT_CODE = 'TEST123';
  const { destination } = metaConversionsConfig();
  writeAgenda('{}', 0);
  writeDraft('{}', 0);
  publishDraft('quiz', 1);
  const now = Date.now();
  const response = { outcome: 'contact', answers: { email: 'Teste@EXAMPLE.test', phone: '(27) 99999-0000' }, extra: [] };
  const authorized = { ...response, metaTracking: { consentAt: now, fbp: 'fb.1.1795789342866.123',
    fbc: 'fb.1.1795789342866.click', eventSourceUrl: 'https://gatu.digital/quiz', clientUserAgent: 'Test browser' } };
  const first = { start: now + 3_600_000, end: now + 7_200_000 };
  const next = { start: first.end, end: first.end + 3_600_000 };
  const unconfigured = { start: next.end, end: next.end + 3_600_000 };

  insertQuizResponse('quiz', 1, 'without-booking', authorized);
  assert.deepEqual(reserveBooking('quiz', 1, 1, 'no-consent', first, 'Diagnóstico', response, '', destination), first);
  assert.deepEqual(reserveBooking('quiz', 1, 1, 'no-config', unconfigured, 'Diagnóstico', authorized), unconfigured);
  assert.equal(reserveBooking('quiz', 1, 1, 'conflict', first, 'Diagnóstico', authorized, '', destination), null);
  assert.deepEqual(reserveBooking('quiz', 1, 1, 'confirmed', next, 'Diagnóstico', authorized, '', destination), next);
  assert.deepEqual(reserveBooking('quiz', 1, 1, 'confirmed', next, 'Diagnóstico', authorized, '', destination), next);

  const calls = [];
  const send = async (url, options) => {
    calls.push({ url, method: options.method, body: JSON.parse(options.body) });
    return Response.json({ events_received: 1 });
  };

  process.env.META_TEST_EVENT_CODE = 'OTHER';
  await deliverMetaConversions(send);
  assert.equal(calls.length, 0);
  process.env.META_TEST_EVENT_CODE = 'TEST123';
  await Promise.all([deliverMetaConversions(send), deliverMetaConversions(send)]);
  await deliverMetaConversions(send);

  const hash = value => createHash('sha256').update(value).digest('hex');
  assert.equal(calls.length, 1);
  const [{ url, method, body }] = calls;
  assert.equal(url, 'https://graph.facebook.com/v25.0/123456789/events');
  assert.equal(method, 'POST');
  assert.equal(body.test_event_code, 'TEST123');
  assert.equal(body.access_token, 'test-token');
  assert.equal(body.data.length, 1);
  const [{ event_time, ...event }] = body.data;
  assert.ok(event_time >= Math.floor(now / 1000) && event_time <= Math.floor(Date.now() / 1000));
  assert.deepEqual(event, {
    event_name: 'Schedule',
    event_id: 'schedule-confirmed',
    action_source: 'website',
    event_source_url: 'https://gatu.digital/quiz',
    user_data: {
      client_user_agent: 'Test browser',
      fbp: authorized.metaTracking.fbp,
      fbc: authorized.metaTracking.fbc,
      em: [hash('teste@example.test')],
      ph: [hash('5527999990000')],
    },
  });

  const retryWindow = { start: unconfigured.end, end: unconfigured.end + 3_600_000 };
  reserveBooking('quiz', 1, 1, 'retry', retryWindow, 'Diagnóstico', authorized, '', destination);
  const retryAttempts = [];
  const flaky = async (_url, options) => {
    retryAttempts.push(JSON.parse(options.body).data[0]);
    if (retryAttempts.length === 1) return new Response(null, { status: 503 });
    return Response.json({ events_received: 1 });
  };
  await deliverMetaConversions(flaky);
  await deliverMetaConversions(flaky);
  assert.equal(retryAttempts.length, 1);
  const retryTime = Date.now() + 31_000;
  t.mock.method(Date, 'now', () => retryTime);
  await deliverMetaConversions(flaky);
  assert.equal(retryAttempts.length, 2);
  assert.deepEqual(retryAttempts[0], retryAttempts[1]);
});

test('configuração do painel tem prioridade sobre o ambiente e guarda o token criptografado', async () => {
  const { currentMetaSettings, metaConversionsConfig } = await import('../src/lib/meta-conversions.ts');
  process.env.META_TEST_EVENT_CODE = 'TEST123';
  assert.deepEqual(currentMetaSettings(), {
    pixelId: '123456789', token: 'test-token', testCode: 'TEST123', revision: 0,
  });
  const initialDestination = metaConversionsConfig().destination;
  const replacement = { pixelId: '987654321', token: 'replacement-token', testCode: 'TEST456' };
  assert.equal(writeMetaSettings(replacement, 0), true);
  assert.equal(writeMetaSettings({ ...replacement, testCode: 'STALE' }, 0), false);
  assert.deepEqual(currentMetaSettings(), { ...replacement, revision: 1 });
  assert.equal(metaConversionsConfig().pixelId, replacement.pixelId);
  assert.notEqual(metaConversionsConfig().destination, initialDestination);

  const database = new DatabaseSync(process.env.AGENDADOR_DB_PATH, { readOnly: true });
  const row = database.prepare('SELECT encrypted_token FROM meta_settings').get();
  database.close();
  assert.ok(row.encrypted_token);
  assert.equal(row.encrypted_token.includes(replacement.token), false);
  assert.equal(writeMetaSettings({ ...replacement, testCode: '' }, 1), true);
  assert.equal(metaConversionsConfig(), null);
});

test('diagnóstico usa apenas dados fictícios e exige o código de teste', async () => {
  const { sendMetaConnectionTest, currentMetaSettings } = await import('../src/lib/meta-conversions.ts');
  const revision = currentMetaSettings().revision;
  const settings = { pixelId: '123456789', token: 'test-diagnostic-token', testCode: '' };
  assert.equal(writeMetaSettings(settings, revision), true);
  const calls = [];
  const fakeMeta = async (url, request) => {
    calls.push({ url, body: JSON.parse(request.body) });
    return Response.json({ events_received: 1 });
  };
  assert.match((await sendMetaConnectionTest(fakeMeta)).error, /código de teste/);
  assert.deepEqual(calls, []);

  assert.equal(writeMetaSettings({ ...settings, testCode: 'TEST789' }, revision + 1), true);
  const result = await sendMetaConnectionTest(fakeMeta);
  assert.equal(result.eventName, 'AgendadorTesteConexao');
  assert.equal(result.pixelId, settings.pixelId);
  const [{ url, body }] = calls;
  assert.equal(url, 'https://graph.facebook.com/v25.0/123456789/events');
  assert.equal(body.test_event_code, 'TEST789');
  const [event] = body.data;
  assert.equal(event.event_name, result.eventName);
  assert.equal(event.event_id, result.eventId);
  assert.equal(event.action_source, 'system_generated');
  assert.equal(event.opt_out, true);
  const syntheticHash = createHash('sha256').update(`${result.eventId}@example.invalid`).digest('hex');
  assert.deepEqual(event.user_data, { em: [syntheticHash] });

  const rejection = await sendMetaConnectionTest(async () => Response.json({
    error: { code: 190, message: 'response detail containing unexpected data' },
  }, { status: 400 }));
  assert.match(rejection.error, /190/);
  assert.doesNotMatch(rejection.error, /unexpected data/);
});
