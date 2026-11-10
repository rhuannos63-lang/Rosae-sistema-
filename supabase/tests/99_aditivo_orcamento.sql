-- Aditivo ligado direto ao orçamento aceito: nasce do orçamento, entra na obra quando ela existir,
-- e o total consolidado soma original + aditivos aprovados sem mexer no original.
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

-- Orçamento original de 5.000 (fictício), ainda em rascunho.
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
with x as (insert into public.proposta (pessoa_id, titulo) values ('10000000-0000-0000-0000-000000000001', 'Reforço de laje (fictício)') returning id) insert into t select 'p', id::text from x;
insert into t select 'v', public.nova_versao_proposta((select v::uuid from t where k = 'p'))::text;
update public.proposta_versao set valor_total = 5000, conteudo = jsonb_build_object('validade_dias', 15, 'local', 'Rua Fictícia, 20', 'cor', 'marinho',
  'ambientes', jsonb_build_array(jsonb_build_object('nome', 'Laje', 'itens', jsonb_build_array(jsonb_build_object('id', 'o1', 'titulo', 'Reforço da laje', 'unidade', 'vb', 'quantidade', 1, 'total', 5000)))))
where id = (select v::uuid from t where k = 'v');
select pg_temp.deve_falhar($$select public.criar_aditivo((select v::uuid from t where k = 'p'), 'Extra')$$, 'aditivo em orçamento não aceito');

select public.emitir_versao((select v::uuid from t where k = 'v'));
insert into t select 'tok', public.criar_link_proposta((select v::uuid from t where k = 'v'), 30);
select pg_temp.como(null);
select public.proposta_responder((select v from t where k = 'tok'), 'aceitar', 'Cliente Fictício', null, null, null);
select pg_temp.deve_falhar($$select public.criar_aditivo((select v::uuid from t where k = 'p'), 'Extra')$$, 'anônimo criando aditivo');
select pg_temp.como('00000000-0000-0000-0000-00000000000d');
select pg_temp.deve_falhar($$select public.criar_aditivo((select v::uuid from t where k = 'p'), 'Extra')$$, 'campo criando aditivo');

-- Aditivo nasce do orçamento aceito, antes de existir obra.
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.deve_falhar($$select public.criar_aditivo((select v::uuid from t where k = 'p'), '  ')$$, 'aditivo sem título');
insert into t select 'a1', public.criar_aditivo((select v::uuid from t where k = 'p'), 'Impermeabilização da laje', 'Pedido do cliente')::text;
select pg_temp.igual((select tipo from public.proposta where id = (select v::uuid from t where k = 'a1')), 'aditivo', 'é aditivo');
select pg_temp.igual((select proposta_origem_id::text from public.proposta where id = (select v::uuid from t where k = 'a1')), (select v from t where k = 'p'), 'ligado ao orçamento');
select pg_temp.igual((select obra_id from public.proposta where id = (select v::uuid from t where k = 'a1')), null::uuid, 'sem obra ainda');
select pg_temp.igual((select codigo like 'ADT-%' from public.proposta where id = (select v::uuid from t where k = 'a1')), true, 'código ADT');
insert into t select 'va1', id::text from public.proposta_versao where proposta_id = (select v::uuid from t where k = 'a1');
select pg_temp.igual((select conteudo->'aditivo_de'->>'codigo' from public.proposta_versao where id = (select v::uuid from t where k = 'va1')),
  (select codigo from public.proposta where id = (select v::uuid from t where k = 'p')), 'versão 1 cita o orçamento original');
select pg_temp.igual((select conteudo->>'cor' from public.proposta_versao where id = (select v::uuid from t where k = 'va1')), 'marinho', 'herda a cor');
select pg_temp.igual((select conteudo->>'motivo' from public.proposta_versao where id = (select v::uuid from t where k = 'va1')), 'Pedido do cliente', 'motivo preenchido');

