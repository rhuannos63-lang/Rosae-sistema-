-- Iniciar, entregar e encerrar obra/serviço em um passo, e entrega de documentos ao cliente (2026-11-26).
--  * iniciar_obra: muda para "em execução" com a data escolhida, programa as etapas sem data a
--    partir dela e já começa a primeira etapa.
--  * entregar_obra: data da entrega, conclui as etapas que faltam e, se nada falta receber,
--    já encerra. encerrar_obra e reabrir_obra completam o ciclo.
--  * Entregas: arquivos (PDF, DWG, ZIP…) com uma mensagem pronta; o cliente baixa por um link
--    próprio (/e/<token>) que vai por e-mail e WhatsApp, e também pelo portal.
--  * Conserto da integração do PR #26 com a agenda (#15): a conversão no aceite passa a dar as
--    datas da agenda às etapas, como a conversão pelo botão já fazia.

-- ---------------------------------------------------------------------
-- 0. Agenda + conversão no aceite
-- ---------------------------------------------------------------------
-- Mesmo encadeamento de antes, sem a checagem de usuário (o aceite do cliente é anônimo).
create or replace function public.agendar_etapas_sem_data_interna(p_obra uuid, p_inicio date default null, p_total_dias int default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_cursor date; v_ini date; e record; v_d int; v_padrao int; v_n int := 0;
  v_conhecidos int; v_sem int;
begin
  v_cursor := coalesce(p_inicio, greatest(v_hoje, (select max(fim_previsto) + 1 from etapa where obra_id = p_obra and estado <> 'cancelado')), v_hoje);
  select coalesce(sum(duracao_dias), 0), count(*) filter (where duracao_dias is null) into v_conhecidos, v_sem
  from etapa where obra_id = p_obra and inicio_previsto is null and fim_previsto is null and estado not in ('cancelado', 'executado', 'conferido');
  v_padrao := case when v_sem > 0 and p_total_dias is not null and p_total_dias > v_conhecidos then greatest(1, (p_total_dias - v_conhecidos) / v_sem) else 7 end;
  v_ini := v_cursor;
  for e in
    select x.id, x.duracao_dias from etapa x join servico s on s.id = x.servico_id
    where x.obra_id = p_obra and x.inicio_previsto is null and x.fim_previsto is null and x.estado not in ('cancelado', 'executado', 'conferido')
    order by s.ordem, x.ordem
  loop
    v_d := coalesce(e.duracao_dias, v_padrao);
    update etapa set inicio_previsto = v_cursor, fim_previsto = v_cursor + v_d - 1 where id = e.id;
    v_cursor := v_cursor + v_d;
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then
    update obra set data_inicio = coalesce(data_inicio, v_ini), data_previsao_fim = coalesce(data_previsao_fim, v_cursor - 1) where id = p_obra;
  end if;
  return v_n;
end $$;
revoke execute on function public.agendar_etapas_sem_data_interna(uuid, date, int) from public, anon, authenticated;

create or replace function public.agendar_etapas_sem_data(p_obra uuid, p_inicio date default null, p_total_dias int default null)
returns integer language plpgsql security definer set search_path = public as $$
begin
  if not eh_equipe_adm() then raise exception 'Sem permissão.'; end if;
  return agendar_etapas_sem_data_interna(p_obra, p_inicio, p_total_dias);
end $$;
grant execute on function public.agendar_etapas_sem_data(uuid, date, int) to authenticated;

-- Conversão + agenda (núcleo do aceite e do botão): as etapas recebem as datas reservadas;
-- sem reserva, entram no primeiro espaço livre da agenda a partir de amanhã.
create or replace function public.converter_proposta_agendada(p_versao uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_obra uuid; p proposta; v proposta_versao; v_ini date; v_fila jsonb; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_reservada boolean; v_n int;
begin
  v_obra := converter_proposta_aceite(p_versao);
  select * into v from proposta_versao where id = p_versao;
  select * into p from proposta where id = v.proposta_id;
  if p.tipo = 'proposta' then
    select min(data) into v_ini from tarefa where proposta_id = p.id and categoria = 'trabalho';
    v_reservada := v_ini is not null;
    if v_ini is null and not exists (select 1 from etapa where obra_id = v_obra and inicio_previsto is not null) then
      v_fila := agenda_fila_interna(p.id, dias_da_versao(v.conteudo), v_hoje + 1);
      v_ini := greatest(coalesce(nullif(v.conteudo->>'data_inicio', '')::date, (v_fila->>'livre')::date), (v_fila->>'livre')::date);
    end if;
    if v_ini is not null then
      v_n := agendar_etapas_sem_data_interna(v_obra, v_ini, dias_da_versao(v.conteudo));
      if not v_reservada and v_n > 0 then
        insert into tarefa (titulo, notas, data, categoria, prioridade, obra_id, proposta_id, origem, chave)
        select 'Confirmar o início com o cliente · ' || p.titulo,
               'Início previsto em ' || to_char(o.data_inicio, 'DD/MM/YYYY') || ' e entrega em ' || to_char(o.data_previsao_fim, 'DD/MM/YYYY') || '.',
               greatest(v_hoje, least(o.data_inicio - 2, v_hoje + 2)), 'ligacao', 2, v_obra, p.id, 'automatica', 'aceite:' || p.id || ':confirmar'
        from obra o where o.id = v_obra and o.data_inicio is not null
        on conflict (chave) do nothing;
      end if;
    end if;
    -- As etapas da obra passam a ocupar a agenda no lugar da reserva.
    delete from tarefa where proposta_id = p.id and categoria = 'trabalho';
    update tarefa set concluida = true, obra_id = v_obra where chave = 'aceite:' || p.id || ':converter' and not concluida;
    update tarefa set obra_id = v_obra where proposta_id = p.id and obra_id is null;
  else
    perform agendar_etapas_sem_data_interna(v_obra, null, dias_da_versao(v.conteudo));
    update tarefa set concluida = true where chave = 'aceite:' || p.id || ':incorporar' and not concluida;
  end if;
  return v_obra;
end $$;
revoke execute on function public.converter_proposta_agendada(uuid) from public, anon, authenticated;

create or replace function public.converter_proposta(p_versao uuid)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not eh_equipe_adm() then raise exception 'Sem permissão.'; end if;
  return converter_proposta_agendada(p_versao);
end $$;
grant execute on function public.converter_proposta(uuid) to authenticated;

create or replace function public.lancar_receber_do_aceite(p_proposta uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare p proposta; v_obra uuid;
begin
  select * into p from proposta where id = p_proposta;
  if p.id is null or p.versao_aprovada_id is null or p.estado <> 'aprovada' then return null; end if;
  if p.tipo = 'aditivo' and p.obra_id is null then return null; end if;
  if proposta_ja_tem_receber(p.id, p.versao_aprovada_id) then return null; end if;
  if p.tipo = 'proposta' and exists (select 1 from obra where proposta_versao_id = p.versao_aprovada_id) then return null; end if;
  if p.tipo = 'aditivo' and exists (select 1 from servico where origem_versao_id = p.versao_aprovada_id) then return null; end if;
  begin
    v_obra := converter_proposta_agendada(p.versao_aprovada_id);
    set constraints public.lancamento_soma, public.parcela_soma immediate;
    set constraints public.lancamento_soma, public.parcela_soma deferred;
  exception when others then
    raise warning 'A receber do aceite da proposta % não foi lançado: %', p.codigo, sqlerrm;
    return null;
  end;
  return v_obra;
end $$;
revoke execute on function public.lancar_receber_do_aceite(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Iniciar, entregar, encerrar e reabrir
-- ---------------------------------------------------------------------
alter table public.obra add column if not exists entregue_em date;
alter table public.obra add column if not exists encerrada_em date;

-- Quanto ainda falta receber da obra (parcelas a receber em aberto). A interna serve às regras;
-- a pública só responde a quem tem acesso ao financeiro.
create or replace function public.obra_falta_receber_interna(p_obra uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(greatest(p.valor - coalesce(i.pago, 0), 0)), 0)
  from parcela p join lancamento l on l.id = p.lancamento_id
  left join v_parcela_interna i on i.id = p.id
  where l.obra_id = p_obra and l.tipo = 'receber' and not l.cancelado
$$;
revoke execute on function public.obra_falta_receber_interna(uuid) from public, anon, authenticated;
create or replace function public.obra_falta_receber(p_obra uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select case when tem_financeiro() then obra_falta_receber_interna(p_obra) end
$$;
revoke execute on function public.obra_falta_receber(uuid) from public, anon;
grant execute on function public.obra_falta_receber(uuid) to authenticated;

create or replace function public.iniciar_obra(p_obra uuid, p_data date default null, p_primeira_etapa boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o obra; v_data date := coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date); v_prog int := 0; v_etapa etapa;
begin
  if not eh_equipe_adm() then raise exception 'Só o escritório inicia a obra.'; end if;
  select * into o from obra where id = p_obra for update;
  if o.id is null then raise exception 'Obra não encontrada.'; end if;
  if o.status not in ('em_negociacao', 'aprovada', 'contratada') then raise exception 'Esta obra já foi iniciada.'; end if;
  if v_data > (now() at time zone 'America/Sao_Paulo')::date + 60 then raise exception 'Escolha uma data de início até 60 dias à frente.'; end if;
  update obra set status = 'em_execucao', data_inicio = v_data,
         liberada_em = coalesce(liberada_em, now()), liberada_por = coalesce(liberada_por, auth.uid())
   where id = p_obra;
  -- Etapas sem data passam a ser encadeadas a partir do início.
  v_prog := agendar_etapas_sem_data_interna(p_obra, v_data, null);
  if p_primeira_etapa and v_data <= (now() at time zone 'America/Sao_Paulo')::date then
    select x.* into v_etapa from etapa x join servico s on s.id = x.servico_id
     where x.obra_id = p_obra and x.estado in ('nao_iniciado', 'programado')
     order by x.inicio_previsto nulls last, s.ordem, x.ordem limit 1;
    if v_etapa.id is not null then
      update etapa set estado = 'em_execucao', inicio_real = v_data where id = v_etapa.id;
    end if;
  end if;
  insert into registro (obra_id, data, tipo, titulo, texto)
  values (p_obra, least(v_data, (now() at time zone 'America/Sao_Paulo')::date), 'sistema', 'Início registrado',
          'Início em ' || to_char(v_data, 'DD/MM/YYYY') || '.' || case when v_etapa.id is not null then ' Primeira etapa em andamento: ' || v_etapa.nome || '.' else '' end);
  return jsonb_build_object('programadas', v_prog, 'etapa', v_etapa.nome);
end $$;

create or replace function public.entregar_obra(p_obra uuid, p_data date default null, p_concluir_etapas boolean default true, p_obs text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o obra; v_data date := coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date); v_n int := 0; v_falta numeric; v_status text;
begin
  if not eh_equipe_adm() then raise exception 'Só o escritório registra a entrega.'; end if;
  select * into o from obra where id = p_obra for update;
  if o.id is null then raise exception 'Obra não encontrada.'; end if;
  if o.status in ('cancelada', 'concluida_fisicamente', 'encerrada_financeiramente') then raise exception 'Esta obra já foi entregue ou encerrada.'; end if;
  if v_data > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'A data da entrega não pode ser no futuro.'; end if;
  if o.data_inicio is not null and v_data < o.data_inicio then raise exception 'A entrega não pode ser antes do início (%).', to_char(o.data_inicio, 'DD/MM/YYYY'); end if;
  if p_concluir_etapas then
    update etapa set estado = 'executado', fim_real = v_data, inicio_real = least(coalesce(inicio_real, v_data), v_data),
           motivo_alteracao = 'Concluída na entrega'
     where obra_id = p_obra and estado not in ('executado', 'conferido', 'cancelado');
    get diagnostics v_n = row_count;
  end if;
  v_falta := obra_falta_receber_interna(p_obra);
  -- Nada a receber: entregue e encerrada de uma vez.
  v_status := case when v_falta = 0 then 'encerrada_financeiramente' else 'concluida_fisicamente' end;
  update obra set status = v_status, data_conclusao = v_data, entregue_em = v_data,
         data_inicio = coalesce(data_inicio, v_data),
         encerrada_em = case when v_status = 'encerrada_financeiramente' then v_data end
   where id = p_obra;
  insert into registro (obra_id, data, tipo, titulo, texto)
  values (p_obra, v_data, 'sistema', 'Entrega registrada',
          'Entregue em ' || to_char(v_data, 'DD/MM/YYYY') || '.' || case when v_n > 0 then ' ' || v_n || ' etapa(s) concluída(s) na entrega.' else '' end
          || case when v_status = 'encerrada_financeiramente' then ' Nada a receber: encerrada.' else '' end
          || coalesce(' ' || nullif(trim(p_obs), ''), ''));
  return jsonb_build_object('status', v_status, 'etapas_concluidas', v_n, 'falta_receber', case when tem_financeiro() then v_falta end);
end $$;

create or replace function public.encerrar_obra(p_obra uuid, p_data date default null)
returns void language plpgsql security definer set search_path = public as $$
declare o obra; v_data date := coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date);
begin
  if not eh_equipe_adm() then raise exception 'Só o escritório encerra a obra.'; end if;
  select * into o from obra where id = p_obra for update;
  if o.id is null then raise exception 'Obra não encontrada.'; end if;
  if o.status <> 'concluida_fisicamente' then raise exception 'Registre a entrega antes de encerrar.'; end if;
  update obra set status = 'encerrada_financeiramente', encerrada_em = v_data where id = p_obra;
  insert into registro (obra_id, data, tipo, titulo, texto)
  values (p_obra, least(v_data, (now() at time zone 'America/Sao_Paulo')::date), 'sistema', 'Obra encerrada', 'Encerrada em ' || to_char(v_data, 'DD/MM/YYYY') || '.');
end $$;

create or replace function public.reabrir_obra(p_obra uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o obra;
begin
  if not eh_equipe_adm() then raise exception 'Só o escritório reabre a obra.'; end if;
  select * into o from obra where id = p_obra for update;
  if o.id is null then raise exception 'Obra não encontrada.'; end if;
  if o.status not in ('concluida_fisicamente', 'encerrada_financeiramente') then raise exception 'Só dá para reabrir uma obra entregue ou encerrada.'; end if;
  update obra set status = 'em_execucao', data_conclusao = null, entregue_em = null, encerrada_em = null where id = p_obra;
  insert into registro (obra_id, tipo, titulo, texto)
  values (p_obra, 'sistema', 'Obra reaberta', coalesce(nullif(trim(p_motivo), ''), 'Reaberta pelo escritório.'));
end $$;

grant execute on function public.iniciar_obra(uuid, date, boolean), public.entregar_obra(uuid, date, boolean, text),
  public.encerrar_obra(uuid, date), public.reabrir_obra(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Entrega de documentos ao cliente
-- ---------------------------------------------------------------------
create table public.entrega (
  id uuid primary key default gen_random_uuid(),
  obra_id uuid not null references public.obra (id) on delete cascade,
  titulo text not null check (length(trim(titulo)) between 1 and 160),
  mensagem text not null default '' check (length(mensagem) <= 6000),
  no_portal boolean not null default true,
  email_para text,
  email_em timestamptz,
  email_erro text,
  whatsapp_em timestamptz,
  primeiro_acesso_em timestamptz,
  acessos integer not null default 0,
  downloads integer not null default 0,
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid()
);
create index entrega_obra_idx on public.entrega (obra_id, criado_em desc);

create table public.entrega_arquivo (
  id uuid primary key default gen_random_uuid(),
  entrega_id uuid not null references public.entrega (id) on delete cascade,
  caminho text not null unique,
  nome text not null check (length(trim(nome)) between 1 and 200),
  mime text,
  tamanho bigint,
  ordem integer not null default 0
);
create index entrega_arquivo_idx on public.entrega_arquivo (entrega_id, ordem);

create table public.entrega_link (
  id uuid primary key default gen_random_uuid(),
  entrega_id uuid not null references public.entrega (id) on delete cascade,
  token_hash text not null unique,
  canal text not null default 'link' check (canal in ('link', 'email', 'whatsapp')),
  expira_em timestamptz not null,
  criado_em timestamptz not null default now()
);

alter table public.entrega enable row level security;
alter table public.entrega_arquivo enable row level security;
alter table public.entrega_link enable row level security;
create policy entrega_ler on public.entrega for select to authenticated using (eh_equipe_adm());
create policy entrega_mudar on public.entrega for update to authenticated using (eh_equipe_adm()) with check (eh_equipe_adm());
create policy entrega_apagar on public.entrega for delete to authenticated using (eh_equipe_adm());
create policy entrega_arquivo_ler on public.entrega_arquivo for select to authenticated using (eh_equipe_adm());
grant select, update (titulo, mensagem, no_portal), delete on public.entrega to authenticated;
grant select on public.entrega_arquivo to authenticated;

-- Cria a entrega com os arquivos já enviados ao Storage (pasta obras/<obra>/entregas/).
create or replace function public.entrega_criar(p_obra uuid, p_titulo text, p_mensagem text, p_no_portal boolean, p_arquivos jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; a jsonb; v_n int := 0;
begin
  if not eh_equipe_adm() then raise exception 'Só o escritório entrega documentos.'; end if;
  if not exists (select 1 from obra where id = p_obra) then raise exception 'Obra não encontrada.'; end if;
  if jsonb_typeof(p_arquivos) <> 'array' or jsonb_array_length(p_arquivos) = 0 then raise exception 'Escolha pelo menos um arquivo.'; end if;
  if jsonb_array_length(p_arquivos) > 30 then raise exception 'No máximo 30 arquivos por entrega.'; end if;
  insert into entrega (obra_id, titulo, mensagem, no_portal)
  values (p_obra, trim(p_titulo), coalesce(p_mensagem, ''), coalesce(p_no_portal, true)) returning id into v_id;
  for a in select * from jsonb_array_elements(p_arquivos) loop
    if coalesce(a->>'caminho', '') not like 'obras/' || p_obra::text || '/entregas/%' or a->>'caminho' ~ '(^|/)\.\.(/|$)' then
      raise exception 'Arquivo fora da pasta da obra.';
    end if;
    insert into entrega_arquivo (entrega_id, caminho, nome, mime, tamanho, ordem)
    values (v_id, a->>'caminho', coalesce(nullif(trim(a->>'nome'), ''), 'Arquivo'), nullif(a->>'mime', ''), nullif(a->>'tamanho', '')::bigint, v_n);
    v_n := v_n + 1;
  end loop;
  insert into registro (obra_id, tipo, titulo, texto)
  values (p_obra, 'sistema', 'Documentos entregues', trim(p_titulo) || ' · ' || v_n || ' arquivo(s).');
  return v_id;
end $$;

-- Um link novo por envio (e-mail, WhatsApp): os anteriores continuam valendo.
create or replace function public.entrega_link_novo(p_entrega uuid, p_canal text default 'link', p_dias integer default 365)
returns text language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if not eh_equipe_adm() then raise exception 'Só o escritório cria o link da entrega.'; end if;
  if not exists (select 1 from entrega where id = p_entrega) then raise exception 'Entrega não encontrada.'; end if;
  v_token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  insert into entrega_link (entrega_id, token_hash, canal, expira_em)
  values (p_entrega, encode(extensions.digest(v_token, 'sha256'), 'hex'), coalesce(p_canal, 'link'),
          now() + make_interval(days => greatest(7, least(coalesce(p_dias, 365), 730))));
  return v_token;
end $$;

create or replace function public.entrega_marcar_envio(p_entrega uuid, p_canal text, p_destino text default null, p_erro text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not eh_equipe_adm() then raise exception 'Sem permissão.'; end if;
  if p_canal = 'email' then
    update entrega set email_para = coalesce(p_destino, email_para), email_em = case when p_erro is null then now() else email_em end,
           email_erro = p_erro where id = p_entrega;
  elsif p_canal = 'whatsapp' then
    update entrega set whatsapp_em = now() where id = p_entrega;
  end if;
end $$;

grant execute on function public.entrega_criar(uuid, text, text, boolean, jsonb), public.entrega_link_novo(uuid, text, integer),
  public.entrega_marcar_envio(uuid, text, text, text) to authenticated;

-- Interna: entrega do token (link próprio), ou nulo.
create or replace function public.entrega_do_token(p_token text)
returns uuid language sql stable security definer set search_path = public as $$
  select l.entrega_id from entrega_link l join entrega e on e.id = l.entrega_id join obra o on o.id = e.obra_id
  where l.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and l.expira_em > now()
    and not o.arquivado and o.status <> 'cancelada'
$$;
revoke execute on function public.entrega_do_token(text) from public, anon, authenticated;

create or replace function public.entrega_conteudo(p_entrega uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', e.id, 'titulo', e.titulo, 'mensagem', e.mensagem, 'criado_em', e.criado_em,
    'obra', o.nome, 'tipo_servico', o.tipo_servico, 'cliente', c.nome,
    'arquivos', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'nome', a.nome, 'mime', a.mime, 'tamanho', a.tamanho) order by a.ordem)
                          from entrega_arquivo a where a.entrega_id = e.id), '[]'::jsonb))
  from entrega e join obra o on o.id = e.obra_id left join pessoa c on c.id = o.cliente_id
  where e.id = p_entrega
$$;
revoke execute on function public.entrega_conteudo(uuid) from public, anon, authenticated;

-- Página pública da entrega (/e/<token>): sem login.
create or replace function public.entrega_publica(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  v_id := entrega_do_token(p_token);
  if v_id is null then return jsonb_build_object('erro', 'Link inválido ou expirado. Peça um novo link à ROSAE.'); end if;
  update entrega set acessos = acessos + 1, primeiro_acesso_em = coalesce(primeiro_acesso_em, now()) where id = v_id;
  return entrega_conteudo(v_id) || jsonb_build_object('empresa', empresa_publica());
end $$;
grant execute on function public.entrega_publica(text) to anon, authenticated;

-- Portal: entregas publicadas da obra do link pessoal.
create or replace function public.portal_entregas(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a portal_acesso;
begin
  a := portal_exigir(p_token);
  return coalesce((select jsonb_agg(entrega_conteudo(e.id) order by e.criado_em desc) from entrega e where e.obra_id = a.obra_id and e.no_portal), '[]'::jsonb);
end $$;
grant execute on function public.portal_entregas(text) to anon, authenticated;

-- Usada só pela função "entrega" (chave de serviço): o caminho do arquivo, se o token
-- (link da entrega ou link do portal) dá direito a ele. Conta o download.
create or replace function public.entrega_arquivo_permitido(p_token text, p_portal text, p_arquivo uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_entrega uuid; a entrega_arquivo; pa portal_acesso;
begin
  select * into a from entrega_arquivo where id = p_arquivo;
  if a.id is null then return null; end if;
  if p_token is not null then
    v_entrega := entrega_do_token(p_token);
    if v_entrega is distinct from a.entrega_id then return null; end if;
  elsif p_portal is not null then
    pa := portal_acesso_valido(p_portal);
    if pa.id is null or not exists (select 1 from entrega e where e.id = a.entrega_id and e.obra_id = pa.obra_id and e.no_portal) then return null; end if;
  else
    return null;
  end if;
  update entrega set downloads = downloads + 1 where id = a.entrega_id;
  return jsonb_build_object('caminho', a.caminho, 'nome', a.nome, 'mime', a.mime);
end $$;
revoke execute on function public.entrega_arquivo_permitido(text, text, uuid) from public, anon, authenticated;
grant execute on function public.entrega_arquivo_permitido(text, text, uuid) to service_role;

-- Arquivos da entrega: projetos costumam ser maiores (até 50 MB) e vir em DWG, DXF ou ZIP.
do $$ begin
  update storage.buckets set file_size_limit = 52428800,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif',
      'application/pdf', 'text/xml', 'application/xml',
      'application/zip', 'application/x-zip-compressed', 'application/octet-stream',
      'image/vnd.dwg', 'application/acad', 'application/dxf', 'image/vnd.dxf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/msword', 'application/vnd.ms-excel']
  where id = 'documentos';
exception when undefined_column or undefined_table then null;
end $$;
