-- Testes do orçamento automático: tabela de preços (permissões) e conversão com as etapas da proposta.
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
create temp table t (k text primary key, v text);
grant all on t to anon, authenticated;
grant execute on all functions in schema pg_temp to anon, authenticated;

-- Tabela de preços
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.igual((select count(*) from public.orcamento_parametro), 8::bigint, 'oito tipos de serviço');
select pg_temp.igual((select count(*) from public.modelo_servico where nome in ('Projeto arquitetônico', 'Regularização de imóvel')), 2::bigint, 'arquitetônico e regularização na biblioteca');
update public.orcamento_parametro set valores = '{"preco_m2": 50}' where tipo = 'projeto_arquitetonico';
select pg_temp.igual((select (valores->>'preco_m2')::numeric from public.orcamento_parametro where tipo = 'projeto_arquitetonico'), 50::numeric, 'admin grava preço do arquitetônico');
update public.orcamento_parametro set valores = '{"preco_m2": 26}' where tipo = 'projeto_estrutural';
select pg_temp.igual((select (valores->>'preco_m2')::numeric from public.orcamento_parametro where tipo = 'projeto_estrutural'), 26::numeric, 'admin grava preço');
select pg_temp.igual((select count(*) from public.modelo_servico where nome = 'Perícia técnica de engenharia'), 1::bigint, 'perícia na biblioteca');

select pg_temp.como('00000000-0000-0000-0000-00000000000b'); -- administrativo sem financeiro
select pg_temp.igual((select count(*) from public.orcamento_parametro), 8::bigint, 'administrativo lê preços');

select pg_temp.como('00000000-0000-0000-0000-00000000000d'); -- campo
select pg_temp.igual((select count(*) from public.orcamento_parametro), 0::bigint, 'campo não lê preços');
update public.orcamento_parametro set valores = '{"preco_m2": 1}' where tipo = 'projeto_estrutural';
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.igual((select (valores->>'preco_m2')::numeric from public.orcamento_parametro where tipo = 'projeto_estrutural'), 26::numeric, 'campo não altera preço');
select pg_temp.como(null);
select pg_temp.deve_falhar($$select * from public.orcamento_parametro$$, 'anônimo lendo preços');

select pg_temp.como('00000000-0000-0000-0000-00000000000a');

-- Conversão usa as etapas (com duração) que o orçamento automático põe no item principal.
with x as (insert into public.proposta (pessoa_id, titulo) values ('10000000-0000-0000-0000-000000000001', 'Projeto automático (fictício)') returning id) insert into t select 'p', id::text from x;
insert into t select 'v', public.nova_versao_proposta((select v::uuid from t where k = 'p'))::text;
update public.proposta_versao set valor_total = 5000, conteudo = jsonb_build_object(
  'validade_dias', 15, 'prazo_texto', '30 dias',
  'ambientes', jsonb_build_array(jsonb_build_object('nome', 'Projeto estrutural', 'itens', jsonb_build_array(
    jsonb_build_object('id', 'g1', 'titulo', 'Projeto estrutural executivo', 'unidade', 'vb', 'quantidade', 1, 'total', 4000,
      'modelo_id', (select id from public.modelo_servico where nome = 'Projeto estrutural em concreto armado'),
      'etapas', jsonb_build_array(
        jsonb_build_object('nome', 'Estudo e concepção', 'percentual', 30, 'duracao_dias', 7),
        jsonb_build_object('nome', 'Cálculo', 'percentual', 40, 'duracao_dias', 10),
        jsonb_build_object('nome', 'Entrega', 'percentual', 0, 'duracao_dias', 5))),
    jsonb_build_object('id', 'g2', 'titulo', 'Visitas', 'unidade', 'vb', 'quantidade', 1, 'total', 1000)))))
where id = (select v::uuid from t where k = 'v');
select public.emitir_versao((select v::uuid from t where k = 'v'));
insert into t select 'tok', public.criar_link_proposta((select v::uuid from t where k = 'v'), 30);
select pg_temp.como(null);
select public.proposta_responder((select v from t where k = 'tok'), 'aceitar', 'Cliente Fictício', null, null, null);
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
insert into t select 'o', public.converter_proposta((select v::uuid from t where k = 'v'))::text;
insert into t select 's', id::text from public.servico where obra_id = (select v::uuid from t where k = 'o') and origem_item_id = 'g1';
select pg_temp.igual((select count(*) from public.etapa where servico_id = (select v::uuid from t where k = 's')), 3::bigint, 'etapas da proposta, não do modelo');
select pg_temp.igual((select string_agg(duracao_dias::text, ',' order by ordem) from public.etapa where servico_id = (select v::uuid from t where k = 's')), '7,10,5', 'durações da proposta');
select pg_temp.igual((select peso from public.etapa where servico_id = (select v::uuid from t where k = 's') and ordem = 3), 5.00, 'etapa sem percentual ganha peso mínimo');
select pg_temp.igual((select count(*) from public.etapa e join public.servico s on s.id = e.servico_id where s.origem_item_id = 'g2' and s.obra_id = (select v::uuid from t where k = 'o')), 1::bigint, 'item sem etapas ganha etapa única');
reset role;