-- Itens e valor próprios; cliente aceita.
update public.proposta_versao set valor_total = 1200, conteudo = conteudo || '{"ambientes":[{"nome":"Laje","itens":[{"id":"x1","titulo":"Impermeabilização","unidade":"m2","quantidade":40,"total":1200}]}]}'
where id = (select v::uuid from t where k = 'va1');
select public.emitir_versao((select v::uuid from t where k = 'va1'));
insert into t select 'toka', public.criar_link_proposta((select v::uuid from t where k = 'va1'), 30);
select pg_temp.como(null);
select public.proposta_responder((select v from t where k = 'toka'), 'aceitar', 'Cliente Fictício', null, null, null);
select pg_temp.como('00000000-0000-0000-0000-00000000000a');

-- Segundo aditivo, ainda em rascunho (criado a partir do primeiro: liga ao original).
insert into t select 'a2', public.criar_aditivo((select v::uuid from t where k = 'a1'), 'Troca de ralos')::text;
select pg_temp.igual((select proposta_origem_id::text from public.proposta where id = (select v::uuid from t where k = 'a2')), (select v from t where k = 'p'), 'aditivo de aditivo liga ao original');
update public.proposta_versao set valor_total = 300 where proposta_id = (select v::uuid from t where k = 'a2');

-- Total consolidado: só aprovados somam; original não muda.
select pg_temp.igual((public.resumo_orcamento((select v::uuid from t where k = 'p'))->>'valor_original')::numeric, 5000.00, 'original preservado');
select pg_temp.igual((public.resumo_orcamento((select v::uuid from t where k = 'p'))->>'aditivos_aprovados')::numeric, 1200.00, 'aditivos aprovados');
select pg_temp.igual((public.resumo_orcamento((select v::uuid from t where k = 'p'))->>'aditivos_em_aberto')::numeric, 300.00, 'aditivos em aberto');
select pg_temp.igual((public.resumo_orcamento((select v::uuid from t where k = 'p'))->>'total_consolidado')::numeric, 6200.00, 'total consolidado');
select pg_temp.igual(jsonb_array_length(public.resumo_orcamento((select v::uuid from t where k = 'p'))->'aditivos'), 2, 'histórico com os dois');
select pg_temp.igual((select valor_total from public.proposta_versao where id = (select v::uuid from t where k = 'v')), 5000.00, 'versão aprovada intacta');

-- Orçamento vira obra: aditivos passam a pertencer a ela e o aprovado entra como serviço.
insert into t select 'o', public.converter_proposta((select v::uuid from t where k = 'v'))::text;
select pg_temp.igual((select obra_id::text from public.proposta where id = (select v::uuid from t where k = 'a1')), (select v from t where k = 'o'), 'aditivo 1 herdou a obra');
select pg_temp.igual((select obra_id::text from public.proposta where id = (select v::uuid from t where k = 'a2')), (select v from t where k = 'o'), 'aditivo 2 herdou a obra');
select public.converter_proposta((select versao_aprovada_id from public.proposta where id = (select v::uuid from t where k = 'a1')));
select pg_temp.igual((select count(*) from public.servico where obra_id = (select v::uuid from t where k = 'o')), 2::bigint, 'original + aditivo na obra');
select pg_temp.igual((public.resumo_obra((select v::uuid from t where k = 'o'))->>'aditivos')::numeric, 1200.00, 'obra mostra o aditivo');
select pg_temp.igual((select valor_contratado from public.obra_financeiro where obra_id = (select v::uuid from t where k = 'o')), 5000.00, 'contratado original preservado');
select pg_temp.igual((select count(*) from public.lancamento where obra_id = (select v::uuid from t where k = 'o') and tipo = 'receber'), 2::bigint, 'recebimento do aditivo previsto');
select pg_temp.igual((public.resumo_orcamento((select v::uuid from t where k = 'p'))->'aditivos'->0->>'incorporado')::boolean, true, 'histórico marca incorporado');

-- Aditivo novo depois da obra já nasce dentro dela.
insert into t select 'a3', public.criar_aditivo((select v::uuid from t where k = 'p'), 'Pintura extra')::text;
select pg_temp.igual((select obra_id::text from public.proposta where id = (select v::uuid from t where k = 'a3')), (select v from t where k = 'o'), 'aditivo pós-obra já na obra');

-- Só aditivo tem origem.
select pg_temp.deve_falhar($$insert into public.proposta (pessoa_id, titulo, proposta_origem_id) values ('10000000-0000-0000-0000-000000000001', 'X', (select v::uuid from t where k = 'p'))$$, 'proposta comum com origem');
reset role;
