import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createQuizDraft, insertQuizResponse, listQuizDrafts, loadDraft, publishDraft,
  readPublication, recentQuizResponses, reserveBooking, writeAgenda, writeDraft } from '../src/lib/local-store.ts';
import { DEFAULT_CONFIG } from '../src/lib/quiz.ts';

test('migra o quiz original e mantém links, revisões, respostas e reservas separados por quiz', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'gatu-quizzes-')), 'test.sqlite');
  process.env.AGENDADOR_DB_PATH = path;
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE quiz_draft (id INTEGER PRIMARY KEY CHECK (id = 1), config TEXT, revision INTEGER);
    CREATE TABLE quiz_publication (id INTEGER PRIMARY KEY CHECK (id = 1), slug TEXT UNIQUE, config TEXT, revision INTEGER);
    CREATE TABLE quiz_responses (id TEXT PRIMARY KEY, revision INTEGER, received_at INTEGER, response TEXT);
  `);
  const original = { ...DEFAULT_CONFIG, name: 'Quiz original' };
  const contact = { outcome: 'contact', answers: { name: 'Contato fictício' }, extra: [] };
  legacy.prepare("INSERT INTO quiz_draft VALUES (1, ?, 3)").run(JSON.stringify(original));
  legacy.prepare("INSERT INTO quiz_publication VALUES (1, 'quiz-original', ?, 2)").run(JSON.stringify(original));
  legacy.prepare("INSERT INTO quiz_responses VALUES ('original-response', 2, ?, ?)").run(Date.now(), JSON.stringify(contact));
  legacy.close();

  assert.equal(loadDraft(1).revision, 3);
  assert.equal(readPublication('quiz-original').revision, 2);
  assert.deepEqual(recentQuizResponses(1).map(response => response.id), ['original-response']);

  const second = createQuizDraft(JSON.stringify({ ...original, headline: 'Título da segunda página' }));
  assert.deepEqual(listQuizDrafts().map(quiz => [quiz.id, quiz.slug]), [[1, 'quiz-original'], [second, null]]);
  assert.equal(readPublication('quiz-original-2'), undefined);
  assert.deepEqual(publishDraft('quiz-original', 1, second), { slug: 'quiz-original-2', revision: 1 });
  assert.equal(JSON.parse(readPublication('quiz-original').config).headline, original.headline);
  assert.equal(JSON.parse(readPublication('quiz-original-2').config).headline, 'Título da segunda página');

  assert.equal(writeDraft(JSON.stringify({ ...original, name: 'Novo título' }), 3, 1), 4);
  assert.equal(writeDraft(JSON.stringify(original), 3, 1), null);
  assert.equal(publishDraft('novo-titulo', 3, 1), undefined);
  assert.deepEqual(publishDraft('novo-titulo', 4, 1), { slug: 'quiz-original', revision: 4 });
  assert.equal(readPublication('quiz-original-2').revision, 1);
  assert.equal(insertQuizResponse('quiz-original-2', 1, 'second-response', contact), true);
  assert.equal(insertQuizResponse('quiz-original', 4, 'first-response', contact), true);
  assert.equal(insertQuizResponse('quiz-original-2', 1, 'original-response', contact), false);

  const third = createQuizDraft(JSON.stringify(original));
  publishDraft('terceiro', 1, third);
  assert.equal(insertQuizResponse('terceiro', 1, 'second-response', contact), false);
  assert.deepEqual(recentQuizResponses(third), []);

  assert.equal(writeAgenda('{}', 0), 1);
  const start = Date.now() + 3_600_000;
  const slot = { start, end: start + 3_600_000 };
  assert.deepEqual(reserveBooking('quiz-original-2', 1, 1, 'second-booking', slot, 'Reunião', contact), slot);
  assert.equal(reserveBooking('quiz-original', 4, 1, 'overlap', slot, 'Reunião', contact), null);
  assert.deepEqual(new Set(recentQuizResponses(1).map(response => response.id)), new Set(['original-response', 'first-response']));
  assert.deepEqual(new Set(recentQuizResponses(second).map(response => response.id)), new Set(['second-response', 'second-booking']));
});
