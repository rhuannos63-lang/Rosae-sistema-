-- Agenda: tarefas só para a equipe do escritório; a proposta aceita reserva a agenda depois dos
-- trabalhos já aceitos; ao virar obra, as etapas recebem as datas; avisos do dia saem uma vez só.
create or replace function pg_temp.como(p_usuario uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_usuario::text, ''), false);
  if p_usuario is null then execute 'set role anon'; else execute 'set role authenticated'; end if;
end $$;
create or replace function pg_temp.deve_falhar(p_sql text, p_motivo text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then return; end;
  raise exception 'FALHOU: deveria ter sido recusado: %', p_motivo;
end $$;
create or replace function pg_temp.igual(p_obtido anyelement, p_esperado anyelement, p_motivo text) returns void language plpgsql as $$
begin
  if p_obtido is distinct from p_esperado then
    raise exception 'FALHOU: % (obtido %, esperado %)', p_motivo, p_obtido, p_esperado;
  end if;
end $$;
-- Proposta emitida com etapas (dias) e aceita pelo link do cliente.
create or replace function pg_temp.proposta(p_titulo text, p_etapas int[], p_inicio date default null, p_aceitar boolean default true) returns uuid language plpgsql as $$
declare v_p uuid; v_v uuid; v_tok text;
begin
  perform pg_temp.como('00000000-0000-0000-0000-00000000000a');
  insert into public.proposta (pessoa_id, titulo) values ('10000000-0000-0000-0000-000000000001', p_titulo) returning id into v_p;
  v_v := public.nova_versao_proposta(v_p);
  update public.proposta_versao set valor_total = 1000, conteudo = jsonb_build_object('validade_dias', 15, 'data_inicio', p_inicio,
    'prazo_total_dias', (select sum(x) from unnest(p_etapas) x),
    'etapas', (select jsonb_agg(jsonb_build_object('nome', 'Etapa ' || k, 'prazo_dias', d) order by k) from unnest(p_etapas) with ordinality u(d, k)),
    'ambientes', jsonb_build_array(jsonb_build_object('nome', 'Geral', 'itens', jsonb_build_array(jsonb_build_object('id', 'i1', 'titulo', 'Serviço', 'unidade', 'vb', 'quantidade', 1, 'total', 1000,
      'etapas', (select jsonb_agg(jsonb_build_object('nome', 'Etapa ' || k, 'duracao_dias', d, 'percentual', 50) order by k) from unnest(p_etapas) with ordinality u(d, k)))))))
  where id = v_v;
  perform public.emitir_versao(v_v);
  if p_aceitar then
    v_tok := public.criar_link_proposta(v_v, 30);
    perform pg_temp.como(null);
    perform public.proposta_responder(v_tok, 'aceitar', 'Cliente Fictício', null, null, null);
  else
    update public.proposta set estado = 'enviada' where id = v_p;
  end if;
  perform pg_temp.como('00000000-0000-0000-0000-00000000000a');
  return v_p;
end $$;
create temp table t (k text primary key, v text);
grant all on t to anon, authenticated;
grant execute on all functions in schema pg_temp to anon, authenticated;

-- Começa com a agenda limpa (os testes anteriores deixam obras e propostas em andamento).
set session_replication_role = replica;
update public.obra set status = 'concluida_fisicamente' where status in ('aprovada', 'contratada', 'em_execucao');
update public.proposta set estado = 'arquivada' where estado in ('enviada', 'em_negociacao', 'aprovada');
set session_replication_role = origin;

-- Tarefas manuais: escritório cria e edita; campo e visitante não.
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
update public.agenda_config set antecedencia_dias = 0, contar_em_aberto = true, paralelos = 1, intervalo_dias = 0;
insert into public.tarefa (titulo, data, hora, lembrete_min) values ('Ligar para o fornecedor', current_date, '09:00', 30);
select pg_temp.igual((select count(*) from public.tarefa where origem = 'manual'), 1::bigint, 'tarefa manual criada');
select pg_temp.deve_falhar($$ insert into public.tarefa (titulo, data, data_fim) values ('Errada', current_date, current_date - 1) $$, 'fim antes do início');
select pg_temp.como('00000000-0000-0000-0000-00000000000d');
select pg_temp.igual((select count(*) from public.tarefa), 0::bigint, 'campo não vê as tarefas do escritório');
select pg_temp.deve_falhar($$ insert into public.tarefa (titulo, data) values ('X', current_date) $$, 'campo não cria tarefa');
select pg_temp.deve_falhar($$ select public.agenda_fila() $$, 'campo não vê a fila');
select pg_temp.como(null);
select pg_temp.deve_falhar($$ select public.agenda_fila() $$, 'visitante não vê a fila');
select pg_temp.deve_falhar($$ select * from public.agenda_avisos_a_enviar() $$, 'só o servidor gera avisos');

-- Agenda vazia: livre já (antecedência zero).
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.igual((public.agenda_fila(null, 10)->>'livre')::date, (now() at time zone 'America/Sao_Paulo')::date, 'agenda vazia: livre hoje');

-- 1ª proposta aceita (10 + 5 dias): reserva a partir de amanhã, uma faixa por etapa, e cria as tarefas.
insert into t select 'p1', pg_temp.proposta('Projeto A (fictício)', array[10, 5])::text;
insert into t values ('d0', ((now() at time zone 'America/Sao_Paulo')::date)::text);
select pg_temp.igual((select count(*) from public.tarefa where proposta_id = (select v::uuid from t where k = 'p1') and categoria = 'trabalho'), 2::bigint, 'duas faixas reservadas');
select pg_temp.igual((select min(data) from public.tarefa where proposta_id = (select v::uuid from t where k = 'p1') and categoria = 'trabalho'), (select v::date + 1 from t where k = 'd0'), 'começa amanhã');
select pg_temp.igual((select max(data_fim) from public.tarefa where proposta_id = (select v::uuid from t where k = 'p1') and categoria = 'trabalho'), (select v::date + 15 from t where k = 'd0'), 'termina em 15 dias');
select pg_temp.igual((select count(*) from public.tarefa where chave = 'aceite:' || (select v from t where k = 'p1') || ':converter'), 1::bigint, 'tarefa de converter em obra');

-- Nova proposta (8 dias): a sugestão começa depois da 1ª.
select pg_temp.igual((public.agenda_fila(null, 8)->>'livre')::date, (select v::date + 16 from t where k = 'd0'), 'sugestão encaixa depois do trabalho aceito');
select pg_temp.igual((public.agenda_fila(null, 8)->>'fim')::date, (select v::date + 23 from t where k = 'd0'), 'entrega da sugestão');

-- Proposta em aberto (6 dias) também reserva em seguida; desligando, deixa de contar.
insert into t select 'p2', pg_temp.proposta('Reforma B (fictício)', array[6], null, false)::text;
select pg_temp.igual((public.agenda_fila(null, 8)->>'livre')::date, (select v::date + 22 from t where k = 'd0'), 'em aberto reserva depois da aceita');
update public.agenda_config set contar_em_aberto = false;
select pg_temp.igual((public.agenda_fila(null, 8)->>'livre')::date, (select v::date + 16 from t where k = 'd0'), 'sem contar as em aberto');
-- Dois trabalhos ao mesmo tempo: já há vaga.
update public.agenda_config set paralelos = 2, contar_em_aberto = true;
select pg_temp.igual((public.agenda_fila(null, 8)->>'livre')::date, (select v::date + 6 from t where k = 'd0'), 'com duas vagas, cabe quando a em aberto termina');
update public.agenda_config set paralelos = 1, contar_em_aberto = false;

-- 2ª aceita pedindo início antes do fim da 1ª: vai para depois, com nota para combinar com o cliente.
insert into t select 'p3', pg_temp.proposta('Laudo C (fictício)', array[4], (now() at time zone 'America/Sao_Paulo')::date + 3)::text;
select pg_temp.igual((select min(data) from public.tarefa where proposta_id = (select v::uuid from t where k = 'p3') and categoria = 'trabalho'), (select v::date + 16 from t where k = 'd0'), 'sem conflito: depois da 1ª');
select pg_temp.igual((select count(*) from public.tarefa where proposta_id = (select v::uuid from t where k = 'p3') and notas like '%agenda estava ocupada%') > 0, true, 'avisa que a data mudou');

-- 1ª vira obra: as etapas recebem as datas reservadas e a reserva sai da agenda.
insert into t select 'o1', public.converter_proposta((select versao_aprovada_id from public.proposta where id = (select v::uuid from t where k = 'p1')))::text;
select pg_temp.igual((select min(inicio_previsto) from public.etapa where obra_id = (select v::uuid from t where k = 'o1')), (select v::date + 1 from t where k = 'd0'), 'etapas começam na data reservada');
select pg_temp.igual((select max(fim_previsto) from public.etapa where obra_id = (select v::uuid from t where k = 'o1')), (select v::date + 15 from t where k = 'd0'), 'etapas terminam na data reservada');
select pg_temp.igual((select count(*) from public.tarefa where proposta_id = (select v::uuid from t where k = 'p1') and categoria = 'trabalho'), 0::bigint, 'reserva trocada pelas etapas');
select pg_temp.igual((select concluida from public.tarefa where chave = 'aceite:' || (select v from t where k = 'p1') || ':converter'), true, 'tarefa de converter feita');
select pg_temp.igual((select data_previsao_fim from public.obra where id = (select v::uuid from t where k = 'o1')), (select v::date + 15 from t where k = 'd0'), 'previsão de término da obra');
-- A fila continua igual (agora pela obra) e, terminando as etapas antes, a agenda libera antes.
select pg_temp.igual((public.agenda_fila(null, 1)->>'livre')::date, (select v::date + 20 from t where k = 'd0'), 'fila: obra + laudo');
update public.etapa set estado = 'executado', percentual = 100 where obra_id = (select v::uuid from t where k = 'o1');
select pg_temp.igual((public.agenda_fila(null, 1)->>'livre')::date, (select v::date + 20 from t where k = 'd0'), 'laudo ainda reservado na data dele');

-- Avisos: lembrete e resumo saem uma vez; repetir não manda de novo.
reset role;
insert into public.tarefa (titulo, data, repetir) values ('Conferir e-mails', current_date - 10, 'diaria');
insert into public.tarefa (titulo, data) values ('Tarefa esquecida', current_date - 2);
insert into t select 'n1', count(*)::text from public.agenda_avisos_a_enviar(((now() at time zone 'America/Sao_Paulo')::date + time '08:45') at time zone 'America/Sao_Paulo');
select pg_temp.igual((select count(*) from public.agenda_avisado where chave like 'lembrete:%'), 1::bigint, 'lembrete 30 min antes');
select pg_temp.igual((select count(*) from public.agenda_avisado where chave like 'resumo:%'), 1::bigint, 'resumo do dia');
select pg_temp.igual((select count(*) from public.agenda_avisado where chave like 'atraso:tarefa:%'), 1::bigint, 'tarefa atrasada avisada');
select pg_temp.igual((select count(*) from public.agenda_avisos_a_enviar(((now() at time zone 'America/Sao_Paulo')::date + time '09:10') at time zone 'America/Sao_Paulo')), 0::bigint, 'nada repetido');
-- Madrugada: só lembretes, sem resumo nem atrasos.
delete from public.agenda_avisado;
select pg_temp.igual((select count(*) from public.agenda_avisos_a_enviar(((now() at time zone 'America/Sao_Paulo')::date + time '03:00') at time zone 'America/Sao_Paulo')), 0::bigint, 'de madrugada não avisa');
select pg_temp.igual(public.brl(1234567.5), 'R$ 1.234.567,50', 'valor em reais');
