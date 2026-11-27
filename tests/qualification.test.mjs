import test from 'node:test';
import assert from 'node:assert/strict';
import { qualify, getNextScreen, getScreenSequence, REVENUE_OPTIONS, normalizePhoneInput, parseConfig, safeExternalUrl, validPhone } from '../src/lib/quiz.ts';
import { DEFAULT_CONFIG, quizSlug, reviewQuizSubmission } from '../src/lib/quiz.ts';

test('o endereço usa o nome do quiz sem acentos ou espaços', () => {
  assert.equal(quizSlug('  Diagnóstico de Marketing! '), 'diagnostico-de-marketing');
  assert.equal(quizSlug('API'), 'quiz-api');
  assert.equal(quizSlug('???'), 'quiz');
});

test('envio público valida o caminho real e descarta dados de telas que não foram visitadas', () => {
  const contact = { name: 'Lead de teste', phone: '11999991234', instagram: '@empresa' };
  const alternative = reviewQuizSubmission(DEFAULT_CONFIG, {
    ...contact, revenue: 'upTo30', investment: 'yes', email: 'teste@example.test',
  }, {});
  assert.equal(alternative.outcome, 'alternative');
  assert.equal(alternative.answers.investment, '');
  assert.equal(alternative.answers.email, '');
  assert.equal(reviewQuizSubmission(DEFAULT_CONFIG, { ...contact, revenue: 'inventado' }, {}), null);
  assert.equal(reviewQuizSubmission(DEFAULT_CONFIG, { ...contact, revenue: 'over100', investment: 'yes' }, {}), null);
  const qualified = reviewQuizSubmission(DEFAULT_CONFIG, {
    ...contact, revenue: 'over100', investment: 'yes', email: 'teste@example.test',
  }, {});
  assert.equal(qualified.outcome, 'contact');
});

test('na regra padrão, faturamento de até 30 mil vai para a oferta', () => {
  for (const answer of [undefined, 'yes', 'no']) assert.equal(qualify('upTo30', answer), 'alternative');
});
test('demais faixas exigem confirmação de investimento', () => {
  for (const option of REVENUE_OPTIONS.filter(o => o.id !== 'upTo30')) {
    assert.equal(qualify(option.id), 'pending');
    assert.equal(qualify(option.id, 'no'), 'alternative');
    assert.equal(qualify(option.id, 'yes'), 'qualified');
  }
});

test('regras salvas mudam o fluxo e mantêm os destinos padrão para valores ausentes ou inválidos', () => {
  const { rules } = parseConfig({
    version: 1,
    rules: {
      revenue: { over100: 'alternative', upTo30: 'investment', '50to100': 'schedule' },
      investment: { yes: 'alternative', no: 'schedule' },
    },
  });
  assert.equal(qualify('over100', 'no', rules), 'alternative');
  assert.equal(qualify('upTo30', undefined, rules), 'pending');
  assert.equal(qualify('upTo30', 'no', rules), 'qualified');
  assert.equal(qualify('upTo30', 'yes', rules), 'alternative');
  assert.equal(qualify('50to100', 'no', rules), 'qualified');
});
test('respostas desconhecidas não qualificam', () => {
  assert.equal(qualify('invalid', 'yes'), 'pending');
  assert.equal(qualify('30to50', 'invalid'), 'pending');
});

test('rascunho reordenado preserva telas criadas e aplica as regras nas posições novas', () => {
  const config = parseConfig({
    version: 1,
    customScreens: [{ id: 8, kind: 'text', title: 'Empresa', required: true }],
    screenOrder: [0, 5, 5, 8, 4, 1, 2, 3, 6, 7, 99],
  });
  assert.deepEqual(getScreenSequence(config), [0, 5, 8, 4, 1, 2, 3, 6]);
  assert.equal(config.customScreens[0].required, true);
  assert.equal(getNextScreen(config, 5, { revenue: '', investment: 'yes' }), 8);
  assert.equal(getNextScreen(config, 5, { revenue: '', investment: 'no' }), 7);
  assert.equal(getNextScreen(config, 4, { revenue: 'upTo30', investment: 'yes' }), 7);
  assert.equal(getNextScreen(config, 4, { revenue: '30to50', investment: 'yes' }), 1);
});
test('configuração recuperada tem versão e valores válidos', () => {
  assert.equal(parseConfig(null), null);
  assert.equal(parseConfig({ version: 2 }), null);
  const config = parseConfig({version: 1, duration: -1, color: 'red', logo: 'javascript:bad'});
  assert.equal(config.duration, 60);
  assert.equal(config.color, '#28734f');
  assert.equal(config.logo, '');
  assert.equal(parseConfig({ version: 1, duration: 90 }).duration, 90);
});
test('links de oferta aceitam somente HTTPS', () => {
  assert.equal(safeExternalUrl('javascript:alert(1)'), null);
  assert.equal(safeExternalUrl('http://example.com'), null);
  assert.equal(safeExternalUrl('https://example.com/servico'), 'https://example.com/servico');
});
test('WhatsApp exige DDD e número brasileiro válido', () => {
  assert.equal(validPhone('(11) 99999-1234'), true);
  assert.equal(validPhone('+55 11 99999-1234'), true);
  assert.equal(validPhone('123'), false);
  assert.equal(validPhone('00000000000'), false);
});

test('campo de WhatsApp limita a 11 dígitos e aceita colar um número com +55', () => {
  assert.equal(normalizePhoneInput('11999991234444'), '11999991234');
  assert.equal(normalizePhoneInput('+55 (11) 99999-1234'), '11999991234');
  assert.equal(normalizePhoneInput('(55) 99999-1234'), '55999991234');
});

test('rascunhos antigos recebem os títulos padrão e os novos preservam os textos editados', () => {
  const oldDraft = parseConfig({ version: 1, name: 'Meu quiz' });
  assert.equal(oldDraft.name, 'Meu quiz');
  assert.equal(oldDraft.phoneTitle, 'Qual é o seu WhatsApp?');
  const edited = parseConfig({ ...oldDraft, phoneTitle: 'Seu número?', phoneSubtitle: '', offerKicker: 'Veja a oferta' });
  assert.equal(edited.phoneTitle, 'Seu número?');
  assert.equal(edited.phoneSubtitle, '');
  assert.equal(edited.offerKicker, 'Veja a oferta');
});
