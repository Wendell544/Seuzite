/* =============================================================
   storage.js — localStorage com prefixo, estado (DB) e a camada API.
   API tem duas implementações com a MESMA interface:
     • Supabase (SB_URL preenchido em config.js)
     • Demonstração (SB_URL vazio): banco de exemplo neste navegador,
       com as mesmas regras do servidor (via Slots.check).
   ============================================================= */
const Store = {
  get(k, d = null) {
    try {
      const v = JSON.parse(localStorage.getItem(k));
      return v === null || v === undefined ? d : v;
    } catch (e) {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
      return true;
    } catch (e) {
      toast(e && e.name === 'QuotaExceededError' ? 'Sem espaço local. Use fotos menores.' : 'Falha ao salvar dados localmente.', 'er');
      return false;
    }
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch (e) {}
  }
};

const Prefs = {
  get: () => Store.get(KEY.pref, {}),
  set: (o) => Store.set(KEY.pref, { ...Prefs.get(), ...o })
};

/* Rascunho do wizard (volta onde parou se fechar e reabrir em até 2h). */
const Draft = {
  get() {
    const d = Store.get(KEY.wz);
    return d && Date.now() - (d.at || 0) < 2 * 36e5 ? d : null;
  },
  set: (v) => Store.set(KEY.wz, { ...v, at: Date.now() }),
  clear: () => Store.del(KEY.wz)
};

/* Dados do cliente para o próximo agendamento (nome e telefone já preenchidos). */
const Me = {
  get: () => Store.get(KEY.me, {}),
  set: (o) => Store.set(KEY.me, o)
};

/* Estado em memória. busy = horários ocupados (sem dados pessoais). */
const DB = { services: [], hours: [], blocked: [], pros: [], set: { ...SET0 }, busy: [], bookings: [], ready: false, err: false };

const ACTIVE = ['pending', 'confirmed'];
const STATUS = { pending: 'Pendente', confirmed: 'Confirmado', done: 'Concluído', cancelled: 'Cancelado' };

/* Mensagens para cada código de erro do servidor (hint do RPC / gatilho). */
const ERR = {
  slot_taken: 'Esse horário acabou de ser reservado. Escolha outro, por favor.',
  too_soon: 'Esse horário já não pode ser reservado. Escolha um mais tarde.',
  too_far: 'Essa data passa do limite de agendamento.',
  closed: 'Não atendemos nesse horário.',
  blocked: 'Essa data está bloqueada.',
  limit: 'Você já tem agendamentos em aberto. Fale com a gente pelo WhatsApp.',
  bad_name: 'Informe seu nome completo.',
  bad_phone: 'Telefone inválido. Use DDD + número.',
  bad_email: 'E-mail inválido.',
  bad_slot: 'Escolha a data e o horário.',
  bad_service: 'Esse serviço não está mais disponível.',
  bad_professional: 'Esse profissional não está disponível.',
  in_use: 'Existem agendamentos ligados a este item. Desative-o em vez de excluir.',
  check: 'Dados fora do padrão permitido. Revise os campos.',
  auth: 'Sessão expirada ou sem permissão. Entre de novo.',
  network: 'Falha de conexão. Verifique a internet e tente de novo.',
  unknown: 'Não foi possível concluir. Tente novamente.'
};
class ApiErr extends Error {
  constructor(code, msg) {
    super(msg || ERR[code] || ERR.unknown);
    this.code = ERR[code] ? code : 'unknown';
  }
}
/* Erro do Supabase/PostgREST → ApiErr com código conhecido. */
const apiErr = (e) => {
  if (e instanceof ApiErr) return e;
  const h = e && e.hint, c = String((e && e.code) || ''), m = String((e && e.message) || e || '');
  if (h && ERR[h]) return new ApiErr(h);
  if (c === '23503') return new ApiErr('in_use');
  if (c === '23514' || c === '22P02' || c === '22007' || c === '22008') return new ApiErr('check');
  if (c === '42501' || c.startsWith('PGRST3') || /jwt|row-level|permission/i.test(m)) return new ApiErr('auth');
  if (/fetch|network|load failed/i.test(m)) return new ApiErr('network');
  return new ApiErr('unknown');
};

