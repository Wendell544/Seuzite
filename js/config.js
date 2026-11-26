/* =============================================================
   config.js — constantes, utilitários, ícones, toast, camadas e Supabase.
   Carrega primeiro: todos os outros arquivos usam o que está aqui.
   ============================================================= */

/* ====== CONFIGURAÇÃO POR CLIENTE (troque aqui em cada site novo) ======
   SB_URL vazio = MODO DEMONSTRAÇÃO: tudo funciona com dados de exemplo
   guardados só neste navegador (painel: qualquer e-mail, senha "demo"). */
const SB_URL = ''; // ex.: 'https://abcdefgh.supabase.co'
const SB_KEY = ''; // chave pública (publishable / anon) do projeto
const GH_OWNER = 'Wendell544';
const GH_REPO = 'Seuzite';
const WAD = '5583996006884'; // WhatsApp padrão (55 + DDD + número)
/* ===================================================================== */

const V = 1, PFX = 'agenda_', KEY = {
  pref: PFX + 'prefs', // tema
  wz: PFX + 'wizard', // rascunho do agendamento em andamento
  me: PFX + 'me', // nome/telefone do cliente para o próximo agendamento
  demo: PFX + 'demo', // banco local do modo demonstração
  demoAuth: PFX + 'demo_auth'
};
const DEMO = !SB_URL;

/* Padrões. Tudo que estiver salvo em settings.data (Supabase) tem prioridade. */
const SET0 = {
  name: 'Meu Negócio',
  slogan: 'Atendimento com hora marcada',
  logo: null, // { u: 'https://…' }
  kick: 'Agendamento online',
  title: 'Seu horário, *do seu jeito*.', // *palavras* = destaque dourado
  text: 'Escolha o serviço, o dia e o horário em poucos toques. A confirmação chega pelo WhatsApp.',
  badge: 'Atendimento nota 5',
  about: 'Um espaço pensado para receber você com pontualidade, cuidado e atenção a cada detalhe. Cada horário é reservado só para você.',
  wa: WAD,
  email: '',
  addr: '',
  maps: '',
  ig: '',
  fb: '',
  hero_bg: null,
  buffer: 15,
  min_notice: 2,
  max_advance: 60,
  slot_interval: 15,
  max_per_phone: 3,
  multiprof: false,
  prof_label: 'Profissional',
  temo: true,
  testimonials: [
    { name: 'Mariana S.', text: 'Agendei em menos de um minuto e fui atendida no horário certinho. Atendimento impecável.', stars: 5 },
    { name: 'Rafael M.', text: 'Ambiente tranquilo, equipe atenciosa e tudo muito organizado. Virei cliente fixo.', stars: 5 },
    { name: 'Juliana C.', text: 'Praticidade total: escolhi o horário pelo site e confirmei no WhatsApp na hora.', stars: 5 }
  ],
  tz: 'America/Sao_Paulo',
  mb: 5 // tamanho máximo de cada foto enviada no painel (MB)
};

const ACT = {};
const $ = (i) => document.getElementById(i);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
const nz = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const okUrl = (u) => /^https?:\/\//i.test(u || '');
const R = (r) => (!r ? null : typeof r === 'string' ? { u: r } : r);
const clamp = (n, a, b) => Math.min(b, Math.max(a, +n || 0));
const debounce = (fn, ms = 300) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};
const smooth = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

/* ---------- Formatação ---------- */
const money = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const price = (n) => (Number(n) > 0 ? money(n) : 'Sob consulta');
const dur = (m) => {
  m = +m || 0;
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60), r = m % 60;
  return h + 'h' + (r ? ' ' + r + 'min' : '');
};
const WD = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const WD3 = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const dBR = (d) => (d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : '');
const dLong = (d) => WD[Slots.weekday(d)] + ', ' + +d.slice(8, 10) + ' de ' + MO[+d.slice(5, 7) - 1];
const dShort = (d) => WD3[Slots.weekday(d)] + ', ' + +d.slice(8, 10) + ' ' + MO[+d.slice(5, 7) - 1].slice(0, 3);
const hm = (t) => String(t || '').slice(0, 5);
/* Texto com *destaque* → <em>destaque</em> (já escapado). */
const hl = (s) => esc(s).replace(/\*([^*]+)\*/g, '<em>$1</em>');
const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

