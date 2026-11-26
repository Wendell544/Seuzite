/* =============================================================
   slots.js — motor de disponibilidade (sem DOM, sem rede).
   As MESMAS regras do servidor (create_booking + bookings_guard):
   o navegador calcula para responder na hora; o banco confere de novo.

   Datas sempre como 'AAAA-MM-DD'. Horas sempre em minutos desde 00:00
   (570 = 09:30). Nada de Date para horário: sem bugs de fuso/meia-noite.

   ctx = {
     hours:   [{ weekday, open, open_time, close_time, break_start, break_end }],
     blocked: [{ date, date_end, all_day, start_time, end_time, professional_id }],
     busy:    [{ booking_date, start_time, end_time, professional_id }],
     pros:    [{ id, active, services: [ids] }],
     set:     { buffer, min_notice, max_advance, slot_interval, multiprof, tz },
     now:     { d: 'AAAA-MM-DD', m: minutos }   // opcional (testes)
   }
   ============================================================= */
const Slots = (() => {
  const pad = (n) => String(n).padStart(2, '0');

  /* 'HH:MM' ou 'HH:MM:SS' → minutos. */
  const toMin = (t) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
    return m ? +m[1] * 60 + +m[2] : null;
  };
  const toHM = (n) => pad(Math.floor(n / 60)) + ':' + pad(n % 60);

  /* Dias como número inteiro (dias desde 1970-01-01, UTC puro). */
  const dayNum = (d) => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5);
  const dayStr = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
  const addDays = (d, k) => dayStr(dayNum(d) + k);
  const weekday = (d) => new Date(dayNum(d) * 864e5).getUTCDay();

  /* "Agora" no relógio do negócio, não do aparelho de quem visita. */
  const now = (tz, at = new Date()) => {
    try {
      const p = {};
      new Intl.DateTimeFormat('en-CA', {
        timeZone: tz || 'America/Sao_Paulo',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
      }).formatToParts(at).forEach((x) => (p[x.type] = x.value));
      return { d: p.year + '-' + p.month + '-' + p.day, m: (+p.hour % 24) * 60 + +p.minute };
    } catch (e) {
      const z = new Date(at.getTime() - 3 * 36e5); // fallback: UTC−3
      return { d: z.toISOString().slice(0, 10), m: z.getUTCHours() * 60 + z.getUTCMinutes() };
    }
  };

  const num = (v, d, a, b) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(b, Math.max(a, Math.round(n))) : d;
  };

  /* Configuração normalizada (mesmos padrões do banco). */
  const cfg = (ctx) => {
    const s = (ctx && ctx.set) || {};
    return {
      buf: num(s.buffer, 15, 0, 240),
      notice: num(s.min_notice, 2, 0, 24 * 30),
      adv: num(s.max_advance, 60, 0, 365),
      step: num(s.slot_interval, 15, 5, 240),
      multi: s.multiprof === true || s.multiprof === 'true' || s.multiprof === 1,
      tz: s.tz || 'America/Sao_Paulo'
    };
  };

  const today = (ctx) => (ctx && ctx.now) || now(cfg(ctx).tz);

  const hoursFor = (ctx, wd) => (ctx.hours || []).find((h) => +h.weekday === wd) || null;

  /* Trechos de atendimento do dia: [[abre, fecha]] ou dois trechos com o intervalo no meio.
     A grade recomeça no fim do intervalo (o 1º horário da tarde é exatamente break_end). */
  const segments = (bh) => {
    if (!bh || !bh.open) return [];
    const a = toMin(bh.open_time), b = toMin(bh.close_time);
    if (a === null || b === null || b <= a) return [];
    const bs = toMin(bh.break_start), be = toMin(bh.break_end);
    if (bs === null || be === null || be <= bs || bs < a || be > b) return [[a, b]];
    return [[a, bs], [be, b]].filter(([x, y]) => y > x);
  };

  const sameId = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);
  const isNil = (v) => v === null || v === undefined || v === '';

  const offers = (p, svcId) => !Array.isArray(p.services) || !p.services.length || p.services.some((x) => sameId(x, svcId));

  /* Quem pode atender. Agenda única → [null]. Sem ninguém qualificado → []. */
  const candidates = (ctx, svc, proId) => {
    const c = cfg(ctx);
    const act = (ctx.pros || []).filter((p) => p.active !== false);
    if (!c.multi || !act.length) return [null];
    return act.filter((p) => offers(p, svc.id) && (isNil(proId) || sameId(p.id, proId))).map((p) => p.id);
  };

  const covers = (b, date) => date >= b.date && date <= (b.date_end || b.date);

  /* Bloqueio geral vale para todos; bloqueio de uma pessoa só vale para ela
     (e só existe quando há vários profissionais — como no servidor). */
  const blocked = (ctx, date, pro, s, e) =>
    (ctx.blocked || []).some(
      (b) =>
        covers(b, date) &&
        (isNil(b.professional_id) || (pro !== null && sameId(b.professional_id, pro))) &&
        (b.all_day !== false || (s < toMin(b.end_time) && e > toMin(b.start_time)))
    );

  /* Conflito com buffer: início < outro.fim + buffer E fim > outro.início − buffer.
     Profissional nulo = agenda única do negócio (conflita com todos). */
  const busy = (ctx, date, pro, s, e, buf) =>
    (ctx.busy || []).some(
      (b) =>
        b.booking_date === date &&
        (pro === null || isNil(b.professional_id) || sameId(b.professional_id, pro)) &&
        s < toMin(b.end_time) + buf &&
        e > toMin(b.start_time) - buf
    );

  /* Dia fora da janela de antecedência ou fechado? */
  const dayOpen = (ctx, date) => {
    const c = cfg(ctx), n = today(ctx);
    const dN = dayNum(date), tN = dayNum(n.d);
    if (dN < tN || dN > tN + c.adv) return false;
    return segments(hoursFor(ctx, weekday(date))).length > 0;
  };

  /* Profissionais livres para [start, start + duração). */
  const freeAt = (ctx, date, startMin, svc, proId) => {
    const c = cfg(ctx), e = startMin + (+svc.duration_min || 0);
    return candidates(ctx, svc, proId).filter((p) => !blocked(ctx, date, p, startMin, e) && !busy(ctx, date, p, startMin, e, c.buf));
  };

  /* Horários livres → ['09:00', '09:15', …]. É a saída principal do motor. */
  const list = (ctx, date, svc, proId) => {
    if (!svc || !date || !dayOpen(ctx, date)) return [];
    const c = cfg(ctx), n = today(ctx);
    const dur = +svc.duration_min || 0;
    if (dur <= 0) return [];
    const cands = candidates(ctx, svc, proId);
    if (!cands.length) return [];
    const minAbs = dayNum(n.d) * 1440 + n.m + c.notice * 60;
    const base = dayNum(date) * 1440;
    const out = [];
    for (const [a, b] of segments(hoursFor(ctx, weekday(date)))) {
      for (let s = a; s + dur <= b; s += c.step) {
        if (base + s < minAbs) continue;
        const e = s + dur;
        if (cands.some((p) => !blocked(ctx, date, p, s, e) && !busy(ctx, date, p, s, e, c.buf))) out.push(toHM(s));
      }
    }
    return out;
  };

  /* Último dia que ainda pode ser agendado. */
  const lastDay = (ctx) => addDays(today(ctx).d, cfg(ctx).adv);

  /* Primeiro horário livre a partir de hoje → { date, time } ou null. */
  const next = (ctx, svc, proId, from) => {
    const t = today(ctx).d, end = lastDay(ctx);
    for (let d = from && from > t ? from : t; d <= end; d = addDays(d, 1)) {
      const l = list(ctx, d, svc, proId);
      if (l.length) return { date: d, time: l[0] };
    }
    return null;
  };

  /* Mesma validação do servidor, devolvendo o código de erro (hint) ou o profissional.
     Usado pelo modo demonstração, que não tem banco. */
  const check = (ctx, date, time, svc, proId) => {
    const c = cfg(ctx), n = today(ctx);
    const s = toMin(time);
    if (!svc) return { code: 'bad_service' };
    if (!date || s === null) return { code: 'bad_slot' };
    const e = s + (+svc.duration_min || 0);
    if (dayNum(date) * 1440 + s < dayNum(n.d) * 1440 + n.m + c.notice * 60) return { code: 'too_soon' };
    if (dayNum(date) > dayNum(n.d) + c.adv) return { code: 'too_far' };
    const segs = segments(hoursFor(ctx, weekday(date)));
    if (!segs.some(([a, b]) => s >= a && e <= b)) return { code: 'closed' };
    if (blocked(ctx, date, null, s, e)) return { code: 'blocked' };
    const free = freeAt(ctx, date, s, svc, proId);
    if (!free.length) return { code: 'slot_taken' };
    if (free[0] === null) return { pro: null };
    // "Sem preferência": quem tem menos atendimentos no dia (empate: ordem da lista).
    const load = (p) => (ctx.busy || []).filter((b) => b.booking_date === date && sameId(b.professional_id, p)).length;
    return { pro: free.slice().sort((x, y) => load(x) - load(y))[0] };
  };

  /* Aberto agora? → { open, until, brk, next: { date, time } | null } */
  const status = (ctx) => {
    const n = today(ctx);
    const generalBlock = (d) => (ctx.blocked || []).some((b) => covers(b, d) && isNil(b.professional_id) && b.all_day !== false);
    const segsOn = (d) => (generalBlock(d) ? [] : segments(hoursFor(ctx, weekday(d))));
    const segs = segsOn(n.d);
    const cur = segs.find(([a, b]) => n.m >= a && n.m < b);
    if (cur) {
      const last = segs[segs.length - 1];
      return { open: true, until: toHM(cur[1]), brk: cur !== last, next: null };
    }
    for (let k = 0; k <= 7; k++) {
      const d = addDays(n.d, k);
      const sg = segsOn(d).find(([a]) => k > 0 || a > n.m);
      if (sg) return { open: false, until: null, brk: false, next: { date: d, time: toHM(sg[0]) } };
    }
    return { open: false, until: null, brk: false, next: null };
  };

  return { toMin, toHM, dayNum, dayStr, addDays, weekday, now, cfg, today, segments, candidates, offers, freeAt, list, next, lastDay, check, status, dayOpen };
})();

if (typeof module === 'object' && module.exports) module.exports = Slots;
