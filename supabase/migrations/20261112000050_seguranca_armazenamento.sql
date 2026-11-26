-- =====================================================================
-- Segurança e guarda de 10 anos de dados.
--  * Verificação em 2 etapas valendo no banco: quem ativou o código do
--    celular só lê e grava depois de digitar o código (sessão aal2).
--  * Auditoria mais leve: na alteração guarda só o que mudou (e nada quando
--    nada mudou). Compressão lz4 nos campos grandes.
--  * Arquivo frio: cópia de todos os arquivos no Cloudflare R2 e, quando o
--    espaço grátis do Supabase aperta, os mais antigos passam a ser lidos de lá.
--  * Medidor de uso (banco e arquivos) com projeção, e registro dos backups.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Verificação em 2 etapas
-- ---------------------------------------------------------------------
-- Sessão segura: quem tem fator verificado precisa estar com aal2. Quem não
-- ativou segue como antes. As funções de papel passam a exigir isso, então
-- todas as regras (RLS) e operações herdam a exigência sem mudar uma a uma.
create or replace function public.sessao_segura()
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_aal text;
begin
  if auth.uid() is null then return true; end if;
  begin
    v_aal := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal';
  exception when others then v_aal := null;
  end;
  if v_aal = 'aal2' then return true; end if;
  return not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status::text = 'verified');
end $$;
grant execute on function public.sessao_segura() to anon, authenticated;

create or replace function public.meu_papel()
returns public.papel_usuario language sql stable security definer set search_path = public as $$
  select papel from usuario where id = auth.uid() and ativo and public.sessao_segura()
$$;

create or replace function public.eh_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select papel = 'administrador' from usuario where id = auth.uid() and ativo), false) and public.sessao_segura()
$$;

create or replace function public.eh_equipe_adm()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select papel in ('administrador', 'administrativo') from usuario where id = auth.uid() and ativo), false) and public.sessao_segura()
$$;

create or replace function public.eh_equipe()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select papel in ('administrador', 'administrativo', 'campo') from usuario where id = auth.uid() and ativo), false) and public.sessao_segura()
$$;

create or replace function public.tem_financeiro()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select papel = 'administrador' or (papel = 'administrativo' and acesso_financeiro)
    from usuario where id = auth.uid() and ativo
  ), false) and public.sessao_segura()
$$;

create or replace function public.membro_da_obra(p_obra uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from membro_obra m join usuario u on u.id = m.usuario_id
                 where m.obra_id = p_obra and m.usuario_id = auth.uid() and u.ativo) and public.sessao_segura()
$$;

-- ---------------------------------------------------------------------
-- Auditoria mais leve (mesma garantia: quem, quando, o que era e o que ficou)
-- ---------------------------------------------------------------------
create or replace function public.auditar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_id text;
  v_antes jsonb;
  v_depois jsonb;
begin
  v_id := coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id', to_jsonb(new)->>'obra_id', to_jsonb(old)->>'obra_id');
  if tg_op = 'UPDATE' then
    -- Só os campos que mudaram: antes = valores antigos, depois = valores novos.
    select coalesce(jsonb_object_agg(o.key, o.value), '{}'), coalesce(jsonb_object_agg(o.key, n.value), '{}')
      into v_antes, v_depois
      from jsonb_each(to_jsonb(old)) o
      join jsonb_each(to_jsonb(new)) n using (key)
     where o.value is distinct from n.value;
    -- Nada mudou (ou só a data de atualização): nada a registrar.
    if (v_depois - 'atualizado_em') = '{}'::jsonb then return null; end if;
    -- Mantém o id para quem lê o histórico sem precisar cruzar tabelas.
    if to_jsonb(new) ? 'id' then v_depois := v_depois || jsonb_build_object('id', to_jsonb(new)->'id'); end if;
  elsif tg_op = 'INSERT' then
    v_depois := to_jsonb(new);
  else
    v_antes := to_jsonb(old);
  end if;
  insert into auditoria (tabela, registro_id, acao, usuario_id, antes, depois)
  values (tg_table_name, v_id, lower(tg_op), auth.uid(), v_antes, v_depois);
  return null;
end $$;

