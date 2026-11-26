-- Números das propostas batem com a situação real: duas enviadas sem resposta contam duas,
-- rascunho não conta como enviada, nova versão em preparo continua com o cliente e vencida aparece.
create or replace function pg_temp.como(p_usuario uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_usuario::text, ''), false);
  if p_usuario is null then execute 'set role anon'; else execute 'set role authenticated'; end if;
end $$;
create or replace function pg_temp.igual(p_obtido anyelement, p_esperado anyelement, p_motivo text) returns void language plpgsql as $$
begin
  if p_obtido is distinct from p_esperado then
    raise exception 'FALHOU: % (obtido %, esperado %)', p_motivo, p_obtido, p_esperado;
  end if;
end $$;
create or replace function pg_temp.nova(p_titulo text, p_emitir boolean) returns uuid language plpgsql as $$
declare v_p uuid; v_v uuid;
begin
  insert into public.proposta (pessoa_id, titulo) values ('10000000-0000-0000-0000-000000000001', p_titulo) returning id into v_p;
  v_v := public.nova_versao_proposta(v_p);
  update public.proposta_versao set valor_total = 1000, conteudo = jsonb_build_object('validade_dias', 15,
    'ambientes', jsonb_build_array(jsonb_build_object('nome', 'Geral', 'itens', jsonb_build_array(jsonb_build_object('id', 'i1', 'titulo', 'Serviço', 'unidade', 'vb', 'quantidade', 1, 'total', 1000)))))
  where id = v_v;
  if p_emitir then perform public.emitir_versao(v_v); end if;
  return v_p;
end $$;
create temp table t (k text primary key, v text);
create temp table base (k text primary key, n int);
grant all on t, base to anon, authenticated;
grant execute on all functions in schema pg_temp to anon, authenticated;

select pg_temp.como('00000000-0000-0000-0000-00000000000a');
insert into base select k, (public.resumo_comercial(current_date, current_date)->>k)::int
from unnest(array['enviadas', 'em_negociacao', 'vencidas', 'com_cliente', 'rascunhos']) k;

insert into t values ('a', pg_temp.nova('Proposta A (fictícia)', true)::text);
insert into t values ('b', pg_temp.nova('Proposta B (fictícia)', true)::text);
insert into t values ('c', pg_temp.nova('Proposta C (fictícia)', false)::text);
select pg_temp.igual(public.situacao_proposta(p), 'aguardando', 'emitida aguarda') from public.proposta p where id = (select v::uuid from t where k = 'a');
select pg_temp.igual(public.situacao_proposta(p), 'rascunho', 'não emitida é rascunho') from public.proposta p where id = (select v::uuid from t where k = 'c');

-- Duas enviadas sem resposta: +2 aguardando; rascunho conta só como rascunho.
select pg_temp.igual((public.resumo_comercial(current_date, current_date)->>'enviadas')::int - (select n from base where k = 'enviadas'), 2, 'duas enviadas');
select pg_temp.igual((public.resumo_comercial(current_date, current_date)->>'rascunhos')::int - (select n from base where k = 'rascunhos'), 1, 'um rascunho');

-- B ganha nova versão (alterar valor): continua com o cliente, como "revisando".
select public.nova_versao_proposta((select v::uuid from t where k = 'b'));
select pg_temp.igual(public.situacao_proposta(p), 'revisando', 'nova versão em preparo') from public.proposta p where id = (select v::uuid from t where k = 'b');
select pg_temp.igual((public.resumo_comercial(current_date, current_date)->>'em_negociacao')::int - (select n from base where k = 'em_negociacao'), 1, 'revisando conta em negociação');
select pg_temp.igual((public.resumo_comercial(current_date, current_date)->>'com_cliente')::int - (select n from base where k = 'com_cliente'), 2, 'as duas seguem com o cliente');

-- A vence sem resposta.
reset role;
set session_replication_role = replica; -- só no teste: simula o tempo passando numa versão congelada
update public.proposta_versao set validade = current_date - 1 where proposta_id = (select v::uuid from t where k = 'a');
set session_replication_role = origin;
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.igual(public.situacao_proposta(p), 'vencida', 'vencida') from public.proposta p where id = (select v::uuid from t where k = 'a');
select pg_temp.igual((public.resumo_comercial(current_date, current_date)->>'vencidas')::int - (select n from base where k = 'vencidas'), 1, 'uma vencida');
select pg_temp.igual((public.resumo_comercial(current_date, current_date)->>'com_cliente')::int - (select n from base where k = 'com_cliente'), 2, 'vencida ainda é enviada sem aprovação');

-- Marcada como recusada sai da conta.
update public.proposta set estado = 'recusada' where id = (select v::uuid from t where k = 'a');
select pg_temp.igual((public.resumo_comercial(current_date, current_date)->>'com_cliente')::int - (select n from base where k = 'com_cliente'), 1, 'recusada sai');
reset role;