const normSet = (data) => {
  const s = { ...SET0, ...(data || {}) };
  if (!Array.isArray(s.testimonials)) s.testimonials = SET0.testimonials;
  return s;
};
const normPro = (p) => ({ ...p, services: Array.isArray(p.services) ? p.services.map(Number) : [], active: p.active !== false });

/* Contexto para o motor de horários (Slots). */
const slotCtx = (busy = DB.busy) => ({ hours: DB.hours, blocked: DB.blocked, busy, pros: DB.pros, set: DB.set });

/* ================= Implementação Supabase ================= */
const Remote = {
  async load() {
    const today = Slots.today({ set: DB.set }).d;
    const [sv, hr, bl, pr, st] = await Promise.all([
      SB.from('services').select('*').order('sort_order').order('id'),
      SB.from('business_hours').select('*').order('weekday'),
      SB.from('blocked_dates').select('*').or('date.gte.' + today + ',date_end.gte.' + today).order('date'),
      SB.from('professionals').select('id,name,avatar,services,active,sort_order').order('sort_order').order('id'),
      SB.from('settings').select('data').eq('id', 1).maybeSingle()
    ]);
    const bad = [sv, hr, bl, pr, st].find((r) => r.error);
    if (bad) throw apiErr(bad.error);
    return { services: sv.data || [], hours: hr.data || [], blocked: bl.data || [], pros: pr.data || [], set: st.data ? st.data.data : {} };
  },
  async busy(from, to) {
    const { data, error } = await SB.rpc('get_busy', { p_from: from, p_to: to });
    if (error) throw apiErr(error);
    return data || [];
  },
  async book(b) {
    const { data, error } = await SB.rpc('create_booking', {
      p_client_name: b.name,
      p_client_phone: b.phone,
      p_client_email: b.email || '',
      p_service_id: b.service_id,
      p_professional_id: b.professional_id ?? null,
      p_booking_date: b.date,
      p_start_time: b.time,
      p_notes: b.notes || ''
    });
    if (error) throw apiErr(error);
    return data;
  },
  /* ----- admin ----- */
  async bookings() {
    const { data, error } = await SB.from('bookings').select('*').order('booking_date', { ascending: false }).order('start_time').range(0, 4999);
    if (error) throw apiErr(error);
    return data || [];
  },
  async adminLoad() {
    const [bl, pr] = await Promise.all([
      SB.from('blocked_dates').select('*').order('date', { ascending: false }).range(0, 999),
      SB.from('professionals').select('*').order('sort_order').order('id')
    ]);
    const bad = [bl, pr].find((r) => r.error);
    if (bad) throw apiErr(bad.error);
    return { blocked: bl.data || [], pros: pr.data || [] };
  },
  async insert(t, row) {
    const { data, error } = await SB.from(t).insert(row).select().single();
    if (error) throw apiErr(error);
    return data;
  },
  async update(t, id, patch) {
    const { data, error } = await SB.from(t).update(patch).eq(t === 'business_hours' ? 'weekday' : 'id', id).select().single();
    if (error) throw apiErr(error);
    return data;
  },
  async remove(t, id) {
    const { error } = await SB.from(t).delete().eq('id', id);
    if (error) throw apiErr(error);
  },
  async saveHours(rows) {
    const { data, error } = await SB.from('business_hours').upsert(rows, { onConflict: 'weekday' }).select();
    if (error) throw apiErr(error);
    return data;
  },
  async saveSettings(data) {
    const { error } = await SB.from('settings').upsert({ id: 1, data });
    if (error) throw apiErr(error);
  },
  /* Avisa o painel quando um agendamento muda (Realtime respeita o RLS: só admin recebe). */
  subscribe(cb) {
    try {
      const ch = SB.channel('bookings-admin')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, (p) => cb(p))
        .subscribe();
      return () => SB.removeChannel(ch);
    } catch (e) {
      return () => {};
    }
  }
};