-- Compressão lz4 (mais rápida e menor) nos campos grandes. Vale para o que for gravado daqui em diante.
do $$
declare r record;
begin
  for r in
    select c.table_name, c.column_name from information_schema.columns c
     where c.table_schema = 'public' and c.data_type = 'jsonb'
       and (c.table_name, c.column_name) in (('auditoria', 'antes'), ('auditoria', 'depois'),
            ('proposta_versao', 'conteudo'), ('proposta_versao', 'custos'), ('lixeira', 'dados'))
  loop
    begin
      execute format('alter table public.%I alter column %I set compression lz4', r.table_name, r.column_name);
    exception when others then null; -- PostgreSQL sem lz4: segue com a compressão padrão
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Arquivos: só tipos esperados entram no Storage (foto, PDF e XML de nota)
-- ---------------------------------------------------------------------
do $$ begin
  update storage.buckets set allowed_mime_types = array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif',
    'application/pdf', 'text/xml', 'application/xml']
  where id = 'documentos';
exception when undefined_column then null;
end $$;

-- ---------------------------------------------------------------------
-- Configuração da guarda (uma linha)
-- ---------------------------------------------------------------------
create table public.armazenamento_config (
  id smallint primary key default 1 check (id = 1),
  limite_banco_mb integer not null default 500 check (limite_banco_mb > 0),
  limite_arquivos_mb integer not null default 1024 check (limite_arquivos_mb > 0),
  limite_frio_gb integer not null default 10 check (limite_frio_gb > 0),
  -- Quando os arquivos no Supabase passam desta porcentagem do limite, os mais antigos
  -- (já copiados no R2) saem do Supabase até voltar para a porcentagem alvo.
  arquivar_acima_pct integer not null default 70 check (arquivar_acima_pct between 10 and 100),
  alvo_pct integer not null default 55 check (alvo_pct between 5 and 95),
  idade_minima_meses integer not null default 6 check (idade_minima_meses >= 1),
  guarda_anos integer not null default 10 check (guarda_anos between 1 and 30),
  atualizado_em timestamptz not null default now(),
  constraint alvo_abaixo check (alvo_pct < arquivar_acima_pct)
);
insert into public.armazenamento_config (id) values (1) on conflict do nothing;

-- Arquivos com cópia no R2. removido_em preenchido = o original saiu do Supabase e é lido do R2.
create table public.arquivo_frio (
  caminho text primary key,
  bytes bigint not null default 0,
  copiado_em timestamptz not null default now(),
  removido_em timestamptz
);
create index arquivo_frio_removido_idx on public.arquivo_frio (removido_em) where removido_em is not null;

create table public.backup_registro (
  id bigint generated always as identity primary key,
  em timestamptz not null default now(),
  tipo text not null check (tipo in ('diario', 'mensal', 'manual')),
  destino text not null check (destino in ('r2', 'github')),
  bytes bigint,
  arquivos_copiados integer not null default 0,
  arquivos_arquivados integer not null default 0,
  ok boolean not null default true,
  detalhe text
);
create index backup_registro_em_idx on public.backup_registro (em desc);

alter table public.armazenamento_config enable row level security;
alter table public.armazenamento_config force row level security;
alter table public.arquivo_frio enable row level security;
alter table public.arquivo_frio force row level security;
alter table public.backup_registro enable row level security;
alter table public.backup_registro force row level security;
revoke all on public.armazenamento_config, public.arquivo_frio, public.backup_registro from anon, authenticated;
grant select, update on public.armazenamento_config to authenticated;
grant select on public.backup_registro to authenticated;
create policy armazenamento_config_ler on public.armazenamento_config for select to authenticated using (eh_admin());
create policy armazenamento_config_editar on public.armazenamento_config for update to authenticated using (eh_admin()) with check (eh_admin());
create policy backup_registro_ler on public.backup_registro for select to authenticated using (eh_admin());
create trigger armazenamento_config_auditoria after insert or update or delete on public.armazenamento_config
  for each row execute function public.auditar();

