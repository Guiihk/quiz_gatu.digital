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

test('envia InitiateCheckout uma vez ao entrar em Proposta enviada, mesmo sem valor', async () => {
  process.env.AGENDADOR_DB_PATH = join(mkdtempSync(join(tmpdir(), 'gatu-checkout-')), 'test.sqlite');
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
  const trackingInput = { fbclid: 'clique', userAgent: 'Test browser', slug: 'quiz' };
  for (const [index, id] of ['proposta', 'only-schedule'].entries()) {
    const start = now + (index + 1) * 3_600_000;
    const metaTracking = buildMetaTracking({ ...trackingInput, purchaseConsent: id === 'proposta' }, now);
    assert.ok(reserveBooking('quiz', 1, 1, id, { start, end: start + 3_600_000 }, 'Diagnóstico', {
      outcome: 'contact', answers: { email: 'Lead@EXAMPLE.test' }, extra: [], metaTracking,
    }));
  }

  const events = [];
  const send = async (_url, request) => {
    const body = JSON.parse(request.body);
    events.push(...body.data);
    return Response.json({ events_received: 1 });
  };
  writeCrmLead('proposta', 0, { stage: 'met' }, destination);
  writeCrmLead('only-schedule', 0, { stage: 'proposal' }, destination);
  assert.equal(writeCrmLead('proposta', 0, { stage: 'proposal' }, destination), null);
  await deliverMetaConversions(send);
  assert.deepEqual(events, []);

  const moved = writeCrmLead('proposta', 1, { stage: 'proposal' }, destination);
  assert.equal(moved.stage, 'proposal');
  assert.equal(moved.dealValueCents, null);
  writeCrmLead('proposta', 2, { stage: 'proposal' }, destination);
  await Promise.all([deliverMetaConversions(send), deliverMetaConversions(send)]);
  writeCrmLead('proposta', 2, { stage: 'met' }, destination);
  writeCrmLead('proposta', 3, { stage: 'proposal' }, destination);
  await deliverMetaConversions(send);

  assert.equal(events.length, 1);
  const [event] = events;
  assert.equal(event.event_name, 'InitiateCheckout');
  assert.equal(event.event_id, 'initiatecheckout-proposta');
  assert.equal(event.action_source, 'other');
  assert.ok(event.event_time >= Math.floor(now / 1000));
  assert.deepEqual(event.user_data, {
    client_user_agent: 'Test browser',
    fbc: `fb.1.${now}.clique`,
    em: [createHash('sha256').update('lead@example.test').digest('hex')],
  });
});