/* ================= Implementação demonstração (local) ================= */
const Demo = (() => {
  const SV = [
    ['Atendimento essencial', 'O cuidado do dia a dia, feito com atenção aos detalhes.', 30, 60],
    ['Atendimento completo', 'Nosso serviço mais procurado, com acabamento caprichado.', 60, 120],
    ['Sessão premium', 'Experiência completa, sem pressa, com o melhor que oferecemos.', 90, 190],
    ['Avaliação personalizada', 'Uma conversa rápida para entender o que você precisa.', 15, 0]
  ];
  const NAMES = ['Ana Paula Souza', 'Bruno Costa', 'Camila Rocha', 'Diego Martins', 'Elisa Prado', 'Fernanda Lima', 'Gustavo Reis', 'Helena Duarte', 'Igor Nunes', 'Júlia Freitas', 'Lucas Almeida', 'Marina Teixeira'];
  const iso = () => new Date().toISOString();

  /* Banco de exemplo com agendamentos espalhados pela última e pela próxima semana. */
  const seed = () => {
    const t = Slots.today({ set: SET0 }).d;
    const services = SV.map((s, i) => ({ id: i + 1, name: s[0], description: s[1], duration_min: s[2], price: s[3], image: null, active: true, sort_order: i, created_at: iso(), updated_at: iso() }));
    const hours = [0, 1, 2, 3, 4, 5, 6].map((w) => ({
      weekday: w,
      open: w !== 0,
      open_time: '09:00:00',
      close_time: w === 6 ? '14:00:00' : '18:00:00',
      break_start: w > 0 && w < 6 ? '12:00:00' : null,
      break_end: w > 0 && w < 6 ? '13:00:00' : null
    }));
    const y = +t.slice(0, 4), nx = (md) => (t.slice(5) <= md ? y : y + 1);
    const blocked = [
      { id: 1, date: nx('12-25') + '-12-25', date_end: null, all_day: true, start_time: null, end_time: null, professional_id: null, reason: 'Natal', created_at: iso() },
      { id: 2, date: nx('12-31') + '-12-31', date_end: nx('12-31') + 1 + '-01-01', all_day: true, start_time: null, end_time: null, professional_id: null, reason: 'Ano-novo', created_at: iso() }
    ];
    const pros = [
      { id: 1, name: 'Ana Ribeiro', avatar: null, phone: '', services: [], active: true, sort_order: 0 },
      { id: 2, name: 'Carlos Lima', avatar: null, phone: '', services: [1, 2], active: true, sort_order: 1 }
    ];
    const d = { v: 1, services, hours, blocked, pros, settings: { ...SET0, addr: 'Rua das Flores, 120 — Centro' }, bookings: [], seq: 1 };
    // Agendamentos de exemplo em horários realmente livres.
    let r = 7;
    const rnd = (n) => ((r = (r * 9301 + 49297) % 233280), Math.floor((r / 233280) * n));
    for (let k = -7; k <= 7; k++) {
      const day = Slots.addDays(t, k);
      const per = k === 0 ? 4 : 1 + rnd(3);
      for (let j = 0; j < per; j++) {
        const svc = services[rnd(3)];
        const ctx = { hours, blocked, pros, busy: d.bookings.filter((b) => ACTIVE.includes(b.status) || b.status === 'done'), set: { ...SET0, min_notice: 0 }, now: { d: day, m: k === 0 ? 8 * 60 : 0 } };
        const l = Slots.list(ctx, day, svc);
        if (!l.length) continue;
        const time = l[rnd(l.length)];
        const st = k < 0 ? (rnd(6) ? 'done' : 'cancelled') : k === 0 ? (j < 2 ? 'confirmed' : 'pending') : rnd(3) ? 'confirmed' : 'pending';
        const ni = rnd(NAMES.length);
        d.bookings.push({
          id: d.seq++,
          client_name: NAMES[ni],
          client_phone: '55839990000' + String(10 + ni),
          client_email: '',
          service_id: svc.id,
          professional_id: null,
          booking_date: day,
          start_time: time + ':00',
          end_time: Slots.toHM(Slots.toMin(time) + svc.duration_min) + ':00',
          price_snapshot: svc.price,
          status: st,
          notes: '',
          created_at: iso(),
          updated_at: iso()
        });
      }
    }
    return d;
  };

  let D = null;
  const db = () => {
    if (!D) {
      D = Store.get(KEY.demo);
      if (!D || D.v !== 1) {
        D = seed();
        save();
      }
    }
    return D;
  };
  const save = () => Store.set(KEY.demo, D);
  const nid = (t) => Math.max(0, ...db()[t].map((x) => +x.id || 0)) + 1;
  const tables = { services: 'services', professionals: 'pros', blocked_dates: 'blocked', bookings: 'bookings' };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const delay = (v) => new Promise((ok) => setTimeout(() => ok(clone(v)), 120));

  /* Mesma guarda do gatilho bookings_guard. */
  const guard = (row) => {
    if (!ACTIVE.includes(row.status)) return;
    const buf = Slots.cfg({ set: db().settings }).buf;
    const s = Slots.toMin(row.start_time), e = Slots.toMin(row.end_time);
    if (!(e > s)) throw new ApiErr('check');
    const hit = db().bookings.some(
      (b) =>
        b.id !== row.id &&
        b.booking_date === row.booking_date &&
        ACTIVE.includes(b.status) &&
        (row.professional_id == null || b.professional_id == null || +b.professional_id === +row.professional_id) &&
        s < Slots.toMin(b.end_time) + buf &&
        e > Slots.toMin(b.start_time) - buf
    );
    if (hit) throw new ApiErr('slot_taken');
  };
  const ctxNow = (busyRows) => ({ hours: db().hours, blocked: db().blocked, pros: db().pros.map(normPro), busy: busyRows, set: normSet(db().settings) });

  return {
    async load() {
      const d = db();
      return delay({ services: d.services, hours: d.hours, blocked: d.blocked, pros: d.pros.map(({ phone, ...p }) => p), set: d.settings });
    },
    async busy(from, to) {
      return delay(db().bookings.filter((b) => ACTIVE.includes(b.status) && b.booking_date >= from && b.booking_date <= to).map((b) => ({ booking_date: b.booking_date, start_time: b.start_time, end_time: b.end_time, professional_id: b.professional_id })));
    },
    async book(b) {
      const d = db(), set = normSet(d.settings);
      const name = String(b.name || '').trim();
      if (name.length < 2 || name.length > 80) throw new ApiErr('bad_name');
      if (!phoneOk(b.phone)) throw new ApiErr('bad_phone');
      const email = String(b.email || '').trim().toLowerCase();
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiErr('bad_email');
      const svc = d.services.find((s) => s.id === +b.service_id && s.active);
      if (!svc) throw new ApiErr('bad_service');
      const phone = phoneStore(b.phone);
      const today = Slots.today({ set }).d;
      if (set.max_per_phone > 0 && d.bookings.filter((x) => x.client_phone === phone && ACTIVE.includes(x.status) && x.booking_date >= today).length >= set.max_per_phone) throw new ApiErr('limit');
      const r = Slots.check(ctxNow(d.bookings.filter((x) => ACTIVE.includes(x.status))), b.date, b.time, svc, b.professional_id ?? null);
      if (r.code) throw new ApiErr(r.code);
      const row = {
        id: nid('bookings'),
        client_name: name,
        client_phone: phone,
        client_email: email,
        service_id: svc.id,
        professional_id: r.pro,
        booking_date: b.date,
        start_time: b.time + ':00',
        end_time: Slots.toHM(Slots.toMin(b.time) + svc.duration_min) + ':00',
        price_snapshot: svc.price,
        status: 'pending',
        notes: String(b.notes || '').slice(0, 500),
        created_at: iso(),
        updated_at: iso()
      };
      guard(row);
      d.bookings.push(row);
      save();
      Demo.emit({ eventType: 'INSERT', new: row });
      return delay({ id: row.id, professional_id: row.professional_id });
    },
    async bookings() {
      return delay(db().bookings.slice().sort((a, b) => (b.booking_date + b.start_time).localeCompare(a.booking_date + a.start_time)));
    },
    async adminLoad() {
      return delay({ blocked: db().blocked, pros: db().pros });
    },
    async insert(t, row) {
      const d = db(), k = tables[t];
      const r = { ...row, id: nid(k), created_at: iso(), updated_at: iso() };
      if (t === 'bookings') guard(r);
      d[k].push(r);
      save();
      return delay(r);
    },
    async update(t, id, patch) {
      const d = db(), k = tables[t];
      const i = d[k].findIndex((x) => x.id === id);
      if (i < 0) throw new ApiErr('unknown');
      const r = { ...d[k][i], ...patch, updated_at: iso() };
      if (t === 'bookings') {
        const o = d[k][i];
        const same = ACTIVE.includes(o.status) && o.booking_date === r.booking_date && o.start_time === r.start_time && o.end_time === r.end_time && o.professional_id == r.professional_id;
        if (!same) guard(r);
      }
      d[k][i] = r;
      save();
      return delay(r);
    },
    async remove(t, id) {
      const d = db(), k = tables[t];
      if (t === 'services' && d.bookings.some((b) => b.service_id === id)) throw new ApiErr('in_use');
      d[k] = d[k].filter((x) => x.id !== id);
      if (t === 'professionals') {
        d.bookings.forEach((b) => b.professional_id === id && (b.professional_id = null));
        d.blocked = d.blocked.filter((b) => b.professional_id !== id);
      }
      save();
      return delay(null);
    },
    async saveHours(rows) {
      db().hours = rows.map((r) => ({ ...r }));
      save();
      return delay(rows);
    },
    async saveSettings(data) {
      db().settings = { ...data };
      save();
      return delay(null);
    },
    subs: new Set(),
    emit(p) {
      Demo.subs.forEach((f) => setTimeout(() => f(p), 50));
    },
    subscribe(cb) {
      Demo.subs.add(cb);
      return () => Demo.subs.delete(cb);
    },
    reset() {
      D = seed();
      save();
    }
  };
})();

