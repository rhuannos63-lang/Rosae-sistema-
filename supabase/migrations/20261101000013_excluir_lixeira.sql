-- Autonomia para excluir qualquer cadastro, com segurança:
--  * só o administrador exclui;
--  * antes de excluir, o sistema mostra tudo o que vai junto (etapas, fotos, parcelas…);
--  * tudo o que sai vai para a lixeira, com os dados completos, e pode ser restaurado;
--  * a auditoria continua registrando cada exclusão e cada restauração.
-- As travas de histórico (movimento, versão emitida, medição, contrato…) continuam valendo
-- no uso normal; só esta função, com a confirmação do administrador, passa por elas.

-- Todas as ligações (chaves estrangeiras) passam a aceitar conferência no fim da transação
-- quando pedido. No uso normal nada muda (continuam conferidas na hora); só a exclusão e a
-- restauração confirmadas pedem a conferência no fim, para tirar e devolver tudo junto.
do $$
declare r record;
begin
  for r in select conname, conrelid::regclass::text as t from pg_constraint
           where contype = 'f' and connamespace = 'public'::regnamespace and not condeferrable
  loop
    execute format('alter table %s alter constraint %I deferrable initially immediate', r.t, r.conname);
  end loop;
end $$;

create table public.lixeira (
  id uuid primary key default gen_random_uuid(),
  tabela text not null,
  registro_id text not null,
  nome text,
  resumo jsonb not null default '{}',
  passos jsonb not null,
  religar jsonb not null default '[]',
  excluido_por uuid default auth.uid(),
  excluido_em timestamptz not null default now(),
  restaurado_em timestamptz,
  restaurado_por uuid
);
create index lixeira_em_idx on public.lixeira (excluido_em desc);
alter table public.lixeira enable row level security;
create policy lixeira_ler on public.lixeira for select to authenticated using (public.eh_admin());
revoke all on public.lixeira from anon;
grant select on public.lixeira to authenticated;

-- Tabelas que podem ser excluídas pelo administrador (a raiz da exclusão).
create or replace function public.exclusao_permitida(p_tabela text) returns boolean language sql immutable as $$
  select p_tabela = any (array[
    'pessoa', 'oportunidade', 'interacao', 'proposta', 'proposta_versao', 'obra', 'ambiente', 'servico', 'etapa',
    'material', 'registro', 'foto', 'pendencia', 'medicao', 'contrato', 'ficha', 'lancamento',
    'conta_bancaria', 'categoria', 'nota_fiscal', 'modelo_servico', 'clausula', 'meta', 'contratacao', 'arquivo'
  ])
$$;

-- Tabelas que nunca saem junto (ligadas a usuários, à empresa ou ao próprio histórico).
create or replace function public.exclusao_bloqueada(p_tabela text) returns boolean language sql immutable as $$
  select p_tabela = any (array['usuario', 'empresa', 'auditoria', 'contador', 'preferencia_usuario', 'lixeira',
    'assistente_config', 'assistente_vinculo', 'assistente_mensagem', 'assistente_acao', 'whatsapp_recebida'])
$$;

create or replace function public.tem_coluna(p_tabela text, p_coluna text) returns boolean language sql stable as $$
  select exists (select 1 from pg_attribute where attrelid = ('public.' || quote_ident(p_tabela))::regclass
                 and attname = p_coluna and not attisdropped and attnum > 0)
$$;

