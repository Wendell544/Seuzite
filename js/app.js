/* =============================================================
   app.js — eventos globais (delegação data-a), rotas por hash,
   tema, login, carregamento sob demanda do painel e boot.
   Rotas: #agendar · #agendar=<id do serviço> · #admin
   ============================================================= */
let pd = null; // onde o clique começou (arrastar texto para fora não fecha modal)
document.addEventListener('pointerdown', (e) => (pd = e.target), true);

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-a]');
  if (t) {
    const f = ACT[t.dataset.a];
    if (f) {
      if (t.tagName === 'A' && t.target !== '_blank') e.preventDefault();
      f(t.dataset.v, t, e);
    }
    return;
  }
  // Clique no fundo escuro fecha (só se começou nele).
  if (e.target === pd && (e.target.id === 'wz' || e.target.id === 'lg')) closeTop();
});

const closeTop = () => {
  const t = Layer.top();
  if (t === 'cf') return ask.esc && ask.esc();
  if (t === 'wz') return Wizard.close();
  if (t === 'lg') return ACT.lclose();
  if (t === 'adm' && window.Admin) return Admin.esc();
};

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && Layer.top()) {
    e.preventDefault();
    closeTop();
  }
  if (e.key === 'Enter' && (e.target.id === 'pw' || e.target.id === 'em')) ACT.login();
});

/* ---------- tema ---------- */
const themeColor = () => {
  const c = document.documentElement.dataset.theme === 'dark' ? '#121110' : '#fbfaf7';
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', c));
};
ACT.theme = () => {
  const d = document.documentElement, t = d.dataset.theme === 'dark' ? 'light' : 'dark';
  d.dataset.theme = t;
  Prefs.set({ theme: t });
  themeColor();
};
try {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (Prefs.get().theme) return;
    document.documentElement.dataset.theme = e.matches ? 'dark' : 'light';
    themeColor();
  });
} catch (e) {}

/* ---------- login e painel (admin.js/admin.css só carregam aqui) ---------- */
const lazy = (() => {
  let p = null;
  return () =>
    p ||
    (p = new Promise((ok, no) => {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = 'css/admin.css?v=' + V;
      document.head.appendChild(l);
      const s = document.createElement('script');
      s.src = 'js/admin.js?v=' + V;
      s.onload = ok;
      s.onerror = () => {
        p = null;
        no(new Error('admin'));
      };
      document.body.appendChild(s);
    }));
})();

const enterAdmin = async () => {
  try {
    await lazy();
  } catch (e) {
    return toast('Não foi possível abrir o painel. Verifique a conexão.', 'er');
  }
  Admin.enter();
};

ACT.admin = async () => {
  if (await Auth.isAdmin()) return enterAdmin();
  $('lg-x').textContent = DEMO ? 'Modo demonstração: use qualquer e-mail e a senha "demo".' : 'Área exclusiva da administração.';
  $('pe').classList.add('hid');
  Layer.open('lg', $('em').value ? $('pw') : $('em'));
  lazy().catch(() => {}); // já vai baixando o painel enquanto digita
};
ACT.lclose = () => {
  Layer.close('lg');
  if (location.hash === '#admin') history.replaceState(null, '', location.pathname + location.search);
};
ACT.login = async () => {
  const e = $('pe'), b = document.querySelector('[data-a=login]');
  e.classList.add('hid');
  const email = $('em').value.trim(), pass = $('pw').value;
  if (!email || !pass) {
    e.textContent = 'Informe e-mail e senha.';
    return e.classList.remove('hid');
  }
  b.disabled = true;
  const r = await Auth.login(email, pass);
  b.disabled = false;
  if (r.st !== 'ok') {
    e.textContent = r.msg || 'E-mail ou senha incorretos.';
    return e.classList.remove('hid');
  }
  $('pw').value = '';
  Layer.close('lg');
  enterAdmin();
};

/* ---------- rotas ---------- */
const route = () => {
  const h = location.hash;
  const m = /^#agendar(?:=(\d+))?$/.exec(h);
  if (m) return Wizard.open(m[1] ? { svc: m[1] } : {});
  if (h === '#admin') return ACT.admin();
  if (Layer.isOpen('wz') && !/^#agendar/.test(h)) Wizard.close(); // "voltar" do navegador fecha
};
addEventListener('hashchange', route);

ACT.retry = async () => {
  document.documentElement.classList.add('is-loading');
  await boot();
};

/* ---------- header, CTA mobile e rolagem ---------- */
let sq = 0, ftOn = false;
const onS = () => {
  sq = 0;
  const y = scrollY;
  $('hd').classList.toggle('sc', y > 8);
  const past = y > ($('hero').offsetHeight || 400) - 80;
  const on = past && !ftOn && DB.ready;
  const m = $('mcta');
  m.classList.toggle('on', on);
  m.setAttribute('aria-hidden', !on);
  m.querySelectorAll('a').forEach((a) => (a.tabIndex = on ? 0 : -1));
};
addEventListener('scroll', () => sq || (sq = requestAnimationFrame(onS)), { passive: true });
try {
  new IntersectionObserver((en) => {
    ftOn = en[0].isIntersecting;
    onS();
  }).observe($('ft'));
} catch (e) {}

/* Volta para a aba depois de um tempo: atualiza os horários ocupados. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !DB.ready || DB.err) return;
  if (DB.busyAt && Date.now() - DB.busyAt < 60000) return;
  loadBusy()
    .then(() => {
      Site.live();
      Wizard.refresh();
    })
    .catch(() => {});
});

/* ---------- boot ---------- */
document.querySelectorAll('[data-i]').forEach((e) => (e.innerHTML = ic(e.dataset.i, +e.dataset.s || 20)));
themeColor();
setTimeout(() => document.documentElement.classList.remove('is-loading'), 6000); // nunca fica preso no skeleton

async function boot() {
  DB.err = false;
  try {
    await loadPublic();
  } catch (e) {
    console.error('Falha ao carregar os dados:', e);
    DB.err = true;
  }
  try {
    Site.render();
  } catch (e) {
    console.error('Falha ao montar a página:', e);
  } finally {
    document.documentElement.classList.remove('is-loading');
  }
  onS();
  if (DB.err) return;
  route();
  try {
    await loadBusy();
  } catch (e) {
    console.error('Falha ao carregar horários ocupados:', e);
    DB.busy = [];
    DB.busyAt = 0;
  }
  Site.live();
  Wizard.refresh();
}
boot();

try {
  navigator.storage && navigator.storage.persist && navigator.storage.persist();
} catch (e) {}
