/* =============================================================
   images.js — compressão WebP, upload pela Edge Function e <img>.
   (Mesmo padrão da loja.) No modo demonstração a foto comprimida
   fica no próprio navegador, como data URL.
   ============================================================= */
const IMG = (() => {
  const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif'];
  const MB = 1024 * 1024;
  const UPLOAD_URL = SB_URL + '/functions/v1/upload-image';
  const URLS = new Map();

  const dec = (f) =>
    'createImageBitmap' in window
      ? createImageBitmap(f)
      : new Promise((ok, no) => {
          const i = new Image(), u = URL.createObjectURL(f);
          i.onload = () => {
            URL.revokeObjectURL(u);
            ok(i);
          };
          i.onerror = () => no(new Error('x'));
          i.src = u;
        });

  const cv = (s, max, type, q) => {
    const k = Math.min(1, max / Math.max(s.width, s.height)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(s.width * k));
    c.height = Math.max(1, Math.round(s.height * k));
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(s, 0, 0, c.width, c.height);
    return new Promise((r) => c.toBlob(r, type, q));
  };

  const enc = async (s, max, q) => {
    let b = await cv(s, max, 'image/webp', q);
    if (!b || b.type !== 'image/webp') b = await cv(s, max, 'image/jpeg', q);
    return b;
  };

  /* Até 1200px; se passar de 200 KB, 800px. No modo demo, sempre leve (localStorage é pequeno). */
  const optimize = async (s) => {
    if (DEMO) return enc(s, 720, 0.7);
    let b = await enc(s, 1200, 0.82);
    if (b && b.size > 200 * 1024) b = await enc(s, 800, 0.7);
    return b;
  };

  const toData = (blob) =>
    new Promise((ok, no) => {
      const r = new FileReader();
      r.onload = () => ok(r.result);
      r.onerror = no;
      r.readAsDataURL(blob);
    });

  async function hash(blob) {
    const u = new Uint8Array(await blob.arrayBuffer());
    if (window.crypto && crypto.subtle) {
      try {
        const h = await crypto.subtle.digest('SHA-256', u);
        return [...new Uint8Array(h)].slice(0, 8).map((x) => x.toString(16).padStart(2, '0')).join('');
      } catch (e) {}
    }
    let h = 5381;
    for (let i = 0; i < u.length; i += 7) h = ((h << 5) + h + u[i]) | 0;
    return (h >>> 0).toString(16) + u.length.toString(16);
  }

  const post = (token, form) =>
    fetch(UPLOAD_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + token, apikey: SB_KEY }, body: form }).then(async (res) => {
      let body = null;
      try {
        body = await res.json();
      } catch (e) {}
      return { res, body };
    });

  async function one(f) {
    const mb = DB.set.mb || 5;
    if (f.size > mb * MB) throw new Error(f.name + ': passa de ' + mb + ' MB.');
    if (!TYPES.includes(f.type) && !/\.(jpe?g|png|webp|heic|heif|gif|avif)$/i.test(f.name)) throw new Error(f.name + ': formato não permitido.');
    let s;
    try {
      s = await dec(f);
    } catch (e) {
      throw new Error(f.name + ': imagem inválida.');
    }
    const full = await optimize(s);
    if (!full) throw new Error(f.name + ': não foi possível processar a imagem.');
    const k = 'i:' + (await hash(full));
    if (URLS.has(k)) return { u: URLS.get(k), k };

    if (DEMO) {
      const u = await toData(full);
      URLS.set(k, u);
      return { u, k };
    }

    // Token com refresh preventivo (mesmo padrão da loja)
    let session = (await SB.auth.getSession()).data.session;
    if (!session) throw new Error('Sessão expirada. Faça login novamente.');
    if (session.expires_at && session.expires_at * 1000 - Date.now() < 60000) {
      const { data } = await SB.auth.refreshSession();
      if (data?.session) session = data.session;
    }
    const form = new FormData();
    form.append('file', new File([full], 'upload.webp', { type: 'image/webp' }));

    let { res, body } = await post(session.access_token, form);
    if (res.status === 401) {
      const { data } = await SB.auth.refreshSession();
      if (!data?.session) throw new Error(body?.error || 'Sessão expirada. Faça login novamente.');
      ({ res, body } = await post(data.session.access_token, form));
    }
    if (!res.ok || !body?.url) throw new Error(body?.error || 'Falha no upload (' + res.status + ').');
    URLS.set(k, body.url);
    return { u: body.url, k };
  }

  /* Envia uma foto e devolve a referência { u, k } (ou lança erro com mensagem clara). */
  const upload = async (file) => one(file);

  /* <img> com fallback neutro (monograma) se a foto não carregar. */
  const html = (r, o = {}) => {
    r = R(r);
    const alt = esc(o.alt || '');
    const fb = art(o.seed || 0, o.letter || o.alt);
    const lazy = o.eager ? ' fetchpriority="high"' : ' loading="lazy"';
    if (!r || !r.u) return '<img src="' + fb + '" alt="' + alt + '" decoding="async"' + lazy + '>';
    return '<img src="' + esc(r.u) + '" alt="' + alt + '" decoding="async"' + lazy + ' data-fb="' + fb + '" onerror="this.onerror=null;this.src=this.dataset.fb">';
  };

  return { upload, html };
})();
