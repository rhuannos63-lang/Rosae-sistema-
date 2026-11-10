-- Agenda: tarefas do dia a dia (manuais) e automáticas, fila de trabalhos para encaixar as
-- propostas novas sem conflito, agenda reservada quando a proposta é aceita e avisos no
-- celular (resumo do dia, lembretes e atrasos).

-- ---------------------------------------------------------------------
-- Configuração da agenda (uma linha só)
-- ---------------------------------------------------------------------
create table public.agenda_config (
  id integer primary key default 1 check (id = 1),
  -- Quantos trabalhos andam ao mesmo tempo. 1 = um depois do outro.
  paralelos integer not null default 1 check (paralelos between 1 and 10),
  -- Propostas enviadas e em negociação também reservam a agenda (se forem aceitas, já cabem).
  contar_em_aberto boolean not null default true,
  -- Dias entre o envio da proposta e o início mais cedo possível (aceite, sinal, informações).
  antecedencia_dias integer not null default 5 check (antecedencia_dias between 0 and 90),
  -- Folga entre um trabalho e o próximo.
  intervalo_dias integer not null default 0 check (intervalo_dias between 0 and 60),
  -- Hora do resumo do dia no celular (horário de Brasília).
  resumo_hora integer not null default 7 check (resumo_hora between 0 and 23),
  avisar_resumo boolean not null default true,
  avisar_atrasos boolean not null default true,
  atualizado_em timestamptz not null default now()
);
insert into public.agenda_config (id) values (1);
alter table public.agenda_config enable row level security;
create policy agenda_config_ler on public.agenda_config for select to authenticated using (eh_equipe_adm());
create policy agenda_config_editar on public.agenda_config for update to authenticated using (eh_equipe_adm()) with check (eh_equipe_adm());
grant select, update on public.agenda_config to authenticated;
create trigger agenda_config_atualizado before update on public.agenda_config
  for each row execute function public.tocar_atualizado_em();

-- ---------------------------------------------------------------------
-- Tarefas (manuais e automáticas)
-- ---------------------------------------------------------------------
create table public.tarefa (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (length(trim(titulo)) > 0),
  notas text,
  data date not null,
  data_fim date,
  hora time,
  hora_fim time,
  -- trabalho = período reservado para executar uma proposta aceita (antes de virar obra).
  categoria text not null default 'tarefa' check (categoria in ('tarefa', 'reuniao', 'visita', 'ligacao', 'prazo', 'pessoal', 'trabalho')),
  prioridade smallint not null default 2 check (prioridade between 1 and 3),
  repetir text not null default 'nao' check (repetir in ('nao', 'diaria', 'dias_uteis', 'semanal', 'mensal')),
  repetir_ate date,
  concluida boolean not null default false,
  concluida_em timestamptz,
  -- Tarefas que se repetem: dias já feitos.
  concluidas date[] not null default '{}',
  -- Minutos antes da hora para avisar no celular (só com hora).
  lembrete_min integer check (lembrete_min is null or lembrete_min between 0 and 10080),
  obra_id uuid references public.obra (id) on delete cascade,
  proposta_id uuid references public.proposta (id) on delete cascade,
  origem text not null default 'manual' check (origem in ('manual', 'automatica')),
  -- Tarefas automáticas: identificam a origem e não duplicam.
  chave text unique,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint tarefa_periodo check (data_fim is null or data_fim >= data),
  constraint tarefa_horas check (hora_fim is null or hora is null or hora_fim >= hora or data_fim > data),
  constraint tarefa_repetir check (repetir = 'nao' or data_fim is null)
);
create index tarefa_data on public.tarefa (data);
create index tarefa_proposta on public.tarefa (proposta_id);
create index tarefa_obra on public.tarefa (obra_id);
create trigger tarefa_atualizado before update on public.tarefa
  for each row execute function public.tocar_atualizado_em();