-- ---------------------------------------------------------------------
-- Quem pode ler um arquivo: as mesmas regras do Storage (pasta financeiro/
-- para o financeiro; obras/ para a equipe administrativa; fotos para o campo
-- das obras atribuídas). Usada pela função "arquivos" para o arquivo frio.
-- ---------------------------------------------------------------------
create or replace function public.pode_ler_arquivo(p_caminho text)
returns boolean language sql stable set search_path = public as $$
  select p_caminho is not null and p_caminho !~ '(^|/)\.\.(/|$)' and (
    (split_part(p_caminho, '/', 1) = 'financeiro' and public.tem_financeiro())
    or (split_part(p_caminho, '/', 1) = 'obras' and public.eh_equipe_adm())
    or (split_part(p_caminho, '/', 1) = 'obras' and split_part(p_caminho, '/', 3) = 'fotos'
        and public.meu_papel() = 'campo' and public.membro_da_obra(public.obra_da_pasta(p_caminho))))
$$;

-- Dos caminhos pedidos, devolve os que a pessoa pode ler e que estão no arquivo frio.
create or replace function public.arquivos_frios_permitidos(p_caminhos text[])
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(f.caminho), '{}')
    from arquivo_frio f
   where f.caminho = any (p_caminhos[1:200]) and f.removido_em is not null and public.pode_ler_arquivo(f.caminho)
$$;
revoke all on function public.pode_ler_arquivo(text), public.arquivos_frios_permitidos(text[]) from public, anon;
grant execute on function public.pode_ler_arquivo(text), public.arquivos_frios_permitidos(text[]) to authenticated;

-- ---------------------------------------------------------------------
-- Uso do armazenamento (só administrador)
-- ---------------------------------------------------------------------
create or replace function public.uso_armazenamento()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cfg armazenamento_config;
  v_inicio timestamptz;
  v_res jsonb;
begin
  if not eh_admin() then raise exception 'Só o administrador vê o uso do armazenamento.'; end if;
  select * into v_cfg from armazenamento_config where id = 1;
  select least(coalesce((select min(criado_em) from empresa), now()), coalesce((select min(em) from auditoria), now())) into v_inicio;

  with obj as (
    select o.name, coalesce((o.metadata->>'size')::bigint, 0) as bytes, o.created_at
      from storage.objects o where o.bucket_id = 'documentos'
  ), frio as (
    select coalesce(sum(bytes) filter (where removido_em is not null), 0) as so_r2,
           count(*) filter (where removido_em is not null) as n_so_r2,
           coalesce(sum(bytes), 0) as copiado, count(*) as n_copiado
      from arquivo_frio
  ), mensal as (
    select to_char(date_trunc('month', m), 'YYYY-MM') as mes,
           coalesce((select sum(bytes) from obj where date_trunc('month', obj.created_at) = m), 0)
           + coalesce((select sum(bytes) from arquivo_frio f where f.removido_em is not null
                        and date_trunc('month', f.copiado_em) = m and not exists (select 1 from obj where obj.name = f.caminho)), 0) as bytes
      from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m
  )
  select jsonb_build_object(
    'inicio', v_inicio,
    'banco', jsonb_build_object(
      'bytes', pg_database_size(current_database()),
      'limite_bytes', v_cfg.limite_banco_mb::bigint * 1024 * 1024,
      'tabelas', (select coalesce(jsonb_agg(t order by t.bytes desc), '[]') from (
                    select c.relname as tabela, pg_total_relation_size(c.oid) as bytes
                      from pg_class c join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname = 'public' and c.relkind = 'r'
                     order by pg_total_relation_size(c.oid) desc limit 8) t)),
    'arquivos', jsonb_build_object(
      'bytes', (select coalesce(sum(bytes), 0) from obj),
      'quantidade', (select count(*) from obj),
      'fotos_bytes', (select coalesce(sum(bytes), 0) from obj where name like 'obras/%/fotos/%'),
      'limite_bytes', v_cfg.limite_arquivos_mb::bigint * 1024 * 1024),
    'frio', (select jsonb_build_object('bytes', so_r2, 'quantidade', n_so_r2, 'copiado_bytes', copiado,
                                       'copiado_quantidade', n_copiado, 'limite_bytes', v_cfg.limite_frio_gb::bigint * 1024 * 1024 * 1024,
                                       'sem_copia', (select count(*) from obj where not exists (select 1 from arquivo_frio f where f.caminho = obj.name)))
               from frio),
    'mensal', (select jsonb_agg(jsonb_build_object('mes', mes, 'bytes', bytes) order by mes) from mensal),
    'backups', (select coalesce(jsonb_agg(b order by b.em desc), '[]') from (
                  select em, tipo, destino, bytes, arquivos_copiados, arquivos_arquivados, ok, detalhe
                    from backup_registro order by em desc limit 6) b),
    'config', to_jsonb(v_cfg)
  ) into v_res;
  return v_res;
