import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCampaignSource } from '../src/lib/quiz.ts';
import { parseDealValue } from '../src/lib/crm.ts';
import { deleteCrmCard, existingBooking, insertQuizResponse, occupiedBookings, publishDraft, readCrmActivity, readCrmLeads, reserveBooking, upcomingBookings, writeAgenda, writeCrmLead, writeDraft } from '../src/lib/local-store.ts';

test('CRM lista reservas, preserva a origem e registra movimentações e anotações', () => {
  process.env.AGENDADOR_DB_PATH = join(mkdtempSync(join(tmpdir(), 'gatu-crm-')), 'test.sqlite');
  writeAgenda('{}', 0);
  writeDraft('{}', 0);
  publishDraft('quiz', 1);
  const response = { outcome: 'contact', answers: { name: 'Lead fictício' }, extra: [],
    source: parseCampaignSource({ utm_source: ' meta ', utm_campaign: 'campanha', ignored: 'ignore', utm_term: ['a', 'b'] }) };
  assert.equal(insertQuizResponse('quiz', 1, 'sem-reserva', response), true);
  assert.deepEqual(readCrmLeads(), []);

  const start = Date.now() + 3_600_000;
  reserveBooking('quiz', 1, 1, 'reserva', { start, end: start + 3_600_000 }, 'Diagnóstico', response);
  const [lead] = readCrmLeads();
  assert.equal(lead.stage, 'scheduled');
  assert.equal(lead.dealValueCents, null);
  assert.deepEqual(lead.source, { utm_source: 'meta', utm_campaign: 'campanha' });
  assert.equal(lead.answers.name, 'Lead fictício');
  assert.equal(writeCrmLead('sem-reserva', 0, { stage: 'won' }), null);

  assert.equal(writeCrmLead('reserva', 0, { stage: 'proposal' }).revision, 1);
  assert.equal(writeCrmLead('reserva', 0, { note: 'Desatualizado' }), null);
  assert.equal(writeCrmLead('reserva', 1, { note: 'Enviar proposta' }).revision, 2);
  assert.equal(writeCrmLead('reserva', 2, { stage: 'proposal' }).revision, 2);
  assert.equal(readCrmLeads()[0].note, 'Enviar proposta');
  assert.deepEqual(readCrmActivity('reserva').map(({ kind, fromStage, toStage }) => [kind, fromStage, toStage]), [
    ['note', null, null], ['stage', 'scheduled', 'proposal'],
  ]);
  assert.equal(writeCrmLead('reserva', 2, { dealValueCents: parseDealValue('1.234,56') }).revision, 3);
  const [updated] = readCrmLeads();
  assert.equal(updated.dealValueCents, 123456);
  assert.equal(updated.stage, 'proposal');
  assert.deepEqual(updated.source, lead.source);
  assert.equal(writeCrmLead('reserva', 3, { dealValueCents: 0 }).dealValueCents, 0);
  assert.equal(writeCrmLead('reserva', 4, { dealValueCents: null }).dealValueCents, null);

  assert.equal(deleteCrmCard('sem-reserva', 0), false);
  assert.equal(deleteCrmCard('reserva', 4), false);
  assert.equal(readCrmLeads().length, 1);
  assert.equal(deleteCrmCard('reserva', 5), true);
  assert.equal(deleteCrmCard('reserva', 5), true);
  assert.deepEqual(readCrmLeads(), []);
  assert.deepEqual(readCrmActivity('reserva'), []);
  assert.equal(writeCrmLead('reserva', 0, { stage: 'won' }), null);
  assert.deepEqual(existingBooking('reserva', 'quiz', 1), { start, end: start + 3_600_000 });
  assert.deepEqual(occupiedBookings(Date.now()).map(row => ({ ...row })), [{ start, end: start + 3_600_000 }]);

  const nextStart = start + 3_600_000;
  reserveBooking('quiz', 1, 1, 'nova-reserva', { start: nextStart, end: nextStart + 3_600_000 }, 'Diagnóstico', response);
  assert.deepEqual(readCrmLeads().map(({ id, revision }) => [id, revision]), [['nova-reserva', 0]]);
  assert.deepEqual(upcomingBookings(Date.now(), { hideDeletedCards: true }).map(({ id }) => id), ['nova-reserva']);
  assert.deepEqual(upcomingBookings(Date.now()).map(({ id }) => id), ['reserva', 'nova-reserva']);
  assert.equal(deleteCrmCard('nova-reserva', 0), true);
  assert.deepEqual(readCrmLeads(), []);
  assert.deepEqual(upcomingBookings(Date.now(), { hideDeletedCards: true }), []);
});

test('valor do negócio aceita reais no formato brasileiro e rejeita valores inválidos', () => {
  assert.equal(parseDealValue('R$ 2.500,01'), 250001);
  assert.equal(parseDealValue('2500.01'), 250001);
  assert.equal(parseDealValue('0,00'), 0);
  assert.equal(parseDealValue(''), null);
  assert.equal(parseDealValue('-5,00'), undefined);
  assert.equal(parseDealValue('2.500,001'), undefined);
});