/* ---------- Telefone: (83) 99999-9999 ---------- */
const phoneDigits = (v) => {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  return d.slice(0, 11);
};
const phoneMask = (v) => {
  const d = phoneDigits(v);
  if (!d) return '';
  if (d.length <= 2) return '(' + d;
  if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
  if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
  return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
};
/* DDD válido + 8 dígitos (fixo) ou 9 começando por 9 (celular). */
const phoneOk = (v) => /^[1-9][1-9](?:9\d{8}|[2-8]\d{7})$/.test(phoneDigits(v));
const phoneStore = (v) => '55' + phoneDigits(v);
const phoneShow = (v) => phoneMask(v);
const waNum = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  return d.length <= 11 ? '55' + d : d;
};
const wa = (t, num) => 'https://wa.me/' + waNum(num || DB.set.wa || WAD) + (t ? '?text=' + encodeURIComponent(t) : '');
const mapsUrl = (s) => (okUrl(s.maps) ? s.maps : s.addr ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(s.addr) : '');

/* ---------- Toast (região aria-live fixa; k = 'ok' | 'er') ---------- */
const toast = (t, k) => {
  const e = $('ts');
  if (!e) return;
  k = k || (/inválid|falh|erro|expirad|negad|permiss|não foi|não pode|indisponível|limite|aguarde|informe|escolha|sem espaço|bloquead|fechad|preencha/i.test(t) ? 'er' : 'ok');
  e.innerHTML = ic(k === 'er' ? 'alert' : 'check', 18) + '<span>' + esc(t) + '</span>';
  e.classList.toggle('er', k === 'er');
  e.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => {
    e.classList.remove('on');
    toast.t = setTimeout(() => (e.textContent = ''), 400);
  }, 3400);
};

/* ---------- Camadas (modal, wizard, painel) ----------
   Pilha: só a camada do topo recebe foco; a página e as camadas de baixo
   ficam inertes. Ao fechar, o foco volta para quem abriu. */
const Layer = {
  st: [],
  ret: {},
  open(id, focus) {
    const e = $(id);
    if (!e) return;
    if (!this.st.includes(id)) {
      this.ret[id] = document.activeElement;
      this.st.push(id);
    }
    e.classList.remove('hid');
    this.sync();
    setTimeout(() => {
      // Não rouba o foco de quem já está usando o diálogo (digitação rápida, preenchimento automático).
      const a = document.activeElement;
      if (a && a !== e && e.contains(a)) return;
      const f = typeof focus === 'string' ? $(focus) : focus;
      (f || e).focus({ preventScroll: true });
    }, 40);
  },
  close(id) {
    const e = $(id);
    if (!e || !this.st.includes(id)) return;
    this.st = this.st.filter((x) => x !== id);
    e.classList.add('hid');
    this.sync();
    const r = this.ret[id];
    delete this.ret[id];
    if (r && r.isConnected && r.focus) r.focus({ preventScroll: true });
  },
  top() {
    return this.st[this.st.length - 1] || null;
  },
  isOpen(id) {
    return this.st.includes(id);
  },
  sync() {
    const on = this.st.length > 0;
    document.documentElement.classList.toggle('al', on);
    document.querySelectorAll('body>header,body>main,body>footer,.skip,#mcta').forEach((e) => (e.inert = on));
    this.st.forEach((id, i) => ($(id).inert = i < this.st.length - 1));
  }
};