create or replace function public.tarefa_antes()
returns trigger language plpgsql as $$
begin
  if new.concluida and (tg_op = 'INSERT' or not old.concluida) then new.concluida_em := now(); end if;
  if not new.concluida then new.concluida_em := null; end if;
  new.titulo := trim(new.titulo);
  return new;
end $$;
create trigger tarefa_antes before insert or update on public.tarefa
  for each row execute function public.tarefa_antes();

alter table public.tarefa enable row level security;
create policy tarefa_ler on public.tarefa for select to authenticated using (eh_equipe_adm());
create policy tarefa_incluir on public.tarefa for insert to authenticated with check (eh_equipe_adm());
create policy tarefa_editar on public.tarefa for update to authenticated using (eh_equipe_adm()) with check (eh_equipe_adm());
create policy tarefa_apagar on public.tarefa for delete to authenticated using (eh_equipe_adm());
grant select, insert, update, delete on public.tarefa to authenticated;

-- ---------------------------------------------------------------------
-- Fila de trabalhos: o que ocupa a agenda e quando ela fica livre
-- ---------------------------------------------------------------------
-- Dias de execução de uma versão de proposta (prazo total, soma das etapas ou 30).
create or replace function public.dias_da_versao(p_conteudo jsonb)
returns integer language sql immutable as $$
  select greatest(1, coalesce(
    nullif(nullif(p_conteudo->>'prazo_total_dias', ''), 'null')::numeric::int,
    nullif((select sum(coalesce(nullif(nullif(e->>'prazo_dias', ''), 'null')::numeric, 0))::int
            from jsonb_array_elements(case when jsonb_typeof(p_conteudo->'etapas') = 'array' then p_conteudo->'etapas' else '[]'::jsonb end) e), 0),
    30))
$$;

-- Primeiro dia em que uma das vagas fica livre, dado o fim de cada trabalho em andamento.
create or replace function public.agenda_vaga(p_fins date[], p_paralelos int, p_minimo date, p_intervalo int)
returns date language sql immutable as $$
  select greatest(p_minimo, coalesce((
    select f + 1 + p_intervalo from unnest(p_fins) f where f >= p_minimo - 1 order by f desc offset greatest(p_paralelos, 1) - 1 limit 1
  ), p_minimo))
$$;