-- Plano da exclusão: a raiz e tudo o que depende dela, na ordem pais → filhos.
create or replace function public.exclusao_plano(p_tabela text, p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  fila jsonb := jsonb_build_array(jsonb_build_object('t', p_tabela, 'ids', jsonb_build_array(p_id)));
  passos jsonb := '[]';
  religar jsonb := '[]';
  vistos text[] := array[p_tabela || ':' || p_id];
  item jsonb; v_val jsonb; fk record; v_ids text[]; v_pais text[]; v_filhos text[]; v_qtd integer; k integer := 0;
begin
  while k < jsonb_array_length(fila) loop
    item := fila -> k; k := k + 1;
    passos := passos || item;
    select array_agg(x) into v_ids from jsonb_array_elements_text(item -> 'ids') x;
    for fk in
      select c.conrelid::regclass::text as filho, a.attname as col, pa.attname as col_pai, c.confdeltype as acao
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
      where c.contype = 'f' and c.confrelid = ('public.' || quote_ident(item ->> 't'))::regclass
        and array_length(c.conkey, 1) = 1 and c.connamespace = 'public'::regnamespace
    loop
      fk.filho := replace(fk.filho, 'public.', '');
      if fk.col_pai = 'id' then v_pais := v_ids;
      else
        execute format('select array_agg(%I::text) from public.%I where id::text = any($1)', fk.col_pai, item ->> 't') into v_pais using v_ids;
      end if;
      if v_pais is null then continue; end if;
      if fk.acao in ('n', 'd') then
        -- O filho fica, só perde a ligação. Guardamos para religar na restauração.
        if tem_coluna(fk.filho, 'id') then
          execute format('select array_agg(id::text) from public.%I where %I::text = any($1)', fk.filho, fk.col) into v_filhos using v_pais;
          if v_filhos is not null then
            execute format('select jsonb_object_agg(id::text, %I::text) from public.%I where id::text = any($1)', fk.col, fk.filho)
              into v_val using v_filhos;
            religar := religar || jsonb_build_object('t', fk.filho, 'col', fk.col, 'valores', v_val);
          end if;
        end if;
        continue;
      end if;
      if exclusao_bloqueada(fk.filho) then
        execute format('select count(*) from public.%I where %I::text = any($1)', fk.filho, fk.col) into v_qtd using v_pais;
        if v_qtd > 0 then
          raise exception 'Este registro está ligado a % e não pode ser excluído por aqui.', replace(fk.filho, '_', ' ');
        end if;
        continue;
      end if;
      -- Rateio de um custo entre obras precisa somar o total: sai o lançamento inteiro.
      if fk.filho = 'lancamento_rateio' and item ->> 't' <> 'lancamento' then
        select array_agg(distinct r.lancamento_id::text) into v_filhos from lancamento_rateio r
        where (case fk.col when 'obra_id' then r.obra_id::text when 'servico_id' then r.servico_id::text else null end) = any (v_pais)
          and not (('lancamento:' || r.lancamento_id::text) = any (vistos));
        if v_filhos is not null then
          vistos := vistos || array(select 'lancamento:' || x from unnest(v_filhos) x);
          fila := fila || jsonb_build_object('t', 'lancamento', 'ids', to_jsonb(v_filhos));
        end if;
        continue;
      end if;
      if tem_coluna(fk.filho, 'id') then
        execute format('select array_agg(id::text) from public.%I where %I::text = any($1) and not ((%L || '':'' || id::text) = any($2))',
          fk.filho, fk.col, fk.filho) into v_filhos using v_pais, vistos;
        if v_filhos is not null then
          vistos := vistos || array(select fk.filho || ':' || x from unnest(v_filhos) x);
          fila := fila || jsonb_build_object('t', fk.filho, 'ids', to_jsonb(v_filhos));
        end if;
      else
        execute format('select count(*) from public.%I where %I::text = any($1)', fk.filho, fk.col) into v_qtd using v_pais;
        if v_qtd > 0 then
          fila := fila || jsonb_build_object('t', fk.filho, 'col', fk.col, 'vals', to_jsonb(v_pais));
        end if;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('passos', passos, 'religar', religar);
end $$;

create or replace function public.exclusao_onde(p jsonb) returns text language sql immutable as $$
  select case when p ? 'col' then format('%I::text = any(array(select jsonb_array_elements_text(%L::jsonb)))', p ->> 'col', p -> 'vals')
              else format('id::text = any(array(select jsonb_array_elements_text(%L::jsonb)))', p -> 'ids') end
$$;

-- Travas de histórico e validações (gatilhos BEFORE) das tabelas envolvidas: desligadas só
-- dentro da transação da exclusão/restauração confirmada. A auditoria (AFTER) continua gravando.
create or replace function public.travas(p_tabelas text[], p_ligar boolean) returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select distinct tg.tgname, tg.tgrelid::regclass::text as t from pg_trigger tg
           where not tg.tgisinternal and (tg.tgtype & 2) = 2
             and tg.tgrelid = any (array(select ('public.' || quote_ident(x))::regclass from unnest(p_tabelas) x))
  loop
    execute format('alter table %s %s trigger %I', r.t, case when p_ligar then 'enable' else 'disable' end, r.tgname);
  end loop;
end $$;

/**
 * Exclui um registro e tudo o que depende dele. Sem p_confirmar, só devolve o que sairia.
 * Confirmado, guarda tudo na lixeira e exclui (filhos antes dos pais).
 */
create or replace function public.excluir_registro(p_tabela text, p_id text, p_confirmar boolean default false, p_nome text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  plano jsonb; passo jsonb; resumo jsonb := '{}'; linhas jsonb; qtd integer; total integer := 0;
  tabelas text[] := '{}'; v_lixeira uuid; i integer;
begin
  if not eh_admin() then raise exception 'Só o administrador pode excluir.'; end if;
  if not exclusao_permitida(p_tabela) then raise exception 'Este tipo de registro não pode ser excluído por aqui.'; end if;
  execute format('select count(*) from public.%I where id::text = $1', p_tabela) into qtd using p_id;
  if qtd = 0 then raise exception 'Registro não encontrado.'; end if;

  plano := exclusao_plano(p_tabela, p_id);
  -- Condição de cada passo sem repetir linhas que outro passo da mesma tabela já pegou
  -- (tabelas de ligação podem ser alcançadas por dois caminhos).
  declare ja jsonb := '{}'; cond text; novos jsonb := '[]';
  begin
    for passo in select * from jsonb_array_elements(plano -> 'passos') loop
      cond := exclusao_onde(passo);
      novos := novos || jsonb_set(passo, '{onde}', to_jsonb(case when ja ? (passo ->> 't') then format('(%s) and not (%s)', cond, ja ->> (passo ->> 't')) else cond end));
      ja := jsonb_set(ja, array[passo ->> 't'], to_jsonb(case when ja ? (passo ->> 't') then format('%s or %s', ja ->> (passo ->> 't'), cond) else cond end));
    end loop;
    plano := jsonb_set(plano, '{passos}', novos);
  end;
  for passo in select * from jsonb_array_elements(plano -> 'passos') loop
    execute format('select count(*) from public.%I where %s', passo ->> 't', passo ->> 'onde') into qtd;
    resumo := jsonb_set(resumo, array[passo ->> 't'], to_jsonb(coalesce((resumo ->> (passo ->> 't'))::integer, 0) + qtd));
    total := total + qtd;
    tabelas := tabelas || (passo ->> 't');
  end loop;
  if not p_confirmar then
    return jsonb_build_object('resumo', resumo, 'total', total);
  end if;

  -- Guarda os dados completos, na ordem pais → filhos.
  linhas := '[]';
  for passo in select * from jsonb_array_elements(plano -> 'passos') loop
    declare r jsonb;
    begin
      execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from public.%I x where %s', passo ->> 't', passo ->> 'onde') into r;
      linhas := linhas || jsonb_build_object('t', passo ->> 't', 'linhas', r);
    end;
  end loop;
  insert into lixeira (tabela, registro_id, nome, resumo, passos, religar)
  values (p_tabela, p_id, p_nome, resumo, linhas, plano -> 'religar') returning id into v_lixeira;

  -- Exclui dos filhos para os pais, atravessando as travas de histórico só agora.
  perform travas(tabelas, false);
  set constraints all deferred;
  -- Exclui em rodadas, dos filhos para os pais, até não sobrar nada.
  declare pend integer[] := array(select g from generate_series(jsonb_array_length(plano -> 'passos') - 1, 0, -1) g);
          resto integer[]; rodada integer := 0;
  begin
    while array_length(pend, 1) > 0 loop
      rodada := rodada + 1;
      resto := '{}';
      foreach i in array pend loop
        passo := plano -> 'passos' -> i;
        begin
          execute format('delete from public.%I where %s', passo ->> 't', exclusao_onde(passo));
        exception when foreign_key_violation then
          resto := resto || i;
        end;
      end loop;
      if array_length(resto, 1) = array_length(pend, 1) or rodada > 20 then
        raise exception 'Não foi possível excluir: há registros ligados que impedem (%).', (select string_agg(distinct plano -> 'passos' -> x ->> 't', ', ') from unnest(resto) x);
      end if;
      pend := resto;
    end loop;
  end;
  set constraints all immediate;
  perform travas(tabelas, true);
  return jsonb_build_object('lixeira_id', v_lixeira, 'resumo', resumo, 'total', total);
end $$;

/** Devolve tudo o que uma exclusão tirou, na ordem pais → filhos, e religa o que perdeu a ligação. */
create or replace function public.restaurar_lixeira(p_lixeira uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l lixeira; passo jsonb; cols text; tabelas text[] := '{}'; r jsonb; k text; v text;
begin
  if not eh_admin() then raise exception 'Só o administrador pode restaurar.'; end if;
  select * into l from lixeira where id = p_lixeira for update;
  if l.id is null then raise exception 'Item da lixeira não encontrado.'; end if;
  if l.restaurado_em is not null then raise exception 'Este item já foi restaurado.'; end if;
  select array_agg(x ->> 't') into tabelas from jsonb_array_elements(l.passos) x;
  perform travas(tabelas, false);
  set constraints all deferred;
  -- 1) insere em rodadas (pais antes dos filhos);
  declare pend integer[] := array(select g from generate_series(0, jsonb_array_length(l.passos) - 1) g);
          resto integer[]; rodada integer := 0; i integer; exprs text; ultimo text;
  begin
    while array_length(pend, 1) > 0 loop
      rodada := rodada + 1;
      resto := '{}';
      foreach i in array pend loop
        passo := l.passos -> i;
        if jsonb_array_length(passo -> 'linhas') = 0 then continue; end if;
        select string_agg(quote_ident(attname), ', ' order by attnum), string_agg('x.' || quote_ident(attname), ', ' order by attnum)
          into cols, exprs
        from pg_attribute where attrelid = ('public.' || quote_ident(passo ->> 't'))::regclass and attnum > 0 and not attisdropped and attgenerated = '';
        begin
          execute format('insert into public.%I (%s) overriding system value select %s from jsonb_populate_recordset(null::public.%I, $1) x',
            passo ->> 't', cols, exprs, passo ->> 't') using passo -> 'linhas';
        exception when foreign_key_violation then
          resto := resto || i;
          ultimo := coalesce(ultimo || ' | ', '') || (passo ->> 't') || ': ' || sqlerrm;
        end;
      end loop;
      if array_length(resto, 1) = array_length(pend, 1) or rodada > 20 then
        raise exception 'Não foi possível restaurar: algum registro ligado não existe mais (%).', ultimo;
      end if;
      pend := resto;
    end loop;
  end;
  for r in select * from jsonb_array_elements(l.religar) loop
    for k, v in select * from jsonb_each_text(r -> 'valores') loop
      execute format('update public.%I set %I = $1::%s where id::text = $2 and %I is null', r ->> 't', r ->> 'col',
        (select format_type(atttypid, atttypmod) from pg_attribute where attrelid = ('public.' || quote_ident(r ->> 't'))::regclass and attname = r ->> 'col'),
        r ->> 'col') using v, k;
    end loop;
  end loop;
  set constraints all immediate;
  perform travas(tabelas, true);
  update lixeira set restaurado_em = now(), restaurado_por = auth.uid() where id = p_lixeira;
  return jsonb_build_object('ok', true, 'tabela', l.tabela, 'registro_id', l.registro_id);
end $$;

revoke all on function public.excluir_registro(text, text, boolean, text) from public, anon;
revoke all on function public.restaurar_lixeira(uuid) from public, anon;
revoke all on function public.exclusao_plano(text, text) from public, anon, authenticated;
revoke all on function public.travas(text[], boolean) from public, anon, authenticated;
grant execute on function public.excluir_registro(text, text, boolean, text) to authenticated;
grant execute on function public.restaurar_lixeira(uuid) to authenticated;
