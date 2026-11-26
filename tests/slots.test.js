/* Testes do motor de horários. Rodar: node --test tests/slots.test.js
   (Não faz parte do site publicado; é só para conferir as regras.) */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/slots.js');

// Segunda 2026-12-07. "Agora" fixo: quinta 2026-12-03 às 10:00.
const MON = '2026-12-07', TUE = '2026-12-08', SAT = '2026-12-12', SUN = '2026-12-06';
const week = [
  { weekday: 0, open: false, open_time: '09:00', close_time: '18:00' },
  ...[1, 2, 3, 4, 5].map((w) => ({ weekday: w, open: true, open_time: '09:00', close_time: '18:00', break_start: '12:00', break_end: '13:00' })),
  { weekday: 6, open: true, open_time: '09:00', close_time: '14:00', break_start: null, break_end: null }
];
const svc60 = { id: 1, duration_min: 60 }, svc30 = { id: 2, duration_min: 30 };
const ctx = (o = {}) => ({
  hours: week,
  blocked: [],
  busy: [],
  pros: [],
  set: { buffer: 15, min_notice: 2, max_advance: 60, slot_interval: 15, multiprof: false },
  now: { d: '2026-12-03', m: 600 },
  ...o,
  set: { buffer: 15, min_notice: 2, max_advance: 60, slot_interval: 15, multiprof: false, ...(o.set || {}) }
});
const bk = (date, s, e, p = null) => ({ booking_date: date, start_time: s, end_time: e, professional_id: p });

test('grade do dia respeita abertura, intervalo e fechamento', () => {
  const l = S.list(ctx(), MON, svc60);
  assert.equal(l[0], '09:00');
  assert.equal(l.at(-1), '17:00');
  assert.ok(l.includes('11:00'), '11:00 + 60 = 12:00 encosta no intervalo');
  assert.ok(!l.includes('11:15'), '11:15 + 60 invade o intervalo');
  assert.ok(!l.includes('12:30'));
  assert.equal(l[l.indexOf('11:00') + 1], '13:00');
});

test('a grade recomeça no fim do intervalo', () => {
  const h = week.map((d) => (d.weekday === 1 ? { ...d, break_end: '12:45' } : d));
  const l = S.list(ctx({ hours: h, set: { slot_interval: 30 } }), MON, svc30);
  assert.ok(l.includes('12:45'));
  assert.ok(!l.includes('13:00'));
});

test('buffer entre agendamentos (mesmos casos do SQL)', () => {
  const c = ctx({ busy: [bk(MON, '10:00:00', '11:00:00')] });
  const l = S.list(c, MON, svc30);
  assert.ok(l.includes('09:15'), '09:15–09:45 deixa 15 min até 10:00');
  assert.ok(!l.includes('09:30'));
  assert.ok(!l.includes('10:30'));
  assert.ok(!l.includes('11:00'), '11:00 está dentro do buffer');
  assert.ok(l.includes('11:15'));
});

test('dia fechado, passado e além do limite → nenhum horário', () => {
  assert.deepEqual(S.list(ctx(), SUN, svc30), []);
  assert.deepEqual(S.list(ctx(), '2026-12-01', svc30), []);
  assert.deepEqual(S.list(ctx(), '2027-02-03', svc30), [], '3/12 + 60 dias = 1/2');
  assert.ok(S.list(ctx(), '2027-02-01', svc30).length > 0);
});

test('sábado fecha às 14:00', () => {
  const l = S.list(ctx(), SAT, svc60);
  assert.equal(l.at(-1), '13:00');
});

test('antecedência mínima, inclusive virando o dia', () => {
  const hoje = S.list(ctx({ now: { d: MON, m: 600 } }), MON, svc30);
  assert.equal(hoje[0], '13:00', '10:00 + 2h = 12:00, que é intervalo');
  const noite = ctx({ now: { d: '2026-12-06', m: 23 * 60 }, set: { min_notice: 12 } });
  assert.equal(S.list(noite, MON, svc30)[0], '11:00', '23:00 + 12h = 11:00 do dia seguinte');
});

test('bloqueios: dia inteiro, período e parcial', () => {
  const c = ctx({
    blocked: [
      { date: MON, date_end: null, all_day: true },
      { date: '2026-12-14', date_end: '2026-12-16', all_day: true },
      { date: TUE, all_day: false, start_time: '14:00:00', end_time: '16:00:00' }
    ]
  });
  assert.deepEqual(S.list(c, MON, svc30), []);
  assert.deepEqual(S.list(c, '2026-12-15', svc30), []);
  assert.deepEqual(S.list(c, '2026-12-16', svc30), []);
  assert.ok(S.list(c, '2026-12-17', svc30).length > 0);
  const t = S.list(c, TUE, svc30);
  assert.ok(t.includes('13:30'), '13:30–14:00 encosta no bloqueio');
  assert.ok(!t.includes('13:45'));
  assert.ok(!t.includes('15:00'));
  assert.ok(t.includes('16:00'));
});

