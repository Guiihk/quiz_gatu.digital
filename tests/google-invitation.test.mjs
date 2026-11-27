import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishDraft, readGoogleConnection, reserveBooking, upcomingBookings, writeAgenda, writeDraft } from '../src/lib/local-store.ts';

registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('/google-calendar.ts') && ['./local-store', './schedule'].includes(specifier)) {
    return next(specifier + '.ts', context);
  }
  return next(specifier, context);
} });

test('Google recebe o convidado na criação, preserva convidados em eventos existentes e evita reenviar', async t => {
  process.env.AGENDADOR_DB_PATH = join(mkdtempSync(join(tmpdir(), 'gatu-invitation-test-')), 'test.sqlite');
  process.env.GOOGLE_CALENDAR_CLIENT_ID = 'test-client';
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'test-secret';
  process.env.GOOGLE_CALENDAR_REDIRECT_URI = 'http://127.0.0.1:3020/api/google-agenda/callback';
  const { connectGoogle, syncGoogleBooking } = await import('../src/lib/google-calendar.ts');
  const events = new Map();
  const writes = [];
  const scope = 'https://www.googleapis.com/auth/calendar.events.owned https://www.googleapis.com/auth/calendar.events.freebusy';
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input);
    if (url.hostname === 'oauth2.googleapis.com') {
      return Response.json({ refresh_token: 'test-refresh', access_token: 'test-token', expires_in: 3600, scope });
    }
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (init.method === 'POST') {
      if (events.has(body.id)) return new Response(null, { status: 409 });
      const event = { ...body, etag: '"version-1"' };
      events.set(body.id, event);
      writes.push({ method: 'POST', sendUpdates: url.searchParams.get('sendUpdates'), body });
      return Response.json(event);
    }
    const id = url.pathname.split('/').at(-1);
    const event = events.get(id);
    if (init.method === 'GET') return Response.json(event);
    assert.equal(init.method, 'PATCH');
    assert.equal(new Headers(init.headers).get('if-match'), event.etag);
    const updated = { ...event, ...body };
    events.set(id, updated);
    writes.push({ method: 'PATCH', sendUpdates: url.searchParams.get('sendUpdates'), body });
    return Response.json(updated);
  });

  await connectGoogle('test-code', 'test-verifier');
  const connection = readGoogleConnection();
  writeAgenda('{}', 0);
  writeDraft('{}', 0);
  publishDraft('teste', 1);
  const start = Date.now() + 3_600_000;
  const cases = ['novo', 'legado', 'sememail'].map((id, i) => {
    const window = { start: start + i * 3_600_000, end: start + (i + 1) * 3_600_000 };
    reserveBooking('teste', 1, 1, id, window, 'Diagnóstico', {
      outcome: 'contact', answers: { email: i < 2 ? 'lead@example.test' : '' }, extra: [],
    }, connection.id);
    return { id, window };
  });

  const [novo, legado, semEmail] = cases;
  await syncGoogleBooking(connection, novo.id, novo.window, 'Diagnóstico', 'lead@example.test');
  await syncGoogleBooking(connection, novo.id, novo.window, 'Diagnóstico', 'lead@example.test');
  assert.deepEqual(writes[0].body.attendees, [{ email: 'lead@example.test' }]);
  assert.equal(writes[0].sendUpdates, 'all');
  assert.equal(writes.length, 1);

  events.set('gatulegado', {
    etag: '"legacy"', start: { dateTime: new Date(legado.window.start).toISOString() }, end: { dateTime: new Date(legado.window.end).toISOString() },
    attendees: [{ email: 'cohost@example.test' }],
  });
  await syncGoogleBooking(connection, legado.id, legado.window, 'Diagnóstico', 'lead@example.test');
  assert.deepEqual(writes[1], { method: 'PATCH', sendUpdates: 'all', body: { attendees: [{ email: 'cohost@example.test' }, { email: 'lead@example.test' }] } });

  await syncGoogleBooking(connection, semEmail.id, semEmail.window, 'Diagnóstico', '');
  assert.equal(writes[2].sendUpdates, null);
  assert.equal(writes[2].body.attendees, undefined);
  assert.deepEqual(upcomingBookings(0).map(booking => [booking.googleSynced, booking.googleInvited]), [[true, true], [true, true], [true, false]]);
});
