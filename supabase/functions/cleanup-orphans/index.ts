import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

// ====== CONFIGURAÇÃO DO SITE (troque aqui em cada site novo) ======
const GITHUB_OWNER = 'Wendell544';
const GITHUB_REPO = 'Seuzite';
const GITHUB_BRANCH = ''; // vazio = branch padrão do repositório (a que o GitHub Pages publica)
// O token do GitHub NÃO fica no código: continua no secret GITHUB_TOKEN do Supabase.
// ===================================================================

const ALLOWED_ORIGINS = ['https://wendell544.github.io'];
const GITHUB_API = 'https://api.github.com';

// Tabelas que podem guardar fotos: serviços (image), profissionais (avatar)
// e settings (logo e imagem de fundo do topo).
const REQUIRED_TABLES = ['services', 'professionals', 'settings'];
const OPTIONAL_TABLES: string[] = [];

// --- inicio: ajudantes ---
const NAME_RE = /i_[a-f0-9]+\.webp/g;
const ORPHAN_NAME_RE = /^i_[a-f0-9]+\.webp$/;

// Limpa o valor de um secret: tira espaços, quebras de linha e aspas que sobram ao colar.
function clean(v: string | undefined) {
  return (v ?? '').trim().replace(/^["']+|["']+$/g, '').trim();
}

// Detecta o erro de colar o NOME de um secret (ex.: GITHUB_REPO) no lugar do valor.
function looksLikeSecretName(v: string) {
  return /^GITHUB_[A-Z_]+$/.test(v);
}

// Junta o nome (i_xxxx.webp) de toda foto citada em qualquer coluna, em qualquer formato.
// Compara só pelo nome do arquivo, então URLs antigas (outro repositório, maiúsculas
// diferentes no usuário) continuam contando como "em uso".
function collectNames(rows: unknown, into: Set<string>) {
  const text = JSON.stringify(rows ?? []);
  for (const m of text.matchAll(NAME_RE)) into.add(m[0]);
}

// A tabela simplesmente não existe neste projeto?
function isMissingTable(e: { code?: string; message?: string }) {
  return e.code === 'PGRST205' || e.code === '42P01' || /could not find the table|does not exist/i.test(e.message ?? '');
}

// Só é órfão: arquivo com nome de foto enviada pelo painel e que nenhuma tabela cita.
function isOrphan(f: { type?: string; name?: string }, referenced: Set<string>) {
  const name = f.name ?? '';
  return f.type === 'file' && ORPHAN_NAME_RE.test(name) && !referenced.has(name);
}
// --- fim: ajudantes ---

function corsFor(req: Request) {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : 'null';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function jsonFor(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsFor(req), 'Content-Type': 'application/json' },
  });
}

// Lê a tabela inteira, de mil em mil linhas (o Supabase devolve no máximo 1000 por consulta).
async function readAll(client: any, table: string) {
  const PAGE = 1000;
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from(table)
      .select('*')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { error, rows };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return { error: null, rows };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsFor(req) });
  }
  const origin = req.headers.get('Origin') ?? '';
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return jsonFor(req, { error: 'Origem não permitida.' }, 403);
  }
  if (req.method !== 'POST') {
    return jsonFor(req, { error: 'Método não permitido. Use POST.' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) {
      return jsonFor(req, { error: 'Token de autenticação ausente.' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const userClient = createClient(supabaseUrl, supabaseAnonKey);

    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData?.user) {
      return jsonFor(req, { error: 'Token inválido ou expirado.' }, 401);
    }
    if (userData.user.app_metadata?.role !== 'admin') {
      return jsonFor(req, { error: 'Acesso negado. Apenas administradores.' }, 403);
    }

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!serviceKey) {
      return jsonFor(req, { error: 'SUPABASE_SERVICE_ROLE_KEY não configurada.' }, 500);
    }
    const adminClient = createClient(supabaseUrl, serviceKey);

    const ghToken = clean(Deno.env.get('GITHUB_TOKEN'));
    if (!ghToken) {
      return jsonFor(req, { error: 'GITHUB_TOKEN não configurado nos secrets do Supabase.' }, 500);
    }
    if (looksLikeSecretName(ghToken)) {
      return jsonFor(req, {
        error: 'O valor do secret GITHUB_TOKEN está errado: parece o nome de outro secret. Cole o token do GitHub (começa com github_pat_ ou ghp_).',
      }, 500);
    }

    // 1) Quais fotos estão em uso? Procura em todas as tabelas. Se qualquer leitura falhar,
    //    para tudo: sem saber o que está em uso, nada é apagado.
    const referenced = new Set<string>();
    for (const table of [...REQUIRED_TABLES, ...OPTIONAL_TABLES]) {
      const { error, rows } = await readAll(adminClient, table);
      if (error) {
        if (OPTIONAL_TABLES.includes(table) && isMissingTable(error)) continue;
        return jsonFor(req, { error: `Erro ao ler ${table}: ${error.message}` }, 500);
      }
      collectNames(rows, referenced);
    }

    // 2) Quais fotos existem no GitHub?
    const owner = GITHUB_OWNER;
    const repo = GITHUB_REPO;
    const ghHeaders: Record<string, string> = {
      Authorization: `Bearer ${ghToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Seuzite-Cleanup-Orphans',
    };

    const refQuery = GITHUB_BRANCH ? `?ref=${encodeURIComponent(GITHUB_BRANCH)}` : '';
    const listRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/img${refQuery}`, { headers: ghHeaders });

    if (!listRes.ok) {
      const errText = await listRes.text();
      const dica = listRes.status === 401 ? ' (token do GitHub inválido ou expirado)'
        : listRes.status === 404 ? ' (a pasta img/ ainda não existe ou o token não tem acesso ao repositório)'
        : listRes.status === 403 ? ' (token sem permissão)'
        : '';
      return jsonFor(req, { error: `Falha ao listar img/ em ${owner}/${repo}: ${listRes.status}${dica} ${errText}` }, 502);
    }

    const files = await listRes.json();
    if (!Array.isArray(files)) {
      return jsonFor(req, { error: 'Resposta inesperada da API do GitHub.' }, 502);
    }

    // 3) Apaga só as que nenhuma tabela cita.
    const orphans = files.filter((f: any) => isOrphan(f, referenced));

    const removed: string[] = [];
    const errors: string[] = [];

    for (const file of orphans) {
      const delUrl = `${GITHUB_API}/repos/${owner}/${repo}/contents/img/${file.name}`;
      const payload: Record<string, string> = {
        message: `cleanup: remove órfão ${file.name}`,
        sha: file.sha,
      };
      if (GITHUB_BRANCH) payload.branch = GITHUB_BRANCH;

      const delRes = await fetch(delUrl, {
        method: 'DELETE',
        headers: { ...ghHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (delRes.ok) {
        removed.push(file.name);
      } else {
        const errText = await delRes.text();
        errors.push(`${file.name}: ${delRes.status} ${errText}`);
      }
    }

    return jsonFor(req, {
      removed,
      kept: files.length - orphans.length,
      total: files.length,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    console.error('cleanup-orphans erro inesperado:', e);
    return jsonFor(req, {
      error: `Erro inesperado: ${e instanceof Error ? e.message : String(e)}`,
    }, 500);
  }
});