test('vários profissionais: sem preferência, escolhido, serviços e folgas', () => {
  const pros = [
    { id: 101, active: true, services: [1] }, // Ana: só o serviço de 60
    { id: 102, active: true, services: [] } // Bia: todos
  ];
  const base = { pros, set: { multiprof: true } };
  let c = ctx({ ...base, busy: [bk(MON, '10:00', '11:00', 101)] });
  assert.ok(S.list(c, MON, svc60).includes('10:00'), 'Bia está livre');
  assert.ok(!S.list(c, MON, svc60, 101).includes('10:00'), 'Ana não');
  assert.deepEqual(S.check(c, MON, '10:00', svc60).pro, 102);
  assert.deepEqual(S.list(ctx(base), MON, svc30, 101), [], 'Ana não faz o serviço de 30');

  c = ctx({ ...base, busy: [bk(MON, '10:00', '11:00', 101), bk(MON, '10:00', '11:00', 102)] });
  assert.ok(!S.list(c, MON, svc60).includes('10:00'), 'as duas ocupadas');
  assert.equal(S.check(c, MON, '10:00', svc60).code, 'slot_taken');

  c = ctx({ ...base, busy: [bk(MON, '16:00', '16:30', null)] });
  assert.ok(!S.list(c, MON, svc60).includes('16:00'), 'agendamento sem profissional bloqueia todos');
  assert.ok(S.list(c, MON, svc60).includes('16:45'));

  c = ctx({ ...base, blocked: [{ date: MON, all_day: true, professional_id: 102 }] });
  assert.deepEqual(S.list(c, MON, svc30), [], 'Bia de folga e Ana não faz o de 30');
  assert.equal(S.check(c, MON, '10:00', svc60).pro, 101);
});

test('"sem preferência" equilibra: vai para quem tem menos no dia', () => {
  const pros = [{ id: 101, active: true, services: [] }, { id: 102, active: true, services: [] }];
  const c = ctx({ pros, set: { multiprof: true }, busy: [bk(MON, '09:00', '10:00', 101)] });
  assert.equal(S.check(c, MON, '15:00', svc60).pro, 102);
});

test('multiprof ligado sem ninguém ativo vira agenda única', () => {
  const c = ctx({ pros: [{ id: 9, active: false, services: [] }], set: { multiprof: true } });
  assert.deepEqual(S.candidates(c, svc30), [null]);
  assert.ok(S.list(c, MON, svc30).length > 0);
});

test('check espelha os erros do servidor', () => {
  const c = ctx();
  assert.equal(S.check(c, SUN, '10:00', svc30).code, 'closed');
  assert.equal(S.check(c, MON, '11:30', svc60).code, 'closed', 'invade o intervalo');
  assert.equal(S.check(c, MON, '17:30', svc60).code, 'closed', 'passa do fechamento');
  assert.equal(S.check(c, '2026-12-03', '11:00', svc30).code, 'too_soon');
  assert.equal(S.check(c, '2027-03-01', '10:00', svc30).code, 'too_far');
  assert.equal(S.check(ctx({ blocked: [{ date: MON, all_day: true }] }), MON, '10:00', svc30).code, 'blocked');
  assert.deepEqual(S.check(c, MON, '10:00', svc30), { pro: null });
});

test('próximo horário disponível pula dias cheios e fechados', () => {
  const c = ctx({ now: { d: '2026-12-05', m: 13 * 60 } }); // sábado 13:00
  assert.deepEqual(S.next(c, svc30), { date: MON, time: '09:00' });
});

test('aberto agora / fechado / intervalo', () => {
  assert.deepEqual(S.status(ctx({ now: { d: MON, m: 600 } })), { open: true, until: '12:00', brk: true, next: null });
  assert.deepEqual(S.status(ctx({ now: { d: MON, m: 14 * 60 } })), { open: true, until: '18:00', brk: false, next: null });
  assert.deepEqual(S.status(ctx({ now: { d: MON, m: 12 * 60 + 30 } })).next, { date: MON, time: '13:00' });
  assert.deepEqual(S.status(ctx({ now: { d: SAT, m: 15 * 60 } })).next, { date: '2026-12-14', time: '09:00' }, 'sábado 15:00 → segunda seguinte');
  const feriado = ctx({ now: { d: MON, m: 600 }, blocked: [{ date: MON, all_day: true }] });
  assert.equal(S.status(feriado).open, false);
});

test('"agora" no fuso do negócio, não do aparelho', () => {
  assert.deepEqual(S.now('America/Sao_Paulo', new Date('2026-11-26T02:59:00Z')), { d: '2026-11-25', m: 23 * 60 + 59 });
  assert.deepEqual(S.now('America/Sao_Paulo', new Date('2026-11-26T03:00:00Z')), { d: '2026-11-26', m: 0 });
  assert.deepEqual(S.now('America/Manaus', new Date('2026-11-26T03:00:00Z')), { d: '2026-11-25', m: 23 * 60 });
});

test('datas: dia da semana e soma de dias atravessando mês e ano', () => {
  assert.equal(S.weekday(MON), 1);
  assert.equal(S.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(S.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(S.toMin('09:30:00'), 570);
  assert.equal(S.toHM(570), '09:30');
});