end $$;
revoke all on function public.uso_armazenamento() from public, anon;
grant execute on function public.uso_armazenamento() to authenticated;

-- ---------------------------------------------------------------------
-- Operações do backup (só a chave de serviço, usada pelo GitHub Actions)
-- ---------------------------------------------------------------------
-- Arquivos do Storage que ainda não têm cópia no R2.
create or replace function public.arquivos_sem_copia(p_limite integer default 500)
returns table (caminho text, bytes bigint) language sql stable security definer set search_path = public as $$
  select o.name, coalesce((o.metadata->>'size')::bigint, 0)
    from storage.objects o
   where o.bucket_id = 'documentos'
     and not exists (select 1 from arquivo_frio f where f.caminho = o.name)
   order by o.created_at
   limit greatest(1, least(p_limite, 5000))
$$;

create or replace function public.marcar_copiados(p_itens jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  insert into arquivo_frio (caminho, bytes)
  select i->>'caminho', coalesce((i->>'bytes')::bigint, 0)
    from jsonb_array_elements(coalesce(p_itens, '[]')) i
   where coalesce(i->>'caminho', '') <> ''
  on conflict (caminho) do update set bytes = excluded.bytes, copiado_em = now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Quando o Supabase passa do limite configurado, escolhe os arquivos mais antigos
-- (com cópia no R2 e mais velhos que a idade mínima) até liberar o necessário.
create or replace function public.arquivos_para_arquivar()
returns table (caminho text, bytes bigint) language plpgsql stable security definer set search_path = public as $$
declare
  v_cfg armazenamento_config;
  v_total bigint;
  v_limite bigint;
  v_liberar bigint;
begin
  select * into v_cfg from armazenamento_config where id = 1;
  select coalesce(sum((metadata->>'size')::bigint), 0) into v_total from storage.objects where bucket_id = 'documentos';
  v_limite := v_cfg.limite_arquivos_mb::bigint * 1024 * 1024;
  if v_total <= v_limite * v_cfg.arquivar_acima_pct / 100 then return; end if;
  v_liberar := v_total - v_limite * v_cfg.alvo_pct / 100;
  return query
    select x.name, x.bytes from (
      select o.name, coalesce((o.metadata->>'size')::bigint, 0) as bytes,
             sum(coalesce((o.metadata->>'size')::bigint, 0)) over (order by o.created_at, o.name) as acumulado
        from storage.objects o
        join arquivo_frio f on f.caminho = o.name and f.removido_em is null
       where o.bucket_id = 'documentos'
         and o.created_at < now() - make_interval(months => v_cfg.idade_minima_meses)
    ) x
    where x.acumulado - x.bytes < v_liberar
    order by x.acumulado;
end $$;

create or replace function public.marcar_arquivados(p_caminhos text[])
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  update arquivo_frio set removido_em = now() where caminho = any (p_caminhos) and removido_em is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.registrar_backup(p_tipo text, p_destino text, p_bytes bigint, p_copiados integer default 0,
                                                   p_arquivados integer default 0, p_ok boolean default true, p_detalhe text default null)
returns bigint language sql security definer set search_path = public as $$
  insert into backup_registro (tipo, destino, bytes, arquivos_copiados, arquivos_arquivados, ok, detalhe)
  values (p_tipo, p_destino, p_bytes, coalesce(p_copiados, 0), coalesce(p_arquivados, 0), coalesce(p_ok, true), left(p_detalhe, 500))
  returning id
$$;

revoke all on function public.arquivos_sem_copia(integer), public.marcar_copiados(jsonb), public.arquivos_para_arquivar(),
  public.marcar_arquivados(text[]), public.registrar_backup(text, text, bigint, integer, integer, boolean, text) from public, anon, authenticated;
grant execute on function public.arquivos_sem_copia(integer), public.marcar_copiados(jsonb), public.arquivos_para_arquivar(),
  public.marcar_arquivados(text[]), public.registrar_backup(text, text, bigint, integer, integer, boolean, text) to service_role;
grant select, insert, update on public.arquivo_frio, public.backup_registro to service_role;
grant select on public.armazenamento_config to service_role;