-- Fila interna (sem conferir quem chama): usada pela tela (via agenda_fila) e pelo aceite.
create or replace function public.agenda_fila_interna(p_ignorar uuid default null, p_dias int default null, p_minimo date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  cfg agenda_config; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_fila jsonb := '[]'; v_fins date[] := '{}'; v_sem_data jsonb := '[]';
  r record; v_ini date; v_fim date; v_livre date; v_min date; v_dias int;
begin
  select * into cfg from agenda_config where id = 1;
  -- 1. Obras em andamento (aprovadas, contratadas ou em execução). Etapas concluídas não ocupam.
  for r in
    select o.id, o.codigo, o.nome, o.status, o.data_inicio, o.data_previsao_fim,
           (select coalesce(min(e.inicio_previsto), min(e.inicio_real)) from etapa e where e.obra_id = o.id and e.estado not in ('cancelado')) as ini_etapas,
           (select max(e.fim_previsto) from etapa e where e.obra_id = o.id and e.estado not in ('executado', 'conferido', 'cancelado')) as fim_aberto,
           (select sum(coalesce(e.duracao_dias, 0)) from etapa e where e.obra_id = o.id and e.estado not in ('executado', 'conferido', 'cancelado')) as dias_abertos,
           (select count(*) from etapa e where e.obra_id = o.id and e.estado not in ('executado', 'conferido', 'cancelado')) as abertas
    from obra o
    where o.status in ('aprovada', 'contratada', 'em_execucao')
      and (p_ignorar is null or o.id not in (select obra_id from proposta where id = p_ignorar and obra_id is not null))
  loop
    if r.abertas = 0 and r.ini_etapas is not null then continue; end if; -- tudo feito: adiantada, já liberou a agenda
    v_fim := coalesce(r.fim_aberto, r.data_previsao_fim, case when r.dias_abertos > 0 then greatest(v_hoje, coalesce(r.data_inicio, v_hoje)) + r.dias_abertos::int - 1 end);
    if v_fim is null then
      v_sem_data := v_sem_data || jsonb_build_object('id', r.id, 'titulo', r.codigo || ' · ' || r.nome, 'link', '/obras/' || r.id || '?aba=cronograma');
      continue;
    end if;
    v_fim := greatest(v_fim, v_hoje); -- atrasada: ainda ocupa até ser concluída
    v_ini := least(coalesce(r.ini_etapas, r.data_inicio, v_hoje), v_fim);
    v_fins := v_fins || v_fim;
    v_fila := v_fila || jsonb_build_object('tipo', 'obra', 'situacao', r.status, 'id', r.id, 'titulo', r.codigo || ' · ' || r.nome,
      'inicio', v_ini, 'fim', v_fim, 'atrasada', coalesce(r.fim_aberto, r.data_previsao_fim) < v_hoje, 'link', '/obras/' || r.id || '?aba=cronograma');
  end loop;

  -- 2. Propostas aceitas que ainda não viraram obra: o período reservado na agenda.
  for r in
    select p.id, p.codigo, p.titulo, p.aprovada_em, v.conteudo,
           (select min(t.data) from tarefa t where t.proposta_id = p.id and t.categoria = 'trabalho') as t_ini,
           (select max(coalesce(t.data_fim, t.data)) from tarefa t where t.proposta_id = p.id and t.categoria = 'trabalho') as t_fim
    from proposta p join proposta_versao v on v.id = p.versao_aprovada_id
    where p.tipo = 'proposta' and p.estado = 'aprovada' and p.id is distinct from p_ignorar
      and not exists (select 1 from obra o where o.proposta_versao_id = p.versao_aprovada_id)
      and p.obra_id is null
  loop
    v_ini := coalesce(r.t_ini, nullif(r.conteudo->>'data_inicio', '')::date, (r.aprovada_em at time zone 'America/Sao_Paulo')::date);
    v_fim := coalesce(r.t_fim, v_ini + dias_da_versao(r.conteudo) - 1);
    if v_fim < v_hoje then continue; end if;
    v_fins := v_fins || v_fim;
    v_fila := v_fila || jsonb_build_object('tipo', 'proposta', 'situacao', 'aceita', 'id', r.id, 'titulo', r.codigo || ' · ' || r.titulo,
      'inicio', v_ini, 'fim', v_fim, 'link', '/propostas/' || r.id);
  end loop;

  -- 3. Propostas em aberto (enviadas ou em negociação, dentro da validade): reservam em seguida, por ordem de envio.
  if cfg.contar_em_aberto then
    for r in
      select p.id, p.codigo, p.titulo, v.conteudo, v.validade
      from proposta p
      join lateral (select * from proposta_versao x where x.proposta_id = p.id and x.emitida order by x.numero desc limit 1) v on true
      where p.tipo = 'proposta' and p.estado in ('enviada', 'em_negociacao') and p.id is distinct from p_ignorar
        and (v.validade is null or v.validade >= v_hoje)
      order by v.emitida_em nulls last, p.criado_em
    loop
      v_livre := agenda_vaga(v_fins, cfg.paralelos, v_hoje, cfg.intervalo_dias);
      v_ini := greatest(coalesce(nullif(r.conteudo->>'data_inicio', '')::date, v_livre), v_livre);
      v_fim := v_ini + dias_da_versao(r.conteudo) - 1;
      v_fins := v_fins || v_fim;
      v_fila := v_fila || jsonb_build_object('tipo', 'proposta', 'situacao', 'em_aberto', 'id', r.id, 'titulo', r.codigo || ' · ' || r.titulo,
        'inicio', v_ini, 'fim', v_fim, 'validade', r.validade, 'link', '/propostas/' || r.id);
    end loop;
  end if;

  v_min := coalesce(p_minimo, v_hoje + cfg.antecedencia_dias);
  v_livre := agenda_vaga(v_fins, cfg.paralelos, v_min, cfg.intervalo_dias);
  v_dias := p_dias;
  return jsonb_build_object(
    'hoje', v_hoje, 'livre', v_livre,
    'fim', case when v_dias > 0 then v_livre + v_dias - 1 end,
    'paralelos', cfg.paralelos, 'contar_em_aberto', cfg.contar_em_aberto, 'antecedencia_dias', cfg.antecedencia_dias, 'intervalo_dias', cfg.intervalo_dias,
    'fila', (select coalesce(jsonb_agg(x order by x->>'inicio', x->>'fim'), '[]') from jsonb_array_elements(v_fila) x),
    'sem_data', v_sem_data);
end $$;
revoke execute on function public.agenda_fila_interna(uuid, int, date) from public, anon, authenticated;

-- Para a tela: quando a agenda fica livre para um trabalho de p_dias (ignorando a própria proposta).
create or replace function public.agenda_fila(p_ignorar uuid default null, p_dias int default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not eh_equipe_adm() then raise exception 'Sem permissão.'; end if;
  return agenda_fila_interna(p_ignorar, p_dias, null);
end $$;
grant execute on function public.agenda_fila(uuid, int) to authenticated;

-- ---------------------------------------------------------------------
-- Proposta aceita: reserva a agenda e cria as tarefas do que fazer
-- ---------------------------------------------------------------------
create or replace function public.agenda_ao_aceitar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v proposta_versao; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_fila jsonb; v_livre date; v_ini date; v_pedido date; v_cursor date; v_dias int; v_n int := 0; et jsonb; v_d int;
  v_total_etapas int; v_nota text;
begin
  select * into v from proposta_versao where id = new.versao_aprovada_id;
  if v.id is null then return new; end if;

  if new.tipo = 'aditivo' then
    insert into tarefa (titulo, notas, data, categoria, prioridade, obra_id, proposta_id, origem, chave)
    values ('Incorporar o aditivo ' || coalesce(new.codigo, '') || ' à obra', 'Aditivo aceito: ' || new.titulo
              || coalesce('. Impacto no prazo: ' || nullif(v.conteudo->>'impacto_prazo_dias', '') || ' dia(s).', '.'),
            v_hoje, 'tarefa', 1, new.obra_id, new.id, 'automatica', 'aceite:' || new.id || ':incorporar')
    on conflict (chave) do nothing;
    return new;
  end if;

  -- Já reservada (aceite repetido): não mexe.
  if exists (select 1 from tarefa where proposta_id = new.id and categoria = 'trabalho') then return new; end if;
  -- Já virou obra: as etapas da obra é que ocupam a agenda.
  if exists (select 1 from obra where proposta_versao_id = v.id) then return new; end if;

  v_dias := dias_da_versao(v.conteudo);
  v_fila := agenda_fila_interna(new.id, v_dias, v_hoje + 1);
  v_livre := (v_fila->>'livre')::date;
  v_pedido := nullif(v.conteudo->>'data_inicio', '')::date;
  v_ini := greatest(coalesce(v_pedido, v_livre), v_livre);
  if v_pedido is not null and v_ini > v_pedido then
    v_nota := 'O início previsto na proposta era ' || to_char(v_pedido, 'DD/MM/YYYY') || ', mas a agenda estava ocupada: reservei a partir de '
              || to_char(v_ini, 'DD/MM/YYYY') || '. Combine a data com o cliente.';
  end if;

  -- Uma faixa por etapa da proposta, uma depois da outra.
  v_cursor := v_ini;
  select count(*) into v_total_etapas from jsonb_array_elements(case when jsonb_typeof(v.conteudo->'etapas') = 'array' then v.conteudo->'etapas' else '[]'::jsonb end);
  if v_total_etapas > 0 then
    for et in select * from jsonb_array_elements(v.conteudo->'etapas') loop
      v_n := v_n + 1;
      v_d := coalesce(nullif(nullif(et->>'prazo_dias', ''), 'null')::numeric::int, greatest(1, v_dias / v_total_etapas));
      if v_d < 1 then v_d := 1; end if;
      insert into tarefa (titulo, notas, data, data_fim, categoria, proposta_id, origem, chave)
      values (coalesce(nullif(trim(et->>'nome'), ''), 'Etapa ' || v_n) || ' · ' || new.titulo,
              concat_ws(E'\n', nullif(trim(et->>'descricao'), ''), new.codigo || ' · etapa ' || v_n || ' de ' || v_total_etapas, case when v_n = 1 then v_nota end),
              v_cursor, v_cursor + v_d - 1, 'trabalho', new.id, 'automatica', 'trabalho:' || new.id || ':' || v_n)
      on conflict (chave) do nothing;
      v_cursor := v_cursor + v_d;
    end loop;
  else
    insert into tarefa (titulo, notas, data, data_fim, categoria, proposta_id, origem, chave)
    values ('Execução · ' || new.titulo, concat_ws(E'\n', new.codigo, v_nota), v_ini, v_ini + v_dias - 1, 'trabalho', new.id, 'automatica', 'trabalho:' || new.id || ':1')
    on conflict (chave) do nothing;
  end if;

  -- O que fazer agora.
  insert into tarefa (titulo, notas, data, categoria, prioridade, proposta_id, origem, chave) values
    ('Converter ' || coalesce(new.codigo, 'a proposta') || ' em obra e preparar o contrato',
     'Proposta aceita por ' || coalesce(new.aprovada_por_nome, 'cliente') || '. Ao converter, as etapas entram no cronograma da obra com as datas reservadas na agenda.',
     v_hoje, 'tarefa', 1, new.id, 'automatica', 'aceite:' || new.id || ':converter'),
    ('Confirmar o início com o cliente · ' || new.titulo,
     'Início reservado em ' || to_char(v_ini, 'DD/MM/YYYY') || ' e entrega prevista em ' || to_char(v_cursor - 1, 'DD/MM/YYYY') || '.' || coalesce(' ' || v_nota, ''),
     greatest(v_hoje, least(v_ini - 2, v_hoje + 2)), 'ligacao', 2, new.id, 'automatica', 'aceite:' || new.id || ':confirmar')
  on conflict (chave) do nothing;
  return new;
end $$;
create trigger proposta_agenda_aceite after update of versao_aprovada_id on public.proposta
  for each row when (new.versao_aprovada_id is not null and new.versao_aprovada_id is distinct from old.versao_aprovada_id)
  execute function public.agenda_ao_aceitar();

-- ---------------------------------------------------------------------
-- Proposta vira obra: as etapas recebem as datas reservadas
-- ---------------------------------------------------------------------
-- Encadeia as etapas sem data, na ordem dos serviços, a partir de p_inicio.
create or replace function public.agendar_etapas_sem_data(p_obra uuid, p_inicio date default null, p_total_dias int default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_cursor date; v_ini date; e record; v_d int; v_padrao int; v_n int := 0;
  v_conhecidos int; v_sem int;
begin
  if not eh_equipe_adm() then raise exception 'Sem permissão.'; end if;
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
grant execute on function public.agendar_etapas_sem_data(uuid, date, int) to authenticated;

alter function public.converter_proposta(uuid) rename to converter_proposta_base;
revoke execute on function public.converter_proposta_base(uuid) from public, anon, authenticated;

create or replace function public.converter_proposta(p_versao uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_obra uuid; p proposta; v proposta_versao; v_ini date; v_fila jsonb;
begin
  v_obra := converter_proposta_base(p_versao);
  select * into v from proposta_versao where id = p_versao;
  select * into p from proposta where id = v.proposta_id;
  if p.tipo = 'proposta' then
    select min(data) into v_ini from tarefa where proposta_id = p.id and categoria = 'trabalho';
    if v_ini is null and not exists (select 1 from etapa where obra_id = v_obra and inicio_previsto is not null) then
      v_fila := agenda_fila_interna(p.id, dias_da_versao(v.conteudo), (now() at time zone 'America/Sao_Paulo')::date);
      v_ini := greatest(coalesce(nullif(v.conteudo->>'data_inicio', '')::date, (v_fila->>'livre')::date), (v_fila->>'livre')::date);
    end if;
    if v_ini is not null then perform agendar_etapas_sem_data(v_obra, v_ini, dias_da_versao(v.conteudo)); end if;
    -- As etapas da obra passam a ocupar a agenda no lugar da reserva.
    delete from tarefa where proposta_id = p.id and categoria = 'trabalho';
    update tarefa set concluida = true, obra_id = v_obra where chave = 'aceite:' || p.id || ':converter' and not concluida;
    update tarefa set obra_id = v_obra where proposta_id = p.id and obra_id is null;
  else
    perform agendar_etapas_sem_data(v_obra, null, dias_da_versao(v.conteudo));
    update tarefa set concluida = true where chave = 'aceite:' || p.id || ':incorporar' and not concluida;
  end if;
  return v_obra;
end $$;
grant execute on function public.converter_proposta(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Avisos da agenda no celular (a função "avisos" chama a cada 15 minutos)
-- ---------------------------------------------------------------------
create table public.agenda_avisado (
  chave text primary key,
  em timestamptz not null default now()
);
alter table public.agenda_avisado enable row level security;
revoke all on public.agenda_avisado from anon, authenticated;

-- A tarefa acontece neste dia? (considera as que se repetem)
create or replace function public.tarefa_no_dia(t tarefa, p_dia date)
returns boolean language sql immutable as $$
  select case
    when t.repetir = 'nao' then p_dia between t.data and coalesce(t.data_fim, t.data)
    when p_dia < t.data or (t.repetir_ate is not null and p_dia > t.repetir_ate) then false
    when t.repetir = 'diaria' then true
    when t.repetir = 'dias_uteis' then extract(isodow from p_dia) between 1 and 5
    when t.repetir = 'semanal' then extract(isodow from p_dia) = extract(isodow from t.data)
    when t.repetir = 'mensal' then extract(day from p_dia) = least(extract(day from t.data), extract(day from (date_trunc('month', p_dia) + interval '1 month - 1 day')))
    else false end
$$;

create or replace function public.brl(v numeric)
returns text language sql immutable as $$
  select 'R$ ' || replace(replace(replace(to_char(coalesce(v, 0), 'FM999,999,999,990.00'), ',', '#'), '.', ','), '#', '.')
$$;

-- Devolve só os avisos novos (marca cada um como avisado). Só a função do servidor chama.
create or replace function public.agenda_avisos_a_enviar(p_agora timestamptz default now())
returns table (chave text, titulo text, corpo text, url text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  cfg agenda_config; v_local timestamp := p_agora at time zone 'America/Sao_Paulo'; v_hoje date := v_local::date;
  v_hora int := extract(hour from v_local); r record; v_partes text[]; v_n int; v_rec numeric; v_pag numeric; v_atr int;
  v_dia text; v_lista text[];
begin
  select * into cfg from agenda_config where id = 1;
  v_dia := (array['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'])[extract(isodow from v_hoje)] || ', ' || to_char(v_hoje, 'DD/MM');

  -- Lembretes das tarefas com hora (a qualquer hora do dia).
  for r in
    select t.* from tarefa t
    where t.hora is not null and t.lembrete_min is not null and tarefa_no_dia(t, v_hoje)
      and not (t.repetir = 'nao' and t.concluida) and not (v_hoje = any (t.concluidas))
      and v_local >= (v_hoje + t.hora) - make_interval(mins => t.lembrete_min) and v_local <= (v_hoje + t.hora) + interval '2 hours'
  loop
    chave := 'lembrete:' || r.id || ':' || v_hoje;
    if not exists (select 1 from agenda_avisado a where a.chave = agenda_avisos_a_enviar.chave) then
      insert into agenda_avisado (chave) values (agenda_avisos_a_enviar.chave);
      titulo := case when v_local < v_hoje + r.hora then 'Às ' || to_char(r.hora, 'HH24:MI') || ': ' else 'Agora: ' end || r.titulo;
      corpo := coalesce(nullif(trim(r.notas), ''), 'Toque para abrir a agenda.');
      url := '/agenda?vista=dia&data=' || v_hoje;
      return next;
    end if;
  end loop;

  if v_hora < cfg.resumo_hora or v_hora >= 22 then return; end if;

  -- Resumo do dia (uma vez por dia, a partir da hora escolhida).
  if cfg.avisar_resumo and not exists (select 1 from agenda_avisado a where a.chave = 'resumo:' || v_hoje) then
    insert into agenda_avisado (chave) values ('resumo:' || v_hoje);
    v_partes := '{}';
    select count(*) into v_n from tarefa t where tarefa_no_dia(t, v_hoje) and t.categoria <> 'trabalho'
      and not (t.repetir = 'nao' and t.concluida) and not (v_hoje = any (t.concluidas));
    if v_n > 0 then v_partes := v_partes || (v_n || case when v_n = 1 then ' tarefa' else ' tarefas' end); end if;
    select count(*) into v_n from etapa e join obra o on o.id = e.obra_id
      where o.status in ('aprovada', 'contratada', 'em_execucao') and e.inicio_previsto = v_hoje and e.estado in ('nao_iniciado', 'programado');
    if v_n > 0 then v_partes := v_partes || (v_n || case when v_n = 1 then ' etapa começa' else ' etapas começam' end); end if;
    select count(*) into v_n from etapa e join obra o on o.id = e.obra_id
      where o.status in ('aprovada', 'contratada', 'em_execucao') and e.fim_previsto = v_hoje and e.estado not in ('executado', 'conferido', 'cancelado');
    if v_n > 0 then v_partes := v_partes || (v_n || case when v_n = 1 then ' etapa termina' else ' etapas terminam' end); end if;
    select count(*) into v_n from tarefa t where t.categoria = 'trabalho' and t.data = v_hoje;
    if v_n > 0 then v_partes := v_partes || (v_n || case when v_n = 1 then ' trabalho começa' else ' trabalhos começam' end); end if;
    select coalesce(sum(saldo) filter (where tipo = 'receber'), 0), coalesce(sum(saldo) filter (where tipo = 'pagar'), 0) into v_rec, v_pag
      from v_parcela where vencimento = v_hoje and situacao in ('aberta', 'parcial');
    if v_rec > 0 then v_partes := v_partes || ('receber ' || brl(v_rec)); end if;
    if v_pag > 0 then v_partes := v_partes || ('pagar ' || brl(v_pag)); end if;
    select count(*) into v_n from proposta p join lateral (select validade from proposta_versao x where x.proposta_id = p.id and x.emitida order by numero desc limit 1) v on true
      where p.estado in ('enviada', 'em_negociacao') and v.validade between v_hoje and v_hoje + 1;
    if v_n > 0 then v_partes := v_partes || (v_n || case when v_n = 1 then ' proposta vence' else ' propostas vencem' end || ' até amanhã'); end if;
    v_atr := (select count(*) from etapa e join obra o on o.id = e.obra_id where o.status in ('aprovada', 'contratada', 'em_execucao')
                and e.fim_previsto < v_hoje and e.estado not in ('executado', 'conferido', 'cancelado'))
           + (select count(*) from v_parcela where situacao = 'vencida')
           + (select count(*) from tarefa t where t.repetir = 'nao' and not t.concluida and t.categoria <> 'trabalho' and coalesce(t.data_fim, t.data) < v_hoje);
    chave := 'resumo:' || v_hoje;
    titulo := 'Sua agenda · ' || v_dia;
    corpo := case when array_length(v_partes, 1) is null then 'Nada marcado para hoje.' else initcap(left(array_to_string(v_partes, ' · '), 1)) || substr(array_to_string(v_partes, ' · '), 2) || '.' end
             || case when v_atr > 0 then ' ' || v_atr || case when v_atr = 1 then ' item atrasado.' else ' itens atrasados.' end else '' end;
    url := '/agenda?vista=dia';
    return next;
  end if;

  if not cfg.avisar_atrasos then return; end if;

  -- Atrasos novos: um aviso por item (agrupa quando são muitos de uma vez).
  create temp table if not exists _atrasos (chave text, titulo text, corpo text, url text) on commit drop;
  truncate _atrasos;
  insert into _atrasos
  select 'atraso:etapa:' || e.id || ':' || e.fim_previsto, 'Etapa atrasada: ' || e.nome,
         o.codigo || ' · ' || o.nome || ' · era para ' || to_char(e.fim_previsto, 'DD/MM'), '/obras/' || o.id || '?aba=cronograma'
  from etapa e join obra o on o.id = e.obra_id
  where o.status in ('aprovada', 'contratada', 'em_execucao') and e.fim_previsto < v_hoje and e.estado not in ('executado', 'conferido', 'cancelado');
  insert into _atrasos
  select 'atraso:parcela:' || p.id || ':' || p.vencimento,
         case when p.tipo = 'receber' then 'Recebimento atrasado: ' else 'Conta vencida: ' end || brl(p.saldo),
         p.descricao || coalesce(' · ' || p.pessoa_nome, '') || ' · venceu em ' || to_char(p.vencimento, 'DD/MM'), '/financeiro/' || p.lancamento_id
  from v_parcela p where p.situacao = 'vencida';
  insert into _atrasos
  select 'atraso:tarefa:' || t.id || ':' || coalesce(t.data_fim, t.data), 'Tarefa não feita: ' || t.titulo,
         'Era para ' || to_char(coalesce(t.data_fim, t.data), 'DD/MM') || '. Marque como feita ou escolha outra data.', '/agenda?vista=dia'
  from tarefa t where t.repetir = 'nao' and not t.concluida and t.categoria <> 'trabalho' and coalesce(t.data_fim, t.data) < v_hoje;
  delete from _atrasos x where exists (select 1 from agenda_avisado a where a.chave = x.chave);
  insert into agenda_avisado (chave) select x.chave from _atrasos x on conflict do nothing;
  select count(*) into v_n from _atrasos;
  if v_n between 1 and 3 then
    return query select x.chave, x.titulo, x.corpo, x.url from _atrasos x order by x.chave;
  elsif v_n > 3 then
    select array_agg(x.titulo order by x.chave) into v_lista from (select y.* from _atrasos y order by y.chave limit 3) x;
    chave := 'atrasos:' || v_hoje || ':' || v_n;
    titulo := v_n || ' itens atrasados na agenda';
    corpo := array_to_string(v_lista, ' · ') || ' e mais ' || (v_n - 3) || '.';
    url := '/agenda?vista=dia';
    return next;
  end if;
end $$;
revoke execute on function public.agenda_avisos_a_enviar(timestamptz) from public, anon, authenticated;
grant execute on function public.agenda_avisos_a_enviar(timestamptz) to service_role;

-- Período reservado de uma proposta aceita (para o aviso de aceite dizer quando entrou na agenda).
create or replace function public.agenda_reserva(p_proposta uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('inicio', min(data), 'fim', max(coalesce(data_fim, data)))
  from tarefa where proposta_id = p_proposta and categoria = 'trabalho'
$$;
revoke execute on function public.agenda_reserva(uuid) from public, anon, authenticated;
grant execute on function public.agenda_reserva(uuid) to service_role;
