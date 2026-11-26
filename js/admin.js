/* =============================================================
   admin.js — painel administrativo (carregado sob demanda por app.js).
   Abas: Dashboard · Agendamentos · Serviços · Horários · Bloqueios ·
         Profissionais · Clientes · Configurações · Senha
   Toda escrita passa pela API (Supabase com RLS de admin, ou demo).
   ============================================================= */
const Admin = (() => {
  const A = {
    tab: 'dash',
    bk: [],
    f: { st: 'all', per: 'next', svc: '', q: '', from: '', to: '', desc: false },
    n: 60,
    cq: '',
    unsub: null,
    form: null,
    up: {},
    dirty: false,
    busy: false
  };

  /* ---------- utilitários ---------- */
  const today = () => Slots.today({ set: DB.set }).d;
  const nowMin = () => Slots.today({ set: DB.set }).m;
  const add = Slots.addDays;
  const week = (d) => {
    const s = add(d, -((Slots.weekday(d) + 6) % 7)); // segunda
    return [s, add(s, 6)];
  };
  const svcName = (id) => svcById(id)?.name || 'Serviço removido';
  const proNm = (id) => (id == null ? '' : proById(id)?.name || 'Profissional removido');
  const first = (n) => String(n || '').trim().split(/\s+/)[0] || '';
  const ini = (n) => String(n || '?').trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  /* plural simples em pt-BR: Profissional→Profissionais, Sala→Salas, Box→Box */
  const pl = (w) => (/l$/i.test(w) ? w.slice(0, -1) + 'is' : /m$/i.test(w) ? w.slice(0, -1) + 'ns' : /[aeiou]$/i.test(w) ? w + 's' : /[sx]$/i.test(w) ? w : w + 'es');
  const ib = (icon, label, act, v, cls = '') => '<button class="ib ' + cls + '" data-a="' + act + '" data-v="' + v + '" aria-label="' + esc(label) + '" title="' + esc(label.split(' de ')[0]) + '">' + ic(icon, 18) + '</button>';
  const sw = (id, label, on, extra = '') => '<label class="sw"><input type="checkbox" role="switch" id="' + id + '"' + (on ? ' checked' : '') + extra + '><span>' + label + '</span></label>';
  const parsePrice = (v) => {
    let s = String(v || '').replace(/[R$\s]/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
  };
  const priceIn = (n) => (Number(n) > 0 ? Number(n).toFixed(2).replace('.', ',') : '');
  const live = (b) => b.status !== 'cancelled';
  const active = (b) => ACTIVE.includes(b.status);
  const sortBk = (l, desc) => l.slice().sort((a, b) => (a.booking_date + a.start_time).localeCompare(b.booking_date + b.start_time) * (desc ? -1 : 1));
  const thumb = (r, seed, name, av) => {
    r = R(r);
    return '<span class="th' + (av ? ' av' : '') + '">' + (r && r.u ? IMG.html(r, { seed, letter: name }) : esc(av ? ini(name) : String(name || '?').charAt(0).toUpperCase())) + '</span>';
  };
  /* Mensagem pronta para o cliente, conforme o status. */
  const waClient = (b) => {
    const base = svcName(b.service_id) + ' em ' + dBR(b.booking_date) + ' às ' + hm(b.start_time);
    const t =
      b.status === 'cancelled'
        ? 'Olá, ' + first(b.client_name) + '! Precisamos cancelar seu agendamento de ' + base + '. Podemos remarcar?'
        : b.status === 'done'
          ? 'Olá, ' + first(b.client_name) + '! Obrigado pela visita. Quando quiser, é só agendar de novo pelo site.'
          : 'Olá, ' + first(b.client_name) + '! Seu agendamento de ' + base + ' está confirmado. Até lá! — ' + DB.set.name;
    return wa(t, b.client_phone);
  };

  /* Horários ocupados = agendamentos ativos (o admin enxerga tudo). */
  const syncBusy = () => {
    DB.busy = A.bk.filter(active).map((b) => ({ booking_date: b.booking_date, start_time: b.start_time, end_time: b.end_time, professional_id: b.professional_id }));
    DB.busyAt = Date.now();
    const n = A.bk.filter((b) => b.status === 'pending' && b.booking_date >= today()).length;
    const e = $('nb');
    if (e) {
      e.textContent = n;
      e.classList.toggle('hid', !n);
      e.setAttribute('aria-label', plural(n, 'pendente', 'pendentes'));
    }
  };

  const put = (row) => {
    const i = A.bk.findIndex((x) => x.id === row.id);
    if (i >= 0) A.bk[i] = row;
    else A.bk.push(row);
    syncBusy();
  };

  /* ---------- abas ---------- */
  const TABS = () => [
    ['dash', 'Dashboard', 'grid'],
    ['bk', 'Agendamentos', 'cal'],
    ['svc', 'Serviços', 'tag'],
    ['hrs', 'Horários', 'clock'],
    ['blk', 'Bloqueios', 'ban'],
    ['pro', pl(profLabel()), 'users'],
    ['cli', 'Clientes', 'user'],
    ['cfg', 'Configurações', 'sliders'],
    ['pw', 'Senha', 'lock']
  ];

  const shell = () => {
    $('adm').innerHTML =
      '<div class="ad"><aside class="ad-side"><div class="ad-brand"><span class="logo" id="ad-logo"><span>' + esc(DB.set.name) + '</span></span><span class="xs tm">Painel de agendamentos</span></div>' +
      '<nav class="ad-nav" role="tablist" aria-label="Seções do painel" id="ad-nav">' +
      TABS()
        .map(([k, l, i]) => '<button role="tab" id="t-' + k + '" aria-controls="ad-main" aria-selected="' + (A.tab === k) + '" tabindex="' + (A.tab === k ? 0 : -1) + '" data-a="atab" data-v="' + k + '">' + ic(i, 18) + '<span>' + esc(l) + '</span>' + (k === 'bk' ? '<span class="nb hid" id="nb"></span>' : '') + '</button>')
        .join('') +
      '</nav><div class="ad-foot"><a href="#top" data-a="aview" aria-label="Ver site">' + ic('ext', 18) + '<span>Ver site</span></a><button data-a="aexit" aria-label="Sair">' + ic('out', 18) + '<span>Sair</span></button></div></aside>' +
      '<main class="ad-main" id="ad-main" role="tabpanel" tabindex="-1" aria-labelledby="t-' + A.tab + '"><div class="ad-in" id="ad-in"></div></main></div>';
    if (!$('am')) {
      const m = document.createElement('div');
      m.id = 'am';
      m.className = 'md af hid';
      document.body.appendChild(m);
    }
  };

  const top = (kick, title, sub, actions = '') =>
    (DEMO ? '<div class="demo"><span><b>Modo demonstração.</b> Os dados ficam só neste navegador.</span><button class="lnk" data-a="areset">Restaurar dados de exemplo</button></div>' : '') +
    '<header class="ad-top"><div><p class="kick">' + kick + '</p><h1 id="ad-h">' + esc(title) + '</h1>' + (sub ? '<p>' + sub + '</p>' : '') + '</div><div class="row">' + actions + '</div></header>';

  const show = async (tab, keepScroll) => {
    if (A.dirty && tab !== A.tab && !(await ask('Descartar alterações?', 'Você mudou campos nesta aba e ainda não salvou.', 'Descartar', true))) return;
    A.dirty = false;
    A.tab = tab;
    document.querySelectorAll('#ad-nav [role=tab]').forEach((b) => {
      const on = b.dataset.v === tab;
      b.setAttribute('aria-selected', on);
      b.tabIndex = on ? 0 : -1;
    });
    $('ad-main').setAttribute('aria-labelledby', 't-' + tab);
    const y = $('ad-main').scrollTop;
    $('ad-in').innerHTML = VIEW[tab]();
    AFTER[tab] && AFTER[tab]();
    $('ad-main').scrollTop = keepScroll ? y : 0;
    syncBusy();
  };
  const redraw = () => show(A.tab, true);

  /* ================= DASHBOARD ================= */
  const occupancy = (from, to, list) => {
    const agendas = multi() ? activePros().length : 1;
    let open = 0;
    for (let d = from; d <= to; d = add(d, 1)) {
      if (DB.blocked.some((b) => d >= b.date && d <= (b.date_end || b.date) && b.professional_id == null && b.all_day !== false)) continue;
      open += Slots.segments(DB.hours.find((h) => +h.weekday === Slots.weekday(d))).reduce((s, [a, b]) => s + b - a, 0) * agendas;
    }
    const used = list.reduce((s, b) => s + Slots.toMin(b.end_time) - Slots.toMin(b.start_time), 0);
    return open ? Math.min(100, Math.round((used / open) * 100)) : 0;
  };

  const item = (b, o = {}) => {
    const x = b.status === 'cancelled', act = active(b), t = today();
    const pro = b.professional_id != null ? proNm(b.professional_id) : multi() ? 'Agenda geral' : '';
    return (
      '<div class="it' + (x ? ' x' : '') + '"><div class="it-t">' + (o.date ? '<small>' + esc(Site.relDay(b.booking_date)) + '</small>' : '') + hm(b.start_time) + '<small>até ' + hm(b.end_time) + '</small></div>' +
      '<div class="it-c"><b>' + esc(b.client_name) + '</b><p>' + esc(svcName(b.service_id)) + (pro ? ' · ' + esc(pro) : '') + ' · ' + price(b.price_snapshot) + '</p><p>' + esc(phoneShow(b.client_phone)) + (b.client_email ? ' · ' + esc(b.client_email) : '') + '</p>' +
      (b.notes ? '<p class="nt">“' + esc(b.notes) + '”</p>' : '') + '</div>' +
      '<div class="it-a"><span class="badge ' + b.status + '">' + STATUS[b.status] + '</span>' +
      (b.status === 'pending' ? ib('check', 'Confirmar agendamento de ' + b.client_name, 'aconf', b.id, 'ok') : '') +
      (act && b.booking_date <= t ? ib('done', 'Marcar como concluído o de ' + b.client_name, 'adone', b.id, 'ok') : '') +
      (act ? ib('ban', 'Cancelar agendamento de ' + b.client_name, 'acanc', b.id, 'er') : '') +
      '<a class="ib" href="' + esc(waClient(b)) + '" target="_blank" rel="noopener" aria-label="Mensagem no WhatsApp para ' + esc(b.client_name) + '" title="WhatsApp">' + ic('wa', 18) + '</a>' +
      (o.short ? '' : ib('edit', 'Editar agendamento de ' + b.client_name, 'aedit', b.id) + ib('trash', 'Excluir agendamento de ' + b.client_name, 'adel', b.id, 'er')) +
      '</div></div>'
    );
  };

  /* Gráfico de barras (série única): 7 dias, hover/foco com tooltip, tabela alternativa. */
  const chart = (days, vals) => {
    const W = 560, H = 210, pt = 26, pb = 30, px = 4;
    const max = Math.max(...vals), topV = Math.max(4, Math.ceil(max / 2) * 2);
    const band = (W - px * 2) / days.length, bw = Math.min(24, band * 0.5), r = 4, y0 = H - pb;
    const t = today();
    const lab = new Set([days.length - 1, vals.indexOf(max)]);
    let g = '<line class="gl" x1="0" x2="' + W + '" y1="' + y0 + '" y2="' + y0 + '"/><line class="gl" x1="0" x2="' + W + '" y1="' + pt + '" y2="' + pt + '"/>' + '<text class="ax" x="0" y="' + (pt - 8) + '">' + topV + '</text>';
    days.forEach((d, i) => {
      const v = vals[i], h = (v / topV) * (y0 - pt), x = px + i * band + (band - bw) / 2, y = y0 - h, rr = Math.min(r, h);
      const path = h > 0 ? 'M' + x + ',' + y0 + 'V' + (y + rr) + 'Q' + x + ',' + y + ' ' + (x + rr) + ',' + y + 'H' + (x + bw - rr) + 'Q' + (x + bw) + ',' + y + ' ' + (x + bw) + ',' + (y + rr) + 'V' + y0 + 'Z' : '';
      const name = cap(dLong(d)) + ': ' + plural(v, 'agendamento', 'agendamentos');
      g += '<rect class="hit" x="' + (px + i * band) + '" y="' + pt + '" width="' + band + '" height="' + (y0 - pt) + '" tabindex="0" role="img" aria-label="' + esc(name) + '" data-i="' + i + '"/>';
      g += path ? '<path class="bar" d="' + path + '"/>' : '';
      if (lab.has(i) && v > 0) g += '<text class="vl" x="' + (x + bw / 2) + '" y="' + (y - 6) + '" text-anchor="middle">' + v + '</text>';
      g += '<text class="ax' + (d === t ? ' t' : '') + '" x="' + (x + bw / 2) + '" y="' + (H - 10) + '" text-anchor="middle">' + (d === t ? 'Hoje' : WD3[Slots.weekday(d)] + ' ' + +d.slice(8, 10)) + '</text>';
    });
    return (
      '<div class="ch" id="ch"><svg viewBox="0 0 ' + W + ' ' + H + '" role="group" aria-label="Agendamentos por dia nos últimos 7 dias">' + g + '</svg><div class="tip hid" id="tip" aria-hidden="true"></div></div>' +
      '<details class="tv"><summary>Ver tabela</summary><table class="tbl"><thead><tr><th>Dia</th><th>Agendamentos</th></tr></thead><tbody>' +
      days.map((d, i) => '<tr><td>' + esc(cap(dLong(d))) + '</td><td>' + vals[i] + '</td></tr>').join('') +
      '</tbody></table></details>'
    );
  };

  const vDash = () => {
    const t = today(), [ws, we] = week(t);
    const L = A.bk.filter(live);
    const tdy = L.filter((b) => b.booking_date === t);
    const pend = A.bk.filter((b) => b.status === 'pending' && b.booking_date >= t);
    const wk = L.filter((b) => b.booking_date >= ws && b.booking_date <= we);
    const pwk = L.filter((b) => b.booking_date >= add(ws, -7) && b.booking_date <= add(we, -7)).length;
    const rev = wk.reduce((s, b) => s + +b.price_snapshot, 0);
    const occ = occupancy(ws, we, wk.filter(active).concat(wk.filter((b) => b.status === 'done')));
    const delta = wk.length - pwk;
    const next = sortBk(A.bk.filter((b) => active(b) && (b.booking_date > t || (b.booking_date === t && Slots.toMin(b.end_time) >= nowMin())))).slice(0, 3);
    const days = Array.from({ length: 7 }, (_, i) => add(t, i - 6));
    const vals = days.map((d) => L.filter((b) => b.booking_date === d).length);
    return (
      top('Visão geral', 'Dashboard', cap(dLong(t)), '<button class="b gold" data-a="anew">' + ic('plus', 18) + 'Novo agendamento</button>') +
      '<div class="kpis">' +
      '<div class="kpi"><span>Hoje</span><b>' + tdy.length + '</b><small>' + (tdy.filter((b) => b.status === 'pending').length ? plural(tdy.filter((b) => b.status === 'pending').length, 'pendente', 'pendentes') : 'nenhum pendente') + '</small></div>' +
      '<button class="kpi" data-a="apend"><span>Pendentes</span><b>' + pend.length + '</b><small>aguardando confirmação</small></button>' +
      '<div class="kpi"><span>Esta semana</span><b>' + wk.length + '</b><small>' + money(rev) + ' previstos · ' + (delta === 0 ? 'igual à anterior' : (delta > 0 ? '+' : '−') + Math.abs(delta) + ' vs. anterior') + '</small></div>' +
      '<div class="kpi"><span>Ocupação da semana</span><b>' + occ + '%</b><div class="meter" role="img" aria-label="' + occ + '% da agenda ocupada"><i style="width:' + occ + '%"></i></div></div>' +
      '</div><div class="grid2">' +
      '<section class="box"><div class="box-h"><h2>Agendamentos por dia</h2><p>Últimos 7 dias, sem cancelados</p></div>' + chart(days, vals) + '</section>' +
      '<section class="box nxt"><div class="box-h"><h2>Próximos atendimentos</h2><button class="lnk" data-a="atab" data-v="bk">Ver agenda</button></div>' +
      (next.length ? '<div class="li">' + next.map((b) => item(b, { date: 1, short: 1 })).join('') + '</div>' : '<div class="emp2"><b>Agenda livre</b>Nenhum atendimento marcado à frente.</div>') +
      '</section></div>'
    );
  };

  const dashAfter = () => {
    const c = $('ch');
    if (!c) return;
    const tip = $('tip');
    const showTip = (el) => {
      const i = +el.dataset.i, rc = el.getBoundingClientRect(), cr = c.getBoundingClientRect();
      const [d, v] = el.getAttribute('aria-label').split(': ');
      tip.replaceChildren();
      const b = document.createElement('b');
      b.textContent = v;
      const s = document.createElement('span');
      s.textContent = d;
      tip.append(b, s);
      tip.style.left = rc.left - cr.left + rc.width / 2 + 'px';
      const bar = el.nextElementSibling && el.nextElementSibling.tagName === 'path' ? el.nextElementSibling.getBoundingClientRect() : null;
      tip.style.top = (bar ? bar.top : rc.bottom) - cr.top + 'px';
      tip.classList.remove('hid');
      tip.dataset.i = i;
    };
    const hide = () => tip.classList.add('hid');
    c.querySelectorAll('.hit').forEach((h) => {
      h.addEventListener('pointerenter', () => showTip(h));
      h.addEventListener('focus', () => showTip(h));
      h.addEventListener('pointerleave', hide);
      h.addEventListener('blur', hide);
    });
  };

  /* ================= AGENDAMENTOS ================= */
  const inPeriod = (b) => {
    const f = A.f, t = today(), d = b.booking_date;
    if (f.per === 'next') return d >= t;
    if (f.per === 'today') return d === t;
    if (f.per === 'week') {
      const [a, z] = week(t);
      return d >= a && d <= z;
    }
    if (f.per === '30') return d >= add(t, -30) && d <= t;
    if (f.per === 'custom') return (!f.from || d >= f.from) && (!f.to || d <= f.to);
    return true;
  };
  const matchQ = (b) => {
    const q = A.f.q.trim();
    if (!q) return true;
    const dq = q.replace(/\D/g, '');
    return nz(b.client_name).includes(nz(q)) || (dq.length >= 3 && b.client_phone.includes(dq)) || String(code(b.id)).includes(q);
  };
  const base = () => A.bk.filter((b) => inPeriod(b) && (!A.f.svc || String(b.service_id) === A.f.svc) && matchQ(b));
  const filtered = () => {
    const l = base().filter((b) => A.f.st === 'all' || b.status === A.f.st);
    return sortBk(l, A.f.desc || A.f.per === '30');
  };

  const segBar = () => {
    const l = base();
    const c = (s) => (s === 'all' ? l.length : l.filter((b) => b.status === s).length);
    return [['all', 'Todos'], ['pending', 'Pendentes'], ['confirmed', 'Confirmados'], ['done', 'Concluídos'], ['cancelled', 'Cancelados']]
      .map(([k, n]) => '<button data-a="ast" data-v="' + k + '" aria-pressed="' + (A.f.st === k) + '">' + n + ' <em>' + c(k) + '</em></button>')
      .join('');
  };

  const listHtml = () => {
    const l = filtered();
    if (!l.length) return '<div class="emp2"><b>Nada por aqui</b>Nenhum agendamento com esses filtros.</div>';
    const shown = l.slice(0, A.n), t = today();
    const groups = [];
    shown.forEach((b) => {
      const g = groups[groups.length - 1];
      if (g && g.d === b.booking_date) g.l.push(b);
      else groups.push({ d: b.booking_date, l: [b] });
    });
    return (
      groups.map((g) => '<section class="dg"><h3>' + esc((g.d === t ? 'Hoje — ' : g.d === add(t, 1) ? 'Amanhã — ' : '') + dLong(g.d)) + ' <span>' + g.l.length + '</span></h3><div class="li">' + g.l.map((b) => item(b)).join('') + '</div></section>').join('') +
      (l.length > A.n ? '<div class="more"><button class="b ghost" data-a="amore">Ver mais (' + (l.length - A.n) + ')</button></div>' : '')
    );
  };

  const vBk = () => {
    const f = A.f;
    const per = [['next', 'Próximos'], ['today', 'Hoje'], ['week', 'Esta semana'], ['30', 'Últimos 30 dias'], ['all', 'Todos'], ['custom', 'Personalizado']];
    return (
      top('Agenda', 'Agendamentos', plural(filtered().length, 'agendamento', 'agendamentos') + ' com os filtros atuais', '<button class="b gold" data-a="anew">' + ic('plus', 18) + 'Novo agendamento</button>') +
      '<div class="seg" role="group" aria-label="Filtrar por status" id="bseg">' + segBar() + '</div>' +
      '<div class="fb"><div class="srch">' + ic('search', 16) + '<input class="in" type="search" id="bq" placeholder="Buscar nome, telefone ou código" aria-label="Buscar agendamento" value="' + esc(f.q) + '"></div>' +
      '<select class="in" id="bper" aria-label="Período">' + per.map(([k, n]) => '<option value="' + k + '"' + (f.per === k ? ' selected' : '') + '>' + n + '</option>').join('') + '</select>' +
      (f.per === 'custom' ? '<input class="in" type="date" id="bfrom" aria-label="De" value="' + f.from + '"><input class="in" type="date" id="bto" aria-label="Até" value="' + f.to + '">' : '') +
      '<select class="in" id="bsvc" aria-label="Serviço"><option value="">Todos os serviços</option>' + DB.services.map((s) => '<option value="' + s.id + '"' + (f.svc === String(s.id) ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select>' +
      '<button class="b ghost sm" data-a="asort" aria-label="Inverter ordem por data">' + ic(f.desc ? 'down' : 'up', 16) + 'Data</button></div>' +
      '<div id="blist">' + listHtml() + '</div>'
    );
  };
  const refreshList = () => {
    if (A.tab !== 'bk') return;
    $('blist').innerHTML = listHtml();
    $('bseg').innerHTML = segBar();
    const h = document.querySelector('.ad-top p:not(.kick)');
    if (h) h.textContent = plural(filtered().length, 'agendamento', 'agendamentos') + ' com os filtros atuais';
  };

  const setStatus = async (id, st, msg) => {
    try {
      put(await API.update('bookings', id, { status: st }));
      toast(msg, 'ok');
    } catch (e) {
      toast(apiErr(e).message, 'er');
    }
    redraw();
  };

  /* ---------- formulário de agendamento ---------- */
  const admCtx = (excl) => ({
    ...slotCtx(A.bk.filter((b) => active(b) && b.id !== excl)),
    set: { ...DB.set, min_notice: 0, max_advance: 366 }
  });

  const form = (title, body, saveAct, extra = '') => {
    $('am').innerHTML =
      '<div role="dialog" aria-modal="true" aria-labelledby="af-t" tabindex="-1"><header class="af-h"><h2 id="af-t">' + esc(title) + '</h2><button class="q" data-a="aclose" aria-label="Fechar">' + ic('x', 18) + '</button></header>' +
      '<div class="af-b">' + body + '<p class="ferr2 hid" id="af-e" role="alert"></p></div><footer class="af-f">' + extra + '<button class="b ghost" data-a="aclose">Cancelar</button><button class="b gold" data-a="' + saveAct + '">Salvar</button></footer></div>';
    Layer.open('am', $('am').querySelector('.af-b input, .af-b select'));
  };
  const formErr = (m) => {
    const e = $('af-e');
    e.textContent = m;
    e.classList.remove('hid');
    e.scrollIntoView({ block: 'nearest' });
  };
  const closeForm = () => {
    Layer.close('am');
    A.form = null;
  };
  const v = (id) => ($(id) ? $(id).value.trim() : '');

  const bkForm = (b, pre = {}) => {
    const s = b ? svcById(b.service_id) : activeServices()[0];
    A.form = { kind: 'bk', id: b ? b.id : null, priceTouched: !!b };
    const pros = DB.pros.filter((p) => p.active || (b && p.id === b.professional_id));
    const showPro = multi() || (b && b.professional_id != null);
    form(
      b ? 'Editar agendamento ' + code(b.id) : 'Novo agendamento',
      '<div class="fg two">' +
        '<label class="lb full">Nome do cliente<input class="in" id="g-name" maxlength="80" autocomplete="off" value="' + esc(b ? b.client_name : pre.name || '') + '"></label>' +
        '<label class="lb">WhatsApp<input class="in num-t" id="g-phone" type="tel" inputmode="tel" placeholder="(83) 99999-9999" value="' + esc(phoneMask(b ? b.client_phone : pre.phone || '')) + '"></label>' +
        '<label class="lb">E-mail <span class="hint">(opcional)</span><input class="in" id="g-email" type="email" value="' + esc(b ? b.client_email : pre.email || '') + '"></label>' +
        '<label class="lb' + (showPro ? '' : ' full') + '">Serviço<select class="in" id="g-svc">' + DB.services.filter((x) => x.active !== false || (s && x.id === s.id)).map((x) => '<option value="' + x.id + '"' + (s && x.id === s.id ? ' selected' : '') + '>' + esc(x.name) + ' · ' + dur(x.duration_min) + '</option>').join('') + '</select></label>' +
        (showPro ? '<label class="lb">' + esc(profLabel()) + '<select class="in" id="g-pro"><option value="">Agenda geral (bloqueia todos)</option>' + pros.map((p) => '<option value="' + p.id + '"' + (b && b.professional_id === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select></label>' : '') +
        '<label class="lb">Data<input class="in" id="g-date" type="date" value="' + (b ? b.booking_date : pre.date || today()) + '"></label>' +
        '<label class="lb">Horário<input class="in num-t" id="g-time" type="time" step="300" value="' + (b ? hm(b.start_time) : pre.time || '') + '"></label>' +
        '<div class="full col"><span class="hint">Horários livres nesse dia (toque para usar):</span><div class="sug" id="g-sug"></div></div>' +
        '<label class="lb">Valor (R$)<input class="in num-t" id="g-price" inputmode="decimal" placeholder="Sob consulta" value="' + priceIn(b ? b.price_snapshot : s ? s.price : 0) + '"></label>' +
        '<label class="lb">Status<select class="in" id="g-st">' + Object.entries(STATUS).map(([k, n]) => '<option value="' + k + '"' + ((b ? b.status : 'confirmed') === k ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label>' +
        '<label class="lb full">Observação <span class="hint">(opcional)</span><textarea class="in" id="g-notes" maxlength="500" rows="2">' + esc(b ? b.notes : '') + '</textarea></label>' +
        '</div>',
      'absave'
    );
    sugg();
  };

  /* Sugestões de horários livres no formulário do admin. */
  const sugg = () => {
    const e = $('g-sug');
    if (!e) return;
    const s = svcById(v('g-svc')), d = v('g-date'), pro = v('g-pro') || null;
    const l = s && d ? Slots.list(admCtx(A.form.id), d, s, pro ? +pro : null) : [];
    const cur = v('g-time');
    e.innerHTML = l.length ? l.map((t) => '<button type="button" data-a="asug" data-v="' + t + '" aria-pressed="' + (t === cur) + '">' + t + '</button>').join('') : '<span class="hint">Nenhum horário livre pelas regras da agenda. Você ainda pode digitar um horário.</span>';
  };

  const saveBk = async () => {
    const s = svcById(v('g-svc')), time = v('g-time'), date = v('g-date');
    const name = v('g-name'), ph = v('g-phone'), pr = v('g-price') === '' ? 0 : parsePrice(v('g-price'));
    if (name.length < 2) return formErr('Informe o nome do cliente.');
    if (!phoneOk(ph)) return formErr('Telefone inválido. Use DDD + número.');
    if (!s) return formErr('Escolha o serviço.');
    if (!date || !/^\d{2}:\d{2}$/.test(time)) return formErr('Escolha data e horário.');
    if (Number.isNaN(pr)) return formErr('Valor inválido. Ex.: 120,00');
    const st = Slots.toMin(time), en = st + s.duration_min;
    if (en >= 1440) return formErr('Esse atendimento passaria da meia-noite.');
    const row = {
      client_name: name,
      client_phone: phoneStore(ph),
      client_email: v('g-email').toLowerCase(),
      service_id: s.id,
      professional_id: v('g-pro') ? +v('g-pro') : null,
      booking_date: date,
      start_time: time + ':00',
      end_time: Slots.toHM(en) + ':00',
      price_snapshot: pr,
      status: v('g-st'),
      notes: v('g-notes')
    };
    try {
      const r = A.form.id ? await API.update('bookings', A.form.id, row) : await API.insert('bookings', row);
      put(r);
      closeForm();
      toast(A.form && A.form.id ? 'Agendamento atualizado.' : 'Agendamento salvo.', 'ok');
      redraw();
    } catch (e) {
      const er = apiErr(e);
      formErr(er.code === 'slot_taken' ? 'Conflito com outro agendamento nesse horário (considerando a pausa de ' + Slots.cfg({ set: DB.set }).buf + ' min entre atendimentos).' : er.message);
    }
  };

  /* ================= SERVIÇOS ================= */
  const svcSorted = () => DB.services.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id);
  const vSvc = () => {
    const l = svcSorted(), t = today();
    return (
      top('Catálogo', 'Serviços', 'A ordem da lista é a ordem do site.', '<button class="b gold" data-a="asnew">' + ic('plus', 18) + 'Novo serviço</button>') +
      (l.length
        ? '<div class="li">' +
          l
            .map((s, i) => {
              const fut = A.bk.filter((b) => b.service_id === s.id && active(b) && b.booking_date >= t).length;
              return (
                '<div class="rw">' + thumb(s.image, s.id, s.name) + '<div class="grow"><b>' + esc(s.name) + '</b><p>' + dur(s.duration_min) + ' · ' + price(s.price) + (fut ? ' · ' + plural(fut, 'agendamento futuro', 'agendamentos futuros') : '') + '</p></div>' +
                '<span class="badge ' + (s.active !== false ? 'confirmed' : 'off') + '">' + (s.active !== false ? 'Ativo' : 'Inativo') + '</span>' +
                ib('up', 'Subir ' + s.name, 'amv', 'svc|' + s.id + '|-1') .replace('<button', '<button' + (i === 0 ? ' disabled' : '')) +
                ib('down', 'Descer ' + s.name, 'amv', 'svc|' + s.id + '|1').replace('<button', '<button' + (i === l.length - 1 ? ' disabled' : '')) +
                ib('edit', 'Editar ' + s.name, 'asedit', s.id) +
                ib('trash', 'Excluir ' + s.name, 'asdel', s.id, 'er') +
                '</div>'
              );
            })
            .join('') +
          '</div>'
        : '<div class="emp2"><b>Nenhum serviço</b>Cadastre o primeiro serviço para abrir a agenda.</div>')
    );
  };

  const upBtn = (key, label) => '<label class="b ghost sm">' + ic('upload', 16) + '<span>' + label + '</span><input type="file" accept="image/*" data-up="' + key + '"></label>';
  const upPrev = (key, ref, name, wide) => {
    const r = R(ref);
    return '<div class="up" id="up-' + key + '"><span class="th' + (wide ? ' wide' : '') + '">' + (r && r.u ? IMG.html(r, { letter: name }) : ic('img', 22)) + '</span>' + upBtn(key, r && r.u ? 'Trocar foto' : 'Enviar foto') + (r && r.u ? '<button class="lnk" data-a="aupx" data-v="' + key + '">Remover</button>' : '') + '</div>';
  };

  const svcForm = (s) => {
    A.form = { kind: 'svc', id: s ? s.id : null };
    A.up.svc = s ? R(s.image) : null;
    const durs = [];
    for (let m = 15; m <= 480; m += 15) durs.push(m);
    form(
      s ? 'Editar serviço' : 'Novo serviço',
      '<div class="fg two"><label class="lb full">Nome<input class="in" id="g-sname" maxlength="120" value="' + esc(s ? s.name : '') + '"></label>' +
        '<label class="lb full">Descrição <span class="hint">(aparece no card, até 2 linhas)</span><textarea class="in" id="g-sdesc" maxlength="600" rows="3">' + esc(s ? s.description : '') + '</textarea></label>' +
        '<label class="lb">Duração<select class="in" id="g-sdur">' + durs.map((m) => '<option value="' + m + '"' + ((s ? s.duration_min : 60) === m ? ' selected' : '') + '>' + dur(m) + '</option>').join('') + '</select></label>' +
        '<label class="lb">Preço (R$) <span class="hint">vazio = sob consulta</span><input class="in num-t" id="g-sprice" inputmode="decimal" placeholder="0,00" value="' + priceIn(s ? s.price : '') + '"></label>' +
        '<div class="full col"><span class="lb">Foto <span class="hint">(opcional, 3:2 fica melhor)</span></span>' + upPrev('svc', A.up.svc, s ? s.name : '', true) + '</div>' +
        '<div class="full">' + sw('g-son', 'Ativo (aparece no site)', s ? s.active !== false : true) + '</div></div>',
      'assave'
    );
  };

  const saveSvc = async () => {
    const name = v('g-sname'), p = v('g-sprice') === '' ? 0 : parsePrice(v('g-sprice'));
    if (name.length < 2) return formErr('Informe o nome do serviço.');
    if (Number.isNaN(p)) return formErr('Preço inválido. Ex.: 80,00');
    const row = { name, description: v('g-sdesc'), duration_min: +v('g-sdur'), price: p, image: A.up.svc ? { u: A.up.svc.u } : null, active: $('g-son').checked };
    try {
      if (A.form.id) {
        const r = await API.update('services', A.form.id, row);
        DB.services = DB.services.map((x) => (x.id === r.id ? r : x));
      } else {
        const r = await API.insert('services', { ...row, sort_order: DB.services.length ? Math.max(...DB.services.map((x) => x.sort_order || 0)) + 1 : 0 });
        DB.services.push(r);
      }
      closeForm();
      toast('Serviço salvo.', 'ok');
      redraw();
    } catch (e) {
      formErr(apiErr(e).message);
    }
  };

  /* Reordena trocando de lugar com o vizinho (normaliza sort_order = posição). */
  const move = async (kind, id, dir) => {
    const list = kind === 'svc' ? svcSorted() : proSorted();
    const i = list.findIndex((x) => x.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const table = kind === 'svc' ? 'services' : 'professionals';
    try {
      for (let k = 0; k < list.length; k++) {
        if (list[k].sort_order !== k) {
          const r = await API.update(table, list[k].id, { sort_order: k });
          list[k].sort_order = r.sort_order;
        }
      }
      if (kind === 'svc') DB.services = list;
      else DB.pros = list.map(normPro);
    } catch (e) {
      toast(apiErr(e).message, 'er');
    }
    redraw();
    const b = document.querySelector('[data-a=amv][data-v="' + kind + '|' + id + '|' + dir + '"]:not(:disabled)') || document.querySelector('[data-a=amv][data-v="' + kind + '|' + id + '|' + -dir + '"]');
    if (b) b.focus();
  };

  /* ================= HORÁRIOS ================= */
  const ORDER = [1, 2, 3, 4, 5, 6, 0];
  const vHrs = () => {
    const rows = ORDER.map((w) => {
      const h = DB.hours.find((x) => +x.weekday === w) || { weekday: w, open: false, open_time: '09:00', close_time: '18:00' };
      const brk = !!h.break_start;
      return (
        '<div class="h7' + (h.open ? '' : ' off') + '" data-w="' + w + '">' + sw('h-o-' + w, cap(WD[w]), h.open, ' data-h="o"') +
        '<div class="h7-t"><input class="in num-t" type="time" step="300" id="h-a-' + w + '" value="' + hm(h.open_time) + '" aria-label="Abre às (' + WD[w] + ')"' + (h.open ? '' : ' disabled') + '><span>até</span>' +
        '<input class="in num-t" type="time" step="300" id="h-c-' + w + '" value="' + hm(h.close_time) + '" aria-label="Fecha às (' + WD[w] + ')"' + (h.open ? '' : ' disabled') + '>' +
        sw('h-b-' + w, 'Intervalo', brk, ' data-h="b"' + (h.open ? '' : ' disabled')) +
        '<span class="h7-b' + (brk ? '' : ' hid') + '" id="h-bb-' + w + '"><input class="in num-t" type="time" step="300" id="h-bs-' + w + '" value="' + hm(h.break_start || '12:00') + '" aria-label="Intervalo começa (' + WD[w] + ')"' + (h.open ? '' : ' disabled') + '><span>–</span><input class="in num-t" type="time" step="300" id="h-be-' + w + '" value="' + hm(h.break_end || '13:00') + '" aria-label="Intervalo termina (' + WD[w] + ')"' + (h.open ? '' : ' disabled') + '></span>' +
        '</div></div>'
      );
    }).join('');
    return (
      top('Agenda', 'Horário de funcionamento', 'Vale para os próximos agendamentos. Os já marcados não mudam.', '<button class="b ghost" data-a="hcopy">Copiar segunda para terça a sexta</button>') +
      '<section class="box"><div class="hd7">' + rows + '</div></section><div class="bar-s"><button class="b gold" data-a="hsave">Salvar horários</button></div>'
    );
  };

  const saveHrs = async () => {
    const rows = [];
    for (const w of ORDER) {
      const open = $('h-o-' + w).checked, a = $('h-a-' + w).value, c = $('h-c-' + w).value, brk = $('h-b-' + w).checked, bs = $('h-bs-' + w).value, be = $('h-be-' + w).value;
      const old = DB.hours.find((x) => +x.weekday === w) || {};
      if (open) {
        if (!a || !c || c <= a) return toast(cap(WD[w]) + ': o fechamento precisa ser depois da abertura.', 'er');
        if (brk && (!bs || !be || be <= bs || bs < a || be > c)) return toast(cap(WD[w]) + ': o intervalo precisa ficar dentro do expediente.', 'er');
      }
      const okT = a && c && c > a;
      rows.push({
        weekday: w,
        open,
        open_time: (okT ? a : hm(old.open_time) || '09:00') + ':00',
        close_time: (okT ? c : hm(old.close_time) || '18:00') + ':00',
        break_start: open && brk ? bs + ':00' : null,
        break_end: open && brk ? be + ':00' : null
      });
    }
    try {
      await API.saveHours(rows);
      DB.hours = rows;
      A.dirty = false;
      toast('Horários salvos.', 'ok');
    } catch (e) {
      toast(apiErr(e).message, 'er');
    }
  };

  /* ================= BLOQUEIOS ================= */
  const blkLabel = (b) => (b.date_end && b.date_end !== b.date ? dBR(b.date) + ' → ' + dBR(b.date_end) : cap(dShort(b.date)) + ' · ' + dBR(b.date));
  const vBlk = () => {
    const t = today(), ms = multi() || DB.pros.length > 0;
    const l = DB.blocked.slice().sort((a, b) => a.date.localeCompare(b.date));
    const fut = l.filter((b) => (b.date_end || b.date) >= t), past = l.filter((b) => (b.date_end || b.date) < t).reverse();
    const row = (b) =>
      '<div class="rw"><span class="th">' + ic('ban', 20) + '</span><div class="grow"><b>' + esc(blkLabel(b)) + '</b><p>' + (b.all_day !== false ? 'Dia inteiro' : hm(b.start_time) + '–' + hm(b.end_time)) + (b.professional_id != null ? ' · ' + esc(proNm(b.professional_id)) : ' · Todos') + (b.reason ? ' · ' + esc(b.reason) : '') + '</p></div>' +
      ib('trash', 'Remover bloqueio de ' + blkLabel(b), 'kdel', b.id, 'er') + '</div>';
    return (
      top('Agenda', 'Bloqueios', 'Feriados, folgas e intervalos sem atendimento.') +
      '<section class="box"><div class="box-h"><h2>Novo bloqueio</h2><p>Um dia, um período ou só algumas horas</p></div><div class="fg two">' +
      '<label class="lb">Data<input class="in" type="date" id="k-d" value="' + t + '"></label>' +
      '<label class="lb">Até <span class="hint">(opcional, para período)</span><input class="in" type="date" id="k-e"></label>' +
      '<div class="full">' + sw('k-all', 'Dia inteiro', true) + '</div>' +
      '<label class="lb k-t hid">Das<input class="in num-t" type="time" step="300" id="k-s" value="12:00"></label><label class="lb k-t hid">Até<input class="in num-t" type="time" step="300" id="k-f" value="14:00"></label>' +
      (ms ? '<label class="lb">Vale para<select class="in" id="k-p"><option value="">Todos</option>' + DB.pros.map((p) => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('') + '</select></label>' : '') +
      '<label class="lb' + (ms ? '' : ' full') + '">Motivo <span class="hint">(opcional)</span><input class="in" id="k-r" maxlength="120" placeholder="Ex.: Feriado, folga, manutenção"></label>' +
      '</div><div class="row" style="justify-content:flex-end;margin-top:16px"><button class="b gold" data-a="kadd">Adicionar bloqueio</button></div></section>' +
      '<section class="box"><div class="box-h"><h2>Próximos</h2><p>' + plural(fut.length, 'bloqueio', 'bloqueios') + '</p></div>' +
      (fut.length ? '<div class="li">' + fut.map(row).join('') + '</div>' : '<div class="emp2"><b>Nenhum bloqueio à frente</b>A agenda segue o horário de funcionamento.</div>') +
      (past.length ? '<details class="tv" style="margin-top:12px"><summary>Anteriores (' + past.length + ')</summary><div class="li">' + past.map(row).join('') + '</div></details>' : '') +
      '</section>'
    );
  };

  const addBlk = async () => {
    const d = v('k-d'), e = v('k-e'), all = $('k-all').checked, s = v('k-s'), f = v('k-f');
    if (!d) return toast('Escolha a data.', 'er');
    if (e && e < d) return toast('A data final precisa ser depois da inicial.', 'er');
    if (!all && (!s || !f || f <= s)) return toast('O horário final precisa ser depois do inicial.', 'er');
    const row = { date: d, date_end: e && e !== d ? e : null, all_day: all, start_time: all ? null : s + ':00', end_time: all ? null : f + ':00', professional_id: v('k-p') ? +v('k-p') : null, reason: v('k-r') };
    try {
      const r = await API.insert('blocked_dates', row);
      DB.blocked.push(r);
      const hit = A.bk.filter(
        (b) =>
          active(b) &&
          b.booking_date >= d &&
          b.booking_date <= (row.date_end || d) &&
          (row.professional_id == null || b.professional_id === row.professional_id) &&
          (all || (Slots.toMin(b.start_time) < Slots.toMin(f) && Slots.toMin(b.end_time) > Slots.toMin(s)))
      ).length;
      toast(hit ? 'Bloqueio criado. Atenção: ' + plural(hit, 'agendamento já marcado continua', 'agendamentos já marcados continuam') + ' ativo nesse período.' : 'Bloqueio criado.', 'ok');
      redraw();
    } catch (x) {
      toast(apiErr(x).message, 'er');
    }
  };

  /* ================= PROFISSIONAIS ================= */
  const proSorted = () => DB.pros.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id);
  const vPro = () => {
    const l = proSorted(), lb = profLabel();
    const svcTxt = (p) => (!p.services.length ? 'Todos os serviços' : plural(p.services.filter((id) => svcById(id)).length, 'serviço', 'serviços'));
    return (
      top('Equipe', pl(lb), 'Quem atende (ou o recurso usado: box, sala, cadeira).', '<button class="b gold" data-a="apnew">' + ic('plus', 18) + 'Novo cadastro</button>') +
      (!Slots.cfg({ set: DB.set }).multi
        ? '<div class="demo"><span><b>Agenda única ativa.</b> Os cadastros abaixo não aparecem para o cliente.</span><button class="lnk" data-a="atab" data-v="cfg">Ativar em Configurações</button></div>'
        : '') +
      (l.length
        ? '<div class="li">' +
          l
            .map(
              (p, i) =>
                '<div class="rw">' + thumb(p.avatar, p.id, p.name, 1) + '<div class="grow"><b>' + esc(p.name) + '</b><p>' + svcTxt(p) + (p.phone ? ' · ' + esc(phoneShow(p.phone)) : '') + '</p></div>' +
                '<span class="badge ' + (p.active ? 'confirmed' : 'off') + '">' + (p.active ? 'Ativo' : 'Inativo') + '</span>' +
                ib('up', 'Subir ' + p.name, 'amv', 'pro|' + p.id + '|-1').replace('<button', '<button' + (i === 0 ? ' disabled' : '')) +
                ib('down', 'Descer ' + p.name, 'amv', 'pro|' + p.id + '|1').replace('<button', '<button' + (i === l.length - 1 ? ' disabled' : '')) +
                ib('edit', 'Editar ' + p.name, 'apedit', p.id) +
                ib('trash', 'Excluir ' + p.name, 'apdel', p.id, 'er') +
                '</div>'
            )
            .join('') +
          '</div>'
        : '<div class="emp2"><b>Ninguém cadastrado</b>Com a agenda única, não é preciso cadastrar ninguém.</div>')
    );
  };

  const proForm = (p) => {
    A.form = { kind: 'pro', id: p ? p.id : null };
    A.up.pro = p ? R(p.avatar) : null;
    const sel = new Set((p ? p.services : []).map(String));
    form(
      p ? 'Editar cadastro' : 'Novo cadastro',
      '<div class="fg two"><label class="lb">Nome<input class="in" id="g-pname" maxlength="80" value="' + esc(p ? p.name : '') + '"></label>' +
        '<label class="lb">Telefone <span class="hint">(opcional, não aparece no site)</span><input class="in num-t" id="g-pphone" type="tel" inputmode="tel" value="' + esc(phoneMask(p ? p.phone : '')) + '"></label>' +
        '<div class="full col"><span class="lb">Foto <span class="hint">(opcional)</span></span>' + upPrev('pro', A.up.pro, p ? p.name : '') + '</div>' +
        '<fieldset class="full fset" style="border:0;padding:0;margin:0"><legend class="lb" style="margin-bottom:6px">Serviços que atende <span class="hint">— nenhum marcado = todos</span></legend><div class="chks">' +
        DB.services.map((s) => '<label class="chk"><input type="checkbox" class="g-psvc" value="' + s.id + '"' + (sel.has(String(s.id)) ? ' checked' : '') + '>' + esc(s.name) + '</label>').join('') +
        '</div></fieldset><div class="full">' + sw('g-pon', 'Ativo (recebe agendamentos)', p ? p.active : true) + '</div></div>',
      'apsave'
    );
  };

  const savePro = async () => {
    const name = v('g-pname'), ph = v('g-pphone');
    if (name.length < 2) return formErr('Informe o nome.');
    if (ph && !phoneOk(ph)) return formErr('Telefone inválido. Use DDD + número.');
    const row = { name, phone: ph ? phoneStore(ph) : '', avatar: A.up.pro ? { u: A.up.pro.u } : null, services: [...document.querySelectorAll('.g-psvc:checked')].map((x) => +x.value), active: $('g-pon').checked };
    try {
      if (A.form.id) {
        const r = await API.update('professionals', A.form.id, row);
        DB.pros = DB.pros.map((x) => (x.id === r.id ? normPro(r) : x));
      } else {
        const r = await API.insert('professionals', { ...row, sort_order: DB.pros.length });
        DB.pros.push(normPro(r));
      }
      closeForm();
      toast('Cadastro salvo.', 'ok');
      redraw();
    } catch (e) {
      formErr(apiErr(e).message);
    }
  };

  /* ================= CLIENTES ================= */
  const clients = () => {
    const t = today(), m = new Map();
    sortBk(A.bk).forEach((b) => {
      const c = m.get(b.client_phone) || { phone: b.client_phone, name: b.client_name, email: '', l: [], n: 0, last: '', next: '', spent: 0 };
      c.name = b.client_name;
      if (b.client_email) c.email = b.client_email;
      c.l.push(b);
      if (live(b)) c.n++;
      if (live(b) && b.booking_date <= t) c.last = b.booking_date;
      if (active(b) && b.booking_date >= t && !c.next) c.next = b.booking_date;
      if (b.status === 'done') c.spent += +b.price_snapshot;
      m.set(b.client_phone, c);
    });
    return [...m.values()].sort((a, b) => (b.last || b.next).localeCompare(a.last || a.next));
  };
  const cliList = () => {
    const q = A.cq.trim(), dq = q.replace(/\D/g, '');
    const l = clients().filter((c) => !q || nz(c.name).includes(nz(q)) || (dq.length >= 3 && c.phone.includes(dq)));
    if (!l.length) return '<div class="emp2"><b>Nenhum cliente encontrado</b>' + (q ? 'Tente outro nome ou telefone.' : 'Os clientes aparecem aqui depois do primeiro agendamento.') + '</div>';
    return (
      '<div class="li">' +
      l
        .slice(0, 200)
        .map(
          (c) =>
            '<button class="rw" data-a="acli" data-v="' + esc(c.phone) + '"><span class="th av">' + esc(ini(c.name)) + '</span><div class="grow"><b>' + esc(c.name) + '</b><p>' + esc(phoneShow(c.phone)) + ' · ' + plural(c.n, 'agendamento', 'agendamentos') + (c.last ? ' · última visita ' + dBR(c.last) : '') + '</p></div>' +
            (c.next ? '<span class="badge confirmed">Próximo: ' + dBR(c.next).slice(0, 5) + '</span>' : '') + ic('next', 18) + '</button>'
        )
        .join('') +
      '</div>'
    );
  };
  const vCli = () =>
    top('Relacionamento', 'Clientes', plural(clients().length, 'cliente', 'clientes') + ' que já agendaram') +
    '<div class="fb"><div class="srch">' + ic('search', 16) + '<input class="in" type="search" id="cq" placeholder="Buscar nome ou telefone" aria-label="Buscar cliente" value="' + esc(A.cq) + '"></div></div><div id="clist">' + cliList() + '</div>';

  const cliView = (phone) => {
    const c = clients().find((x) => x.phone === phone);
    if (!c) return;
    A.form = { kind: 'cli', phone };
    $('am').innerHTML =
      '<div role="dialog" aria-modal="true" aria-labelledby="af-t" tabindex="-1"><header class="af-h"><div><h2 id="af-t">' + esc(c.name) + '</h2><p class="xs tm">' + esc(phoneShow(c.phone)) + (c.email ? ' · ' + esc(c.email) : '') + '</p></div><button class="q" data-a="aclose" aria-label="Fechar">' + ic('x', 18) + '</button></header>' +
      '<div class="af-b"><div class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))"><div class="kpi"><span>Agendamentos</span><b>' + c.n + '</b></div><div class="kpi"><span>Última visita</span><b style="font-size:1.25rem">' + (c.last ? dBR(c.last) : '—') + '</b></div><div class="kpi"><span>Concluídos</span><b style="font-size:1.25rem">' + money(c.spent) + '</b></div></div>' +
      '<div class="li hist">' + sortBk(c.l, true).map((b) => '<div class="it' + (b.status === 'cancelled' ? ' x' : '') + '"><div class="it-t">' + dBR(b.booking_date) + '<small>' + hm(b.start_time) + '</small></div><div class="it-c"><b>' + esc(svcName(b.service_id)) + '</b><p>' + price(b.price_snapshot) + (b.notes ? ' · “' + esc(b.notes) + '”' : '') + '</p></div><div class="it-a"><span class="badge ' + b.status + '">' + STATUS[b.status] + '</span></div></div>').join('') + '</div></div>' +
      '<footer class="af-f"><a class="b ghost" href="' + esc(wa('Olá, ' + first(c.name) + '!', c.phone)) + '" target="_blank" rel="noopener">' + ic('wa', 18) + 'WhatsApp</a><button class="b gold" data-a="aclinew" data-v="' + esc(c.phone) + '">' + ic('plus', 18) + 'Novo agendamento</button></footer></div>';
    Layer.open('am', $('am').querySelector('[role=dialog]'));
  };

  /* ================= CONFIGURAÇÕES ================= */
  const TZ = [
    ['America/Sao_Paulo', 'Brasília / São Paulo (UTC−3)'],
    ['America/Fortaleza', 'Nordeste (UTC−3)'],
    ['America/Belem', 'Pará / Amapá (UTC−3)'],
    ['America/Manaus', 'Amazonas (UTC−4)'],
    ['America/Cuiaba', 'Mato Grosso (UTC−4)'],
    ['America/Campo_Grande', 'Mato Grosso do Sul (UTC−4)'],
    ['America/Porto_Velho', 'Rondônia (UTC−4)'],
    ['America/Rio_Branco', 'Acre (UTC−5)'],
    ['America/Noronha', 'Fernando de Noronha (UTC−2)']
  ];
  const fi = (id, label, val, attrs = '', hint = '') => '<label class="lb">' + label + (hint ? ' <span class="hint">' + hint + '</span>' : '') + '<input class="in" id="s-' + id + '" value="' + esc(val ?? '') + '" ' + attrs + '></label>';
  const ta = (id, label, val, max, hint = '') => '<label class="lb full">' + label + (hint ? ' <span class="hint">' + hint + '</span>' : '') + '<textarea class="in" id="s-' + id + '" maxlength="' + max + '" rows="3">' + esc(val || '') + '</textarea></label>';
  const vCfg = () => {
    const s = DB.set;
    A.up.logo = R(s.logo);
    A.up.bg = R(s.hero_bg);
    const tm = s.testimonials || [];
    const t3 = [0, 1, 2]
      .map((i) => {
        const x = tm[i] || {};
        return (
          '<div class="fg two" style="padding-block:12px;border-top:1px solid var(--bd)">' + fi('tn' + i, 'Nome', x.name, 'maxlength="40"') +
          '<label class="lb">Estrelas<select class="in" id="s-ts' + i + '">' + [5, 4, 3].map((n) => '<option' + ((x.stars || 5) === n ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label>' +
          ta('tt' + i, 'Depoimento ' + (i + 1), x.text, 220) + '</div>'
        );
      })
      .join('');
    return (
      top('Ajustes', 'Configurações', 'Tudo que aparece no site e as regras da agenda.') +
      '<section class="box"><div class="box-h"><h2>Negócio</h2></div><div class="fg two">' + fi('name', 'Nome do negócio', s.name, 'maxlength="60"') + fi('slogan', 'Slogan', s.slogan, 'maxlength="80"') +
      '<div class="full col"><span class="lb">Logo <span class="hint">(opcional; sem logo, o nome vira o logo)</span></span>' + upPrev('logo', A.up.logo, s.name, true) + '</div></div></section>' +
      '<section class="box"><div class="box-h"><h2>Página inicial</h2></div><div class="fg two">' + fi('kick', 'Selo acima do título', s.kick, 'maxlength="40"') + fi('badge', 'Frase de confiança', s.badge, 'maxlength="60"', '(vazio = esconder)') +
      '<label class="lb full">Título <span class="hint">— use *asteriscos* para destacar em dourado</span><input class="in" id="s-title" maxlength="90" value="' + esc(s.title) + '"></label>' +
      ta('text', 'Texto de apoio', s.text, 240) +
      '<div class="full col"><span class="lb">Imagem de fundo do topo <span class="hint">(opcional; o texto fica claro sobre ela)</span></span>' + upPrev('bg', A.up.bg, '', true) + '</div></div></section>' +
      '<section class="box"><div class="box-h"><h2>Contato</h2></div><div class="fg two">' + fi('wa', 'WhatsApp', phoneMask(s.wa), 'type="tel" inputmode="tel"', '(recebe os agendamentos)') + fi('email', 'E-mail', s.email, 'type="email"') +
      fi('addr', 'Endereço', s.addr, 'maxlength="140"') + fi('maps', 'Link do Google Maps', s.maps, 'type="url" placeholder="https://maps.app.goo.gl/…"', '(opcional)') +
      fi('ig', 'Instagram', s.ig, 'placeholder="seuperfil"', '(só o usuário)') + fi('fb', 'Facebook', s.fb, 'type="url" placeholder="https://facebook.com/…"') +
      ta('about', 'Sobre o negócio', s.about, 600) + '</div></section>' +
      '<section class="box"><div class="box-h"><h2>Regras da agenda</h2><p>O servidor aplica as mesmas regras</p></div><div class="fg two">' +
      '<label class="lb">Intervalo entre horários oferecidos<select class="in" id="s-slot">' + [10, 15, 20, 30, 45, 60].map((n) => '<option value="' + n + '"' + (+s.slot_interval === n ? ' selected' : '') + '>De ' + n + ' em ' + n + ' min</option>').join('') + '</select></label>' +
      fi('buffer', 'Pausa entre atendimentos (min)', s.buffer, 'type="number" min="0" max="120" step="5"') +
      fi('notice', 'Antecedência mínima (horas)', s.min_notice, 'type="number" min="0" max="720"') +
      fi('adv', 'Agendar até quantos dias à frente', s.max_advance, 'type="number" min="1" max="365"') +
      fi('maxph', 'Agendamentos em aberto por telefone', s.max_per_phone, 'type="number" min="0" max="20"', '(0 = sem limite)') +
      '<label class="lb">Fuso horário<select class="in" id="s-tz">' + TZ.map(([k, n]) => '<option value="' + k + '"' + (s.tz === k ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label>' +
      '<div class="full">' + sw('s-multi', 'Vários profissionais (o cliente escolhe com quem)', Slots.cfg({ set: s }).multi) + '</div>' +
      fi('plabel', 'Como chamar quem atende', s.prof_label, 'maxlength="24" placeholder="Profissional"', '(ex.: Profissional, Box, Sala)') + '</div></section>' +
      '<section class="box"><div class="box-h"><h2>Depoimentos</h2></div>' + sw('s-temo', 'Mostrar depoimentos no site', s.temo !== false) + t3 + '</section>' +
      (DEMO ? '' : '<section class="box"><div class="box-h"><h2>Manutenção</h2><p>Remove do repositório as fotos que nenhum cadastro usa</p></div><button class="b ghost" data-a="aclean">Limpar fotos não usadas</button> <span class="hint" id="clean-out"></span></section>') +
      '<div class="bar-s"><button class="b gold" data-a="cfgsave">Salvar configurações</button></div>'
    );
  };

  const saveCfg = async () => {
    const s = DB.set, n = (id, a, b, d) => {
      const x = Number(v('s-' + id));
      return Number.isFinite(x) && v('s-' + id) !== '' ? Math.min(b, Math.max(a, Math.round(x))) : d;
    };
    let w = phoneDigits(v('s-wa'));
    const ig = v('s-ig').replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/.*$/, '');
    if (!phoneOk(w)) return toast('WhatsApp inválido. Use DDD + número.', 'er');
    if (v('s-email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('s-email'))) return toast('E-mail inválido.', 'er');
    if (v('s-fb') && !okUrl(v('s-fb'))) return toast('O link do Facebook deve começar com https://', 'er');
    if (v('s-maps') && !okUrl(v('s-maps'))) return toast('O link do mapa deve começar com https://', 'er');
    if (ig && !/^[\w.]{1,30}$/.test(ig)) return toast('Instagram inválido. Use só o nome de usuário.', 'er');
    if (v('s-name').length < 2) return toast('Informe o nome do negócio.', 'er');
    const data = {
      ...s,
      name: v('s-name'),
      slogan: v('s-slogan'),
      logo: A.up.logo ? { u: A.up.logo.u } : null,
      kick: v('s-kick'),
      title: v('s-title') || SET0.title,
      text: v('s-text'),
      badge: v('s-badge'),
      hero_bg: A.up.bg ? { u: A.up.bg.u } : null,
      wa: '55' + w,
      email: v('s-email'),
      addr: v('s-addr'),
      maps: v('s-maps'),
      ig,
      fb: v('s-fb'),
      about: v('s-about'),
      slot_interval: +v('s-slot') || 15,
      buffer: n('buffer', 0, 120, 15),
      min_notice: n('notice', 0, 720, 2),
      max_advance: n('adv', 1, 365, 60),
      max_per_phone: n('maxph', 0, 20, 3),
      tz: v('s-tz') || 'America/Sao_Paulo',
      multiprof: $('s-multi').checked,
      prof_label: v('s-plabel') || 'Profissional',
      temo: $('s-temo').checked,
      testimonials: [0, 1, 2].map((i) => ({ name: v('s-tn' + i), text: v('s-tt' + i), stars: +v('s-ts' + i) || 5 })).filter((x) => x.text)
    };
    try {
      await API.saveSettings(data);
      DB.set = normSet(data);
      A.dirty = false;
      $('ad-logo').innerHTML = '<span>' + esc(DB.set.name) + '</span>';
      $('t-pro').querySelector('span').textContent = pl(profLabel());
      toast('Configurações salvas.', 'ok');
    } catch (e) {
      toast(apiErr(e).message, 'er');
    }
  };

  /* ================= SENHA ================= */
  const vPw = () =>
    top('Conta', 'Senha', DEMO ? 'No modo demonstração a senha é sempre "demo".' : 'Troque a senha de acesso ao painel.') +
    '<section class="box" style="max-width:520px"><div class="fg"><label class="lb">Nova senha<input class="in" type="password" id="p1" autocomplete="new-password" minlength="8"></label><label class="lb">Repita a nova senha<input class="in" type="password" id="p2" autocomplete="new-password"></label><p class="hint">Use 8 caracteres ou mais.</p></div><div class="row" style="justify-content:flex-end;margin-top:16px"><button class="b gold" data-a="pwsave">Alterar senha</button></div></section>';

  const VIEW = { dash: vDash, bk: vBk, svc: vSvc, hrs: vHrs, blk: vBlk, pro: vPro, cli: vCli, cfg: vCfg, pw: vPw };
  const AFTER = { dash: dashAfter };

  /* ================= carregar, entrar, sair ================= */
  const load = async () => {
    const [bk, ad] = await Promise.all([API.bookings(), API.adminLoad(), loadPublic()]);
    A.bk = bk;
    DB.blocked = ad.blocked;
    DB.pros = ad.pros.map(normPro);
    syncBusy();
  };

  const reloadBk = debounce(async () => {
    try {
      A.bk = await API.bookings();
      syncBusy();
      if (A.tab === 'bk') refreshList();
      else if (A.tab === 'dash' || (A.tab === 'cli' && !Layer.isOpen('am'))) redraw();
    } catch (e) {}
  }, 400);

  const enter = async () => {
    if (A.busy) return;
    A.busy = true;
    Layer.open('adm', $('adm'));
    $('adm').innerHTML = '<div class="ad-in" style="padding-top:64px"><p class="kick">Painel</p><h1 class="h2" style="margin-top:8px">Carregando…</h1></div>';
    try {
      await load();
    } catch (e) {
      A.busy = false;
      const er = apiErr(e);
      if (er.code === 'auth') {
        await Auth.logout();
        Layer.close('adm');
        toast('Sessão expirada. Entre de novo.', 'er');
        return ACT.admin();
      }
      $('adm').innerHTML = '<div class="ad-in" style="padding-top:64px"><h1 class="h2">Não foi possível carregar o painel</h1><p class="tm" style="margin:12px 0 24px">' + esc(er.message) + '</p><div class="row"><button class="b gold" data-a="aretry">Tentar novamente</button><button class="b ghost" data-a="aview">Voltar ao site</button></div></div>';
      return;
    }
    A.busy = false;
    shell();
    show(A.tab);
    if (location.hash !== '#admin') history.replaceState(null, '', '#admin');
    A.unsub && A.unsub();
    A.unsub = API.subscribe((p) => {
      if (p && p.eventType === 'INSERT' && p.new) toast('Novo agendamento: ' + p.new.client_name + ' · ' + dBR(p.new.booking_date).slice(0, 5) + ' ' + hm(p.new.start_time), 'ok');
      reloadBk();
    });
    setTimeout(() => $('ad-main') && $('ad-main').focus({ preventScroll: true }), 60);
  };

  const leave = async (logout) => {
    if (A.dirty && !(await ask('Sair sem salvar?', 'Há alterações nesta aba que ainda não foram salvas.', 'Sair', true))) return;
    A.dirty = false;
    A.unsub && A.unsub();
    A.unsub = null;
    if (Layer.isOpen('am')) closeForm();
    if (logout) await Auth.logout();
    Layer.close('adm');
    $('adm').innerHTML = '';
    history.replaceState(null, '', location.pathname + location.search);
    try {
      await loadPublic();
      await loadBusy();
    } catch (e) {}
    Site.render();
  };

  /* Um envio por vez: duplo clique em "Salvar" não grava duas vezes. */
  const once = (fn) => async (...a) => {
    if (A.saving) return;
    A.saving = true;
    const btns = [...document.querySelectorAll('#am:not(.hid) .af-f .gold, #ad-in .bar-s .gold, #ad-in [data-a=kadd], #ad-in [data-a=pwsave]')];
    btns.forEach((b) => (b.disabled = true));
    try {
      await fn(...a);
    } finally {
      A.saving = false;
      btns.forEach((b) => (b.disabled = false));
    }
  };
  const S = { bk: once(() => saveBk()), svc: once(() => saveSvc()), pro: once(() => savePro()), cfg: once(() => saveCfg()), hrs: once(() => saveHrs()), blk: once(() => addBlk()) };

  /* ================= ações ================= */
  Object.assign(ACT, {
    atab: (k) => (Layer.isOpen('am') ? closeForm() : 0, show(k)),
    aview: () => leave(false),
    aexit: () => leave(true),
    aretry: () => enter(),
    areset: async () => {
      if (!(await ask('Restaurar dados de exemplo?', 'Tudo que você mudou no modo demonstração será substituído.', 'Restaurar', true))) return;
      Demo.reset();
      await load();
      shell();
      show(A.tab);
      toast('Dados de exemplo restaurados.', 'ok');
    },
    aclose: closeForm,
    anew: () => bkForm(null),
    aedit: (id) => bkForm(A.bk.find((b) => b.id === +id)),
    absave: S.bk,
    asug: (t) => {
      $('g-time').value = t;
      sugg();
    },
    aconf: (id) => setStatus(+id, 'confirmed', 'Confirmado. Use o botão do WhatsApp para avisar o cliente.'),
    adone: (id) => setStatus(+id, 'done', 'Marcado como concluído.'),
    acanc: async (id) => {
      const b = A.bk.find((x) => x.id === +id);
      if (b && (await ask('Cancelar este agendamento?', b.client_name + ' · ' + dBR(b.booking_date) + ' às ' + hm(b.start_time) + '. O horário volta a ficar livre.', 'Cancelar agendamento', true))) setStatus(+id, 'cancelled', 'Agendamento cancelado. Avise o cliente pelo WhatsApp.');
    },
    adel: async (id) => {
      const b = A.bk.find((x) => x.id === +id);
      if (!b || !(await ask('Excluir definitivamente?', 'O agendamento de ' + b.client_name + ' some do histórico. Para manter o registro, prefira cancelar.', 'Excluir', true))) return;
      try {
        await API.remove('bookings', +id);
        A.bk = A.bk.filter((x) => x.id !== +id);
        toast('Agendamento excluído.', 'ok');
      } catch (e) {
        toast(apiErr(e).message, 'er');
      }
      redraw();
    },
    apend: () => {
      A.f = { ...A.f, st: 'pending', per: 'next' };
      show('bk');
    },
    ast: (k) => {
      A.f.st = k;
      A.n = 60;
      refreshList();
    },
    asort: () => {
      A.f.desc = !A.f.desc;
      redraw();
    },
    amore: () => {
      A.n += 60;
      refreshList();
    },
    asnew: () => svcForm(null),
    asedit: (id) => svcForm(svcById(id)),
    assave: S.svc,
    asdel: async (id) => {
      const s = svcById(id);
      if (!s || !(await ask('Excluir "' + s.name + '"?', 'Se houver agendamentos com este serviço, ele não pode ser excluído — desative-o.', 'Excluir', true))) return;
      try {
        await API.remove('services', s.id);
        DB.services = DB.services.filter((x) => x.id !== s.id);
        toast('Serviço excluído.', 'ok');
      } catch (e) {
        toast(apiErr(e).message, 'er');
      }
      redraw();
    },
    amv: (val) => {
      const [k, id, d] = val.split('|');
      move(k, +id, +d);
    },
    aupx: (key) => {
      A.up[key] = null;
      const e = $('up-' + key);
      if (e) e.outerHTML = upPrev(key, null, '', key !== 'pro');
      A.dirty = A.tab === 'cfg' || A.dirty;
    },
    hcopy: () => {
      const g = (id) => $(id);
      [2, 3, 4, 5].forEach((w) => {
        g('h-o-' + w).checked = g('h-o-1').checked;
        ['a', 'c', 'bs', 'be'].forEach((k) => (g('h-' + k + '-' + w).value = g('h-' + k + '-1').value));
        g('h-b-' + w).checked = g('h-b-1').checked;
        syncHour(w);
      });
      A.dirty = true;
      toast('Segunda copiada para terça a sexta. Falta salvar.', 'ok');
    },
    hsave: S.hrs,
    kadd: S.blk,
    kdel: async (id) => {
      const b = DB.blocked.find((x) => x.id === +id);
      if (!b || !(await ask('Remover bloqueio?', blkLabel(b) + (b.reason ? ' · ' + b.reason : '') + '. A agenda volta a abrir nesse período.', 'Remover', true))) return;
      try {
        await API.remove('blocked_dates', b.id);
        DB.blocked = DB.blocked.filter((x) => x.id !== b.id);
        toast('Bloqueio removido.', 'ok');
      } catch (e) {
        toast(apiErr(e).message, 'er');
      }
      redraw();
    },
    apnew: () => proForm(null),
    apedit: (id) => proForm(proById(id)),
    apsave: S.pro,
    apdel: async (id) => {
      const p = proById(id);
      if (!p || !(await ask('Excluir "' + p.name + '"?', 'Agendamentos futuros dessa pessoa passam a ocupar a agenda geral. Para pausar, prefira desativar.', 'Excluir', true))) return;
      try {
        await API.remove('professionals', p.id);
        DB.pros = DB.pros.filter((x) => x.id !== p.id);
        A.bk.forEach((b) => b.professional_id === p.id && (b.professional_id = null));
        DB.blocked = DB.blocked.filter((b) => b.professional_id !== p.id);
        toast('Cadastro excluído.', 'ok');
      } catch (e) {
        toast(apiErr(e).message, 'er');
      }
      redraw();
    },
    acli: (ph) => cliView(ph),
    aclinew: (ph) => {
      const c = clients().find((x) => x.phone === ph);
      closeForm();
      bkForm(null, c ? { name: c.name, phone: c.phone, email: c.email } : {});
    },
    cfgsave: S.cfg,
    pwsave: async () => {
      const a = $('p1').value, b = $('p2').value;
      if (a.length < 8) return toast('Use 8 caracteres ou mais.', 'er');
      if (a !== b) return toast('As senhas não conferem.', 'er');
      const r = await Auth.changePassword(a);
      if (r.st !== 'ok') return toast(r.msg, 'er');
      $('p1').value = $('p2').value = '';
      toast('Senha alterada.', 'ok');
    },
    aclean: async () => {
      const out = $('clean-out');
      out.textContent = 'Limpando…';
      try {
        const s = await Auth.getSession();
        const r = await fetch(SB_URL + '/functions/v1/cleanup-orphans', { method: 'POST', headers: { Authorization: 'Bearer ' + s.access_token, apikey: SB_KEY } });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || r.status);
        out.textContent = (j.removed || []).length + ' removida(s), ' + j.kept + ' em uso.';
      } catch (e) {
        out.textContent = 'Falhou: ' + e.message;
      }
    }
  });

  /* ---------- horários: liga/desliga campos ---------- */
  const syncHour = (w) => {
    const on = $('h-o-' + w).checked, brk = $('h-b-' + w).checked;
    $('h-a-' + w).closest('.h7').classList.toggle('off', !on);
    ['a', 'c', 'b', 'bs', 'be'].forEach((k) => ($('h-' + k + '-' + w).disabled = !on));
    $('h-bb-' + w).classList.toggle('hid', !brk);
  };

  /* ---------- eventos do painel ---------- */
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (!Layer.isOpen('adm')) return;
    if (t.id === 'bq') {
      A.f.q = t.value;
      A.n = 60;
      refreshList();
    } else if (t.id === 'cq') {
      A.cq = t.value;
      $('clist').innerHTML = cliList();
    } else if (/^(g-phone|g-pphone|s-wa)$/.test(t.id)) {
      t.value = phoneMask(t.value);
    }
    if (t.id === 'g-price') A.form && (A.form.priceTouched = true);
    if (t.id === 'g-time') sugg();
    if ((A.tab === 'cfg' || A.tab === 'hrs') && t.closest && t.closest('#ad-in')) A.dirty = true;
  });

  document.addEventListener('change', async (e) => {
    const t = e.target;
    if (!Layer.isOpen('adm')) return;
    if (t.id === 'bper') {
      A.f.per = t.value;
      A.n = 60;
      return redraw();
    }
    if (t.id === 'bsvc' || t.id === 'bfrom' || t.id === 'bto') {
      A.f[{ bsvc: 'svc', bfrom: 'from', bto: 'to' }[t.id]] = t.value;
      A.n = 60;
      return refreshList();
    }
    if (t.id === 'g-svc' || t.id === 'g-date' || t.id === 'g-pro') {
      if (t.id === 'g-svc' && A.form && !A.form.priceTouched) {
        const s = svcById(t.value);
        $('g-price').value = priceIn(s ? s.price : 0);
      }
      return sugg();
    }
    if (t.dataset && t.dataset.h) return syncHour(+t.id.split('-').pop());
    if (t.id === 'k-all') return document.querySelectorAll('.k-t').forEach((x) => x.classList.toggle('hid', t.checked));
    if (t.dataset && t.dataset.up) {
      const key = t.dataset.up, f = t.files && t.files[0];
      t.value = '';
      if (!f) return;
      const lbl = t.closest('label');
      lbl.classList.add('is-up');
      lbl.querySelector('span').textContent = 'Enviando…';
      try {
        A.up[key] = await IMG.upload(f);
        if (A.tab === 'cfg') A.dirty = true;
      } catch (x) {
        toast(x.message || 'Falha no envio da foto.', 'er');
      }
      const box = $('up-' + key);
      if (box) box.outerHTML = upPrev(key, A.up[key], '', key !== 'pro');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!Layer.isOpen('adm')) return;
    // Setas navegam entre as abas
    if (e.target.getAttribute && e.target.getAttribute('role') === 'tab' && /^Arrow/.test(e.key)) {
      const b = [...document.querySelectorAll('#ad-nav [role=tab]')], i = b.indexOf(e.target);
      const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
      if (d) {
        e.preventDefault();
        b[(i + d + b.length) % b.length].focus();
      }
    }
    // Ctrl/Cmd+S salva a aba atual
    if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 's') {
      const f = Layer.isOpen('am') && A.form ? { bk: S.bk, svc: S.svc, pro: S.pro }[A.form.kind] : { cfg: S.cfg, hrs: S.hrs }[A.tab];
      if (f) {
        e.preventDefault();
        f();
      }
    }
  });

  const esc_ = () => {
    if (Layer.isOpen('am')) closeForm();
  };

  return { enter, esc: esc_, state: A };
})();
