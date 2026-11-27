import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { DEFAULT_AGENDA, availableSlots, parseAgenda } from '../src/lib/schedule.ts';
import { DEFAULT_CONFIG, reviewQuizSubmission } from '../src/lib/quiz.ts';
import { writeAgenda, writeDraft, publishDraft, reserveBooking, recentQuizResponses } from '../src/lib/local-store.ts';

const now = Date.parse('2026-11-27T10:00:00Z');
const friday = { enabled: true, start: '09:00', end: '12:00' };
const config = { ...DEFAULT_AGENDA, days: DEFAULT_AGENDA.days.map((day, index) => index === 5 ? friday : day), horizonDays: 1 };

test('horários de Brasília respeitam a duração, a antecedência, os bloqueios e reservas que se sobrepõem', () => {
  const halfHourly = { ...config, slotIntervalMinutes: 30 };
  const occupied = [{ start: Date.parse('2026-11-27T13:30:00Z'), end: Date.parse('2026-11-27T14:30:00Z') }];
  const [day] = availableSlots(halfHourly, 60, occupied, now);
  assert.equal(day.date, '2026-11-27');
  assert.deepEqual(day.times, [
    { start: Date.parse('2026-11-27T12:00:00Z'), label: '09:00' },
    { start: Date.parse('2026-11-27T12:30:00Z'), label: '09:30' },
  ]);
  assert.deepEqual(availableSlots(halfHourly, 60, occupied, now + 60_000)[0].times, [day.times[1]]);
  assert.deepEqual(availableSlots({ ...config, blockedDates: [day.date] }, 60, [], now), []);
  assert.deepEqual(availableSlots(config, 60, [], Date.parse('2026-11-28T02:00:00Z')), []);
  assert.equal(parseAgenda({ ...config, blockedDates: ['2026-02-30'] }), null);
});

test('agendas anteriores passam a oferecer horários de uma em uma hora sem alterar a duração', () => {
  const { slotIntervalMinutes: _interval, ...oldConfig } = config;
  const saved = parseAgenda(oldConfig);
  assert.equal(saved.slotIntervalMinutes, 60);
  assert.deepEqual(availableSlots(saved, 45, [], now)[0].times.map(slot => slot.label), ['09:00', '10:00', '11:00']);
  assert.deepEqual(availableSlots(saved, 90, [], now)[0].times.map(slot => slot.label), ['09:00', '10:00']);
  assert.equal(parseAgenda({ ...oldConfig, slotIntervalMinutes: 0 }), null);
});

test('reserva não duplica, rejeita sobreposição e grava uma resposta só após confirmar', () => {
  process.env.AGENDADOR_DB_PATH = join(mkdtempSync(join(tmpdir(), 'agenda-local-test-')), 'test.sqlite');
  assert.equal(writeAgenda(JSON.stringify(config), 0), 1);
  assert.equal(writeDraft(JSON.stringify(DEFAULT_CONFIG), 0), 1);
  assert.equal(publishDraft('diagnostico', 1).revision, 1);
  const response = reviewQuizSubmission(DEFAULT_CONFIG, {
    name: 'Lead de teste', phone: '11999991234', instagram: '@empresa', revenue: 'over100', investment: 'yes', email: 'lead@example.test',
  }, {});
  const start = Date.parse('2026-11-27T12:00:00Z');
  const window = { start, end: start + 3_600_000 };
  assert.deepEqual(reserveBooking('diagnostico', 1, 1, 'first', window, 'Diagnóstico', response), window);
  assert.deepEqual(reserveBooking('diagnostico', 1, 1, 'first', window, 'Diagnóstico', response), window);
  assert.equal(reserveBooking('diagnostico', 1, 1, 'overlap', { start: start + 1_800_000, end: window.end + 1_800_000 }, 'Diagnóstico', response), null);
  assert.equal(reserveBooking('diagnostico', 1, 0, 'stale', { start: window.end, end: window.end + 3_600_000 }, 'Diagnóstico', response), null);
  assert.equal(recentQuizResponses().length, 1);
});
