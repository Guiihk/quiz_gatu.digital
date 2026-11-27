import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { generateRequestDetails } from 'web-push';
import { insertQuizResponse, markBookingNotificationsRead, publishDraft, readBookingNotifications, reserveBooking, savePushSubscription, writeAgenda, writeDraft } from '../src/lib/local-store.ts';

registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('/browser-push.ts') && specifier === './local-store') return next(specifier + '.ts', context);
  return next(specifier, context);
} });

test('somente a reserva confirmada registra um aviso e envia um único push por inscrição', async () => {
  process.env.AGENDADOR_DB_PATH = join(mkdtempSync(join(tmpdir(), 'gatu-push-')), 'test.sqlite');
  const { deliverBookingPush, ensurePushKeys, parsePushSubscription } = await import('../src/lib/browser-push.ts');
  const keys = ensurePushKeys();
  assert.equal(ensurePushKeys().publicKey, keys.publicKey);

  const browser = createECDH('prime256v1');
  browser.generateKeys();
  const raw = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint', keys: {
    p256dh: browser.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url'),
  } };
  assert.equal(parsePushSubscription({ ...raw, endpoint: 'https://127.0.0.1/test' }), null);
  const sub = parsePushSubscription(raw);
  assert.equal(savePushSubscription(sub.endpoint, sub.p256dh, sub.auth), true);
  writeAgenda('{}', 0);
  writeDraft('{}', 0);
  publishDraft('teste', 1);
  const response = { outcome: 'contact', answers: { name: 'Lead fictício' }, extra: [] };
  insertQuizResponse('teste', 1, 'sem-reserva', response);
  assert.equal(readBookingNotifications().unread, 0);

  const start = Date.now() + 3_600_000;
  const id = '7f558555-ff50-4722-85b0-569dd44e0a31';
  const window = { start, end: start + 3_600_000 };
  reserveBooking('teste', 1, 1, id, window, 'Reunião', response);
  reserveBooking('teste', 1, 1, id, window, 'Reunião', response);
  assert.equal(readBookingNotifications().unread, 1);
  const sent = [];
  const send = async (recipient, payload, options) => {
    const request = generateRequestDetails(recipient, payload, options);
    assert.ok(request.body.length > payload.length);
    sent.push(JSON.parse(payload));
  };
  await Promise.all([deliverBookingPush(send), deliverBookingPush(send)]);
  await deliverBookingPush(send);
  assert.deepEqual(sent, [{ id }]);
  markBookingNotificationsRead(id);
  assert.equal(readBookingNotifications().unread, 0);
  assert.equal(readBookingNotifications().items.length, 1);
});

test('service worker exibe o aviso sem uma aba e abre a agenda ao clicar', async () => {
  const handlers = {};
  let notification;
  let opened;
  const worker = {
    addEventListener(type, callback) { handlers[type] = callback; },
    registration: { async showNotification(title, options) { notification = { title, options }; } },
    clients: { async matchAll() { return []; }, async openWindow(url) { opened = url; } },
  };
  runInNewContext(readFileSync(new URL('../public/agendador-sw.js', import.meta.url), 'utf8'), { self: worker, URL });
  let task;
  handlers.push({ data: { json: () => ({ id: 'test-reservation' }) }, waitUntil: promise => { task = promise; } });
  await task;
  assert.equal(notification.title, 'Novo agendamento');
  assert.equal(notification.options.tag, 'agendador-reserva-test-reservation');
  handlers.notificationclick({ notification: { close() {} }, waitUntil: promise => { task = promise; } });
  await task;
  assert.equal(opened, '/?agenda=1');
});
