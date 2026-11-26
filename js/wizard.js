/* =============================================================
   wizard.js — o fluxo de agendamento.
   Etapas: Serviço → (Profissional) → Data e horário → Seus dados → Sucesso.
   • Escolher avança sozinho; não existe "próximo" sem escolha.
   • O rascunho volta se fechar e reabrir (Draft, até 2h).
   • Se o horário for tomado enquanto preenche, volta para os horários
     com aviso (o servidor é quem decide: create_booking).
   ============================================================= */
const Wizard = (() => {
  const W = { step: 'svc', svc: null, pro: undefined, date: null, time: null, month: null, note: '', f: {}, errs: {}, sending: false, res: null };

  /* ---------- etapas ---------- */
  const prosFor = (svc) => activePros().filter((p) => !svc || Slots.offers(p, svc.id));
  const hasPro = () => multi() && prosFor(W.svc).length > 1;
  const steps = () => ['svc', ...(hasPro() ? ['pro'] : []), 'when', 'data'];
  const LABEL = { svc: 'Serviço', pro: () => profLabel(), when: 'Data e horário', data: 'Seus dados' };
  const TITLE = { svc: 'Escolha o serviço', pro: () => 'Preferência de ' + profLabel().toLowerCase(), when: 'Escolha data e horário', data: 'Seus dados', done: 'Tudo certo' };
  const val = (x) => (typeof x === 'function' ? x() : x);

  const ctx = () => slotCtx();
  const proArg = () => (W.pro === undefined ? null : W.pro);
  const slots = (d) => (W.svc && d ? Slots.list(ctx(), d, W.svc, proArg()) : []);
  const proName = (id) => (id == null ? 'Sem preferência' : proById(id)?.name || 'Sem preferência');

  /* ---------- persistência ---------- */
  const save = () => {
    if (W.step === 'done') return;
    Draft.set({ step: W.step, svc: W.svc && W.svc.id, pro: W.pro === undefined ? '_' : W.pro, date: W.date, time: W.time });
  };

  /* Volta o rascunho, revalidando tudo contra os dados atuais. */
  const restore = () => {
    const d = Draft.get();
    if (!d) return false;
    const svc = svcById(d.svc);
    if (!svc || svc.active === false) return false;
    W.svc = svc;
    W.pro = d.pro === '_' ? undefined : d.pro === null ? null : proById(d.pro) ? d.pro : undefined;
    W.date = d.date || null;
    W.time = d.time || null;
    W.step = steps().includes(d.step) ? d.step : 'when';
    if (W.step === 'pro' && !hasPro()) W.step = 'when';
    return true;
  };

  const reset = () => {
    Object.assign(W, { step: 'svc', svc: null, pro: undefined, date: null, time: null, month: null, note: '', errs: {}, res: null });
  };

  /* ---------- navegação ---------- */
  const go = (step) => {
    W.step = step;
    if (step === 'when') ensureDate();
    if (step === 'data' && !stillFree()) {
      W.time = null;
      W.note = ERR.slot_taken;
      W.step = 'when';
      ensureDate();
    }
    render(true);
  };
  const nextOf = (s) => {
    const st = steps();
    return st[st.indexOf(s) + 1] || 'data';
  };

  /* Horário escolhido ainda está livre (pela agenda que temos agora)? */
  const stillFree = () => !W.time || slots(W.date).includes(W.time);

  /* Ao entrar em "Data e horário", já mostra o 1º dia com vaga. */
  const ensureDate = () => {
    if (W.date && slots(W.date).length) {
      W.month = W.month || W.date.slice(0, 7);
      if (W.time && !slots(W.date).includes(W.time)) W.time = null;
      return;
    }
    const n = W.svc ? Slots.next(ctx(), W.svc, proArg()) : null;
    W.date = n ? n.date : W.date && Slots.dayOpen(ctx(), W.date) ? W.date : null;
    W.time = null;
    W.month = (W.date || Slots.today(ctx()).d).slice(0, 7);
  };

  /* ---------- views ---------- */
  const vSvc = () => {
    const l = activeServices();
    if (!l.length) return '<div class="emp"><span class="emp-i">' + ic('list', 22) + '</span><b>Nenhum serviço disponível no momento</b><p>Fale com a gente pelo WhatsApp.</p></div>';
    return (
      '<p class="wz-intro">Toque no serviço desejado.</p><div class="opts two">' +
      l
        .map(
          (s) =>
            '<button class="opt" data-a="wsvc" data-v="' + s.id + '" aria-pressed="' + !!(W.svc && W.svc.id === s.id) + '"><span class="opt-i">' + IMG.html(s.image, { seed: s.id, letter: s.name }) + '</span><span class="opt-c"><b>' + esc(s.name) + '</b>' +
            (s.description ? '<span>' + esc(s.description) + '</span>' : '') +
            '</span><span class="opt-m"><b>' + price(s.price) + '</b><span>' + dur(s.duration_min) + '</span></span></button>'
        )
        .join('') +
      '</div>'
    );
  };

  const avatar = (p) => {
    const a = R(p.avatar);
    if (a && a.u) return '<span class="opt-i av">' + IMG.html(a, { seed: p.id, letter: p.name }) + '</span>';
    const ini = String(p.name || '?').trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
    return '<span class="opt-i av">' + esc(ini) + '</span>';
  };

  const vPro = () => {
    const l = prosFor(W.svc), lb = profLabel().toLowerCase();
    return (
      '<p class="wz-intro">Escolha com quem prefere ser atendido. Sem preferência, mostramos todos os horários livres.</p><div class="opts">' +
      '<button class="opt" data-a="wpro" data-v="any" aria-pressed="' + (W.pro === null) + '"><span class="opt-i av">' + ic('users', 22) + '</span><span class="opt-c"><b>Sem preferência</b><span>Primeiro horário livre com qualquer ' + esc(lb) + '</span></span></button>' +
      l.map((p) => '<button class="opt" data-a="wpro" data-v="' + p.id + '" aria-pressed="' + (W.pro != null && String(W.pro) === String(p.id)) + '">' + avatar(p) + '<span class="opt-c"><b>' + esc(p.name) + '</b></span></button>').join('') +
      '</div>'
    );
  };

  const vCal = () => {
    const c = ctx(), t = Slots.today(c).d, last = Slots.lastDay(c);
    const [y, m] = W.month.split('-').map(Number);
    const first = W.month + '-01';
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const off = Slots.weekday(first);
    const minM = t.slice(0, 7), maxM = last.slice(0, 7);
    let cells = WD3.map((d) => '<span class="cal-w" aria-hidden="true">' + d.slice(0, 3) + '</span>').join('');
    // Semanas inteiras já passadas não aparecem: o calendário fica curto e os horários sobem.
    let k0 = 1;
    if (W.month === minM) {
      const tk = +t.slice(8, 10);
      k0 = Math.max(1, tk - Slots.weekday(t));
    }
    const lead = k0 === 1 ? off : 0;
    for (let i = 0; i < lead; i++) cells += '<span aria-hidden="true"></span>';
    const list = [];
    for (let k = k0; k <= days; k++) {
      const d = W.month + '-' + String(k).padStart(2, '0');
      list.push([d, k, d < t || d > last ? 0 : slots(d).length]);
    }
    // Um único dia entra no Tab (o escolhido, senão o 1º com vaga, senão o 1º do mês); as setas fazem o resto.
    const tab = (list.find(([d]) => d === W.date) || list.find(([, , n]) => n) || list[0])[0];
    list.forEach(([d, k, n]) => {
      cells +=
        '<button class="dy' + (d === t ? ' td' : '') + '" data-a="wday" data-v="' + d + '" aria-pressed="' + (d === W.date) + '"' + (n ? '' : ' aria-disabled="true"') + ' tabindex="' + (d === tab ? 0 : -1) + '" aria-label="' + dLong(d) + (d === t ? ', hoje' : '') + ' — ' + (n ? plural(n, 'horário livre', 'horários livres') : 'sem horários') + '">' + k + '</button>';
    });
    return (
      '<div class="cal"><div class="cal-h"><h3 aria-live="polite">' + MO[m - 1] + ' ' + y + '</h3><div class="row">' +
      '<button class="q" data-a="wmon" data-v="-1" aria-label="Mês anterior"' + (W.month <= minM ? ' disabled' : '') + '>' + ic('prev', 18) + '</button>' +
      '<button class="q" data-a="wmon" data-v="1" aria-label="Próximo mês"' + (W.month >= maxM ? ' disabled' : '') + '>' + ic('next', 18) + '</button></div></div>' +
      '<div class="cal-g" id="wz-cal">' + cells + '</div>' +
      '<p class="cal-lg"><span><i></i>Dias com horários livres</span></p></div>'
    );
  };

  const vSlots = () => {
    if (DB.busyAt === undefined) return '<div class="sl" id="wz-sl"><div class="slh"><i class="sk sk-t"></i></div><div class="sls">' + '<i class="sk sk-b"></i>'.repeat(8) + '</div></div>';
    if (!W.date) {
      return '<div class="sl" id="wz-sl"><div class="emp"><span class="emp-i">' + ic('cal', 22) + '</span><b>Sem horários livres nos próximos dias</b><p>Chame no WhatsApp que tentamos encaixar você.</p><a class="b ghost sm" href="' + wa('Olá! Não encontrei horário livre no site. Podem me ajudar?') + '" target="_blank" rel="noopener">' + ic('wa', 16) + 'WhatsApp</a></div></div>';
    }
    const l = slots(W.date);
    let body;
    if (!l.length) {
      const n = W.svc && Slots.next(ctx(), W.svc, proArg(), Slots.addDays(W.date, 1));
      body = '<div class="emp"><span class="emp-i">' + ic('clock', 22) + '</span><b>Nenhum horário disponível nesta data.</b><p>Tente outro dia.</p>' + (n ? '<button class="b ghost sm" data-a="wday" data-v="' + n.date + '">Ver ' + Site.relDay(n.date) + '</button>' : '') + '</div>';
    } else {
      const g = [
        ['Manhã', l.filter((t) => t < '12:00')],
        ['Tarde', l.filter((t) => t >= '12:00' && t < '18:00')],
        ['Noite', l.filter((t) => t >= '18:00')]
      ].filter((x) => x[1].length);
      body = g
        .map(([n, ts]) => '<div class="slg" role="group" aria-label="' + n + '"><h4>' + n + '</h4><div class="sls">' + ts.map((t) => '<button class="slot" data-a="wtime" data-v="' + t + '" aria-pressed="' + (t === W.time) + '">' + t + '</button>').join('') + '</div></div>')
        .join('');
    }
    return '<div class="sl" id="wz-sl"><div class="slh"><h3>' + dLong(W.date) + '</h3><p class="xs tm">' + (l.length ? plural(l.length, 'horário livre', 'horários livres') + ' · ' + esc(W.svc.name) + ' (' + dur(W.svc.duration_min) + ')' : '&nbsp;') + '</p></div>' + body + '</div>';
  };

  const vWhen = () => (W.note ? '<p class="wz-note" role="alert">' + ic('alert', 18) + '<span>' + esc(W.note) + '</span></p>' : '') + '<div class="when">' + vCal() + vSlots() + '</div>';

  const rows = (o) => {
    const r = [
      ['tag', 'Serviço', esc(o.svc.name)],
      ['cal', 'Data', esc(dLong(o.date))],
      ['clock', 'Horário', o.time + ' – ' + Slots.toHM(Slots.toMin(o.time) + o.svc.duration_min)]
    ];
    if (multi()) r.push(['user', esc(profLabel()), esc(proName(o.pro))]);
    return '<dl>' + r.map(([i, k, v]) => '<div class="sum-r">' + ic(i, 16) + '<dt>' + k + '</dt><dd>' + v + '</dd></div>').join('') + '</dl><div class="sum-t"><span class="tm sm">Valor</span><b>' + price(o.svc.price) + '</b></div>';
  };

  const field = (id, label, input, opt) =>
    '<div class="col"><label class="lb" for="f-' + id + '"><span>' + label + (opt ? ' <span class="lbo">(opcional)</span>' : '') + '</span></label>' + input + '<p class="ferr" id="e-' + id + '" aria-live="polite">' + esc(W.errs[id] || '') + '</p></div>';
  const inv = (id) => (W.errs[id] ? ' aria-invalid="true"' : '');

  const vData = () => {
    const f = W.f;
    return (
      (W.note ? '<p class="wz-note" role="alert">' + ic('alert', 18) + '<span>' + esc(W.note) + '</span></p>' : '') +
      '<div class="fd"><form class="fm" id="wf" novalidate>' +
      field('name', 'Nome completo', '<input class="in" id="f-name" name="name" autocomplete="name" maxlength="80" required aria-describedby="e-name" value="' + esc(f.name || '') + '"' + inv('name') + '>') +
      field('phone', 'WhatsApp', '<input class="in num-t" id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="(83) 99999-9999" maxlength="16" required aria-describedby="e-phone" value="' + esc(phoneMask(f.phone || '')) + '"' + inv('phone') + '>') +
      field('email', 'E-mail', '<input class="in" id="f-email" name="email" type="email" inputmode="email" autocomplete="email" maxlength="120" aria-describedby="e-email" value="' + esc(f.email || '') + '"' + inv('email') + '>', 1) +
      field('notes', 'Observação', '<textarea class="in" id="f-notes" name="notes" maxlength="500" rows="3" placeholder="Ex.: primeira vez, preferências, algo que devemos saber">' + esc(f.notes || '') + '</textarea>', 1) +
      '<label class="chk"><input type="checkbox" id="f-rem"' + (f.remember !== false ? ' checked' : '') + '>Lembrar meus dados neste aparelho</label>' +
      '<button type="submit" class="sr" tabindex="-1">Confirmar</button></form>' +
      '<aside class="sum" aria-label="Resumo do agendamento"><h3>Resumo</h3>' + rows(W) + '<button class="lnk sum-e" data-a="wedit">Alterar data ou horário</button></aside></div>'
    );
  };

  const vDone = () => {
    const r = W.res;
    return (
      '<div class="okk"><svg class="ck" viewBox="0 0 76 76" aria-hidden="true"><circle cx="38" cy="38" r="34" fill="none" stroke-width="2"/><path d="M24 39.5l9.5 9.5L52 29" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '<h2 class="h2" id="ok-t" tabindex="-1">Agendamento solicitado!</h2>' +
      '<p>Você será redirecionado para o WhatsApp para finalizar. Se não abrir sozinho, toque no botão abaixo.</p>' +
      '<span class="code">Código <b>' + code(r.id) + '</b></span>' +
      '<div class="sum">' + rows(r) + '</div>' +
      '<div class="cta"><a class="b gold lg" href="' + esc(r.url) + '" target="_blank" rel="noopener">' + ic('wa', 18) + 'Abrir WhatsApp</a><button class="b ghost lg" data-a="wclose">Fechar</button></div>' +
      '<button class="lnk" data-a="wagain">Fazer outro agendamento</button></div>'
    );
  };

  const VIEW = { svc: vSvc, pro: vPro, when: vWhen, data: vData, done: vDone };

  const foot = () => {
    if (W.step === 'done' || !W.svc) return '';
    const a = '<b>' + esc(W.svc.name) + '</b>';
    const b = W.date && W.time ? dShort(W.date) + ' · ' + W.time : dur(W.svc.duration_min) + ' · ' + price(W.svc.price);
    const sum = '<div class="wz-sum">' + a + '<span>' + b + (W.step !== 'svc' && W.pro !== undefined && multi() ? ' · ' + esc(proName(W.pro)) : '') + '</span></div>';
    if (W.step === 'data') return sum + '<button class="b gold" data-a="wsend"' + (W.sending ? ' disabled aria-busy="true"' : '') + '>' + (W.sending ? 'Enviando…' : 'Confirmar agendamento') + '</button>';
    return sum;
  };

  /* ---------- render ---------- */
  const render = (moved) => {
    const st = steps(), done = W.step === 'done', i = st.indexOf(W.step);
    $('wz-k').textContent = done ? 'Concluído' : 'Etapa ' + (i + 1) + ' de ' + st.length;
    $('wz-t').textContent = val(TITLE[W.step]);
    const bk = document.querySelector('.wz-bk');
    bk.setAttribute('aria-disabled', done);
    bk.setAttribute('aria-label', i === 0 ? 'Fechar' : 'Voltar');
    $('wz-st').innerHTML = st.map((s, k) => '<li class="' + (done || k < i ? 'ok' : '') + '"' + (k === i && !done ? ' aria-current="step"' : '') + '><span>' + esc(val(LABEL[s])) + '</span></li>').join('');
    const b = $('wz-b');
    b.innerHTML = VIEW[W.step]();
    $('wz-f').innerHTML = foot();
    save();
    if (moved) {
      b.scrollTop = 0;
      setTimeout(() => {
        const f = done ? $('ok-t') : W.step === 'data' ? (!W.f.name ? $('f-name') : !phoneOk(W.f.phone) ? $('f-phone') : $('f-name')) : b.querySelector('[aria-pressed=true]') || b.querySelector('.opt,.dy:not([aria-disabled]),.slot') || $('wz-t');
        if (f) f.focus({ preventScroll: W.step !== 'data' });
      }, 60);
    }
  };

  /* Re-render sem perder o foco (ex.: chegaram os horários ocupados). */
  const refresh = () => {
    if (!Layer.isOpen('wz') || W.step === 'data' || W.step === 'done') return;
    const a = document.activeElement, key = a && a.dataset ? a.dataset.a + '|' + a.dataset.v : '';
    if (W.step === 'when') ensureDate();
    render(false);
    const back = key && $('wz-b').querySelector('[data-a="' + key.split('|')[0] + '"][data-v="' + key.split('|')[1] + '"]');
    if (back) back.focus({ preventScroll: true });
  };

  /* ---------- abrir / fechar ---------- */
  const fresh = async () => {
    if (DB.busyAt && Date.now() - DB.busyAt < 60000) return;
    try {
      await loadBusy();
      refresh();
      Site.live();
    } catch (e) {}
  };

  /* o = { svc, date, time } — de um card, do cartão do hero ou do hash. */
  const open = (o = {}) => {
    if (!DB.ready) return toast('Carregando a agenda, só um instante…');
    const me = Me.get();
    W.f = { name: me.name || '', phone: me.phone || '', email: me.email || '', notes: '', remember: me.name ? true : W.f.remember !== false };
    W.errs = {};
    W.note = '';
    const svc = o.svc != null ? svcById(o.svc) : null;
    if (W.step === 'done') reset();
    if (svc && svc.active !== false) {
      if (!W.svc || W.svc.id !== svc.id) {
        W.svc = svc;
        W.date = null;
        W.time = null;
        W.month = null;
        if (W.pro != null && !Slots.offers(proById(W.pro) || {}, svc.id)) W.pro = undefined;
      }
      if (o.date && o.time) {
        W.date = o.date;
        W.month = o.date.slice(0, 7);
        W.time = o.time;
        if (W.pro === undefined) W.pro = null; // horário veio de "qualquer profissional"
        W.step = stillFree() ? 'data' : 'when';
        if (W.step === 'when') ensureDate();
      } else {
        W.step = hasPro() ? 'pro' : 'when';
        if (W.step === 'when') ensureDate();
      }
    } else if (!W.svc && !restore()) {
      reset();
    } else if (W.step === 'when' || W.step === 'data') {
      if (W.step === 'data' && !stillFree()) {
        W.note = ERR.slot_taken;
        W.step = 'when';
      }
      ensureDate();
    }
    render(true);
    Layer.open('wz', $('wz-t'));
    fresh();
  };

  const close = () => {
    if (!Layer.isOpen('wz')) return;
    if (W.step === 'data') readForm();
    if (W.step === 'done') {
      reset();
      Draft.clear();
    }
    Layer.close('wz');
    if (/^#agendar/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  };

  /* ---------- formulário ---------- */
  const readForm = () => {
    const g = (id) => ($(id) ? $(id).value : '');
    if (!$('f-name')) return;
    W.f = { name: g('f-name').trim(), phone: phoneDigits(g('f-phone')), email: g('f-email').trim(), notes: g('f-notes').trim(), remember: $('f-rem').checked };
  };

  const validate = () => {
    const f = W.f, e = {};
    if (f.name.length < 3 || !/\S+\s+\S+/.test(f.name)) e.name = 'Informe nome e sobrenome.';
    if (!phoneOk(f.phone)) e.phone = f.phone ? 'Confira o número: DDD + celular, ex. (83) 99999-9999.' : 'Informe seu WhatsApp com DDD.';
    if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) e.email = 'E-mail inválido.';
    W.errs = e;
    return !Object.keys(e).length;
  };

  const showErrs = () => {
    ['name', 'phone', 'email'].forEach((k) => {
      const i = $('f-' + k), p = $('e-' + k);
      if (!i) return;
      p.textContent = W.errs[k] || '';
      if (W.errs[k]) i.setAttribute('aria-invalid', 'true');
      else i.removeAttribute('aria-invalid');
    });
    const first = ['name', 'phone', 'email'].find((k) => W.errs[k]);
    if (first) $('f-' + first).focus();
  };

  const message = (r) => {
    const l = [
      'Olá! Gostaria de confirmar meu agendamento:',
      '• Serviço: ' + r.svc.name,
      '• Data: ' + dBR(r.date),
      '• Horário: ' + r.time
    ];
    if (multi()) l.push('• ' + profLabel() + ': ' + (r.pro == null ? 'sem preferência' : proName(r.pro)));
    l.push('• Nome: ' + r.name, '• Telefone: ' + phoneMask(r.phone));
    if (r.notes) l.push('• Observação: ' + r.notes);
    l.push('• Código: ' + code(r.id));
    return l.join('\n');
  };

  /* Aba do WhatsApp aberta no próprio clique (navegadores bloqueiam pop-up depois de um await). */
  const preopen = () => {
    try {
      const w = window.open('', '_blank');
      if (!w) return null;
      w.document.write('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Abrindo o WhatsApp…</title><body style="margin:0;display:grid;place-items:center;min-height:100vh;font:16px system-ui,sans-serif;color:#6b665e;background:#fbfaf7">Abrindo o WhatsApp…</body>');
      w.document.close();
      return w;
    } catch (e) {
      return null;
    }
  };

  const send = async () => {
    if (W.sending) return;
    readForm();
    if (!validate()) return showErrs();
    W.sending = true;
    W.note = '';
    $('wz-f').innerHTML = foot();
    const win = preopen();
    try {
      const r = await API.book({ name: W.f.name, phone: W.f.phone, email: W.f.email, notes: W.f.notes, service_id: W.svc.id, professional_id: proArg(), date: W.date, time: W.time });
      const res = { id: r.id, pro: r.professional_id != null ? r.professional_id : proArg(), svc: W.svc, date: W.date, time: W.time, name: W.f.name, phone: W.f.phone, notes: W.f.notes };
      res.url = wa(message(res));
      W.res = res;
      Me.set(W.f.remember ? { name: W.f.name, phone: W.f.phone, email: W.f.email } : {});
      Draft.clear();
      W.sending = false;
      W.step = 'done';
      render(true);
      if (win && !win.closed) win.location.href = res.url;
      loadBusy().then(() => Site.live()).catch(() => {});
    } catch (e) {
      if (win && !win.closed) win.close();
      W.sending = false;
      const er = apiErr(e);
      if (['slot_taken', 'too_soon', 'closed', 'blocked'].includes(er.code)) {
        try {
          await loadBusy();
          Site.live();
        } catch (x) {}
        W.time = null;
        W.note = er.message;
        W.step = 'when';
        ensureDate();
        render(true);
      } else if (er.code === 'bad_phone' || er.code === 'bad_name' || er.code === 'bad_email') {
        W.errs = { [er.code.slice(4)]: er.message };
        $('wz-f').innerHTML = foot();
        showErrs();
      } else {
        W.note = er.message;
        render(false);
        $('wz-b').scrollTop = 0;
      }
    }
  };

  /* ---------- ações ---------- */
  Object.assign(ACT, {
    book: (v) => open(v ? { svc: v } : {}),
    quick: (v) => {
      const [s, d, t] = String(v).split('|');
      open({ svc: s, date: d, time: t });
    },
    wclose: close,
    wback: () => {
      if (W.step === 'done') return;
      if (W.step === 'data') readForm();
      const st = steps(), i = st.indexOf(W.step);
      W.note = '';
      if (i <= 0) return close();
      go(st[i - 1]);
    },
    wsvc: (v) => {
      const s = svcById(v);
      if (!s) return;
      if (!W.svc || W.svc.id !== s.id) {
        W.svc = s;
        W.time = null;
        if (W.pro != null && !Slots.offers(proById(W.pro) || {}, s.id)) W.pro = undefined;
      }
      if (!hasPro() && multi()) W.pro = null;
      go(nextOf('svc'));
    },
    wpro: (v) => {
      W.pro = v === 'any' ? null : +v;
      W.time = null;
      go('when');
    },
    wday: (v, el) => {
      if (el && el.getAttribute('aria-disabled') === 'true') return;
      W.date = v;
      W.month = v.slice(0, 7);
      W.time = null;
      W.note = '';
      render(false);
      const btn = $('wz-b').querySelector('.dy[data-v="' + v + '"]');
      if (btn) btn.focus({ preventScroll: true });
      const sl = $('wz-sl');
      if (sl && innerWidth <= 720) setTimeout(() => sl.scrollIntoView({ behavior: smooth(), block: 'start' }), 40);
    },
    wmon: (v) => {
      const [y, m] = W.month.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1 + +v, 1));
      W.month = d.toISOString().slice(0, 7);
      render(false);
      const b = $('wz-b').querySelector('[data-a=wmon][data-v="' + v + '"]');
      if (b && !b.disabled) b.focus({ preventScroll: true });
      else $('wz-b').querySelector('[data-a=wmon]:not([disabled])')?.focus({ preventScroll: true });
    },
    wtime: (v) => {
      W.time = v;
      W.note = '';
      go('data');
    },
    wedit: () => {
      readForm();
      go('when');
    },
    wsend: send,
    wagain: () => {
      const keep = W.f;
      reset();
      W.f = { ...keep, notes: '' };
      render(true);
    }
  });

  /* Teclado no calendário: setas andam pelos dias, Home/End vão ao início/fim da semana. */
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (!t.classList || !t.classList.contains('dy')) return;
    const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!d) return;
    e.preventDefault();
    const all = [...$('wz-cal').querySelectorAll('.dy')];
    const i = all.indexOf(t), j = i + d;
    if (j >= 0 && j < all.length) {
      all.forEach((b) => (b.tabIndex = -1));
      all[j].tabIndex = 0;
      all[j].focus();
    } else ACT.wmon(d > 0 ? 1 : -1);
  });

  /* Máscara do telefone e erros que somem ao corrigir. */
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'f-phone') {
      const end = t.selectionStart === t.value.length;
      t.value = phoneMask(t.value);
      if (end) t.setSelectionRange(t.value.length, t.value.length);
    }
    if (/^f-(name|phone|email)$/.test(t.id) && t.getAttribute('aria-invalid')) {
      const k = t.id.slice(2);
      delete W.errs[k];
      t.removeAttribute('aria-invalid');
      $('e-' + k).textContent = '';
    }
  });
  document.addEventListener('submit', (e) => {
    if (e.target.id === 'wf') {
      e.preventDefault();
      send();
    }
  });

  return { open, close, refresh, state: W };
})();
