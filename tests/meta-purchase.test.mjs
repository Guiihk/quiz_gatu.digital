import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishDraft, reserveBooking, writeAgenda, writeCrmLead, writeDraft } from '../src/lib/local-store.ts';
import { buildMetaTracking } from '../src/lib/meta-tracking.ts';

registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('/meta-conversions.ts') && specifier === './local-store') return next(specifier + '.ts', context);
  return next(specifier, context);
} });

test('envia Purchase uma vez por card autorizado que chegou a Ganho com valor salvo', async () => {
  process.env.AGENDADOR_DB_PATH = join(mkdtempSync(join(tmpdir(), 'gatu-purchase-')), 'test.sqlite');
  process.env.NODE_ENV = 'development';
  process.env.META_PIXEL_ID = '123456789';
  process.env.META_CONVERSIONS_ACCESS_TOKEN = 'mock-token';
  process.env.META_TEST_EVENT_CODE = 'TEST123';
  const { deliverMetaConversions, metaConversionsConfig } = await import('../src/lib/meta-conversions.ts');
  const { destination } = metaConversionsConfig();

  writeAgenda('{}', 0);
  writeDraft('{}', 0);
  publishDraft('quiz', 1);
  const now = Date.now();
  const firstSlot = now + 3_600_000;
  const answers = { email: 'Compra@EXAMPLE.test', phone: '(27) 99999-0000' };
  const trackingInput = { fbclid: 'clique', userAgent: 'Test browser', origin: 'https://gatu.digital', slug: 'quiz' };
  for (const [index, id] of ['won', 'missing-value', 'schedule-only', 'no-consent'].entries()) {
    const start = firstSlot + index * 3_600_000;
    const metaTracking = id === 'no-consent' ? undefined :
      buildMetaTracking({ ...trackingInput, purchaseConsent: id !== 'schedule-only' }, now);
    assert.ok(reserveBooking('quiz', 1, 1, id, { start, end: start + 3_600_000 }, 'Diagnóstico',
      { outcome: 'contact', answers, extra: [], metaTracking }));
  }

  const events = [];
  const send = async (_url, request) => {
    const body = JSON.parse(request.body);
    assert.equal(body.test_event_code, 'TEST123');
    events.push(...body.data);
    return Response.json({ events_received: 1 });
  };

  for (const id of ['won', 'schedule-only', 'no-consent']) {
    assert.equal(writeCrmLead(id, 0, { dealValueCents: 123456 }, destination).revision, 1);
  }
  await deliverMetaConversions(send);
  assert.equal(events.length, 0);

  assert.equal(writeCrmLead('won', 0, { stage: 'won' }, destination), null);
  assert.equal(writeCrmLead('won', 1, { stage: 'won' }, destination).revision, 2);
  assert.equal(writeCrmLead('won', 2, { dealValueCents: 345678 }, destination).revision, 3);
  assert.equal(writeCrmLead('schedule-only', 1, { stage: 'won' }, destination).revision, 2);
  assert.equal(writeCrmLead('no-consent', 1, { stage: 'won' }, destination).revision, 2);
  assert.equal(writeCrmLead('missing-value', 0, { stage: 'won' }, destination).revision, 1);
  await Promise.all([deliverMetaConversions(send), deliverMetaConversions(send)]);
  assert.equal(events.length, 1);
  const [purchase] = events;
  assert.equal(purchase.event_name, 'Purchase');
  assert.equal(purchase.event_id, 'purchase-won');
  assert.equal(purchase.action_source, 'other');
  assert.deepEqual(purchase.custom_data, { value: 1234.56, currency: 'BRL' });
  assert.equal(purchase.user_data.fbc, `fb.1.${now}.clique`);
  assert.deepEqual(purchase.user_data.em, [createHash('sha256').update('compra@example.test').digest('hex')]);
  assert.ok(purchase.event_time >= Math.floor(now / 1000));

  writeCrmLead('won', 3, { stage: 'proposal' }, destination);
  writeCrmLead('won', 4, { stage: 'won' }, destination);
  writeCrmLead('missing-value', 1, { dealValueCents: 98765 }, destination);
  await deliverMetaConversions(send);
  assert.deepEqual(events.map(event => [event.event_id, event.custom_data]), [
    ['purchase-won', { value: 1234.56, currency: 'BRL' }],
    ['initiatecheckout-won', undefined],
    ['purchase-missing-value', { value: 987.65, currency: 'BRL' }],
  ]);
});
