/* =============================================================
   site.js — monta a página pública a partir de DB (dados do Supabase
   ou do modo demonstração). render() = tudo; live() = só o que
   depende dos horários ocupados (cartão do hero e "próximo horário").
   ============================================================= */
const Site = (() => {
  const S = () => DB.set;
  const ORDER = [1, 2, 3, 4, 5, 6, 0]; // segunda → domingo

  /* "hoje", "amanhã", "sexta-feira" (até 6 dias) ou "seg, 7 dez". */
  const relDay = (d) => {
    const t = Slots.today({ set: S() }).d, k = Slots.dayNum(d) - Slots.dayNum(t);
    if (k === 0) return 'hoje';
    if (k === 1) return 'amanhã';
    if (k > 1 && k < 7) return WD[Slots.weekday(d)];
    return dShort(d);
  };

  const logo = (el) => {
    const s = S(), l = R(s.logo);
    el.setAttribute('aria-label', s.name + ' — início');
    if (l && l.u) {
      el.classList.add('img');
      el.innerHTML = '<img src="' + esc(l.u) + '" alt="' + esc(s.name) + '">';
    } else {
      el.classList.remove('img');
      el.innerHTML = '<span>' + esc(s.name) + '</span>';
    }
  };

  const meta = () => {
    const s = S();
    document.title = s.name + ' — ' + (s.slogan || 'Agendamento online');
    const d = document.querySelector('meta[name=description]');
    if (d && s.text) d.setAttribute('content', s.text);
  };

  const hero = () => {
    const s = S();
    $('hk').querySelector('span').textContent = s.kick || SET0.kick;
    $('ht').innerHTML = hl(s.title || SET0.title);
    $('hx').textContent = s.text || '';
    const w = wa('Olá! Vim pelo site e gostaria de mais informações.');
    $('hw').href = w;
    $('mw').href = w;
    $('hb').innerHTML = s.badge ? stars(5) + '<span>' + esc(s.badge) + '</span>' : '';
    const bg = R(s.hero_bg);
    const on = !!(bg && bg.u);
    $('hero').classList.toggle('has-bg', on);
    $('hbg').style.setProperty('--hbg', on ? 'url("' + String(bg.u).replace(/["\\\n]/g, '') + '")' : 'none');
  };

  /* Até 4 horários do 1º serviço, no máximo 2 por dia e com 2h de distância. */
  const picks = (svc) => {
    const ctx = slotCtx(), out = [];
    const end = Slots.lastDay(ctx);
    for (let d = Slots.today(ctx).d; d <= end && out.length < 4; d = Slots.addDays(d, 1)) {
      let last = -1e9, n = 0;
      for (const t of Slots.list(ctx, d, svc)) {
        const m = Slots.toMin(t);
        if (m - last >= 120) {
          out.push({ d, t });
          last = m;
          if (++n === 2 || out.length === 4) break;
        }
      }
    }
    return out;
  };

  const quick = () => {
    const e = $('qk'), svc = activeServices()[0];
    if (!DB.ready || DB.busyAt === undefined) return; // mantém o skeleton até ter a agenda
    if (!svc) {
      e.innerHTML = '<div class="qk-h"><p class="kick">Agenda</p><h2 id="qk-t" class="h3">Em breve</h2></div><p class="qk-e">Os serviços estão sendo cadastrados. Fale com a gente pelo WhatsApp.</p>';
      return;
    }
    const l = picks(svc);
    e.innerHTML =
      '<div class="qk-h"><p class="kick">Próximos horários</p><h2 id="qk-t" class="h3">' + esc(svc.name) + '</h2><p class="xs tm">' + dur(svc.duration_min) + ' · ' + price(svc.price) + '</p></div>' +
      (l.length
        ? '<div class="qk-l">' +
          l
            .map((x) => {
              const r = relDay(x.d);
              const sub = r === 'hoje' || r === 'amanhã' ? dShort(x.d) : +x.d.slice(8, 10) + ' de ' + MO[+x.d.slice(5, 7) - 1];
              return '<button class="qk-s" data-a="quick" data-v="' + svc.id + '|' + x.d + '|' + x.t + '" aria-label="Agendar ' + esc(svc.name) + ', ' + r + ' às ' + x.t + '"><span class="qk-d"><b>' + cap(r) + '</b>' + sub + '</span><span class="qk-t">' + x.t + '</span>' + ic('next', 18) + '</button>';
            })
            .join('') +
          '</div>'
        : '<p class="qk-e">Sem horários livres nos próximos dias. Chame no WhatsApp que encaixamos você.</p>') +
      '<div class="qk-f"><span class="xs tm">Outro serviço ou dia?</span><a href="#agendar" class="lnk" data-a="book">Ver agenda</a></div>';
  };

  const services = () => {
    const e = $('svcs'), l = activeServices();
    if (DB.err) {
      e.innerHTML = '<div class="state"><b>Não foi possível carregar</b><p>Verifique sua conexão e tente de novo.</p><button class="b ghost" data-a="retry">' + ic('retry', 18) + 'Tentar novamente</button></div>';
      return;
    }
    if (!l.length) {
      e.innerHTML = '<div class="state"><b>Em breve</b><p>Os serviços estão sendo cadastrados. Fale com a gente pelo WhatsApp.</p></div>';
      return;
    }
    e.innerHTML = l
      .map(
        (s) =>
          '<article class="sc"><div class="sc-i">' + IMG.html(s.image, { seed: s.id, letter: s.name }) + '</div><div class="sc-b"><h3 class="h3">' + esc(s.name) + '</h3>' +
          (s.description ? '<p class="sc-x">' + esc(s.description) + '</p>' : '') +
          '<div class="sc-m"><span class="sc-d">' + ic('clock', 16) + dur(s.duration_min) + '</span><span class="sc-p">' + price(s.price) + '</span></div>' +
          '<a href="#agendar=' + s.id + '" class="b ghost sc-a" data-a="book" data-v="' + s.id + '" aria-label="Agendar ' + esc(s.name) + '">Agendar este serviço' + ic('arrow', 18) + '</a></div></article>'
      )
      .join('');
  };

  const hours = () => {
    const ctx = slotCtx(), n = Slots.today(ctx), wt = Slots.weekday(n.d);
    const blk = DB.blocked.find((b) => n.d >= b.date && n.d <= (b.date_end || b.date) && b.professional_id == null && b.all_day !== false);
    $('htab').innerHTML =
      '<dl class="htab">' +
      ORDER.map((w) => {
        const h = DB.hours.find((x) => +x.weekday === w);
        const sg = Slots.segments(h);
        const now = w === wt;
        let dd;
        if (now && blk) dd = 'Fechado hoje' + (blk.reason ? '<small>' + esc(blk.reason) + '</small>' : '');
        else if (!sg.length) dd = 'Fechado';
        else {
          dd = hm(h.open_time) + ' – ' + hm(h.close_time);
          if (sg.length > 1) dd += '<small>Intervalo ' + hm(h.break_start) + '–' + hm(h.break_end) + '</small>';
        }
        return '<div class="hrow' + (!sg.length || (now && blk) ? ' off' : '') + (now ? ' now' : '') + '"><dt>' + cap(WD[w]) + (now ? ' <span class="tagd">Hoje</span>' : '') + '</dt><dd>' + dd + '</dd></div>';
      }).join('') +
      '</dl>';
    status();
  };

  const status = () => {
    const ctx = slotCtx(), st = Slots.status(ctx);
    const pill = st.open
      ? '<span class="st on"><i></i>Aberto agora · ' + (st.brk ? 'pausa às ' : 'até ') + st.until + '</span>'
      : '<span class="st"><i></i>Fechado agora' + (st.next ? ' · abre ' + relDay(st.next.date) + ' às ' + st.next.time : '') + '</span>';
    let nx = '';
    if (DB.busyAt !== undefined) {
      const svc = activeServices().slice().sort((a, b) => a.duration_min - b.duration_min)[0];
      const x = svc && Slots.next(ctx, svc);
      nx = x
        ? '<div class="nx"><div><p>Próximo horário livre</p><b>' + relDay(x.date) + ' às ' + x.time + '</b></div><button class="b gold sm" data-a="quick" data-v="' + svc.id + '|' + x.date + '|' + x.time + '">Agendar</button></div>'
        : svc
          ? '<div class="nx"><div><p>Agenda cheia nos próximos dias</p><b>Fale com a gente</b></div><a class="b ghost sm" href="' + wa('Olá! Gostaria de verificar um horário.') + '" target="_blank" rel="noopener">' + ic('wa', 16) + 'WhatsApp</a></div>'
          : '';
    }
    $('hst').innerHTML = pill + nx;
  };

  const temo = () => {
    const s = S(), l = (s.testimonials || []).filter((t) => t && String(t.text || '').trim()).slice(0, 3);
    const on = s.temo !== false && l.length > 0;
    $('depoimentos').classList.toggle('hid', !on);
    if (!on) return;
    $('dps').innerHTML = l
      .map((t) => '<figure class="dp">' + stars(clamp(t.stars || 5, 1, 5)) + '<blockquote>“' + esc(t.text) + '”</blockquote><figcaption>' + esc(t.name || 'Cliente') + '<span>Cliente</span></figcaption></figure>')
      .join('');
  };

  const contacts = () => {
    const s = S(), l = [];
    const m = mapsUrl(s);
    if (s.addr) l.push(['pin', 'Endereço', '<span>' + esc(s.addr) + '</span>' + (m ? '<br><a class="ct-m" href="' + esc(m) + '" target="_blank" rel="noopener">Ver no mapa' + ic('ext', 14) + '</a>' : '')]);
    l.push(['wa', 'WhatsApp', '<a href="' + wa('Olá! Vim pelo site.') + '" target="_blank" rel="noopener">' + esc(phoneShow(s.wa)) + '</a>']);
    if (s.ig) l.push(['ig', 'Instagram', '<a href="https://instagram.com/' + encodeURIComponent(s.ig) + '" target="_blank" rel="noopener">@' + esc(s.ig) + '</a>']);
    if (okUrl(s.fb)) l.push(['fb', 'Facebook', '<a href="' + esc(s.fb) + '" target="_blank" rel="noopener">' + esc(s.fb.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')) + '</a>']);
    if (s.email) l.push(['mail', 'E-mail', '<a href="mailto:' + esc(s.email) + '">' + esc(s.email) + '</a>']);
    return l;
  };

  const about = () => {
    const s = S();
    $('ab-t').textContent = s.name;
    $('abx').textContent = s.about || '';
    $('contato').innerHTML = '<h3 class="sr">Contato</h3>' + contacts().map(([i, t, v]) => '<div class="ct-i"><span class="ct-ic">' + ic(i, 18) + '</span><div class="grow"><p>' + t + '</p>' + v + '</div></div>').join('');
  };

  const footer = () => {
    const s = S(), y = new Date().getFullYear();
    const soc = [
      s.ig ? '<a href="https://instagram.com/' + encodeURIComponent(s.ig) + '" target="_blank" rel="noopener">' + ic('ig', 16) + 'Instagram</a>' : '',
      okUrl(s.fb) ? '<a href="' + esc(s.fb) + '" target="_blank" rel="noopener">' + ic('fb', 16) + 'Facebook</a>' : ''
    ].join('');
    $('ft').innerHTML =
      '<div class="w"><div class="ft-g">' +
      '<div class="ft-b"><a href="#top" class="logo" id="ft-logo"></a><p>' + esc(s.slogan || '') + '</p></div>' +
      '<div><h3>Contato</h3><div class="ft-l"><a href="' + wa('Olá! Vim pelo site.') + '" target="_blank" rel="noopener">' + ic('wa', 16) + esc(phoneShow(s.wa)) + '</a>' +
      (s.email ? '<a href="mailto:' + esc(s.email) + '">' + ic('mail', 16) + esc(s.email) + '</a>' : '') +
      (s.addr ? '<span>' + ic('pin', 16) + esc(s.addr) + '</span>' : '') + soc + '</div></div>' +
      '<div><h3>Agenda</h3><div class="ft-l"><a href="#agendar" data-a="book">' + ic('cal', 16) + 'Agendar horário</a><a href="#servicos">' + ic('list', 16) + 'Serviços</a><a href="#horarios">' + ic('clock', 16) + 'Horários</a></div></div>' +
      '</div><div class="ft-x"><span>© ' + y + ' ' + esc(s.name) + ' · Agendamento online</span><button class="ft-adm" data-a="admin" aria-label="Área administrativa" title="Área administrativa">•••</button></div></div>';
    logo($('ft-logo'));
  };

  const live = () => {
    quick();
    status();
  };

  const render = () => {
    meta();
    logo($('logo'));
    hero();
    services();
    hours();
    temo();
    about();
    footer();
    live();
  };

  return { render, live, relDay };
})();
