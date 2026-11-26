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


-- Base de insumos e composições
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.igual((select count(*) > 50 from public.insumo), true, 'insumos iniciais');
select pg_temp.igual((select count(*) > 20 from public.composicao), true, 'composições iniciais');
select pg_temp.igual((select count(*) from public.composicao c where not exists (select 1 from public.composicao_item i where i.composicao_id = c.id)), 0::bigint, 'toda composição tem insumos');
update public.insumo set preco = 31 where codigo = 'MO-001';
select pg_temp.igual((select preco from public.insumo where codigo = 'MO-001'), 31.0000, 'financeiro edita o preço da mão de obra');

select pg_temp.como('00000000-0000-0000-0000-00000000000b'); -- administrativo sem financeiro
select pg_temp.igual((select count(*) from public.insumo), 0::bigint, 'sem financeiro não vê preços de insumos');
select pg_temp.igual((select count(*) > 20 from public.composicao), true, 'administrativo lê composições');
update public.composicao set nome = 'x' where codigo = 'CP-001';
select pg_temp.como('00000000-0000-0000-0000-00000000000d'); -- campo
select pg_temp.igual((select count(*) from public.composicao), 0::bigint, 'campo não vê composições');
select pg_temp.como(null);
select pg_temp.deve_falhar($$select * from public.insumo$$, 'anônimo lendo insumos');

-- Lista de compras da proposta aprovada
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.igual((select nome from public.composicao where codigo = 'CP-001'), 'Alvenaria de vedação com bloco cerâmico 9 cm', 'administrativo não altera composição');
with x as (insert into public.proposta (pessoa_id, titulo) values ('10000000-0000-0000-0000-000000000001', 'Reforma com composição (fictício)') returning id) insert into t select 'p', id::text from x;
insert into t select 'v', public.nova_versao_proposta((select v::uuid from t where k = 'p'))::text;
update public.proposta_versao set valor_total = 9000, conteudo = jsonb_build_object(
  'validade_dias', 15, 'prazo_texto', '30 dias',
  'ambientes', jsonb_build_array(jsonb_build_object('nome', 'Banheiro', 'itens', jsonb_build_array(
    jsonb_build_object('id', 'r1', 'titulo', 'Paredes novas', 'unidade', 'm2', 'quantidade', 10, 'total', 5000),
    jsonb_build_object('id', 'r2', 'titulo', 'Piso', 'unidade', 'm2', 'quantidade', 8, 'total', 4000)))))
where id = (select v::uuid from t where k = 'v');
insert into public.proposta_custo (versao_id, custos, custo_total) values ((select v::uuid from t where k = 'v'), jsonb_build_object('padrao', 'premium', 'composicoes', jsonb_build_array(
  jsonb_build_object('item_id', 'r1', 'composicao_id', (select id from public.composicao where codigo = 'CP-001'), 'quantidade', 10, 'perda_pct', 0),
  jsonb_build_object('item_id', 'r2', 'composicao_id', (select id from public.composicao where codigo = 'CP-004'), 'quantidade', 8, 'perda_pct', 10),
  jsonb_build_object('item_id', 'r2', 'composicao_id', (select id from public.composicao where codigo = 'CP-005'), 'quantidade', 8, 'perda_pct', 10))), 3000);
select public.emitir_versao((select v::uuid from t where k = 'v'));
insert into t select 'tok', public.criar_link_proposta((select v::uuid from t where k = 'v'), 30);
select pg_temp.como(null);
select public.proposta_responder((select v from t where k = 'tok'), 'aceitar', 'Cliente Fictício', null, null, null);
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
insert into t select 'o', public.converter_proposta((select v::uuid from t where k = 'v'))::text;
select pg_temp.igual(public.gerar_lista_compras((select v::uuid from t where k = 'o')) > 0, true, 'lista de compras gerada');
-- Blocos: 10 m² × 25,5 = 255 un, para o serviço das paredes.
select pg_temp.igual((select quantidade from public.material where obra_id = (select v::uuid from t where k = 'o') and descricao like 'Bloco cerâmico%'), 255.000, 'quantidade de blocos');
select pg_temp.igual((select s.origem_item_id from public.material m join public.servico s on s.id = m.servico_id where m.obra_id = (select v::uuid from t where k = 'o') and m.descricao like 'Bloco cerâmico%'), 'r1', 'material ligado ao serviço');
-- Cimento: 10 × 2 + 8 × 10 × 1,1 = 108 kg = 3 sacos de 50 kg (arredonda para cima); usado em dois serviços.
select pg_temp.igual((select quantidade || ' ' || unidade from public.material where obra_id = (select v::uuid from t where k = 'o') and descricao like 'Cimento%'), '3.000 saco 50 kg', 'cimento em sacos');
select pg_temp.igual((select servico_id is null from public.material where obra_id = (select v::uuid from t where k = 'o') and descricao like 'Cimento%'), true, 'material de vários serviços fica sem serviço');
-- Porcelanato: 8 × 1,10 × 1,10 = 9,68 m².
select pg_temp.igual((select quantidade from public.material where obra_id = (select v::uuid from t where k = 'o') and descricao like 'Porcelanato%'), 9.680, 'porcelanato com perda');
select pg_temp.igual((select descricao from public.material where obra_id = (select v::uuid from t where k = 'o') and descricao like 'Porcelanato%'), (select nome from public.insumo where nome like 'Porcelanato%' limit 1) || ' (padrão premium)', 'acabamento sai com o padrão');
select pg_temp.igual((select descricao from public.material where obra_id = (select v::uuid from t where k = 'o') and descricao like 'Cimento%'), (select nome from public.insumo where nome like 'Cimento%' limit 1), 'material comum não leva padrão');
select pg_temp.igual((select count(*) from public.material where obra_id = (select v::uuid from t where k = 'o') and origem_versao_id is not null and visivel_cliente), 0::bigint, 'lista não aparece para o cliente');
select pg_temp.deve_falhar($$select public.gerar_lista_compras((select v::uuid from t where k = 'o'))$$, 'gerar a lista duas vezes');
select pg_temp.como('00000000-0000-0000-0000-00000000000d');
select pg_temp.deve_falhar($$select public.gerar_lista_compras((select v::uuid from t where k = 'o'))$$, 'campo gerando lista');
reset role;

-- Condições da obra e logística
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.igual((select count(*) > 15 from public.condicao_obra where ativo), true, 'condições iniciais');
update public.condicao_obra set mao_de_obra_pct = 14 where codigo = 'AC-03';
select pg_temp.igual((select mao_de_obra_pct from public.condicao_obra where codigo = 'AC-03'), 14.00, 'financeiro edita o percentual');
select pg_temp.deve_falhar($$update public.condicao_obra set material_pct = -1 where codigo = 'AC-03'$$, 'percentual negativo');
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select pg_temp.igual((select count(*) > 15 from public.condicao_obra), true, 'administrativo lê as condições');
update public.condicao_obra set mao_de_obra_pct = 99 where codigo = 'AC-03';
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.igual((select mao_de_obra_pct from public.condicao_obra where codigo = 'AC-03'), 14.00, 'administrativo não altera');
select pg_temp.como('00000000-0000-0000-0000-00000000000d');
select pg_temp.igual((select count(*) from public.condicao_obra), 0::bigint, 'campo não vê as condições');
select pg_temp.como(null);
select pg_temp.deve_falhar($$select * from public.condicao_obra$$, 'anônimo lendo condições');
reset role;
