import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMetaTracking } from '../src/lib/meta-tracking.ts';

const now = Date.parse('2026-11-27T15:00:00Z');

test('o clique atual substitui um fbc antigo e usa a hora de chegada ao quiz', () => {
  const tracking = buildMetaTracking({
    slug: 'diagnostico', fbp: 'fb.1.1795780790000.123456', fbc: 'fb.1.1795780790000.oldClick',
    fbclid: 'New_Click-ID', clickSeenAt: now - 10_000,
    userAgent: 'Mozilla/5.0', origin: 'https://example.test/?ref=descartar',
  }, now);
  assert.equal(tracking.fbp, 'fb.1.1795780790000.123456');
  assert.equal(tracking.fbclid, 'New_Click-ID');
  assert.equal(tracking.fbc, `fb.1.${now - 10_000}.New_Click-ID`);
  assert.equal(tracking.eventSourceUrl, 'https://example.test/diagnostico');
  assert.equal(tracking.consentAt, now);
});

test('preserva o cookie do mesmo clique e deixa campos ausentes sem criar identificadores fictícios', () => {
  const preserved = 'fb.1.1795780790000.Current_ID';
  assert.equal(buildMetaTracking({ slug: 'quiz', fbclid: 'Current_ID', fbc: preserved }, now).fbc, preserved);
  assert.equal(buildMetaTracking({ slug: 'quiz', fbc: preserved }, now).fbclid, 'Current_ID');
  assert.deepEqual(buildMetaTracking({ slug: 'quiz', fbp: 'invalid-script', fbc: 'bad', fbclid: 'id with spaces' }, now), { consentAt: now });
});
