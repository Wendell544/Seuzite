# Agendamento online — base universal

Site de **agendamento de serviços com hora marcada** (salão, barbearia, manicure, estética automotiva,
tatuagem, pet, spa, estúdio, aulas, consultoria…). O cliente escolhe serviço, dia e horário, informa
nome e WhatsApp e confirma pelo WhatsApp. Leva uns 30 segundos. O dono do negócio controla tudo num
painel.

HTML + CSS + JavaScript puro (sem framework, sem build), Supabase (Postgres + Auth + Realtime + Edge
Functions) e GitHub Pages.

## Modo demonstração

Com `SB_URL` vazio em `js/config.js`, o site funciona inteiro **sem Supabase**: serviços, agenda e
agendamentos de exemplo ficam salvos só no navegador. É assim que ele vem, pronto para mostrar a clientes.

- Painel: botão **•••** no rodapé → qualquer e-mail com a senha **`demo`**.
- "Restaurar dados de exemplo" no topo do painel volta tudo ao início.
- As mensagens de WhatsApp vão para o número em `WAD` (`js/config.js`).

## Montar o site de um cliente

1. **Copie este repositório** para um repositório novo do cliente.
2. **Crie um projeto Supabase novo** (um por cliente).
3. **SQL Editor → cole e execute `supabase/schema.sql`** inteiro. Ele pode ser executado de novo depois
   sem perder dados.
4. **Crie o login do dono:**
   - Authentication → Sign In / Providers → desligue *Allow new users to sign up*.
   - Authentication → Users → *Add user* (e-mail e senha, marque *Auto Confirm*).
   - No SQL Editor, dê o papel de admin a esse usuário:
     ```sql
     update auth.users
        set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
      where email = 'dono@negocio.com.br';
     ```
5. **Preencha `js/config.js`:** `SB_URL` e `SB_KEY` (Project Settings → API: *Project URL* e a chave
   *publishable*/*anon*), `GH_OWNER` e `GH_REPO` (repositório do cliente) e `WAD` (WhatsApp padrão).
6. **Fotos (Edge Functions):** as fotos enviadas pelo painel vão para a pasta `img/` do repositório,
   pelo mesmo esquema da loja.
   ```bash
   supabase functions deploy upload-image
   supabase functions deploy cleanup-orphans
   supabase secrets set GITHUB_TOKEN=... GITHUB_OWNER=Wendell544 GITHUB_REPO=NomeDoRepo
   ```
   O token precisa de *Contents: Read and write* no repositório do cliente. Em `cleanup-orphans/index.ts`,
   ajuste `GITHUB_REPO` e, se usar domínio próprio, `ALLOWED_ORIGINS`.
7. **GitHub Pages:** Settings → Pages → *Deploy from a branch* → `main` / raiz.
8. Abra o site, entre pelo **•••** e configure em **Configurações**: nome, logo, WhatsApp,
   endereço, textos, regras da agenda e depoimentos. Depois cadastre serviços, horários e bloqueios.

## Como a agenda decide os horários

A mesma regra roda em dois lugares: no navegador (`js/slots.js`), para responder na hora, e no banco
(`create_booking` + gatilho `bookings_guard`), que tem a palavra final.

- **Grade:** de `slot_interval` em `slot_interval` minutos, da abertura até o fechamento. Recomeça
  no fim do intervalo de almoço e nunca deixa um atendimento invadir o intervalo.
- **Conflito:** um horário está ocupado se
  `início < outro.fim + pausa` **e** `fim > outro.início − pausa` (pausa = `buffer`).
  Só contam agendamentos *pendentes* ou *confirmados*; cancelar libera o horário.
- **Antecedência:** mínimo de `min_notice` horas e máximo de `max_advance` dias, no fuso do negócio
  (`tz`), não no do celular do cliente.
- **Bloqueios:** dia, período (`date` → `date_end`) ou intervalo de horas; geral ou de um profissional.
- **Vários profissionais** (`multiprof`): cada um é uma agenda. "Sem preferência" mostra o horário
  se *alguém* que faz o serviço estiver livre, e o servidor escolhe quem tem menos atendimentos no dia.
  Um agendamento sem profissional ocupa a agenda de todos.
- **Concorrência:** o banco trava o dia durante a gravação. Se duas pessoas confirmarem o mesmo
  horário ao mesmo tempo, a segunda recebe "horário indisponível" e o site volta para a escolha
  de horário com um aviso.
- **Anti-spam:** até `max_per_phone` agendamentos em aberto por telefone (0 = sem limite).

## Segurança (RLS)

- Visitantes **leem** serviços, horários, bloqueios, profissionais (sem o telefone) e configurações.
- Visitantes **não leem** agendamentos. O calendário usa `get_busy`, que devolve só data e hora
  ocupadas, sem nome nem telefone.
- Visitantes **só agendam pelo RPC `create_booking`**: não existe insert direto na tabela. Preço e
  duração vêm do banco, nunca do navegador.
- Só quem tem `app_metadata.role = 'admin'` escreve, inclusive pelo painel, que também passa pela
  checagem de conflito.

## Arquivos

| Arquivo | O que faz |
|---|---|
| `index.html` | Página pública e contêineres (wizard, login, painel, toast) |
| `css/style.css` | Design system (tokens), página e wizard |
| `css/admin.css` | Painel (só carrega quando o admin entra) |
| `js/slots.js` | Motor de horários (funções puras, sem DOM) |
| `js/config.js` | **Configuração por cliente**, utilitários, ícones, toast e camadas |
| `js/storage.js` | `localStorage`, estado e a camada `API` (Supabase ou demonstração) |
| `js/auth.js` | Login do admin |
| `js/images.js` | Compressão WebP e upload |
| `js/site.js` | Monta as seções da página |
| `js/wizard.js` | Fluxo de agendamento |
| `js/admin.js` | Painel (só carrega quando o admin entra) |
| `js/app.js` | Eventos, rotas (`#agendar`, `#agendar=<id>`, `#admin`), tema e inicialização |
| `supabase/schema.sql` | Tabelas, regras, RPCs, RLS e dados iniciais |
| `supabase/functions/*` | Upload e limpeza de fotos (mesmo padrão da loja) |
| `tests/slots.test.js` | Testes do motor de horários |

## Testes

```bash
node --test tests/slots.test.js
```

## Visual

Tudo sai dos tokens no topo de `css/style.css` (`--bg`, `--sf`, `--tx`, `--mt`, `--bd`, `--gd`,
`--er`, `--ok`, raios, sombras, espaçamentos e transições). O tema escuro tem valores próprios em
`:root[data-theme=dark]`. No título do topo, `*palavras entre asteriscos*` aparecem em itálico dourado.