/* Confirmação desenhada (substitui o confirm() do navegador). */
const ask = (title, text, ok = 'Confirmar', danger = false) =>
  new Promise((res) => {
    const e = $('cf');
    e.innerHTML = `<div role="alertdialog" aria-modal="true" aria-labelledby="cf-t" aria-describedby="cf-x" tabindex="-1">
      <h2 id="cf-t" class="serif h3">${esc(title)}</h2>
      <p id="cf-x" class="tm">${esc(text)}</p>
      <div class="row"><button class="b ghost grow" data-cf="0">Cancelar</button><button class="b grow ${danger ? 'danger' : 'gold'}" data-cf="1">${esc(ok)}</button></div>
    </div>`;
    const done = (v) => {
      e.removeEventListener('click', on);
      ask.esc = null;
      Layer.close('cf');
      res(v);
    };
    const on = (ev) => {
      const b = ev.target.closest('[data-cf]');
      if (b) done(b.dataset.cf === '1');
      else if (ev.target === e) done(false);
    };
    ask.esc = () => done(false);
    e.addEventListener('click', on);
    Layer.open('cf', e.querySelector('[data-cf="1"]'));
  });

/* ---------- Ícones (traço 1.7, 24×24). Use ic('nome', tamanho). ---------- */
const IC = {
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  wa: '<path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20.5l1.7-5.2A8.5 8.5 0 1 1 21 11.5z"/><path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.5-2-1-1 .8c-1-.4-1.8-1.2-2.2-2.2l.8-1-1-2z"/>',
  star: '<path d="m12 2.8 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  prev: '<path d="m15 18-6-6 6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/>',
  retry: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  ig: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>',
  fb: '<path d="M14 8h2.5V4.5H14A3.5 3.5 0 0 0 10.5 8v2.5H8V14h2.5v6.5H14V14h2.5l.5-3.5h-3V8.5a.5.5 0 0 1 .5-.5z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/>',
  users: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20c.9-3.3 3.4-5 6.5-5s5.6 1.7 6.5 5"/><path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6M17.5 15.3c2 .6 3.4 2.2 4 4.7"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.5"/>',
  phone: '<path d="M5 3.5h3.2l1.6 4.2-2 1.3a11 11 0 0 0 5.2 5.2l1.3-2 4.2 1.6V17a2 2 0 0 1-2.1 2A15.5 15.5 0 0 1 3 5.6 2 2 0 0 1 5 3.5z"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  tag: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-6.6 6.6a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8" cy="8" r="1.4"/>',
  ban: '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  out: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l-4-4 4-4M6 12h10"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  img: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5-5 3.5 3.5L15 14l5 5"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  done: '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.2 2.4 2.4 4.8-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>'
};
const ic = (n, s = 20) =>
  '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
  (IC[n] || '') +
  '</svg>';
const stars = (n) => '<span class="stars" role="img" aria-label="' + n + ' de 5 estrelas">' + Array.from({ length: 5 }, (_, i) => '<i class="' + (i < n ? 'on' : '') + '">' + ic('star', 15) + '</i>').join('') + '</span>';

/* Imagem neutra para serviço sem foto: tom quente + monograma dourado. */
const art = (seed, letter) => {
  const h = 28 + (Math.abs(+seed || 0) % 5) * 6;
  const L = esc(String(letter || '').trim().charAt(0).toUpperCase() || '·');
  return (
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><defs><radialGradient id="g" cx="50%" cy="40%" r="85%"><stop offset="0" stop-color="hsl(' + h + ',14%,24%)"/><stop offset="1" stop-color="hsl(' + h + ',12%,11%)"/></radialGradient></defs><rect width="400" height="300" fill="url(#g)"/><circle cx="200" cy="150" r="54" fill="none" stroke="#cda353" stroke-opacity=".55" stroke-width="1.5"/><text x="200" y="171" text-anchor="middle" font-family="Playfair Display,Georgia,serif" font-size="58" fill="#cda353" fill-opacity=".9">' + L + '</text></svg>'
    )
  );
};

/* Cliente Supabase. CDN fora do ar com SB_URL preenchido → SB = null e o site mostra erro. */
const SB = !DEMO && window.supabase ? window.supabase.createClient(SB_URL, SB_KEY) : null;