const API = DEMO ? Demo : Remote;

/* Carrega o que o site público precisa. */
async function loadPublic() {
  if (!DEMO && !SB) throw new ApiErr('network');
  const d = await API.load();
  DB.set = normSet(d.set);
  DB.services = (d.services || []).filter((s) => s && s.name && +s.duration_min > 0);
  DB.hours = d.hours || [];
  DB.blocked = d.blocked || [];
  DB.pros = (d.pros || []).map(normPro);
  DB.ready = true;
}

/* Horários ocupados de hoje até o último dia agendável. */
async function loadBusy() {
  const ctx = { set: DB.set };
  DB.busy = await API.busy(Slots.today(ctx).d, Slots.lastDay(ctx));
  DB.busyAt = Date.now();
  return DB.busy;
}

const activeServices = () => DB.services.filter((s) => s.active !== false).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id);
const activePros = () => DB.pros.filter((p) => p.active).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id);
const multi = () => Slots.cfg({ set: DB.set }).multi && activePros().length > 0;
const svcById = (id) => DB.services.find((s) => String(s.id) === String(id));
const proById = (id) => DB.pros.find((p) => String(p.id) === String(id));
const profLabel = () => String(DB.set.prof_label || 'Profissional').trim() || 'Profissional';
/* Código curto do agendamento: #0042 */
const code = (id) => '#' + String(id).padStart(4, '0');
